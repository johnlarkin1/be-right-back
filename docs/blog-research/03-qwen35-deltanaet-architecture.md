# Research Report: Qwen3.5 Gated DeltaNet Architecture

> Reference material for writing about why Qwen3.5's hybrid attention matters for on-device AI
> Generated: 2026-04-03

---

## What's Novel

Qwen3.5 (March 2026, Alibaba) is the first widely-adopted model family using **Gated DeltaNet** linear attention in a hybrid architecture. 75% of layers use DeltaNet (fixed-size state), 25% use standard softmax attention. This makes 262K context feasible on consumer hardware.

---

## The 3:1 Hybrid Pattern

Every Qwen3.5 model repeats:
```
3 × (Gated DeltaNet → FFN) → 1 × (Full Attention → FFN)
```

For the 9B model (32 layers):
- Layers 0-2: DeltaNet, Layer 3: Full Attention
- Layers 4-6: DeltaNet, Layer 7: Full Attention
- ... repeating through Layer 31
- 24 DeltaNet layers, 8 Full Attention layers

Config encodes this as `layer_types` array and `full_attention_interval: 4`.

---

## Why This Matters for On-Device

### Standard Transformer (Qwen3)
- Every layer needs a KV cache
- KV cache grows linearly with context length
- 9B model at 32K context ≈ 4-6GB KV cache
- 262K context is impossible on 24GB M3 Pro

### Qwen3.5 Hybrid
- DeltaNet layers have **fixed-size state** (d × d matrix, doesn't grow with context)
- Only 25% of layers (8 out of 32) need KV cache
- KV cache memory reduced by ~75%
- 262K context becomes feasible on consumer hardware
- 9B variant beats GPT-OSS-120B on benchmarks while being 13x smaller

---

## DeltaNet Technical Details

### The Delta Rule
Standard linear attention: `S_t = S_{t-1} + v_t * k_t^T` (associative scan, never forgets)
- Problem: Unbounded state growth, old associations persist forever

Delta rule: `S_t = S_{t-1} + v_t * k_t^T - (k_t^T * S_{t-1}) * k_t`
- The subtraction term "erases" old key-value associations before writing new ones
- Like a dictionary that replaces values instead of just appending

### Gating
Gated DeltaNet adds learned gates:
- Output gate: controls what information flows out of the state
- WY decomposition: efficient matrix computation trick
- Result: selectively reads/writes state, more expressive than simple delta rule

### Fixed-Size State
- State matrix is `d × d` (hidden_dim × hidden_dim) per layer
- For 9B: 4096 × 4096 = 16M floats per DeltaNet layer
- Compare to KV cache: grows with `context_length × hidden_dim × 2`
- At 262K tokens: KV cache per layer ≈ 262K × 4096 × 2 = 2.1B values
- DeltaNet state: always 16M values. That's 131x smaller per layer.

---

## Model Family Specs

| Model | Params | Layers | Hidden | Context | DeltaNet Layers | Full Attn Layers |
|-------|--------|--------|--------|---------|-----------------|------------------|
| 0.8B | 0.8B | 24 | 1024 | 262K | 18 | 6 |
| 2B | 2B | 24 | 2048 | 262K | 18 | 6 |
| 4B | 4B | 32 | 2560 | 262K | 24 | 8 |
| 9B | 9B | 32 | 4096 | 262K→1M | 24 | 8 |
| 397B-A17B | 397B total, 17B active | 60 | 4096 | 262K | 45 | 15 |

All use:
- 248,320 vocab size
- ChatML template (same as Qwen3)
- Natively multimodal (vision + language)
- Thinking mode support
- Multi-Token Prediction (MTP)

---

## LoRA Fine-Tuning Implications

### Different LoRA Targets
Standard Transformer LoRA targets: `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`

Qwen3.5 adds DeltaNet-specific targets:
- `linear_attn.q_proj` — query projection in DeltaNet layers
- `linear_attn.k_proj` — key projection
- `linear_attn.v_proj` — value projection
- `linear_attn.out_proj` — output projection (unique to DeltaNet, no equivalent in standard attention)
- `linear_attn.beta_proj` — gating parameter
- `linear_attn.o_gate` — output gate

### BRB Implementation
- Auto-detects LoRA target modules per model family
- Qwen3.5: targets include `linear_attn.out_proj` (DeltaNet-specific)
- Uses MLX's `lora.train_model()` with adaptive learning
- Checkpoints with early stopping via `StopIteration` callback

---

## The TurboQuant Spike (What Didn't Work)

You researched TurboQuant KV cache compression (2026-03-28):
- **Finding**: TurboQuant works but **regressed performance 15-23%** on Qwen3.5-9B
- **Why**: Only 8/32 layers (the full attention layers) have KV cache to compress
- DeltaNet layers already have fixed-size state — nothing to compress
- The overhead of quantizing/dequantizing the small number of KV caches outweighed savings
- **Decision**: Not viable for 9B; revisit for larger models (35B+) where more layers = more KV cache

Docs:
- `docs/research/2026-03-28-turboquant-kv-cache-compression.md`
- `docs/spikes/2026-03-28-turboquant-integration-spike.md`

---

## MLX-Specific Details

### MLX-LM Version Pinning
- Pinned to `>=0.31.3` from PyPI
- Required for Qwen3.5 DeltaNet architecture support, which reached PyPI in 0.31.0
- Earlier versions don't know about `linear_attn` layer type
- Was briefly pinned to a `git+` URL at an unreleased commit, before the support was
  published. That has to stay a registry dependency: uv shells out to the `git` CLI for git
  dependencies, and on a Mac without Xcode Command Line Tools `/usr/bin/git` is a stub that
  opens the CLT installer and fails, breaking first-run setup in the bundled app.

### The make_sampler() API Break (mlx-lm 0.28+)
- `generate()` no longer accepts `temp=` directly
- Must use `make_sampler(temp=temperature, top_p=top_p)` and pass `sampler=` to `generate()`
- `repetition_penalty` requires `make_logits_processors()`
- This broke the inference daemon and took debugging to find

### 4-bit Quantization
- All models used as `4bit` variants from `mlx-community/`
- 9B 4-bit ≈ 5GB model weights
- Practical for 16GB+ Apple Silicon machines

---

## Existing Documentation

| Doc | Path | Content |
|-----|------|---------|
| Deep architecture report | `docs/research/2026-03-04-qwen3.5-architecture-report.md` | 200+ lines, full deep-dive |
| TurboQuant spike | `docs/spikes/2026-03-28-turboquant-integration-spike.md` | What didn't work |
| TurboQuant research | `docs/research/2026-03-28-turboquant-kv-cache-compression.md` | KV cache compression theory |
| MLX-RS research | `docs/research/MLX_RS_PROJECT.md` | Alternative Rust bindings analysis |
| Model cards | `docs/model-cards/qwen3.5/` | 3 cards (0.8B, 2B, 4B, 9B) |

---

## Narrative Angles

1. **"The end of quadratic attention?"** — Qwen3.5 proves hybrid linear/standard attention is production-ready. What took GPT-4 massive compute, this achieves on a laptop.

2. **"Why 75/25?"** — The 3:1 ratio isn't arbitrary. Full attention layers act as "global context checkpoints" — DeltaNet handles local patterns, full attention handles long-range dependencies. Like having both fast cache and slow storage.

3. **"The failed optimization"** — TurboQuant didn't help because the architecture already solved the KV cache problem. When 75% of layers don't even have a KV cache, compressing the remaining 25% yields diminishing returns.

4. **"LoRA on an alien architecture"** — Fine-tuning DeltaNet layers requires different target modules. Auto-detection was necessary because the community hasn't standardized this yet.

5. **"262K context on a MacBook"** — The practical implications. You can search through years of messages and fit the context into a single prompt.

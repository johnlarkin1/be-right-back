# Research Report: LoRA Fine-Tuning Pipeline on Apple Silicon

> Reference material for writing about local persona training with MLX
> Generated: 2026-04-03

---

## What You Built

A LoRA fine-tuning pipeline that takes iMessage exports (JSONL), trains a personalized adapter on Apple Silicon using MLX, with adaptive model selection based on available VRAM, checkpointing with early stopping, and loss visualization.

---

## Data Pipeline

```
iMessage DB
  │
  ├─ Snapshot (read-only copy)
  │
  ├─ Message extraction (Rust, per-contact)
  │     → decode attributedBody, filter reactions, normalize timestamps
  │
  ├─ JSONL export (Rust, crates/training/)
  │     → ChatML format with system + user + assistant turns
  │     → Sampling strategies for balanced training data
  │
  └─ LoRA Training (Python, MLX)
        → Load base model (4-bit quantized)
        → Apply LoRA adapters to target modules
        → Train on JSONL data
        → Save adapter weights + loss history
```

---

## JSONL Training Data Format

### ChatML Format (Qwen3/3.5)
```json
{"messages": [
  {"role": "system", "content": "You are [contact_name]. Respond in their style..."},
  {"role": "user", "content": "Hey, what are you up to?"},
  {"role": "assistant", "content": "nm just chilling, wanna grab food?"}
]}
```

### Data Preparation (Rust side — `crates/training/`)
- `export/jsonl.rs` — Main JSONL export (7 tests)
- `export/stats.rs` — Training data statistics (7 tests)
- `export/sampling.rs` — Sampling strategies for balanced data (6 tests)
- `export/prompt_template.rs` — ChatML template generation (5 tests)
- `export/llm_analyze.rs` — LLM-based persona analysis (3 tests)

### Sampling Strategies
- **Recent-weighted**: More recent messages weighted higher
- **Balanced per-conversation**: Equal representation across conversations
- **Deduplication**: Remove exact duplicate messages

### Known Gaps in Data Filtering (from NEXT_UP.md)
- [ ] Remove <5 word messages
- [ ] Remove exact duplicates
- [ ] Remove media-only messages (tapback reactions: "Loved", "Liked", "Emphasized")
- [ ] Filter non-primary-language messages
- [ ] Add multi-turn context (3-5 prior messages as conversation history)

---

## Model Tier System

Dynamic VRAM-based model selection (`crates/common/src/model_tiers.rs`, 6 tests):

| Tier | VRAM Required | Model | Parameters |
|------|--------------|-------|-----------|
| 9B | 24GB+ (M3 Pro 36GB, M4 Max) | `mlx-community/Qwen3.5-9B-4bit` | 9 billion |
| 4B | 16GB+ (M3 Pro 18GB) | `mlx-community/Qwen3.5-4B-4bit` | 4 billion |
| 2B | 12GB+ (M2 16GB) | `mlx-community/Qwen3.5-2B-4bit` | 2 billion |
| 0.8B | 8GB+ (base M1/M2/M3) | `mlx-community/Qwen3.5-0.8B-4bit` | 0.8 billion |

All are 4-bit quantized from `mlx-community/` (MLX-optimized quantization for Apple Silicon).

---

## LoRA Configuration

### Current Defaults
```python
# mlx/src/core/train.py
lora_config = {
    "rank": 16,
    "alpha": 16,        # alpha/rank = 1.0
    "dropout": 0.0,     # No dropout currently
    "target_modules": auto_detected,  # Per model family
}
```

### Recommended (from evals strategy doc, not yet applied)
```python
lora_config = {
    "rank": 16,
    "alpha": 16,        # alpha/rank = 1.0 (same)
    "dropout": 0.1,     # Add regularization
    "lr": 1e-4,         # Learning rate
    "kl_penalty": 0.05, # Keep model close to base
}
# + cosine LR schedule with 5% warmup
# + target ALL linear layers (not just attention)
```

### Auto-Detected LoRA Targets

**Qwen3 (standard Transformer):**
`q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`

**Qwen3.5 (DeltaNet hybrid):**
All of the above PLUS:
- `linear_attn.q_proj`
- `linear_attn.k_proj`
- `linear_attn.v_proj`
- `linear_attn.out_proj` (unique to DeltaNet)
- `linear_attn.beta_proj` (gating)
- `linear_attn.o_gate` (output gate)

---

## Training Process

### MLX Training Call
```python
from mlx_lm.lora import train_model

# train.py orchestration:
# 1. Load base model + tokenizer
# 2. Apply LoRA adapters to detected target modules
# 3. Load JSONL training data
# 4. Train with callbacks for:
#    - Progress reporting (JSON-lines to stdout)
#    - Checkpointing
#    - Early stopping (StopIteration)
#    - Loss history recording
```

### Checkpointing
- Saves adapter weights at configurable intervals
- Loss history tracked per step
- Matplotlib loss plots generated on completion
- Early stopping via `StopIteration` exception in training callback

### Progress Reporting
```json
{"type": "stage_progress", "stage": "training", "percent": 45, "message": "Epoch 2/4, Loss: 1.23"}
```

Rust side parses JSON-lines and emits Tauri `training-status` events to frontend.

---

## MLX-Specific Details

### Why MLX (vs PyTorch, ONNX, llama.cpp)
- **Native Apple Silicon support** — uses Metal GPU directly
- **Unified memory** — CPU and GPU share memory, no explicit transfers
- **Lazy evaluation** — operations are computed on demand
- **mlx-lm library** — provides `generate()`, `lora.train_model()`, `make_sampler()`
- **Community quantized models** — `mlx-community/` has ready-to-use 4/8-bit models

### The mlx-lm 0.28+ API Break
Before:
```python
response = generate(model, tokenizer, prompt=prompt, temp=0.7, top_p=0.9)
```

After:
```python
from mlx_lm.sample_utils import make_sampler, make_logits_processors
sampler = make_sampler(temp=0.7, top_p=0.9)
logits_processors = make_logits_processors(repetition_penalty=1.1, repetition_context_size=20)
response = generate(model, tokenizer, prompt=prompt, sampler=sampler, logits_processors=logits_processors)
```

Note: `make_sampler()` uses `temp=` (not `temperature=`).

---

## Embedding Model

| Property | Value |
|----------|-------|
| Model | `mlx-community/nomicai-modernbert-embed-base-8bit` |
| Dimensions | 768 |
| Quantization | 8-bit |
| Use | Vector embeddings for RAG search |
| Storage | DuckDB HNSW index |

### Chunk Configuration
```python
# mlx/src/config/embedding.py
CHUNK_WINDOW = 8     # messages per chunk
CHUNK_STRIDE = 4     # stride (50% overlap)
# Average chunk size: ~420 characters
```

---

## Persona Analysis

Two-phase LLM-driven personality profiling:

### Phase 1: Message Sampling
- Sample representative messages from the user's sent messages
- Focus on messages with personality indicators (emoji, slang, tone markers)

### Phase 2: LLM Analysis
- Feed sampled messages to the base model
- Generate personality profile: writing style, common phrases, emoji patterns, formality level
- Output used as system prompt for persona inference

Implementation: `mlx/src/entry/analyze_persona.py` — communicates via stdin JSON with Rust.

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Python training code | 376 lines (`mlx/src/core/train.py`) |
| Python embedding code | 764 lines (`mlx/src/pipelines/embedding.py`) |
| Rust training export | `crates/training/` (28 tests across 4 files) |
| Model tiers | 4 (0.8B → 9B) |
| Default LoRA rank | 16 |
| Embedding dimensions | 768 |
| Chunk window | 8 messages |
| Chunk stride | 4 messages |

---

## Code Locations

| Component | Path |
|-----------|------|
| Training entry point (Python) | `mlx/src/core/train.py` |
| Embedding pipeline (Python) | `mlx/src/pipelines/embedding.py` |
| Analytics pipeline (Python) | `mlx/src/entry/analytics.py` |
| Persona analysis (Python) | `mlx/src/entry/analyze_persona.py` |
| Inference daemon (Python) | `mlx/src/entry/inference_daemon.py` |
| Embedding config | `mlx/src/config/embedding.py` |
| Training config | `mlx/src/config/` |
| JSONL export (Rust) | `crates/training/src/export/jsonl.rs` |
| Training data stats (Rust) | `crates/training/src/export/stats.rs` |
| Sampling strategies (Rust) | `crates/training/src/export/sampling.rs` |
| Prompt templates (Rust) | `crates/training/src/export/prompt_template.rs` |
| Model tier selection (Rust) | `crates/common/src/model_tiers.rs` |

---

## Narrative Angles

1. **"Fine-tuning a language model to sound like you"** — The training data pipeline: from iMessage → JSONL → LoRA adapter. What makes good training data, what doesn't (reactions, <5 word messages, media-only).

2. **"The model tier ladder"** — Adaptive model selection based on your Mac's memory. 8GB gets 0.8B, 36GB gets 9B. The quality difference is real but 0.8B is still usable.

3. **"LoRA on DeltaNet: targeting the right modules"** — Standard LoRA guides don't cover Qwen3.5's linear attention layers. Auto-detection across model families because the community hasn't standardized this.

4. **"The eval gap"** — You can train a persona, but how do you know it sounds right? Currently there's no way to measure "does this sound like me." The existential product question.

5. **"MLX: the Apple Silicon ML framework nobody talks about"** — Why MLX exists (Apple-native alternative to PyTorch), what works well (quantization, LoRA, generation), what's rough (documentation, ecosystem maturity, API stability).

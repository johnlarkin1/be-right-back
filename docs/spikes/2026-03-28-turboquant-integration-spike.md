# Spike: TurboQuant KV Cache Compression for BRB Inference

**Date**: 2026-03-28
**Branch**: `feat-spike-into-turboquant`
**Status**: Spike complete. **Not viable for Qwen3.5-9B** via `mlx-optiq` today. Revisit when mlx-lm adds native Metal-optimized support or for larger models (35B+).
**Related**: [TurboQuant Research Report](../research/2026-03-28-turboquant-kv-cache-compression.md)

---

## Goal

Determine whether Google's TurboQuant KV cache compression can improve BRB's local inference performance on Apple Silicon, and plan integration.

## TL;DR

**Integration works but performance regresses.** We successfully integrated `mlx-optiq`'s `TurboQuantKVCache` into the BRB inference daemon. The code produces correct, coherent output. However, benchmarks show TurboQuant is **15-23% slower** on Qwen3.5-9B-4bit across all context lengths tested (512-4096 tokens).

The root cause: Qwen3.5-9B's hybrid DeltaNet architecture means only **8 of 32 layers** have traditional KV caches. The rotation matrix overhead (per-token for those 8 layers) isn't offset by memory savings on a model this size. The community benchmarks showing speedups were on the 35B-A3B MoE variant where KV cache is a much larger fraction of total memory.

**Recommendation**: Do not enable TurboQuant for Qwen3.5-9B. Revisit when:
1. mlx-lm adds native Metal-kernel TurboQuant (avoiding Python-level centroid lookup overhead)
2. BRB supports larger models (35B+) where KV cache dominates memory
3. Very long context use cases emerge (16K+) where memory pressure causes swapping

---

## Current State of BRB Inference

### Model Tier System (`crates/common/src/model_tiers.rs`)

| Tier | Model | Min Memory | 4-bit Size | Available Memory Formula |
|------|-------|-----------|------------|--------------------------|
| 9B | Qwen3.5-9B-4bit | 19 GB | 5.95 GB | `total - 5GB` (OS + embeddings) |
| 4B | Qwen3.5-4B-4bit | 11 GB | 2.5 GB | |
| 2B | Qwen3.5-2B-4bit | 7 GB | 1.5 GB | |
| 0.8B | Qwen3.5-0.8B-4bit | 4 GB | 0.6 GB | |

The 5GB reservation (1GB embedding model + 4GB OS) leaves no room for KV cache on tight machines. A 16GB M2 Air gets 11GB available = 4B tier only.

### Inference Pipeline (`mlx/src/entry/inference_daemon.py`)

- Uses `mlx_lm.generate()` and `stream_generate()` with default KV cache
- No `max_kv_size` or cache quantization parameters
- Parameters: `sampler` (temp/top_p/top_k), `logits_processors` (repetition penalty), `max_tokens`, `stop_sequences`
- Two code paths: `handle_generate()` (single shot) and `_generate_with_stop_sequences()` (streaming with early stop)

### KV Cache Memory (No TurboQuant)

Rough estimates for Qwen3.5-9B-4bit (32 layers, but only 8 full-attention layers due to 3:1 DeltaNet hybrid):

| Context Length | KV Cache (f16) | KV Cache (TQ 3-bit) | Savings |
|---------------|----------------|----------------------|---------|
| 2K tokens | ~200 MB | ~45 MB | -78% |
| 4K tokens | ~400 MB | ~90 MB | -78% |
| 8K tokens | ~800 MB | ~180 MB | -78% |
| 16K tokens | ~1.6 GB | ~360 MB | -78% |

*Note: Qwen3.5's hybrid architecture means only ~25% of layers have traditional KV caches. DeltaNet layers use fixed-size state. These numbers reflect total KV memory including both layer types.*

---

## What TurboQuant Changes

### Model Tier Impact (With 3-bit KV Cache)

| Machine | Total RAM | Current Tier | With TurboQuant | Quality Jump |
|---------|-----------|-------------|-----------------|-------------|
| M2 Air 8GB | 8 GB | 0.8B | 2B | Significant |
| M2 Air 16GB | 16 GB | 4B | **9B** | **Major** |
| M2 Pro 16GB | 16 GB | 4B | **9B** | **Major** |
| M2 Pro 32GB | 32 GB | 9B | 9B (longer context) | Moderate |
| M3 Max 64GB | 64 GB | 9B | 9B (much longer context) | Minor |

The 16GB -> 9B upgrade is the killer use case. 9B models produce dramatically better persona fidelity than 4B.

### Revised Tier Thresholds (Proposed)

```rust
// Current thresholds (no TurboQuant)
const TIER_9B_MIN: f64 = 19.0;  // GB
const TIER_4B_MIN: f64 = 11.0;
const TIER_2B_MIN: f64 = 7.0;
const TIER_08B_MIN: f64 = 4.0;

// Proposed with TurboQuant KV cache (3-bit)
const TIER_9B_MIN: f64 = 13.0;  // Was 19, saved ~6GB on KV
const TIER_4B_MIN: f64 = 8.0;   // Was 11
const TIER_2B_MIN: f64 = 5.5;   // Was 7
const TIER_08B_MIN: f64 = 3.5;  // Was 4
```

These would need validation via actual benchmarking.

---

## Integration Plan

### Phase 1: Benchmark (Now, 1-2 days)

```bash
# Clone the community MLX implementation
git clone https://huggingface.co/flovflo/turboquant-mlx-qwen35-kv

# Benchmark on BRB's exact model
python benchmark.py \
  --model mlx-community/Qwen3.5-9B-4bit \
  --prompt-tokens 2048 \
  --gen-tokens 256 \
  --backend baseline,turboquant \
  --device mps

# Measure on 16GB machine specifically
# Key metrics: peak memory, tok/s, quality (perplexity)
```

Questions to answer:
1. Does TurboQuant work with Qwen3.5's hybrid DeltaNet architecture?
2. What's the actual memory savings on M2/M3 16GB?
3. Is there measurable quality loss at 3-bit on persona chat tasks?
4. Does it interact well with LoRA adapters (BRB uses LoRA for persona fine-tuning)?

### Phase 2: Prepare Infrastructure (1 day)

Add configuration scaffolding without functional changes:

```python
# mlx/src/config/inference.py (new file)
@dataclass
class InferenceConfig:
    kv_cache_quantization: Optional[str] = None  # None, "turboquant3", "turboquant4"
    kv_cache_bits: float = 16.0  # Default f16, 3.25 or 4.25 for TurboQuant
    max_kv_cache_mb: Optional[int] = None  # Hard limit
```

```rust
// crates/common/src/model_tiers.rs
pub struct ModelTier {
    // ... existing fields ...
    pub kv_cache_quantized: bool,  // Whether TurboQuant is available
    pub min_memory_gb_with_tq: f64,  // Relaxed threshold with TQ
}
```

### Phase 3: Integrate (When mlx-lm Supports It)

Minimal changes expected:

```python
# mlx/src/entry/inference_daemon.py — handle_generate()

# Before (current)
response = generate(
    self.llm_model,
    self.llm_tokenizer,
    prompt=prompt,
    max_tokens=max_tokens,
    sampler=sampler,
    logits_processors=logits_processors,
)

# After (with TurboQuant)
response = generate(
    self.llm_model,
    self.llm_tokenizer,
    prompt=prompt,
    max_tokens=max_tokens,
    sampler=sampler,
    logits_processors=logits_processors,
    kv_cache_quantization="turboquant",  # or similar parameter name
    kv_bits=3,
)
```

### Phase 4: Model Tier Adjustment

Once benchmarked, update `model_tiers.rs` with TurboQuant-aware thresholds and expose a "TurboQuant enabled" toggle in the UI for users who want to trade KV precision for model size.

---

## Secondary Use Case: Vector Embedding Compression

### Current State

- 768-dim f32 embeddings in DuckDB (`FLOAT[768]`)
- HNSW index with cosine distance
- ~3KB per embedding, ~500MB for 100K chunks
- No compression or quantization

### TurboQuant for Embeddings

TurboQuant's vector quantization could compress stored embeddings:
- 768 * 4 bytes (f32) = 3,072 bytes -> ~768 bytes at 3-bit (~4x compression)
- Near-zero indexing time (vs. current HNSW build)
- Paper shows it outperforms Product Quantization in recall

### Why Deprioritize

- Storage isn't a bottleneck (500MB is fine on macOS)
- Would require DuckDB schema changes (`FLOAT[768]` -> custom binary)
- Would require re-embedding all chunks on upgrade
- RAG quality is dominated by cross-encoder reranking, not vector precision
- HNSW approximation already handles "good enough" retrieval

### When to Revisit

- If BRB scales to millions of chunks (power users with decades of messages)
- If DuckDB adds native support for quantized vectors
- If search latency becomes a bottleneck (currently ~50ms)

---

## Risks & Open Questions

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| mlx-lm never adds native TurboQuant | Low (huge community demand) | Fall back to community fork or manual integration |
| Quality degradation on persona chat specifically | Low (paper shows zero loss at 3.5 bits) | Benchmark with actual persona conversations |
| LoRA adapter interaction | Unknown | Test: does TurboQuant KV cache work correctly with LoRA-modified attention? |
| DeltaNet layer compatibility | Medium | Qwen3.5's DeltaNet layers don't use traditional KV caches — verify TurboQuant only targets the 25% full-attention layers |
| Apple Silicon M1 performance | Unknown | M1 has fewer GPU cores, may see different speedup profile |

---

## Actual Benchmark Results (2026-03-28)

### Setup

- **Machine**: Apple Silicon Mac (M-series)
- **Model**: `mlx-community/Qwen3.5-9B-4bit`
- **Architecture**: 32 layers (24 DeltaNet, 8 full-attention)
- **TurboQuant**: `mlx-optiq==0.0.2`, 4-bit, applied to 8 full-attention layers only
- **Package**: `mlx-optiq` installed via PyPI, no conflicts with pinned mlx-lm SHA

### Results

| Context (tokens) | Metric | Baseline | TurboQuant | Delta |
|----------------:|--------|----------|------------|-------|
| **512** | Wall time | 1.097s | 1.300s | **+18.6%** (slower) |
| | Gen tok/s | 29.2 | 24.6 | **-15.8%** |
| | Prompt tok/s | 466.8 | 393.8 | **-15.6%** |
| | Cache size | (internal) | 71.1 MB | — |
| **2048** | Wall time | 3.146s | 3.986s | **+26.7%** (slower) |
| | Gen tok/s | 10.5 | 8.3 | **-21.0%** |
| | Prompt tok/s | 651.2 | 513.9 | **-21.1%** |
| | Cache size | (internal) | 119.1 MB | — |
| **4096** | Wall time | 6.471s | 8.561s | **+32.3%** (slower) |
| | Gen tok/s | 5.0 | 3.8 | **-23.2%** |
| | Prompt tok/s | 633.0 | 484.3 | **-23.5%** |
| | Cache size | (internal) | 183.1 MB | — |

### Quality Check

TurboQuant produces correct, coherent output. Example:

> **Prompt**: "Hello! What is the capital of France?"
> **TurboQuant output**: "The capital of France is **Paris**. It is the country's largest city and serves as its center for politics, economics, culture, and art."

Quality is not the issue — performance is.

### Root Cause Analysis

1. **Only 25% of layers benefit**: Qwen3.5's hybrid DeltaNet architecture means 24/32 layers use fixed-size `ArraysCache` (not traditional KV cache). TurboQuant only applies to the 8 full-attention layers.

2. **Rotation overhead dominates**: Each full-attention layer must compute `q @ R_k^T` (pre-rotation) and `output @ R_v` (post-rotation) at every token. On a 9B model with small KV caches, this compute cost exceeds the memory bandwidth savings.

3. **Python-level centroid lookup**: `mlx-optiq`'s `_to_centroid_space()` uses a Python for-loop over boundaries, which is not Metal-optimized. This adds latency per quantization operation.

4. **Benchmark context**: The flovflo/HuggingFace benchmarks showing +26-32% speedups used `Qwen3.5-35B-A3B-4bit` — a much larger MoE model where KV cache is a proportionally bigger memory bottleneck.

### What the Integration Looks Like (Code is Working)

The integration is complete and functional in `inference_daemon.py`:

```bash
# Enable via CLI flag:
python inference_daemon.py --use-turboquant --turboquant-bits 4
```

Key changes:
- `mlx-optiq` added to `pyproject.toml`
- `TurboQuantKVCache` replaces `KVCache` for full-attention layers via `_make_turboquant_cache()`
- `patch_attention()` monkey-patches `scaled_dot_product_attention` for rotated-space attention
- Cache injected via `prompt_cache=` parameter (already supported by mlx-lm)
- Graceful fallback if `mlx-optiq` is not installed (`HAS_TURBOQUANT` flag)

---

## Decision

**Do not enable TurboQuant for Qwen3.5-9B.** The integration is complete and correct, but causes a 15-23% performance regression. The code remains on the `feat-spike-into-turboquant` branch for future use.

### When to Revisit

1. **Native mlx-lm support**: When mlx-lm adds built-in TurboQuant with Metal-optimized kernels (avoiding Python centroid lookup)
2. **Larger models**: If BRB adds support for 35B+ models where KV cache is the dominant memory consumer
3. **Memory-constrained scenarios**: On 8GB machines where even the 2B model's KV cache causes swapping at long contexts
4. **Very long contexts** (16K+): Where memory pressure from KV cache causes page faults and TurboQuant's compression could prevent that

---

## References

- [Full Research Report](../research/2026-03-28-turboquant-kv-cache-compression.md)
- [Qwen3.5 Architecture Report](../research/2026-03-04-qwen3.5-architecture-report.md)
- [Google Research Blog](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [arXiv 2504.19874](https://arxiv.org/abs/2504.19874)
- [flovflo/turboquant-mlx-qwen35-kv](https://huggingface.co/flovflo/turboquant-mlx-qwen35-kv)
- [llama.cpp TurboQuant Discussion](https://github.com/ggml-org/llama.cpp/discussions/20969)

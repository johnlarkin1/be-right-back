# TurboQuant: Google's KV Cache Compression for Local LLM Inference

**Date**: 2026-03-28
**Context**: Google Research published TurboQuant ([arXiv 2504.19874](https://arxiv.org/abs/2504.19874)), a training-free KV cache compression algorithm accepted at ICLR 2026. The local LLM community has rapidly adopted it, with working MLX implementations already available for the Qwen3.5 model family that BRB uses.

---

## Table of Contents

1. [What Is TurboQuant?](#1-what-is-turboquant)
2. [How It Works](#2-how-it-works)
3. [Performance Results](#3-performance-results)
4. [Apple Silicon Optimizations](#4-apple-silicon-optimizations)
5. [Community Implementations](#5-community-implementations)
6. [Relevance to Be Right Back](#6-relevance-to-be-right-back)
7. [Integration Assessment](#7-integration-assessment)
8. [Sources](#8-sources)

---

## 1. What Is TurboQuant?

TurboQuant is a compression algorithm that quantizes LLM **key-value caches** to 3-4 bits per element with zero accuracy loss. Unlike weight quantization (which BRB already uses via 4-bit Qwen3.5 models), TurboQuant targets the **runtime KV cache** — the memory that grows linearly with conversation length during inference.

Key properties:
- **Training-free**: No calibration data, fine-tuning, or model-specific tuning required
- **Model-agnostic**: Works on any transformer architecture (including Qwen3.5's hybrid DeltaNet)
- **Zero accuracy loss**: At 3.5 bits/channel, achieves "absolute quality neutrality"
- **Dual application**: Works for both KV cache compression AND vector search quantization

The paper's full title is "TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate."

## 2. How It Works

TurboQuant is a two-stage compression pipeline:

### Stage 1: Random Rotation + Scalar Quantization

1. **Random rotation** of input vectors using a fixed random orthogonal matrix
2. This transforms the data into a geometry where coordinates are approximately independent and follow a concentrated Beta distribution
3. Apply **optimal scalar quantizers** to each coordinate independently
4. This is based on PolarQuant (high-quality main quantizer after random rotation)

### Stage 2: 1-bit Residual Correction (QJL)

1. Compute the **residual error** from Stage 1
2. Apply the **Quantized Johnson-Lindenstrauss (QJL)** algorithm using just 1 bit
3. QJL acts as a mathematical error-checker that produces an **unbiased inner product estimator**
4. This eliminates the systematic bias that plagues naive quantization

### Theoretical Foundation

TurboQuant closely matches information-theoretic lower bounds on distortion rate, differing only by a small constant factor (~2.7x). It addresses both:
- **MSE distortion** (for storage/compression)
- **Inner product distortion** (critical for attention score accuracy)

## 3. Performance Results

### GPU Benchmarks (H100)

| Metric | Baseline (FP32) | TurboQuant 4-bit | Improvement |
|--------|-----------------|-------------------|-------------|
| Attention logit computation | 1x | 8x | **8x speedup** |
| KV cache memory | 1x | ~0.17x | **6x reduction** |
| Model accuracy | Baseline | No degradation | **Zero loss** |

### MLX Benchmarks on Qwen3.5-35B-A3B-4bit (Apple Silicon)

From [`flovflo/turboquant-mlx-qwen35-kv`](https://huggingface.co/flovflo/turboquant-mlx-qwen35-kv):

Setup: 2048 prompt tokens / 8 generation tokens, 3 trials

| Metric | Baseline | MLX Quant | TurboQuant | TQ vs Baseline |
|--------|----------|-----------|------------|----------------|
| Prompt tok/s | 514.34 | 516.13 | **679.14** | **+32%** |
| Gen tok/s | 35.67 | 38.30 | **44.83** | **+26%** |
| Gen wall time (s) | 5.67 | 5.16 | **4.20** | **-26%** |
| KV cache size (MB) | 80.12 | 44.77 | **45.10** | **-44%** |

### Quality at Different Bit Widths

| Bits/channel | Compression | Quality |
|-------------|-------------|---------|
| 4.25 (turbo4) | 3.8x | Lossless |
| 3.5 | 4.6x | "Absolute quality neutrality" |
| 3.25 (turbo3) | 4.9x | Lossless |
| 2.5 | 6.4x | "Marginal quality degradation" |

### Vector Search (Nearest Neighbor)

TurboQuant outperforms existing product quantization techniques (PQ, OPQ, RaBitQ) in recall while reducing indexing time to virtually zero. This is relevant for BRB's RAG embedding storage.

## 4. Apple Silicon Optimizations

Two community-developed optimizations specifically target M-series chips:

### 4-Magnitude LUT (Pre-M5 devices)

- Reduces constant memory addresses from 8 to 4 during K dequantization
- Auto-detected on M1/M2/M3/M4 hardware
- **+38% decode throughput on M2 Pro at 8K context**

### Sparse V Dequantization

- Skips V dequantization for positions where softmax attention weight < 1e-6
- At long context lengths, 90%+ of attention weights are negligible
- **+22.8% decode throughput at 32K context on M5 Max**

### End-to-End Apple Silicon Results

Working implementations exist for:
- Qwen3.5-35B-A3B MoE with 3-bit TurboQuant KV cache on M5 Max via llama.cpp Metal
- Faster than q8_0 baseline at 4.6x compression
- One developer reported 6/6 on needle-in-a-haystack tests at every quantization level on Apple Silicon

## 5. Community Implementations

| Implementation | Framework | Status | Link |
|---------------|-----------|--------|------|
| `flovflo/turboquant-mlx-qwen35-kv` | MLX (Apple Silicon) | Working PoC | [HuggingFace](https://huggingface.co/flovflo/turboquant-mlx-qwen35-kv) |
| `tonbistudio/turboquant-pytorch` | PyTorch | Working PoC | [GitHub](https://github.com/tonbistudio/turboquant-pytorch) |
| llama.cpp `turbo3`/`turbo4` types | C/C++ + Metal | Active development | [Discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969) |
| `TheTom/llama-cpp-turboquant` | C/C++ | Fork | [GitHub](https://github.com/TheTom/llama-cpp-turboquant) |
| `0xSero/turboquant` | Python + Triton + vLLM | Working | [GitHub](https://github.com/0xSero/turboquant) |
| `mlx-optiq` | MLX | Published on PyPI | [PyPI](https://pypi.org/project/mlx-optiq/) |
| `TheTom/turboquant_plus` | Multi-framework | Active | [GitHub](https://github.com/TheTom/turboquant_plus) |
| Official Google code | TBD | **Not yet released** | Expected Q2 2026 |

**Note**: All community implementations are reverse-engineered from the paper. Official code has not been released as of 2026-03-28.

## 6. Relevance to Be Right Back

### Use Case 1: KV Cache Compression During Chat Inference (HIGH impact)

BRB's inference daemon (`mlx/src/entry/inference_daemon.py`) currently has **zero KV cache management**. It calls `mlx_lm.generate()` and `stream_generate()` with default KV cache behavior. The model tier system (`crates/common/src/model_tiers.rs`) reserves 5GB for OS + embedding model overhead.

**Impact of TurboQuant KV cache compression:**

| Scenario | Current (no TQ) | With TurboQuant (3-bit) | Delta |
|----------|-----------------|-------------------------|-------|
| KV cache for 4K context on 9B model | ~800 MB | ~180 MB | -77% |
| Max context on 16GB machine (9B) | Not feasible | Feasible | Unlocks 9B tier |
| Prompt processing speed | Baseline | +32% | Faster RAG context |
| Generation speed | Baseline | +26% | Snappier chat |

**The biggest win**: Users on 16GB M2/M3 machines could potentially run the Qwen3.5-9B-4bit model (currently requires 19GB+ threshold). This meaningfully improves chat quality because 9B >> 4B for persona fidelity.

**Integration points:**
- `mlx/src/entry/inference_daemon.py` — `handle_generate()` and `_generate_with_stop_sequences()`
- `crates/common/src/model_tiers.rs` — relax VRAM thresholds
- No Rust/Tauri changes needed — purely Python-side MLX enhancement

### Use Case 2: Vector Embedding Compression for RAG (MODERATE impact)

BRB stores 768-dim f32 embeddings in DuckDB (~3KB each). For 100K chunks = ~300MB raw vectors.

TurboQuant's vector quantization could:
- Compress embeddings ~4-5x (768 * 4 bytes -> 768 * ~0.8 bytes)
- Reduce DuckDB file size from ~500MB to ~150MB
- Speed up HNSW traversal (less memory bandwidth)
- Near-zero indexing time vs. current HNSW build

**Lower priority because**:
- 300-500MB is manageable on macOS
- RAG quality bottleneck is cross-encoder reranking and MMR, not vector storage
- Would require DuckDB schema changes and re-embedding

### Use Case 3: Qwen3.5 Hybrid Architecture Synergy

Qwen3.5 uses a 3:1 DeltaNet/full-attention hybrid. Only the 25% full-attention layers produce traditional KV caches. DeltaNet layers use a fixed-size state matrix. This means:
- TurboQuant applies to the full-attention layer KV caches
- The DeltaNet layers already have constant memory (no KV cache growth)
- Net effect: TurboQuant's savings compound with DeltaNet's inherent efficiency

## 7. Integration Assessment

### Recommended Approach: Wait + Prototype

| Phase | Action | Timeline |
|-------|--------|----------|
| **Now** | Track `mlx-lm` repo for native TurboQuant support | Ongoing |
| **Now** | Benchmark `flovflo/turboquant-mlx-qwen35-kv` on BRB's Qwen3.5-9B-4bit | 1-2 days |
| **Q2 2026** | Integrate when mlx-lm adds native support | When available |
| **Later** | Evaluate vector search compression if storage becomes an issue | As needed |

### Why Wait for mlx-lm Native Support

1. BRB pins mlx-lm to `>=0.31.3` — native support would be a version bump
2. Integration would likely be a single parameter: `kv_cache_quantization="turboquant"`
3. Community PoCs are not production-ready
4. Google's official code is expected Q2 2026

### Immediate Spike: Model Tier Relaxation

Even without full integration, we can prepare by:
1. Profiling actual KV cache memory usage at various context lengths on each model tier
2. Modeling what thresholds would look like with 3-bit KV cache
3. Designing a `TurboQuantConfig` dataclass for future use

## 8. Sources

### Primary
- [Google Research Blog: TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [arXiv Paper 2504.19874](https://arxiv.org/abs/2504.19874)
- [ICLR 2026 Presentation](https://arxiv.org/abs/2504.19874) (late April 2026)

### Benchmarks & Analysis
- [Tom's Hardware: 6x KV Cache Compression on H100](https://www.tomshardware.com/tech-industry/artificial-intelligence/googles-turboquant-compresses-llm-kv-caches-to-3-bits-with-no-accuracy-loss)
- [MarkTechPost: 6x Compression, 8x Speedup, Zero Accuracy Loss](https://www.marktechpost.com/2026/03/25/google-introduces-turboquant-a-new-compression-algorithm-that-reduces-llm-key-value-cache-memory-by-6x-and-delivers-up-to-8x-speedup-all-with-zero-accuracy-loss/)
- [VentureBeat: 8x Speedup, 50% Cost Reduction](https://venturebeat.com/infrastructure/googles-new-turboquant-algorithm-speeds-up-ai-memory-8x-cutting-costs-by-50)
- [Heise: Google Aims to Curb Memory Hunger](https://www.heise.de/en/news/TurboQuant-Google-aims-to-curb-the-memory-hunger-of-large-LLMs-11225521.html)

### Community Implementations
- [flovflo/turboquant-mlx-qwen35-kv (HuggingFace)](https://huggingface.co/flovflo/turboquant-mlx-qwen35-kv) — MLX + Qwen3.5 benchmarks
- [llama.cpp Discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969) — turbo3/turbo4 types
- [tonbistudio/turboquant-pytorch](https://github.com/tonbistudio/turboquant-pytorch) — Reference PyTorch implementation
- [DEV Community: What Developers Need to Know](https://dev.to/arshtechpro/turboquant-what-developers-need-to-know-about-googles-kv-cache-compression-eeg)

### Context
- [BRB Qwen3.5 Architecture Report](./2026-03-04-qwen3.5-architecture-report.md) — Our existing analysis of the hybrid DeltaNet architecture

# MLX-RS Integration Project

## Executive Summary

This document analyzes the work required to integrate `mlx-rs` (Rust bindings for Apple's MLX framework) with the Be Right Back project, enabling pure Rust inference without Python subprocess dependencies.

**Bottom Line**: mlx-rs is surprisingly mature. The `mlx-lm` crate within the project provides ~80% of what we need. The remaining work is:
1. **Add Qwen3-4B model architecture** (~400-600 lines) — Note: Qwen3 is already implemented in mlx-lm
2. **Implement LoRA adapter loading** (~200-300 lines)
3. **Expose high-level inference API** (~150-200 lines)

**Estimated effort**: 2-4 weeks for a senior Rust developer familiar with ML concepts.

---

## Current State of mlx-rs

### Repository Structure
```
mlx-rs/
├── mlx-sys/          # Low-level FFI bindings to mlx-c
├── mlx-rs/           # Core Rust API (~35,000 lines)
│   └── src/
│       ├── array/    # Array operations
│       ├── nn/       # Neural network layers
│       ├── ops/      # Tensor operations
│       ├── module/   # Module trait system
│       └── optimizers/
├── mlx-lm/           # LLM-specific utilities (NEW!)
│   └── src/
│       ├── models/   # Model implementations (currently Qwen3 only)
│       ├── cache.rs  # KV cache for generation
│       ├── sampler.rs
│       └── utils/    # RoPE, attention, tokenizer
├── mlx-lm-utils/     # Tokenizer & chat templates
└── examples/
    ├── lm/           # Working Qwen3 chat example
    ├── mistral/      # Mistral inference
    └── mnist/        # Training example
```

### What's Already Implemented

#### Core Infrastructure (mlx-rs) ✅
| Component | Status | Notes |
|-----------|--------|-------|
| Array operations | ✅ Complete | Full MLX array API |
| Metal GPU support | ✅ Complete | Native Apple Silicon |
| nn::Linear | ✅ Complete | With bias options |
| nn::Embedding | ✅ Complete | |
| nn::RmsNorm | ✅ Complete | |
| nn::LayerNorm | ✅ Complete | |
| nn::Rope | ✅ Complete | Rotary position embeddings |
| nn::Attention (MultiHead) | ✅ Complete | |
| Quantization | ✅ Complete | 4-bit, 8-bit support |
| Safetensors I/O | ✅ Complete | Load/save model weights |
| ModuleParameters trait | ✅ Complete | Freeze/unfreeze, parameter access |
| Optimizers | ✅ Complete | Adam, AdamW, SGD, etc. |

#### LLM Infrastructure (mlx-lm) ✅
| Component | Status | Notes |
|-----------|--------|-------|
| KV Cache | ✅ Complete | `ConcatKeyValueCache` implemented |
| Text generation loop | ✅ Complete | Iterator-based `Generate` struct |
| Temperature sampling | ✅ Complete | Greedy and stochastic |
| Chat templates | ✅ Complete | Jinja2 via minijinja |
| Tokenizer integration | ✅ Complete | HuggingFace tokenizers |
| Qwen3 model | ✅ Complete | Full implementation |

### What's Missing for Be Right Back

#### 1. Model Architecture ✅ (Qwen3 already implemented)
**Current state**: Qwen3 is implemented in `mlx-lm/src/models/`. Since BRB now uses Qwen3-4B as its primary model, no additional model architecture work is needed.

**Reference**: The Qwen3 implementation (`mlx-lm/src/models/qwen3.rs`) is 696 lines and already covers our needs.

#### 2. LoRA Adapter Support ❌
**Current state**: No LoRA support exists.

**Work required**:
```rust
// Proposed API
pub struct LoraLinear {
    base: Linear,           // Frozen base weights
    lora_a: Array,          // Low-rank A matrix
    lora_b: Array,          // Low-rank B matrix
    scale: f32,             // alpha / rank
}

impl Module<&Array> for LoraLinear {
    fn forward(&mut self, x: &Array) -> Result<Array, Exception> {
        // W'x = Wx + (BA)x * scale
        let base_out = self.base.forward(x)?;
        let lora_out = matmul(&matmul(x, &self.lora_a)?, &self.lora_b)?;
        add(&base_out, &lora_out.multiply(self.scale)?)
    }
}
```

**Additional needs**:
- `load_lora_adapter(model: &mut Model, adapter_path: &Path)` function
- Logic to identify and wrap target layers (q_proj, k_proj, v_proj, etc.)
- Support for MLX safetensors adapter format (what our training produces)

#### 3. High-Level Inference API ❌
**Current state**: Generation exists but requires manual setup.

**Proposed API for Be Right Back**:
```rust
pub struct InferenceEngine {
    model: Qwen3Model,
    tokenizer: Tokenizer,
    cache: Vec<Option<ConcatKeyValueCache>>,
    config: GenerationConfig,
}

impl InferenceEngine {
    pub fn new(model_path: &Path) -> Result<Self, Error>;
    pub fn load_adapter(&mut self, adapter_path: &Path, scale: f32) -> Result<(), Error>;
    pub fn generate(&mut self, prompt: &str) -> Result<String, Error>;
    pub fn generate_streaming(&mut self, prompt: &str) -> impl Iterator<Item = String>;
}
```

---

## Detailed Implementation Plan

### Phase 1: Model Architecture ✅ (Already Done)

Qwen3 is already implemented in `mlx-lm/src/models/qwen3.rs`. Since BRB now uses Qwen3-4B as its primary model, this phase requires no additional work.

### Phase 2: LoRA Support (~1 week)

**Files to create**:
- `mlx-rs/src/nn/lora.rs`
- `mlx-lm/src/lora.rs`

**Tasks**:
1. [ ] Implement `LoraLinear` wrapper struct
2. [ ] Implement `Quantizable` for `LoraLinear` (optional)
3. [ ] Create `apply_lora_to_model()` function that:
   - Takes a model and adapter weights
   - Identifies target layers by name pattern
   - Wraps them with LoRA
4. [ ] Handle adapter weight loading from safetensors
5. [ ] Support adapter hot-swapping (unload/reload)

**Adapter format** (from our MLX training):
```
adapter/
├── adapter_config.json   # {"rank": 8, "alpha": 16, "target_modules": [...]}
└── adapters.safetensors  # LoRA weights
```

### Phase 3: High-Level API (~0.5 week)

**Files to create**:
- `mlx-lm/src/inference.rs`

**Tasks**:
1. [ ] Create `InferenceEngine` struct
2. [ ] Implement model + tokenizer loading
3. [ ] Implement generation with proper chat formatting
4. [ ] Add streaming generation support
5. [ ] Handle system prompts from persona metadata

### Phase 4: Integration with Be Right Back (~0.5 week)

**Files to modify**:
- `crates/inference/Cargo.toml` - Add mlx-rs dependency
- `crates/inference/src/engine.rs` - Use new mlx-rs backend

**Tasks**:
1. [ ] Replace llama-cpp-2 with mlx-rs
2. [ ] Update Tauri commands to use new engine
3. [ ] Remove GGUF conversion requirement
4. [ ] Test end-to-end with trained personas

---

## Technical Considerations

### Memory Management
mlx-rs uses lazy evaluation like Python MLX. Call `eval()` periodically during generation to materialize arrays and free intermediate buffers.

```rust
// Every 20 tokens, evaluate to free memory
if tokens.len() % 20 == 0 {
    mlx_rs::transforms::eval(&tokens)?;
}
```

### Quantization Alignment
With mlx-rs, we can use the **same quantization** for training and inference:
- Train with `mlx-community/Qwen3-4B-8bit` (8-bit)
- Inference with same 8-bit model
- No GGUF conversion needed!

### Thread Safety
mlx-rs types are NOT `Send` (same issue as llama-cpp-2). For Tauri integration, still need `spawn_blocking` pattern.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Qwen3 architecture quirks | Low | Medium | Qwen3 already implemented in mlx-lm |
| LoRA weight format mismatch | Low | Medium | We control both training and inference |
| mlx-rs API instability | Medium | Medium | Pin version, contribute fixes upstream |
| Performance regression | Low | Low | MLX is already optimized for Apple Silicon |

---

## Alternative: Contribute Upstream

Instead of forking, consider contributing to the main mlx-rs repository:

1. **Additional model architectures**: Would benefit the community
2. **LoRA support**: High-demand feature request
3. **Better documentation**: Currently sparse

Benefits:
- Maintenance shared with community
- Visibility for Be Right Back project
- Good open source citizenship

---

## Comparison: mlx-rs vs Current Approach

| Aspect | llama-cpp-2 (current) | mlx-rs (proposed) |
|--------|----------------------|-------------------|
| Conversion needed | MLX → GGUF | None |
| Quantization match | 8-bit train → 4-bit infer | 8-bit → 8-bit |
| Apple Silicon optimization | Good | Excellent (native) |
| Rust ecosystem | Mature | Newer but active |
| LoRA support | Built-in | Need to implement |
| Python dependency | None | None |
| Model support | Many models | Qwen3 already included |

---

## Conclusion

mlx-rs is a viable path for pure Rust inference on Apple Silicon. The mlx-lm crate provides most of the scaffolding we need. The primary work is:

1. **LoRA adapter loading** (biggest remaining task)
2. **High-level API wrapper** (convenience)

Total estimated effort: **1-2 weeks** to production-ready state (reduced since Qwen3 model is already implemented).

The main advantage over llama-cpp-2 is eliminating the quantization mismatch between training (8-bit MLX) and inference (4-bit GGUF). With mlx-rs, we use the exact same model format throughout the pipeline.

---

## References

- [mlx-rs GitHub](https://github.com/oxideai/mlx-rs)
- [MLX Python mlx-lm](https://github.com/ml-explore/mlx-examples/tree/main/llms/mlx_lm)
- [Qwen3-4B Model Card](https://huggingface.co/Qwen/Qwen3-4B)
- [LoRA Paper](https://arxiv.org/abs/2106.09685)

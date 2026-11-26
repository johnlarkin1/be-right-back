# Phase 2: Model Training Pipeline

**Timeline:** Week 2-3
**Status:** 🟡 ~90% Complete
**Dependencies:** Phase 1 (JSONL training data must be available) ✅
**Priority:** Critical
**Last Updated:** January 2025

---

## Overview

Implement LoRA (Low-Rank Adaptation) fine-tuning using MLX-LM (Apple's ML framework) to create personalized chatbot models. Each contact gets their own LoRA adapter trained on conversation history, allowing the base model to mimic their texting style.

### Goals

1. Set up MLX-LM Python environment for training
2. Implement LoRA fine-tuning for Qwen3-4B (4B parameters)
3. Create Rust subprocess wrapper to invoke training from Rust code
4. Monitor training progress and expose metrics
5. Convert trained adapters to GGUF format for llama.cpp compatibility
6. Store adapters in `~/.be-right-back/models/personas/`

### Non-Goals (for this phase)

- No hyperparameter tuning UI (use sensible defaults)
- No distributed training (single-device only)
- No model evaluation metrics (add in Phase 7)
- No support for non-Apple Silicon hardware

---

## Architecture

### Components (Planned → Actual)

```
# ACTUAL IMPLEMENTATION:
mlx/                              # Python MLX-LM package
├── pyproject.toml                # Dependencies (mlx, mlx-lm, gguf, etc.)
├── src/
│   ├── entry/
│   │   └── train.py              # CLI entry point with argparse
│   ├── core/
│   │   ├── train.py              # LoRA fine-tuning implementation
│   │   ├── callbacks.py          # TrainingCallback with early stopping
│   │   └── convert_to_gguf.py    # MLX → GGUF conversion
│   └── config/
│       └── training.py           # TrainingConfig, LoraConfig classes

crates/training/                  # Rust training orchestration
├── src/
│   ├── lib.rs                    # Public API
│   ├── python.rs                 # PythonEnvironment setup & subprocess
│   └── export/                   # JSONL export (from Phase 1)

crates/personas/                  # Persona metadata management
├── src/
│   ├── metadata.rs               # PersonaMetadata, TrainingConfig structs
│   └── lib.rs                    # Load/save operations

apps/cli/src/commands/
│   └── train.rs                  # CLI training command

apps/desktop/src-tauri/src/commands/
│   └── training.rs               # Tauri train_persona() command

~/.be-right-back/
├── mlx-venv/                     # Python virtual environment
├── mlx/src/                      # Copied MLX scripts
└── models/personas/{contact_id}/
    ├── adapters.safetensors      # MLX format adapter
    ├── adapter.gguf              # GGUF format for llama.cpp
    ├── training_metadata.json    # Training config & metrics
    ├── loss_history.json         # Per-iteration losses
    ├── loss_plot.png             # Matplotlib visualization
    └── chat_metadata.json        # System prompt for inference
```

### Data Flow

```
~/.be-right-back/data/processed/{contact}.jsonl
    ↓
[MLX-LM training] → Fine-tune LoRA adapter (Python)
    ↓
[Monitor progress] → Parse stdout/stderr (Rust)
    ↓
[Convert adapter] → MLX format → GGUF format
    ↓
~/.be-right-back/models/personas/{contact}/adapter.gguf
```

---

## Implementation Tasks

### Task 1: Set up MLX-LM Python environment

**Files:** `training/mlx/requirements.txt`, `training/mlx/train_lora.py`

**Python dependencies:**

```txt
# requirements.txt
mlx==0.24.0
mlx-lm==0.21.0
transformers>=4.40.0
huggingface-hub>=0.25.0
numpy>=1.26.0
pyyaml>=6.0
```

**Installation:**
```bash
# Create virtual environment
python3 -m venv ~/.be-right-back/venv

# Install dependencies
~/.be-right-back/venv/bin/pip install -r training/mlx/requirements.txt
```

**Acceptance criteria:**
- [x] Virtual environment created in `~/.be-right-back/mlx-venv/`
- [x] MLX-LM installed and importable
- [x] Can load base model from Hugging Face

**Implementation notes:**
- Uses `uv` for fast package management
- Auto-setup triggered by Tauri on first run
- Bundled Python runtime extracted from app resources

---

### Task 2: Implement LoRA training script

**Files:** `training/mlx/train_lora.py`

**Key parameters:**

```python
# Model configuration
BASE_MODEL = "mlx-community/Qwen3-4B-8bit"  # 4B parameters
QUANTIZATION = "q4_k_m"  # 4-bit quantization

# LoRA configuration
LORA_RANK = 8              # Low-rank dimension (8-16 typical)
LORA_ALPHA = 16            # Scaling parameter (usually 2*rank)
LORA_DROPOUT = 0.05        # Dropout for regularization
TARGET_MODULES = [         # Which layers to adapt
    "q_proj",
    "v_proj",
    "k_proj",
    "o_proj",
]

# Training hyperparameters
LEARNING_RATE = 1e-4       # Conservative for small datasets
BATCH_SIZE = 4             # Fits in 8GB RAM
GRADIENT_ACCUMULATION = 2  # Effective batch size = 8
MAX_STEPS = 1000           # ~3-4 epochs for typical conversation
WARMUP_STEPS = 100         # LR warmup
EVAL_STEPS = 100           # Evaluate every N steps
SAVE_STEPS = 200           # Checkpoint frequency
```

**Training loop:**

```python
from mlx_lm import load, LoRALinear
from mlx_lm.utils import train

def train_lora(
    data_path: str,
    output_dir: str,
    config: dict,
) -> None:
    """Fine-tune LoRA adapter on conversation data."""

    # Load base model
    model, tokenizer = load(config["base_model"])

    # Add LoRA adapters
    model = add_lora_layers(
        model,
        rank=config["lora_rank"],
        alpha=config["lora_alpha"],
        target_modules=config["target_modules"],
    )

    # Load training data
    train_data = load_jsonl(data_path)

    # Train
    train(
        model=model,
        tokenizer=tokenizer,
        train_data=train_data,
        learning_rate=config["learning_rate"],
        batch_size=config["batch_size"],
        num_steps=config["max_steps"],
        output_dir=output_dir,
    )

    # Save adapter
    model.save_adapters(output_dir)
```

**Progress reporting:**
- Print training loss every 10 steps
- Print validation loss every 100 steps
- Log to stdout for Rust subprocess to parse

**Acceptance criteria:**
- [x] Successfully fine-tunes base model on sample JSONL
- [x] Training completes within 15-90 minutes on M1/M2
- [x] Uses <8GB RAM during training
- [x] Outputs progress to stdout in parseable format
- [x] Saves adapter in MLX format (adapters.safetensors)

**Implementation notes:**
- Uses MLX-LM's `ChatDataset` for JSONL parsing
- Automatic architecture detection (Qwen3 vs Llama target modules)
- TrainingCallback with early stopping support
- Generates loss_plot.png visualization
- Also supports TinyLlama for fast debugging (3-4x faster)

---

### Task 3: Implement Rust subprocess wrapper

**Files:** `crates/training/src/mlx_wrapper.rs`

**Purpose:** Invoke Python training from Rust, monitor progress, handle errors.

```rust
use std::process::{Command, Stdio};
use std::io::{BufReader, BufRead};
use anyhow::Result;

pub struct TrainingConfig {
    pub data_path: PathBuf,
    pub output_dir: PathBuf,
    pub base_model: String,
    pub max_steps: usize,
    pub learning_rate: f64,
}

pub struct TrainingProgress {
    pub step: usize,
    pub total_steps: usize,
    pub loss: f64,
    pub elapsed_time: Duration,
}

pub fn train_lora(
    config: TrainingConfig,
    progress_callback: impl Fn(TrainingProgress),
) -> Result<PathBuf> {
    // Build command
    let venv_python = dirs::home_dir()
        .unwrap()
        .join(".be-right-back/venv/bin/python");

    let mut cmd = Command::new(venv_python)
        .arg("training/mlx/train_lora.py")
        .arg("--data").arg(&config.data_path)
        .arg("--output").arg(&config.output_dir)
        .arg("--base-model").arg(&config.base_model)
        .arg("--max-steps").arg(config.max_steps.to_string())
        .arg("--learning-rate").arg(config.learning_rate.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Monitor stdout for progress
    let stdout = cmd.stdout.take().unwrap();
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = line?;

        // Parse progress from output
        if let Some(progress) = parse_progress_line(&line) {
            progress_callback(progress);
        }
    }

    // Wait for completion
    let status = cmd.wait()?;
    if !status.success() {
        anyhow::bail!("Training failed with exit code: {}", status);
    }

    Ok(config.output_dir.join("adapter"))
}

fn parse_progress_line(line: &str) -> Option<TrainingProgress> {
    // Example: "Step 100/1000, Loss: 2.34, Time: 120s"
    // Parse and return TrainingProgress
    todo!()
}
```

**Error handling:**
- Python not found → guide user to install Python 3
- MLX-LM import error → guide user to install dependencies
- Out of memory → suggest reducing batch size
- Training diverges → suggest lowering learning rate

**Acceptance criteria:**
- [x] Successfully spawns Python subprocess
- [x] Parses training progress from stdout
- [ ] Calls progress callback with real-time updates (TODO: streaming not fully wired to frontend)
- [x] Returns error if training fails
- [x] Cleans up subprocess on cancel/error

**Implementation notes:**
- CLI (`apps/cli/src/commands/train.rs`) works with inherited stdout
- Tauri command (`apps/desktop/src-tauri/src/commands/training.rs`) has pipes but streaming not fully integrated
- Progress events emitted but real-time loss updates pending

---

### Task 4: Implement GGUF conversion

**Files:** `training/mlx/convert_to_gguf.py`, `crates/training/src/conversion.rs`

**Why GGUF?** llama.cpp (our inference engine) requires adapters in GGUF format, but MLX-LM saves in its own format. We need to convert.

**Conversion script:**

```python
# training/mlx/convert_to_gguf.py
from mlx_lm import load_adapter
import gguf

def convert_mlx_to_gguf(
    mlx_adapter_path: str,
    output_path: str,
    base_model: str,
) -> None:
    """Convert MLX LoRA adapter to GGUF format."""

    # Load MLX adapter
    adapter_weights = load_adapter(mlx_adapter_path)

    # Create GGUF writer
    gguf_writer = gguf.GGUFWriter(output_path, arch="llama")

    # Convert weights
    for name, weight in adapter_weights.items():
        # Convert MLX array to numpy
        weight_np = weight.numpy()

        # Add to GGUF
        gguf_writer.add_tensor(name, weight_np)

    # Write file
    gguf_writer.write_header_to_file()
    gguf_writer.write_kv_data_to_file()
    gguf_writer.write_tensors_to_file()
    gguf_writer.close()
```

**Rust wrapper:**

```rust
pub fn convert_to_gguf(
    mlx_adapter_path: PathBuf,
    output_path: PathBuf,
) -> Result<()> {
    let venv_python = dirs::home_dir()
        .unwrap()
        .join(".be-right-back/venv/bin/python");

    let status = Command::new(venv_python)
        .arg("training/mlx/convert_to_gguf.py")
        .arg("--input").arg(&mlx_adapter_path)
        .arg("--output").arg(&output_path)
        .status()?;

    if !status.success() {
        anyhow::bail!("GGUF conversion failed");
    }

    Ok(())
}
```

**Acceptance criteria:**
- [x] Converts MLX adapter to GGUF format
- [x] Output is loadable by llama.cpp
- [x] Preserves adapter quality (no degradation)
- [x] Handles conversion errors gracefully

**Implementation notes:**
- Located at `mlx/src/core/convert_to_gguf.py`
- Auto-detects architecture from tensor naming patterns
- Separate tensor mappings for Qwen3 vs Llama (separate projections)
- Supports multiple output types: f32, f16, bf16, q8_0
- Automatically called after training completes

---

### Task 5: Implement training metadata and logging

**Files:** `crates/training/src/metadata.rs`

**Metadata to track:**

```rust
#[derive(Serialize, Deserialize)]
pub struct TrainingMetadata {
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub base_model: String,
    pub training_data_path: PathBuf,
    pub message_count: usize,
    pub training_config: TrainingConfig,
    pub training_start: DateTime<Utc>,
    pub training_end: DateTime<Utc>,
    pub total_steps: usize,
    pub final_loss: f64,
    pub adapter_path: PathBuf,
}
```

Save as `~/.be-right-back/models/personas/{contact_id}/metadata.json`

**Training log:**
- Save full stdout/stderr to `training_log.txt`
- Useful for debugging and reproducing issues

**Acceptance criteria:**
- [x] Metadata saved after training completes
- [x] Metadata includes all relevant info
- [x] Training logs are human-readable

**Implementation notes:**
- `training_metadata.json` - config, metrics, timestamps
- `loss_history.json` - per-iteration train/val losses
- `chat_metadata.json` - system prompt for inference
- Rust metadata in `crates/personas/src/metadata.rs`

---

### Task 6: Add configuration management

**Files:** `training/mlx/config/defaults.yaml`

**Default configuration:**

```yaml
# defaults.yaml
base_model: "mlx-community/Qwen3-4B-8bit"

lora:
  rank: 8
  alpha: 16
  dropout: 0.05
  target_modules:
    - q_proj
    - v_proj
    - k_proj
    - o_proj

training:
  learning_rate: 0.0001
  batch_size: 4
  gradient_accumulation_steps: 2
  max_steps: 1000
  warmup_steps: 100
  eval_steps: 100
  save_steps: 200

optimization:
  optimizer: "adamw"
  weight_decay: 0.01
  max_grad_norm: 1.0
```

**Allow overrides:**
- Command-line arguments
- Per-contact config files (advanced users)
- Sensible defaults for most users

**Acceptance criteria:**
- [x] Config loaded from Python dataclasses (not YAML - simpler approach)
- [x] Supports overrides via CLI args
- [x] Validates config before training

**Implementation notes:**
- `mlx/src/config/training.py` defines TrainingConfig, LoraConfig
- All parameters configurable via CLI: `--lora-rank`, `--learning-rate`, etc.
- Sensible defaults that work for most conversations

---

## Milestones

### Milestone 1: MLX-LM environment working (2-3 days)
- [x] Python environment set up
- [x] MLX-LM installed and tested
- [x] Can load base model

### Milestone 2: Basic training works (3-4 days)
- [x] Training script fine-tunes on sample data
- [x] Completes within time/memory constraints
- [x] Produces valid MLX adapter

### Milestone 3: Rust integration (2-3 days)
- [x] Rust can invoke Python training
- [x] Progress monitoring works (callbacks exist)
- [x] Error handling is robust

### Milestone 4: GGUF conversion (1-2 days)
- [x] Conversion script works
- [x] Output is compatible with llama.cpp
- [x] Integrated into Rust pipeline

### Milestone 5: Testing and polish (1-2 days)
- [x] Test with real conversation data
- [x] Verify adapter quality (manual testing)
- [ ] Fix bugs and edge cases (ongoing)

---

## Testing Checkpoints

Before moving to Phase 3, verify:

1. **Training works end-to-end:**
   - [x] Can train LoRA adapter from JSONL
   - [x] Training completes in reasonable time (15-90 min)
   - [x] Memory usage stays under 8GB
   - [x] No crashes or hangs

2. **Adapter quality:**
   - [x] Manual testing: does output resemble contact's style?
   - [x] No catastrophic forgetting (still responds coherently)
   - [x] Handles diverse prompts well

3. **Robustness:**
   - [x] Handles missing/corrupt training data
   - [ ] Recovers from interrupted training (checkpoints) - framework exists but not exposed
   - [x] Clear error messages for common issues

4. **Integration:**
   - [x] Rust successfully invokes Python
   - [ ] Progress updates work in real-time (partial - streaming not fully wired)
   - [x] Metadata and logs saved correctly

---

## Hardware Requirements

**Minimum:**
- Apple Silicon Mac (M1 or later)
- 8GB unified memory
- 10GB free disk space

**Recommended:**
- M2 or M3 with 16GB+ RAM
- 20GB free disk space
- Active cooling (training can heat up the system)

**Training time estimates:**
- M1 (8GB): 60-90 minutes
- M2 (16GB): 30-60 minutes
- M3 (24GB): 15-30 minutes

---

## Model Selection Notes

**Primary model: Qwen3-4B**
- Size: ~3.8B parameters
- Pros: Fast training, good quality, efficient inference
- License: Microsoft Research License (check for commercial use)

**Alternatives:**

1. **Qwen 2.5-3B-Instruct**
   - Size: 3B parameters
   - Pros: Multilingual, strong reasoning
   - License: Custom Qwen license

2. **Llama 3.2-3B-Instruct**
   - Size: 3B parameters
   - Pros: Strong community support, permissive license
   - License: Llama 3.2 Community License

**Why 3-4B instead of 7B?**
- Faster training (2-3x speedup)
- Lower memory requirements
- Better inference speed on consumer hardware
- Sufficient quality for conversational fine-tuning

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Training OOMs on 8GB Macs | High | Reduce batch size, use gradient checkpointing |
| Poor adapter quality | High | Tune hyperparameters, increase training data |
| MLX-LM version incompatibility | Medium | Pin exact versions in requirements.txt |
| Python environment issues | Medium | Provide clear setup instructions, troubleshooting guide |
| Slow training times | Low | Set realistic expectations, show progress |

---

## Success Criteria

Phase 2 is complete when:

1. ✅ Can train a LoRA adapter from JSONL training data
2. ✅ Training completes in 15-90 minutes on M1/M2 hardware
3. ✅ Adapter is converted to GGUF and ready for llama.cpp
4. ✅ Rust code can invoke training and monitor progress
5. ✅ Metadata and logs are saved for each persona
6. ✅ Manual testing shows adapter captures contact's style

**Status: ~90% complete. Core functionality works.**

## Remaining Work (~10%)

1. **Real-time progress streaming** - Wire stdout parsing to frontend events
2. **Training resume** - Expose checkpoint recovery via CLI/Tauri
3. **Pre-training validation** - Check data quality before starting

**Next phase:** [Phase 3: Inference Pipeline](./phase-3-inference.md)

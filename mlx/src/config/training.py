from dataclasses import dataclass
from pathlib import Path

from constants import HF_DEFAULT_BASE_MODEL


@dataclass
class LoRAConfig:
    rank: int = 16
    alpha: int = 32
    dropout: float = 0.1
    target_modules: list[str] | None = None
    model_type: str | None = None

    def __post_init__(self):
        if self.target_modules is None:
            self.target_modules = self._detect_target_modules()

    # Qwen3.5 uses a hybrid DeltaNet + Attention architecture:
    # - 3 of every 4 layers use DeltaNet (linear_attn) with in_proj/out_proj
    # - 1 of every 4 layers uses standard attention (self_attn) with q/k/v/o_proj
    # - All layers have MLP with gate/up/down projections
    # LoRA targets both attention types + MLP for full coverage.
    _QWEN35_TARGET_MODULES = [
        # DeltaNet linear attention layers (3 of every 4)
        "linear_attn.in_proj_qkv",
        "linear_attn.out_proj",
        # Standard attention layers (every 4th layer)
        "self_attn.q_proj",
        "self_attn.k_proj",
        "self_attn.v_proj",
        "self_attn.o_proj",
        # MLP (all layers)
        "mlp.gate_proj",
        "mlp.up_proj",
        "mlp.down_proj",
    ]

    # Legacy Qwen3/Llama target modules (for backward compatibility with older models)
    _LEGACY_TARGET_MODULES = [
        "self_attn.q_proj",
        "self_attn.k_proj",
        "self_attn.v_proj",
        "self_attn.o_proj",
        "mlp.gate_proj",
        "mlp.up_proj",
        "mlp.down_proj",
    ]

    def _detect_target_modules(self) -> list[str]:
        if self.model_type is None:
            raise AssertionError("Model type is required for target module detection")
        if self.model_type and "qwen3.5" in self.model_type.lower().replace("-", "."):
            return list(self._QWEN35_TARGET_MODULES)
        return list(self._LEGACY_TARGET_MODULES)


@dataclass
class TrainingConfig:
    learning_rate: float = 1e-5  # Reduced from 1e-4 to prevent overfitting
    batch_size: int = 1  # Kept low to reduce peak VRAM; effective batch = batch_size * grad_accum
    gradient_accumulation_steps: int = 4
    max_steps: int = 300
    eval_steps: int = 50
    save_steps: int = 200
    warmup_steps: int = 50
    report_steps: int = 10
    max_seq_length: int = 1024  # 512 truncates multi-turn examples; 1024 balances headroom and VRAM
    # Number of top transformer layers to apply LoRA to. None = all layers.
    # Adapting only the top layers cuts trainable params, optimizer state, and
    # wall-clock time -- ideal for surface style adaptation on consumer Macs.
    # Set by the hardware-aware TrainingProfile on the Rust side.
    num_layers: int | None = None
    # mask prompt
    mask_prompt: bool = True

    # optimizer settings
    optimizer: str = "adamw"
    weight_decay: float = 0.01
    max_grad_norm: float = 1.0

    # early stopping - stop if validation loss doesn't improve by threshold for patience checks
    early_stopping_patience: int | None = 3  # number of validation checks without improvement
    early_stopping_threshold: float = 0.05  # minimum improvement required (lowered from 0.1)


@dataclass
class ModelConfig:
    base_model: str = HF_DEFAULT_BASE_MODEL
    quantization: str | None = None  # for future use
    trust_remote_code: bool = True


@dataclass
class Config:
    data_path: Path
    output_dir: Path
    model: ModelConfig
    lora: LoRAConfig
    training: TrainingConfig
    contact_id: str | None = None
    contact_name: str | None = None

    @classmethod
    def default(cls, data_path: str, output_dir: str, base_model: str | None = None) -> "Config":
        model_config = ModelConfig()
        if base_model is not None:
            model_config.base_model = base_model

        lora_config = LoRAConfig(model_type=base_model)

        return cls(
            data_path=Path(data_path),
            output_dir=Path(output_dir),
            model=model_config,
            lora=lora_config,
            training=TrainingConfig(),
        )

    def to_dict(self) -> dict:
        """Convert config to dictionary for serialization."""
        return {
            "data_path": str(self.data_path),
            "output_dir": str(self.output_dir),
            "model": {
                "base_model": self.model.base_model,
                "quantization": self.model.quantization,
                "trust_remote_code": self.model.trust_remote_code,
            },
            "lora": {
                "rank": self.lora.rank,
                "alpha": self.lora.alpha,
                "dropout": self.lora.dropout,
                "target_modules": self.lora.target_modules,
                "model_type": self.lora.model_type,
            },
            "training": {
                "learning_rate": self.training.learning_rate,
                "batch_size": self.training.batch_size,
                "gradient_accumulation_steps": self.training.gradient_accumulation_steps,
                "max_steps": self.training.max_steps,
                "warmup_steps": self.training.warmup_steps,
                "eval_steps": self.training.eval_steps,
                "save_steps": self.training.save_steps,
                "max_seq_length": self.training.max_seq_length,
                "num_layers": self.training.num_layers,
                "optimizer": self.training.optimizer,
                "weight_decay": self.training.weight_decay,
                "max_grad_norm": self.training.max_grad_norm,
            },
            "contact_id": self.contact_id,
            "contact_name": self.contact_name,
        }

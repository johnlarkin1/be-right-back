#!/usr/bin/env python3
"""LoRA fine-tuning CLI for Be Right Back personas."""

import argparse
import sys
from pathlib import Path

import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16

# Add mlx/src/ to path so entry points can import sibling packages.
# This is necessary because entry point scripts are invoked directly by the Rust
# subprocess runner (not via `python -m`), so the package root isn't automatically
# on sys.path. Imports below this block depend on this path setup.
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from config.training import Config  # noqa: E402
from constants import HF_DEFAULT_BASE_MODEL  # noqa: E402
from core.train import run_training  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Train LoRA adapter for persona")
    parser.add_argument(
        "--data",
        type=str,
        required=True,
        help="Path to data directory containing train.jsonl and metadata.json",
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Output directory for adapter (default: ~/.be-right-back/models/personas/you)",
    )
    parser.add_argument(
        "--base-model",
        type=str,
        default=HF_DEFAULT_BASE_MODEL,
        help="Base model name or path",
    )
    parser.add_argument("--max-steps", type=int, default=500, help="Maximum training steps")
    parser.add_argument("--learning-rate", type=float, default=1e-5, help="Learning rate")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size")
    parser.add_argument("--lora-rank", type=int, default=16, help="LoRA rank")
    parser.add_argument("--lora-alpha", type=int, default=32, help="LoRA alpha")
    parser.add_argument("--save-every", type=int, default=200, help="Save checkpoint every N steps")
    parser.add_argument(
        "--max-seq-length", type=int, default=1024, help="Maximum sequence length for training"
    )
    parser.add_argument(
        "--num-layers",
        type=int,
        default=None,
        help="Number of top transformer layers to apply LoRA to (default: all layers)",
    )
    parser.add_argument(
        "--eval-steps",
        type=int,
        default=None,
        help="Run a validation pass every N steps (default: config default)",
    )
    parser.add_argument(
        "--no-early-stopping",
        action="store_true",
        help="Run every step even when validation loss stops improving",
    )
    parser.add_argument(
        "--grad-accum",
        type=int,
        default=None,
        help="Gradient accumulation steps (default: config default)",
    )

    args = parser.parse_args()

    data_dir = Path(args.data).expanduser()
    if not data_dir.exists():
        print(f"error: data directory not found at {data_dir}", file=sys.stderr)
        sys.exit(1)

    if not data_dir.is_dir():
        print(f"error: --data must be a directory, got {data_dir}", file=sys.stderr)
        sys.exit(1)

    metadata_path = data_dir / "metadata.json"
    if not metadata_path.exists():
        print(f"error: metadata.json not found at {metadata_path}", file=sys.stderr)
        sys.exit(1)

    with open(metadata_path, encoding="utf-8") as f:
        metadata = json.load(f)

    contact_id = metadata.get("contact_id")
    contact_name = metadata.get("contact_name")
    msg_break_token = metadata.get("msg_break_token")

    print(f"Loaded metadata from {metadata_path}")
    print(f"  Contact ID: {contact_id}")
    print(f"  Contact Name: {contact_name}")
    print(f"  Message Break Token: {msg_break_token}")
    print(f"  Total Messages: {metadata.get('total_messages', 'N/A')}")
    print(f"  Training Examples: {metadata.get('training_examples', 'N/A')}")
    print()

    if args.output is None:
        # "You" is the only persona the app trains (see AGENTS.md).
        output_dir = Path.home() / ".be-right-back" / "models" / "personas" / "you"
    else:
        output_dir = Path(args.output).expanduser()

    jsonl_path = data_dir / "train.jsonl"
    if not jsonl_path.exists():
        print(f"error: train.jsonl not found at {jsonl_path}", file=sys.stderr)
        sys.exit(1)

    config = Config.default(
        data_path=str(jsonl_path), output_dir=str(output_dir), base_model=args.base_model
    )

    config.lora.rank = args.lora_rank
    config.lora.alpha = args.lora_alpha
    config.training.max_steps = args.max_steps
    config.training.learning_rate = args.learning_rate
    config.training.batch_size = args.batch_size
    config.training.save_steps = args.save_every
    config.training.max_seq_length = args.max_seq_length
    if args.num_layers is not None:
        config.training.num_layers = args.num_layers
    if args.grad_accum is not None:
        config.training.gradient_accumulation_steps = args.grad_accum
    if args.eval_steps is not None:
        config.training.eval_steps = args.eval_steps
    if args.no_early_stopping:
        config.training.early_stopping_patience = None
    config.contact_id = contact_id
    config.contact_name = contact_name

    if not config.data_path.exists():
        print(f"error: training data not found at {config.data_path}", file=sys.stderr)
        sys.exit(1)

    config.output_dir.mkdir(parents=True, exist_ok=True)
    run_training(config, data_dir)


if __name__ == "__main__":
    main()

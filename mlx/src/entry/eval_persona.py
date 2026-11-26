#!/usr/bin/env python3
"""Persona fidelity eval CLI.

Scores a trained persona against its held-out messages: base model vs base model
plus adapter. Writes `report.json` and `report.md` under `<persona>/fidelity/`.
Runs on Apple Silicon only, since it loads the model with MLX.
"""

import argparse
import sys
from pathlib import Path

# Entry points run as scripts, so put mlx/src/ on sys.path (same as entry/train.py).
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from fidelity.run import EvalOptions, main  # noqa: E402


def parse_args(argv: list[str] | None = None) -> EvalOptions:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--persona-dir", type=Path, required=True, help="~/.be-right-back/models/personas/<id>"
    )
    p.add_argument(
        "--data", type=Path, help="train.jsonl (default: path in training_metadata.json)"
    )
    p.add_argument("--base-model", help="default: base_model in training_metadata.json")
    p.add_argument(
        "--max-examples", type=int, default=200, help="held-out examples to score (0 = all)"
    )
    p.add_argument(
        "--generate", type=int, default=50, help="replies to generate for style (0 = skip)"
    )
    p.add_argument("--max-tokens", type=int, default=128, help="max tokens per generated reply")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--system-prompt", choices=["chat", "none"], default="chat")
    p.add_argument(
        "--allow-legacy-split",
        action="store_true",
        help="score the chronological tail when heldout.json does not match the data",
    )
    p.add_argument(
        "--output", type=Path, help="report directory (default: <persona>/fidelity/<time>)"
    )
    a = p.parse_args(argv)
    return EvalOptions(
        persona_dir=a.persona_dir.expanduser(),
        data_path=a.data.expanduser() if a.data else None,
        base_model=a.base_model,
        max_examples=a.max_examples,
        generate=a.generate,
        max_tokens=a.max_tokens,
        seed=a.seed,
        system_prompt=a.system_prompt,
        allow_legacy_split=a.allow_legacy_split,
        output_dir=a.output.expanduser() if a.output else None,
    )


if __name__ == "__main__":
    sys.exit(main(parse_args()))

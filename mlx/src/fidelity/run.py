"""Run the persona fidelity eval end to end and write the report."""

import random
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ujson as json

from fidelity.heldout import HeldoutMismatchError, legacy_tail_indices, load_heldout
from fidelity.report import to_markdown, verdict
from fidelity.style import compare as compare_style
from utils.data import load_jsonl
from utils.ipc import send_response
from utils.msg_break import read_msg_break_token, register_msg_break


@dataclass
class EvalOptions:
    persona_dir: Path
    data_path: Path | None = None
    base_model: str | None = None
    max_examples: int = 200
    generate: int = 50
    max_tokens: int = 128
    seed: int = 0
    system_prompt: str = "chat"  # "chat" = chat_metadata.json, "none" = no system prompt
    allow_legacy_split: bool = False
    output_dir: Path | None = None


def _progress(phase: str, message: str, **extra: Any) -> None:
    send_response({"type": "fidelity_progress", "phase": phase, "message": message, **extra})


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def resolve_adapter_dir(persona_dir: Path) -> Path:
    """Same lookup as the inference daemon: nested `adapter/` first, then flat."""
    for candidate in (persona_dir / "adapter", persona_dir):
        if (candidate / "adapters.safetensors").exists():
            return candidate
    raise FileNotFoundError(f"no adapters.safetensors under {persona_dir}")


def sample_examples(examples: list[Any], limit: int, seed: int) -> list[Any]:
    """Seeded subsample that keeps the original order."""
    if limit <= 0 or len(examples) <= limit:
        return list(examples)
    keep = sorted(random.Random(seed).sample(range(len(examples)), limit))
    return [examples[i] for i in keep]


def run_eval(opts: EvalOptions) -> dict[str, Any]:
    # MLX imports stay here so the pure-Python modules import on any platform.
    from mlx_lm import load

    from fidelity.generate import generate_replies
    from fidelity.perplexity import compare_base_and_adapter, with_system_prompt
    from utils.mlx_memory import configure_cache_limit

    configure_cache_limit()

    started = time.time()
    persona_dir = opts.persona_dir
    training_meta = _read_json(persona_dir / "training_metadata.json")
    chat_meta = _read_json(persona_dir / "chat_metadata.json")

    data_path = opts.data_path or Path(training_meta.get("training_data_path", ""))
    if not data_path.is_file():
        raise FileNotFoundError(f"training data not found: {data_path!s}. Pass --data.")
    base_model = opts.base_model or training_meta.get("base_model")
    if not base_model:
        raise ValueError("base model unknown: training_metadata.json has none. Pass --base-model.")
    max_seq_length = (
        training_meta.get("training_config", {}).get("training", {}).get("max_seq_length") or 1024
    )
    break_token = read_msg_break_token(chat_meta, "chat_metadata.json")

    _progress("loading_data", f"Loading {data_path.name}")
    examples = load_jsonl(data_path)
    try:
        heldout, split_method = load_heldout(
            persona_dir,
            examples,
            data_path=data_path,
            trained_examples=training_meta.get("training_examples"),
        )
    except HeldoutMismatchError:
        # Only a data mismatch falls back. Other errors, like malformed JSON, surface.
        if not opts.allow_legacy_split:
            raise
        heldout = [examples[i] for i in legacy_tail_indices(len(examples))]
        split_method = "legacy_tail_forced"
    heldout = [ex for ex in heldout if ex["messages"] and ex["messages"][-1]["role"] == "assistant"]
    used = sample_examples(heldout, opts.max_examples, opts.seed)
    if not used:
        raise ValueError("held-out set is empty; the persona has too few examples to evaluate")

    system_prompt = chat_meta.get("system_prompt") if opts.system_prompt == "chat" else None

    _progress("loading_model", f"Loading {base_model} with adapter")
    adapter_dir = resolve_adapter_dir(persona_dir)
    model, tokenizer = load(  # type: ignore[misc]
        base_model,
        adapter_path=str(adapter_dir),
        tokenizer_config={"trust_remote_code": True},
    )
    model.eval()
    from fidelity.perplexity import verify_adapter_loaded

    verify_adapter_loaded(model, adapter_dir)
    # Same id as in training and in the chat daemon.
    register_msg_break(tokenizer, break_token, model)

    style: dict[str, Any] | None = None
    if opts.generate > 0:
        from fidelity.perplexity import adapter_disabled

        # Random subset: `used` is in file order, which is time order.
        gen_examples = sample_examples(used, opts.generate, opts.seed)
        _progress("generating", f"Generating {len(gen_examples)} base replies")
        with adapter_disabled(model):
            base_replies = generate_replies(
                model,
                tokenizer,
                gen_examples,
                system_prompt=system_prompt,
                seed=opts.seed,
                max_tokens=opts.max_tokens,
                break_token=break_token,
            )
        _progress("generating", f"Generating {len(gen_examples)} adapter replies")
        adapter_replies = generate_replies(
            model,
            tokenizer,
            gen_examples,
            system_prompt=system_prompt,
            seed=opts.seed,
            max_tokens=opts.max_tokens,
            break_token=break_token,
        )
        real_replies = [ex["messages"][-1]["content"] for ex in gen_examples]
        style = compare_style(real_replies, base_replies, adapter_replies, break_token=break_token)
        style["samples"] = [
            {"prompt": ex["messages"][:-1], "real": r, "base": b, "adapter": a}
            for ex, r, b, a in zip(
                gen_examples, real_replies, base_replies, adapter_replies, strict=True
            )
        ]

    _progress("scoring", f"Scoring {len(used)} held-out examples")
    scored = [with_system_prompt(ex, system_prompt) for ex in used]
    ppl = compare_base_and_adapter(
        model, tokenizer, scored, max_seq_length=max_seq_length, break_token=break_token
    )

    report: dict[str, Any] = {
        "version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "persona_dir": str(persona_dir),
        "contact_name": training_meta.get("contact_name") or chat_meta.get("contact_name"),
        "base_model": base_model,
        "adapter_dir": str(adapter_dir),
        "data_path": str(data_path),
        "heldout": {"method": split_method, "available": len(heldout), "used": len(used)},
        "system_prompt": "chat_metadata.json" if system_prompt else "none",
        "max_seq_length": max_seq_length,
        "seed": opts.seed,
        "perplexity": ppl,
        "style": style,
        "verdict": verdict(ppl),
        "duration_secs": round(time.time() - started, 1),
    }
    return report


def write_report(report: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    """Write `report.json` (with samples) and `report.md`. Both hold real messages."""
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "report.json"
    md_path = output_dir / "report.md"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    md_path.write_text(to_markdown(report), encoding="utf-8")
    return json_path, md_path


def main(opts: EvalOptions) -> int:
    try:
        report = run_eval(opts)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        _progress("error", str(exc))
        return 1
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    output_dir = opts.output_dir or opts.persona_dir / "fidelity" / stamp
    json_path, md_path = write_report(report, output_dir)
    ppl = report["perplexity"]
    send_response(
        {
            "type": "fidelity_complete",
            "verdict": report["verdict"],
            "base_perplexity": ppl["base"]["perplexity"],
            "adapter_perplexity": ppl["adapter"]["perplexity"],
            "perplexity_delta": ppl["all_tokens"]["delta"],
            "val_examples": ppl["adapter"]["examples"],
            "report_path": str(json_path),
        }
    )
    print(md_path.read_text(encoding="utf-8"), file=sys.stderr)
    return 0

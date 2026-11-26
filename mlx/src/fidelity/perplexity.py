"""Held-out perplexity for base model vs base model + adapter.

Scoring mirrors training exactly: `ChatDataset(mask_prompt=True)` tokenizes each
example, and only the final assistant message counts, truncated to
`max_seq_length`. One exception: an empty Qwen think block at the start of the
reply is left out, since it is template, not the person. The adapter is switched off by setting every LoRA layer's scale
to 0, so both conditions run on the same loaded weights.
"""

import math
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten
from mlx_lm.tuner.datasets import ChatDataset

Example = dict[str, Any]


@dataclass
class PerplexityResult:
    """Token-weighted perplexity over a set of examples."""

    examples: int
    skipped: int
    tokens: int
    mean_nll: float
    perplexity: float
    # The same, with `<MSG_BREAK>` targets left out. The base model has never seen
    # that token, so it can dominate the gap on its own.
    tokens_excl_break: int
    mean_nll_excl_break: float
    perplexity_excl_break: float
    # Examples whose empty `<think>\n\n</think>\n\n` scaffold was left out of the targets.
    think_scaffold_masked: int = 0
    # Break vs end-of-turn choice at the person's real bubble and turn ends.
    # See `BoundaryStats`. None when there is no break token.
    boundaries: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BoundaryStats:
    """What the model predicts where the person ended a bubble.

    At a real break, the person sent another bubble. At a real end, they
    stopped. `p_break` and `p_end` are the model's probabilities of
    `<MSG_BREAK>` and of the end-of-turn token at that point.
    `picks_break` counts points where `p_break > p_end`.
    """

    breaks: int = 0
    breaks_picks_break: int = 0
    breaks_p_break: float = 0.0
    breaks_p_end: float = 0.0
    ends: int = 0
    ends_picks_break: int = 0
    ends_p_break: float = 0.0
    ends_p_end: float = 0.0

    def add(self, other: "BoundaryStats") -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))

    def to_dict(self) -> dict[str, Any]:
        def mean(total: float, n: int) -> float | None:
            return total / n if n else None

        return {
            "breaks": self.breaks,
            "breaks_pick_break_rate": mean(self.breaks_picks_break, self.breaks),
            "breaks_mean_p_break": mean(self.breaks_p_break, self.breaks),
            "breaks_mean_p_end": mean(self.breaks_p_end, self.breaks),
            "ends": self.ends,
            "ends_pick_break_rate": mean(self.ends_picks_break, self.ends),
            "ends_mean_p_break": mean(self.ends_p_break, self.ends),
            "ends_mean_p_end": mean(self.ends_p_end, self.ends),
        }


@dataclass
class _ExampleScore:
    nll: float
    tokens: int
    nll_excl_break: float
    tokens_excl_break: int
    boundaries: BoundaryStats | None = None


def with_system_prompt(example: Example, system_prompt: str | None) -> Example:
    """Prepend a system message unless the example already has one."""
    if not system_prompt:
        return example
    messages = example["messages"]
    if messages and messages[0].get("role") == "system":
        return example
    return {**example, "messages": [{"role": "system", "content": system_prompt}, *messages]}


@contextmanager
def adapter_disabled(model: nn.Module) -> Iterator[int]:
    """Set every LoRA layer's scale to 0 for the duration of the block.

    Yields the number of LoRA layers switched off. 0 means the model has no adapter.
    """
    saved: list[tuple[Any, float]] = []
    for module in model.modules():
        if hasattr(module, "lora_a") and hasattr(module, "scale"):
            saved.append((module, module.scale))
            module.scale = 0.0
    try:
        yield len(saved)
    finally:
        for module, scale in saved:
            module.scale = scale


def _score_one(
    model: nn.Module,
    tokens: list[int],
    offset: int,
    max_seq_length: int,
    break_id: int | None,
    end_id: int | None = None,
) -> _ExampleScore | None:
    tokens = tokens[:max_seq_length]
    if offset >= len(tokens) or len(tokens) < 2:
        return None  # truncation removed every target token; training skips these too

    arr = mx.array(tokens)[None]
    inputs, targets = arr[:, :-1], arr[:, 1:]
    logits = model(inputs)
    ce = nn.losses.cross_entropy(logits, targets).astype(mx.float32)

    # Target position t predicts token t+1. Training keeps steps t+1 >= offset.
    steps = mx.arange(1, targets.shape[1] + 1)
    mask = steps >= offset
    nll = (ce * mask).sum()
    n = mask.sum()
    if break_id is not None:
        mask_excl = mx.logical_and(mask, targets[0] != break_id)
    else:
        mask_excl = mask
    nll_excl = (ce * mask_excl).sum()
    n_excl = mask_excl.sum()
    # Take the few boundary rows in the same eval, so the full logits
    # (sequence x vocabulary) are not kept after this function.
    points = boundary_points(tokens, offset, break_id, end_id)
    probs = None
    if points and break_id is not None and end_id is not None:
        rows = logits[0][mx.array([p for p, _ in points])].astype(mx.float32)
        probs = mx.softmax(rows, axis=-1)[:, mx.array([break_id, end_id])]
    mx.eval(nll, n, nll_excl, n_excl, *([probs] if probs is not None else []))
    # `probs` was evaluated above, so the logits are no longer needed. Any new
    # value read from `logits` must join that `mx.eval` before this line.
    del logits, ce
    boundaries = None
    if break_id is not None and end_id is not None:
        boundaries = _boundary_stats(points, probs.tolist() if probs is not None else [])
    return _ExampleScore(
        cast(float, nll.item()),
        int(cast(float, n.item())),
        cast(float, nll_excl.item()),
        int(cast(float, n_excl.item())),
        boundaries,
    )


def boundary_points(
    tokens: list[int], offset: int, break_id: int | None, end_id: int | None
) -> list[tuple[int, bool]]:
    """Return (logit row, is_break) for each real break and the real turn end.

    `logits[t]` predicts `tokens[t + 1]`. Only the first end token after
    `offset` counts: it closes the scored reply.
    """
    if break_id is None or end_id is None:
        return []
    points: list[tuple[int, bool]] = []
    for t in range(max(offset, 1), len(tokens)):
        if tokens[t] == break_id:
            points.append((t - 1, True))
        elif tokens[t] == end_id:
            points.append((t - 1, False))
            break
    return points


def _boundary_stats(points: list[tuple[int, bool]], probs: list[list[float]]) -> BoundaryStats:
    """Tally P(break) and P(end) at each point. `probs[i]` is [P(break), P(end)]."""
    stats = BoundaryStats()
    for (_, is_break), (pb, pe) in zip(points, probs, strict=True):
        picks = int(pb > pe)
        if is_break:
            stats.breaks += 1
            stats.breaks_picks_break += picks
            stats.breaks_p_break += pb
            stats.breaks_p_end += pe
        else:
            stats.ends += 1
            stats.ends_picks_break += picks
            stats.ends_p_break += pb
            stats.ends_p_end += pe
    return stats


def end_of_turn_id(tokenizer: Any) -> int | None:
    """Return the id that ends an assistant turn: `<|im_end|>`, else the EOS token."""
    ids = tokenizer.convert_tokens_to_ids("<|im_end|>")
    unk = getattr(tokenizer, "unk_token_id", None)
    if isinstance(ids, int) and ids != unk:
        return ids
    eos = getattr(tokenizer, "eos_token_id", None)
    return eos if isinstance(eos, int) else None


# Qwen3 chat templates put an empty think block before the final assistant reply.
# It is template scaffolding, not the person's words, so it is left out of the targets.
THINK_SCAFFOLD = "<think>\n\n</think>\n\n"


def think_scaffold_ids(tokenizer: Any) -> list[int]:
    return list(tokenizer.encode(THINK_SCAFFOLD, add_special_tokens=False))


def skip_think_scaffold(tokens: list[int], offset: int, scaffold: list[int]) -> int:
    """Move `offset` past an empty think block at the start of the targets, if one is there."""
    if scaffold and tokens[offset : offset + len(scaffold)] == scaffold:
        return offset + len(scaffold)
    return offset


def verify_adapter_loaded(model: nn.Module, adapter_dir: Path) -> int:
    """Check that every weight in `adapters.safetensors` is in the model, unchanged.

    mlx-lm before 0.31 drops adapter weights whose names do not match the model,
    without an error. The adapter then does nothing. Returns the number of weights checked.
    """
    saved = mx.load(str(adapter_dir / "adapters.safetensors"))
    if not isinstance(saved, dict):
        raise TypeError(f"{adapter_dir / 'adapters.safetensors'} did not load as a weight dict")
    params = dict(tree_flatten(model.parameters()))
    missing = [k for k in saved if k not in params]
    if missing:
        raise ValueError(
            f"{len(missing)} of {len(saved)} adapter weights have no matching layer in the "
            f"base model (first: {missing[0]}). The adapter was trained on a different base "
            "model than training_metadata.json names. Pass --base-model."
        )
    changed = [k for k, w in saved.items() if not mx.array_equal(params[k], w).item()]
    if changed:
        raise ValueError(
            f"{len(changed)} of {len(saved)} adapter weights did not load "
            f"(first: {changed[0]}). Check the adapter and the mlx-lm version."
        )
    return len(saved)


def _summarize(scores: list[_ExampleScore], skipped: int, masked: int = 0) -> PerplexityResult:
    tokens = sum(s.tokens for s in scores)
    tokens_excl = sum(s.tokens_excl_break for s in scores)
    mean_nll = sum(s.nll for s in scores) / tokens if tokens else float("nan")
    mean_excl = sum(s.nll_excl_break for s in scores) / tokens_excl if tokens_excl else float("nan")
    boundaries: BoundaryStats | None = None
    for s in scores:
        if s.boundaries is not None:
            boundaries = boundaries or BoundaryStats()
            boundaries.add(s.boundaries)
    return PerplexityResult(
        examples=len(scores),
        skipped=skipped,
        tokens=tokens,
        mean_nll=mean_nll,
        perplexity=math.exp(mean_nll) if tokens else float("nan"),
        tokens_excl_break=tokens_excl,
        mean_nll_excl_break=mean_excl,
        perplexity_excl_break=math.exp(mean_excl) if tokens_excl else float("nan"),
        think_scaffold_masked=masked,
        boundaries=boundaries.to_dict() if boundaries else None,
    )


def system_prompt_tokens(tokenizer: Any, messages: list[dict]) -> int:
    """Token count of a leading system message, as the chat template renders it.

    Qwen's template rejects a conversation with no user turn, so this renders
    a one-word user turn with and without the system message.
    """
    if not messages or messages[0].get("role") != "system":
        return 0
    probe = {"role": "user", "content": "hi"}

    def count(conversation: list[dict]) -> int:
        text = tokenizer.apply_chat_template(conversation, tokenize=False)
        return len(tokenizer.encode(text, add_special_tokens=False))

    return max(0, count([messages[0], probe]) - count([probe]))


def score_examples(
    model: nn.Module,
    tokenizer: Any,
    examples: list[Example],
    *,
    max_seq_length: int,
    break_token: str | None = None,
) -> PerplexityResult:
    """Token-weighted perplexity of each example's final assistant message."""
    dataset = ChatDataset(examples, tokenizer, chat_key="messages", mask_prompt=True)  # type: ignore[arg-type]
    break_id = None
    if break_token:
        ids = tokenizer.convert_tokens_to_ids(break_token)
        unk = getattr(tokenizer, "unk_token_id", None)
        if isinstance(ids, int) and ids != unk:
            break_id = ids

    end_id = end_of_turn_id(tokenizer)
    scaffold = think_scaffold_ids(tokenizer)
    scores: list[_ExampleScore] = []
    skipped = 0
    masked = 0
    for i in range(len(dataset)):
        example = dataset[i]
        if example["messages"][-1].get("role") != "assistant":
            skipped += 1
            continue
        tokens, offset = dataset.process(example)
        new_offset = skip_think_scaffold(tokens, offset, scaffold)
        masked += new_offset != offset
        offset = new_offset
        # Training data has no system prompt. Give the prompt's tokens on top of
        # the training length, so a long chat prompt does not cut off the reply.
        limit = max_seq_length + system_prompt_tokens(tokenizer, example["messages"])
        score = _score_one(model, tokens, offset, limit, break_id, end_id)
        # Sequence lengths vary, so the MLX cache would otherwise keep a
        # buffer for each size and grow until macOS kills the process.
        mx.clear_cache()
        if score is None:
            skipped += 1
        else:
            scores.append(score)
    return _summarize(scores, skipped, masked)


def perplexity_delta(base: PerplexityResult, adapter: PerplexityResult) -> dict[str, Any]:
    """Compare two results. Positive delta means the adapter fits the held-out set better."""

    def _pair(b: float, a: float) -> dict[str, float | None]:
        if math.isnan(b) or math.isnan(a):
            return {"delta": None, "improvement_pct": None, "nll_delta": None}
        return {
            "delta": b - a,
            "improvement_pct": 100.0 * (b - a) / b,
            "nll_delta": math.log(b) - math.log(a),
        }

    return {
        "all_tokens": _pair(base.perplexity, adapter.perplexity),
        "excl_break": _pair(base.perplexity_excl_break, adapter.perplexity_excl_break),
    }


def compare_base_and_adapter(
    model: nn.Module,
    tokenizer: Any,
    examples: list[Example],
    *,
    max_seq_length: int,
    break_token: str | None = None,
) -> dict[str, Any]:
    """Score the same examples with the adapter off, then on."""
    with adapter_disabled(model) as n_lora:
        if n_lora == 0:
            raise ValueError("model has no LoRA layers; load it with adapter_path")
        base = score_examples(
            model, tokenizer, examples, max_seq_length=max_seq_length, break_token=break_token
        )
    adapter = score_examples(
        model, tokenizer, examples, max_seq_length=max_seq_length, break_token=break_token
    )
    return {
        "base": base.to_dict(),
        "adapter": adapter.to_dict(),
        **perplexity_delta(base, adapter),
        "lora_layers": n_lora,
    }

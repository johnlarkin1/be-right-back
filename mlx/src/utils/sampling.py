"""Repetition penalty that leaves turn-structure tokens alone.

mlx-lm's repetition penalty divides the logit of every token in the last
`context_size` tokens, including the prompt's tail. A reply with two short
bubbles then penalizes its own `<MSG_BREAK>`, and the prompt's
`<|im_end|>` penalizes ending the turn. Those tokens mark structure, not
repeated words, so this penalty skips them.
"""

from collections.abc import Callable, Iterable
from typing import Any

import mlx.core as mx

LogitsProcessor = Callable[[mx.array, mx.array], mx.array]


def structure_token_ids(tokenizer: Any, break_token: str | None) -> list[int]:
    """Return the ids of the break token, `<|im_end|>` and every EOS token."""
    ids: set[int] = set()
    unk = getattr(tokenizer, "unk_token_id", None)
    for token in (break_token, "<|im_end|>"):
        if token:
            token_id = tokenizer.convert_tokens_to_ids(token)
            if isinstance(token_id, int) and token_id != unk:
                ids.add(token_id)
    eos = getattr(tokenizer, "eos_token_ids", None) or [getattr(tokenizer, "eos_token_id", None)]
    ids.update(i for i in eos if isinstance(i, int))
    return sorted(ids)


def make_repetition_penalty(
    penalty: float, context_size: int = 20, exempt_ids: Iterable[int] = ()
) -> LogitsProcessor:
    """Return mlx-lm's repetition penalty, with `exempt_ids` left unpenalized."""
    if penalty <= 0:
        raise ValueError(f"penalty must be positive, got {penalty}")
    exempt_list = sorted(set(exempt_ids))
    exempt = mx.array(exempt_list) if exempt_list else None

    def processor(tokens: mx.array, logits: mx.array) -> mx.array:
        if len(tokens) == 0 or penalty == 1.0:
            return logits
        recent = tokens[-context_size:]
        kept = logits[:, exempt] if exempt is not None else None
        selected = logits[:, recent]
        logits[:, recent] = mx.where(selected < 0, selected * penalty, selected / penalty)
        if exempt is not None and kept is not None:
            logits[:, exempt] = kept
        return logits

    return processor

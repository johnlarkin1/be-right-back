"""Generate persona replies to held-out prompts, the way the chat UI does.

The prompt format and sampling settings mirror `entry/inference_daemon.py`:
ChatML with an empty think block, temp 0.7, top_p 0.9, repetition penalty 1.1
that skips the break and end-of-turn tokens.
"""

from typing import Any

import mlx.core as mx
import mlx.nn as nn
from mlx_lm import generate
from mlx_lm.sample_utils import make_sampler

from utils.llm import strip_think_tags
from utils.sampling import make_repetition_penalty, structure_token_ids

Example = dict[str, Any]

_SPECIAL_TOKENS = ("<|im_end|>", "<|im_start|>", "<|endoftext|>")


def format_chatml(messages: list[dict[str, str]]) -> str:
    """ChatML prompt with thinking off. Mirrors `InferenceDaemon._format_chat_prompt`."""
    parts = [f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages]
    parts.append("<|im_start|>assistant\n<think>\n\n</think>\n\n")
    return "".join(parts)


def prompt_messages(example: Example, system_prompt: str | None) -> list[dict[str, str]]:
    """Every message before the final assistant turn, with the persona system prompt first."""
    messages = list(example["messages"][:-1])
    if system_prompt and (not messages or messages[0].get("role") != "system"):
        messages.insert(0, {"role": "system", "content": system_prompt})
    return messages


def clean_reply(text: str) -> str:
    text = strip_think_tags(text)
    for token in _SPECIAL_TOKENS:
        text = text.replace(token, "")
    return text.strip()


def generate_replies(
    model: nn.Module,
    tokenizer: Any,
    examples: list[Example],
    *,
    system_prompt: str | None,
    seed: int,
    max_tokens: int = 128,
    temperature: float = 0.7,
    top_p: float = 0.9,
    repetition_penalty: float = 1.1,
    break_token: str | None = None,
) -> list[str]:
    """One sampled reply per example.

    Reseeds before each example with `seed + index`. Each reply then gets the
    same RNG state in both conditions, however many draws earlier replies used.
    """
    sampler = make_sampler(temp=temperature, top_p=top_p)
    exempt = structure_token_ids(tokenizer, break_token)
    replies = []
    for index, example in enumerate(examples):
        mx.random.seed(seed + index)
        prompt = format_chatml(prompt_messages(example, system_prompt))
        processors = [make_repetition_penalty(repetition_penalty, 20, exempt)]
        text = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            sampler=sampler,
            logits_processors=processors,
        )
        replies.append(clean_reply(text))
    return replies

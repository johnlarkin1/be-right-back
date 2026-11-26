"""LLM response cleaning utilities."""

import re

from constants import EOS_TOKENS


def strip_think_tags(text: str) -> str:
    """Remove Qwen3/3.5 thinking blocks from LLM output.

    Qwen3 models emit a reasoning block before the actual answer.
    This strips it so callers get only the final response.
    Handles:
    - Complete blocks: <think>...</think>
    - Incomplete blocks (truncated): <think>... with no closing tag
    - Orphaned closing tag: </think>... where <think> was in the prompt
      (common when prompt stripping removes the opening tag)
    """
    # Complete think block: <think>...</think> (possibly multi-line)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # Incomplete think block (truncated): <think>... with no closing tag
    text = re.sub(r"<think>.*", "", text, flags=re.DOTALL)
    # Orphaned </think> — opening <think> was part of the prompt and got stripped.
    # Everything before the closing tag is thinking content.
    text = re.sub(r"^.*?</think>\s*", "", text, flags=re.DOTALL)
    return text.strip()


def clean_llm_response(text: str, strip_preamble: bool = False) -> str:
    """Clean an LLM response by removing EOS tokens and optional preamble.

    Args:
        text: Raw LLM output text.
        strip_preamble: If True, remove any text before the first ### header.

    Returns:
        Cleaned text with EOS tokens removed and optionally preamble stripped.
    """
    # Strip Qwen3 thinking blocks first
    text = strip_think_tags(text)

    # Remove everything after end-of-text tokens
    for eos_token in EOS_TOKENS:
        if eos_token in text:
            text = text.split(eos_token)[0].strip()
            break

    # Strip any preamble before the first ### header (h3)
    # LLM sometimes outputs # or ## title headers before the actual sections
    if strip_preamble:
        header_match = re.search(r"^###\s", text, re.MULTILINE)
        if header_match and header_match.start() > 0:
            text = text[header_match.start() :]

    return text.strip()

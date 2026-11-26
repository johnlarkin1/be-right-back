"""Turn stored chunks into topic text: no contact header, no speaker names.

The embedding pipeline formats each chunk as:

    [Contact: Riley | 2024-03-15]
    Riley: are we still on for dinner
    Me: yes 7pm

Analytics wants only what was said. The header and sender names repeat in
every chunk of a contact, so they dominate word counts and cluster labels.
"""

import re
from collections import Counter

from constants import STOP_WORDS

_HEADER_RE = re.compile(r"^\[Contact:[^\]\n]*\]\s*\n?")
_WORD_RE = re.compile(r"\b[a-z]{3,}\b")
# Link text ("stspg", "utm", domain names) is not something anyone said.
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
# Possessive 's keeps its word ("dad's" -> "dad"). Any other contraction is a
# function word ("we'd", "she'll", "don't"); joined, it reads as "wed" or "shell".
_POSSESSIVE_RE = re.compile(r"'s\b")
_CONTRACTION_RE = re.compile(r"\b[a-z]+'[a-z]+\b")
# Laughs and interjections with any number of repeats: hahaha, lolol, ahhh, yeahhh, hmmm.
_NOISE_WORD_RE = re.compile(
    r"^(?:(?:ha|he|ah|ja|ba)+h?|l+o+l+(?:o+l+)*|l+m+f*a+o+|a+h+|o+h+|u+g+h+|h+m+|m+h*m+|"
    r"y+e+a*h*s*|y+a+y*|n+o+p*e*|w+o+w+|o+o+f+|u+m+|e+h+|a+w+|y+e+p+|y+u+p+|o+k+a*y*)$"
)


def message_lines(chunk_data: dict, contact_name: str = "") -> list[tuple[bool, str]]:
    """Return (is_from_me, text) per message in a stored chunk.

    Reads `chunk_data["messages"]` when present. Falls back to parsing
    `chunk_data["formatted"]` with the known sender names.
    """
    messages = chunk_data.get("messages") or []
    if messages:
        return [(m.get("sender") == "Me", m.get("text", "")) for m in messages if m.get("text")]

    formatted = chunk_data.get("formatted", "")
    return _parse_formatted(formatted, contact_name)


def _parse_formatted(formatted: str, contact_name: str) -> list[tuple[bool, str]]:
    body = _HEADER_RE.sub("", formatted, count=1)
    senders = ["Me"] + ([contact_name] if contact_name else [])
    prefix = re.compile(rf"^({'|'.join(re.escape(s) for s in senders)}):\s?")
    lines: list[tuple[bool, str]] = []
    for line in body.split("\n"):
        match = prefix.match(line)
        if match:
            lines.append((match.group(1) == "Me", line[match.end() :]))
        elif lines:
            # Continuation of a multi-line message.
            is_me, text = lines[-1]
            lines[-1] = (is_me, f"{text}\n{line}")
        elif line.strip():
            lines.append((False, line))
    return lines


def chunk_body(chunk_data: dict, contact_name: str = "") -> str:
    """Message texts only, one per line."""
    return "\n".join(text for _, text in message_lines(chunk_data, contact_name))


def chunk_dialogue(chunk_data: dict, contact_name: str = "") -> str:
    """Messages as `Me:` / `Them:` lines, for LLM prompts."""
    return "\n".join(
        f"{'Me' if is_me else 'Them'}: {text}"
        for is_me, text in message_lines(chunk_data, contact_name)
    )


def name_tokens(names: list[str]) -> set[str]:
    """Lowercase word tokens of contact names, for filtering keywords."""
    tokens: set[str] = set()
    for name in names:
        tokens.update(re.findall(r"[a-z]+", name.lower()))
    return tokens


def extract_words(text: str, exclude: set[str] | frozenset[str] = frozenset()) -> Counter:
    """Count content words: 3+ letters, not a stop word or an excluded token."""
    text = _URL_RE.sub(" ", text.lower()).replace("\u2019", "'")
    text = _CONTRACTION_RE.sub(" ", _POSSESSIVE_RE.sub("", text))
    return Counter(
        w
        for w in _WORD_RE.findall(text)
        if w not in STOP_WORDS and w not in exclude and not _NOISE_WORD_RE.match(w)
    )

"""Stylometric distance between real replies and generated replies.

Each reply is one assistant turn. `<MSG_BREAK>` splits a turn into bubbles, the
separate iMessages a person sends in a row. Features are rates per bubble or
histograms. The eval reports each feature on its own. It does not combine them
into one score, because a single composite is easy to game (see issue #228).
"""

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

_EMOJI_RE = re.compile(
    "["
    "\U0001f1e6-\U0001f1ff"  # flags
    "\U0001f300-\U0001f5ff"  # symbols and pictographs
    "\U0001f600-\U0001f64f"  # emoticons
    "\U0001f680-\U0001f6ff"  # transport and map
    "\U0001f900-\U0001f9ff"  # supplemental symbols
    "\U0001fa70-\U0001faff"  # extended pictographs
    "☀-➿"  # misc symbols and dingbats
    "❤"
    "]"
)
_WORD_RE = re.compile(r"[a-z0-9']+")
_LAUGH_RE = re.compile(r"\b(?:a?ha(?:ha)+h?|lol+|lmf?ao+|rofl)\b|😂|🤣")
_SLANG = frozenset(
    "u ur r ya ya'll yall idk tbh imo ngl omg omw btw rn nvm pls plz thx ty k kk gonna wanna "
    "gotta lemme dunno yeah yea yep nah ok okay".split()
)

# Histogram bin upper bounds (inclusive). The last bin is open-ended.
BUBBLE_BINS = (1, 2, 3, 4)
WORD_BINS = (1, 2, 3, 5, 8, 12, 20, 40)

RATE_FEATURES = (
    "lowercase_start",
    "all_lowercase",
    "ends_with_period",
    "has_question",
    "has_exclamation",
    "has_emoji",
    "has_laugh",
    "has_slang",
)
HIST_FEATURES = ("bubbles_per_reply", "words_per_bubble", "word_distribution")


def split_bubbles(reply: str, break_token: str) -> list[str]:
    return [b.strip() for b in reply.split(break_token) if b.strip()]


def _bin(value: int, bounds: tuple[int, ...]) -> int:
    for i, bound in enumerate(bounds):
        if value <= bound:
            return i
    return len(bounds)


@dataclass
class StyleProfile:
    replies: int
    bubbles: int
    rates: dict[str, float]
    bubbles_per_reply: list[float]
    words_per_bubble: list[float]
    word_counts: Counter[str]
    mean_words_per_bubble: float

    def summary(self) -> dict[str, Any]:
        return {
            "replies": self.replies,
            "bubbles": self.bubbles,
            "mean_words_per_bubble": self.mean_words_per_bubble,
            "mean_bubbles_per_reply": self.bubbles / self.replies if self.replies else 0.0,
            **self.rates,
        }


def _normalize(counts: list[int]) -> list[float]:
    total = sum(counts)
    return [c / total for c in counts] if total else [0.0] * len(counts)


def profile(replies: list[str], break_token: str) -> StyleProfile:
    """Extract style features from a list of assistant turns."""
    bubble_hist = [0] * (len(BUBBLE_BINS) + 1)
    word_hist = [0] * (len(WORD_BINS) + 1)
    rate_hits = dict.fromkeys(RATE_FEATURES, 0)
    words: Counter[str] = Counter()
    n_bubbles = 0
    n_words = 0

    for reply in replies:
        bubbles = split_bubbles(reply, break_token)
        bubble_hist[_bin(max(len(bubbles), 1), BUBBLE_BINS)] += 1
        for bubble in bubbles:
            n_bubbles += 1
            lower = bubble.lower()
            tokens = _WORD_RE.findall(lower)
            n_words += len(tokens)
            words.update(tokens)
            word_hist[_bin(len(tokens), WORD_BINS)] += 1

            letters = [c for c in bubble if c.isalpha()]
            if letters and letters[0].islower():
                rate_hits["lowercase_start"] += 1
            if letters and not any(c.isupper() for c in letters):
                rate_hits["all_lowercase"] += 1
            if bubble.endswith(".") and not bubble.endswith(".."):
                rate_hits["ends_with_period"] += 1
            if "?" in bubble:
                rate_hits["has_question"] += 1
            if "!" in bubble:
                rate_hits["has_exclamation"] += 1
            if _EMOJI_RE.search(bubble):
                rate_hits["has_emoji"] += 1
            if _LAUGH_RE.search(lower):
                rate_hits["has_laugh"] += 1
            if any(t in _SLANG for t in tokens):
                rate_hits["has_slang"] += 1

    rates = {k: (v / n_bubbles if n_bubbles else 0.0) for k, v in rate_hits.items()}
    return StyleProfile(
        replies=len(replies),
        bubbles=n_bubbles,
        rates=rates,
        bubbles_per_reply=_normalize(bubble_hist),
        words_per_bubble=_normalize(word_hist),
        word_counts=words,
        mean_words_per_bubble=n_words / n_bubbles if n_bubbles else 0.0,
    )


def js_divergence(p: list[float], q: list[float]) -> float:
    """Jensen-Shannon divergence in bits. 0 = identical, 1 = disjoint."""
    total = 0.0
    for pi, qi in zip(p, q, strict=True):
        m = (pi + qi) / 2
        if pi > 0:
            total += 0.5 * pi * math.log2(pi / m)
        if qi > 0:
            total += 0.5 * qi * math.log2(qi / m)
    return total


def word_js_divergence(a: Counter[str], b: Counter[str]) -> float:
    vocab = sorted(set(a) | set(b))
    if not vocab:
        return 0.0
    return js_divergence(
        _normalize([a[w] for w in vocab]),
        _normalize([b[w] for w in vocab]),
    )


def distances(real: StyleProfile, other: StyleProfile) -> dict[str, float]:
    """Per-feature distance from `other` to `real`. Lower is closer."""
    out = {k: abs(real.rates[k] - other.rates[k]) for k in RATE_FEATURES}
    out["bubbles_per_reply"] = js_divergence(real.bubbles_per_reply, other.bubbles_per_reply)
    out["words_per_bubble"] = js_divergence(real.words_per_bubble, other.words_per_bubble)
    out["word_distribution"] = word_js_divergence(real.word_counts, other.word_counts)
    return out


def compare(
    real: list[str],
    base: list[str],
    adapter: list[str],
    *,
    break_token: str,
    tie_tolerance: float = 0.01,
) -> dict[str, Any]:
    """Compare base and adapter replies against the real replies, feature by feature.

    `closer` names the condition with the smaller distance. Differences within
    `tie_tolerance` count as a tie, since small samples make tiny gaps noise.
    """
    p_real = profile(real, break_token)
    p_base = profile(base, break_token)
    p_adapter = profile(adapter, break_token)
    d_base = distances(p_real, p_base)
    d_adapter = distances(p_real, p_adapter)

    features: dict[str, dict[str, Any]] = {}
    tally = {"adapter": 0, "base": 0, "tie": 0}
    for name in (*RATE_FEATURES, *HIST_FEATURES):
        gap = d_base[name] - d_adapter[name]
        closer = "tie" if abs(gap) <= tie_tolerance else ("adapter" if gap > 0 else "base")
        tally[closer] += 1
        entry: dict[str, Any] = {
            "base_distance": d_base[name],
            "adapter_distance": d_adapter[name],
            "closer": closer,
        }
        if name in RATE_FEATURES:
            entry.update(
                real=p_real.rates[name], base=p_base.rates[name], adapter=p_adapter.rates[name]
            )
        features[name] = entry

    return {
        "profiles": {
            "real": p_real.summary(),
            "base": p_base.summary(),
            "adapter": p_adapter.summary(),
        },
        "features": features,
        "closer_count": tally,
    }

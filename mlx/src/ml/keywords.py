"""Cluster keywords with class-based TF-IDF (c-TF-IDF).

Each cluster is one document: the concatenated message bodies of its chunks.
A word scores high when it is frequent in the cluster and rare across clusters.
"""

import math
from collections import Counter

import numpy as np

from utils.chunk_text import extract_words


def cluster_word_counts(
    cluster_labels: np.ndarray,
    bodies: list[str],
    exclude: set[str],
    chunk_excludes: list[set[str]] | None = None,
) -> dict[int, Counter]:
    """Count content words per cluster. Noise (-1) is skipped.

    `chunk_excludes[i]` adds tokens to drop from chunk i only, such as the
    name of that chunk's own contact.
    """
    counts: dict[int, Counter] = {}
    for i, (cid, body) in enumerate(zip(cluster_labels.tolist(), bodies)):
        if cid < 0 or not body:
            continue
        drop = exclude | chunk_excludes[i] if chunk_excludes else exclude
        counts.setdefault(cid, Counter()).update(extract_words(body, drop))
    return counts


def c_tf_idf_keywords(
    counts: dict[int, Counter],
    top_n: int = 10,
    min_count: int = 3,
) -> dict[int, list[str]]:
    """Top keywords per cluster, best first.

    score(w, c) = tf(w, c) / |c| * log(1 + A / f(w)), where A is the mean word
    count per cluster and f(w) is the count of w across all clusters.
    """
    if not counts:
        return {}

    total: Counter = Counter()
    for c in counts.values():
        total.update(c)
    avg_words = sum(total.values()) / len(counts)

    keywords: dict[int, list[str]] = {}
    for cid, c in counts.items():
        size = sum(c.values()) or 1
        scored = [
            (n / size * math.log(1 + avg_words / total[w]), w)
            for w, n in c.items()
            if n >= min_count
        ]
        scored.sort(reverse=True)
        keywords[cid] = [w for _, w in scored[:top_n]]
    return keywords


def keyword_label(keywords: list[str], cluster_id: int) -> str:
    """Fallback label from the top two keywords: "Rent & Lease"."""
    top = [w.capitalize() for w in keywords[:2]]
    if len(top) == 2:
        return f"{top[0]} & {top[1]}"
    if top:
        return top[0]
    return f"Topic {cluster_id + 1}"

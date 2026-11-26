"""Cross-encoder reranking for search result quality improvement.

Uses sentence-transformers CrossEncoder with ms-marco-MiniLM-L-6-v2
to score (query, passage) pairs for precise relevance ranking.

The cross-encoder jointly encodes query and passage together, producing
a single relevance score. This is more accurate than bi-encoder cosine
similarity but too slow for initial retrieval (O(n) vs O(1) with HNSW),
hence the retrieve-then-rerank pattern.
"""

import sys
import threading
import time
from typing import Any

from sentence_transformers import CrossEncoder


class CrossEncoderReranker:
    """Reranker using a cross-encoder model for precise relevance scoring.

    The model is lazy-loaded on first use and cached for subsequent calls.
    Uses cross-encoder/ms-marco-MiniLM-L-6-v2 (22M params, 6 layers),
    which was trained on MS MARCO passage ranking.

    Typical latency: ~50-150ms for 30 candidates on Apple Silicon.
    """

    DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or self.DEFAULT_MODEL
        self._model: Any = None

    def _ensure_loaded(self) -> None:
        """Load the cross-encoder model if not already loaded."""
        if self._model is not None:
            return

        start = time.monotonic()
        sys.stderr.write(f"Loading cross-encoder model: {self.model_name}\n")
        sys.stderr.flush()

        self._model = CrossEncoder(self.model_name)

        elapsed = time.monotonic() - start
        sys.stderr.write(f"Cross-encoder loaded in {elapsed:.2f}s\n")
        sys.stderr.flush()

    def score(self, query: str, passages: list[str]) -> list[float]:
        """Score (query, passage) pairs using the cross-encoder.

        Args:
            query: The search query string.
            passages: List of passage texts to score against the query.

        Returns:
            List of relevance scores (one per passage). Higher = more relevant.
            Scores are logits from the model (not normalized to 0-1).
        """
        if not passages:
            return []

        self._ensure_loaded()

        start = time.monotonic()

        # Cross-encoder expects list of [query, passage] pairs
        pairs = [[query, passage] for passage in passages]
        scores = self._model.predict(pairs)

        elapsed_ms = (time.monotonic() - start) * 1000

        sys.stderr.write(f"Reranked {len(passages)} passages in {elapsed_ms:.1f}ms\n")
        sys.stderr.flush()

        # Convert numpy array to list of Python floats
        return [float(s) for s in scores]

    def rerank(
        self,
        query: str,
        candidates: list[dict],
        text_key: str = "text",
        id_key: str = "chunk_id",
    ) -> list[dict]:
        """Rerank candidates by cross-encoder score.

        Args:
            query: The search query string.
            candidates: List of dicts with at least text_key and id_key.
            text_key: Key in each candidate dict containing the passage text.
            id_key: Key in each candidate dict containing the unique identifier.

        Returns:
            List of dicts with id_key and "score" fields, sorted by score descending.
        """
        if not candidates:
            return []

        passages = [c.get(text_key, "") for c in candidates]
        scores = self.score(query, passages)

        results = []
        for candidate, score in zip(candidates, scores):
            results.append(
                {
                    id_key: candidate[id_key],
                    "score": score,
                }
            )

        # Sort by score descending
        results.sort(key=lambda x: x["score"], reverse=True)
        return results


# Module-level singleton for reuse across calls, protected by a lock
# to prevent race conditions when multiple threads call get_reranker()
# concurrently (e.g., from the inference daemon's request handlers).
_reranker_lock = threading.Lock()
_default_reranker: CrossEncoderReranker | None = None


def get_reranker(model_name: str | None = None) -> CrossEncoderReranker:
    """Get or create the default reranker singleton.

    This ensures the model is loaded once and reused across calls
    within the same Python process. Thread-safe via lock.
    """
    global _default_reranker
    with _reranker_lock:
        if _default_reranker is None:
            _default_reranker = CrossEncoderReranker(model_name)
        return _default_reranker

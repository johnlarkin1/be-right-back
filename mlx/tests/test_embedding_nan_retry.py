"""A NaN embedding must be retried, not silently stored as zeros."""

import numpy as np
import pytest

from config.embedding import EmbeddingConfig
from pipelines.embedding import attach_embeddings


@pytest.fixture
def batch():
    return [{"text": "dinner tomorrow?"}, {"text": "sounds good"}]


def good(n=2):
    return np.tile(np.linspace(0.1, 1.0, 768, dtype=np.float32), (n, 1))


def test_nan_embedding_is_re_embedded_alone(monkeypatch, batch):
    calls = []

    def fake_embed(model, tokenizer, texts, prefix=""):
        calls.append(texts)
        return good(len(texts))

    monkeypatch.setattr("pipelines.embedding.embed_batch_mlx", fake_embed)

    embeddings = good()
    embeddings[1][5] = np.nan
    out, retried, unusable = attach_embeddings(None, None, batch, embeddings, EmbeddingConfig())

    assert calls == [["sounds good"]], "only the NaN chunk should be re-embedded"
    assert np.isfinite(out[1]["embedding"]).all()
    assert any(out[1]["embedding"]), "retry result must be kept, not zeroed"
    assert (retried, unusable) == (1, 0), "counts are reported for one summary line per batch"


def test_zeros_only_when_retry_also_fails(monkeypatch, batch):
    monkeypatch.setattr(
        "pipelines.embedding.embed_batch_mlx",
        lambda *a, **k: np.full((1, 768), np.inf, dtype=np.float32),
    )

    embeddings = good()
    embeddings[0][:] = np.nan
    out, retried, unusable = attach_embeddings(None, None, batch, embeddings, EmbeddingConfig())

    assert not any(out[0]["embedding"]), "unusable embedding falls back to zeros"
    assert any(out[1]["embedding"]), "healthy embedding is untouched"
    assert (retried, unusable) == (1, 1)


def test_counts_do_not_log_per_chunk(monkeypatch):
    """A burst of NaN must cost one summary line upstream, not a line per chunk.

    log_warn prints to stdout/stderr rather than going through `logging`, so this
    spies on the function itself; caplog would pass whatever the code did.
    """
    monkeypatch.setattr("pipelines.embedding.embed_batch_mlx", lambda *a, **k: good(1))
    warnings = []
    monkeypatch.setattr("pipelines.embedding.log_warn", lambda msg: warnings.append(msg))

    embeddings = good()
    embeddings[0][0] = np.nan
    embeddings[1][0] = np.inf
    _, retried, unusable = attach_embeddings(
        None,
        None,
        [{"text": "dinner tomorrow?"}, {"text": "sounds good"}],
        embeddings,
        EmbeddingConfig(),
    )

    assert (retried, unusable) == (2, 0)
    assert warnings == [], "attach_embeddings must count, not log"

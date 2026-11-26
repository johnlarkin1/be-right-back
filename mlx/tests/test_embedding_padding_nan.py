"""Long padding must not turn a row's embedding into NaN.

A tiny random float16 ModernBERT reproduces the bug on CPU: a row padded by more
than 64 tokens comes back NaN when embedded in one padded batch.
"""

import mlx.core as mx
import numpy as np
import pytest
from mlx.utils import tree_map
from mlx_embeddings.models import modernbert

from ml.embeddings import MAX_PADDING_TOKENS, embed_batch_mlx, split_by_padding

PAD_ID = 0


class FakeHFTokenizer:
    """One token per word, so a text's token count is its word count."""

    pad_token_id = PAD_ID

    def __call__(self, texts, truncation=True, max_length=512):
        return {"input_ids": [[3 + (hash(w) % 900) for w in t.split()][:max_length] for t in texts]}


class FakeWrapper:
    _tokenizer = FakeHFTokenizer()


@pytest.fixture(scope="module")
def model():
    mx.random.seed(0)
    args = modernbert.ModelArgs(
        model_type="modernbert",
        hidden_size=64,
        num_hidden_layers=3,
        intermediate_size=128,
        num_attention_heads=4,
        vocab_size=1000,
        max_position_embeddings=512,
        architectures=["ModernBertModel"],
    )
    m = modernbert.Model(args)
    m.update(
        tree_map(
            lambda p: p.astype(mx.float16) if p.dtype == mx.float32 else p,
            m.parameters(),
        )
    )
    return m


def words(n: int) -> str:
    return " ".join(f"w{i}" for i in range(n))


def test_one_padded_batch_reproduces_the_nan(model):
    ids = mx.array(np.random.randint(3, 900, (2, 200)), dtype=mx.int32)
    mask = np.ones((2, 200), dtype=np.int32)
    mask[1, 100:] = 0  # 100 padding tokens
    out = np.array(model(ids, attention_mask=mx.array(mask)).text_embeds.astype(mx.float32))
    assert not np.isfinite(out[1]).all(), "the bug this module guards against"


def test_mixed_lengths_embed_without_nan(model):
    texts = [words(200), words(10), words(150), words(12)]
    out = embed_batch_mlx(model, FakeWrapper(), texts, prefix="")
    assert out.shape == (4, 64)
    assert np.isfinite(out).all()


def test_rows_match_embedding_each_text_alone(model):
    texts = [words(200), words(10), words(150)]
    batched = embed_batch_mlx(model, FakeWrapper(), texts, prefix="")
    for i, text in enumerate(texts):
        alone = embed_batch_mlx(model, FakeWrapper(), [text], prefix="")[0]
        np.testing.assert_allclose(batched[i], alone, atol=2e-2)


@pytest.mark.parametrize(
    ("lengths", "groups"),
    [
        ([5, 60, 69], [[0, 1, 2]]),
        ([5, 70], [[0], [1]]),
        ([200, 10, 150, 12], [[1, 3], [2, 0]]),
        ([], []),
    ],
)
def test_split_by_padding(lengths, groups):
    assert split_by_padding(lengths) == groups
    for group in groups:
        spread = max(lengths[i] for i in group) - min(lengths[i] for i in group)
        assert spread <= MAX_PADDING_TOKENS

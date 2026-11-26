"""Embedding generation using MLX."""

import sys
import time
from typing import Any

import mlx.core as mx
import numpy as np
from mlx_embeddings.tokenizer_utils import TokenizerWrapper
from mlx_embeddings.utils import load

from config.embedding import EmbeddingConfig
from constants import GPU_STR
from progress.base import emit_result, log_error, log_info, log_warn

# Metal buffer cache limit: 512MB keeps enough for batch reuse without unbounded growth.
# Without this, MLX retains all freed arrays in the Metal buffer cache, which can grow
# to 10-20GB+ over hundreds of embedding batches.
_METAL_CACHE_LIMIT_BYTES = 512 * 1024 * 1024


def configure_metal_memory() -> None:
    """Set Metal memory limits to prevent unbounded cache growth during batch processing."""
    try:
        mx.metal.set_cache_limit(_METAL_CACHE_LIMIT_BYTES)
        log_info(f"Metal cache limit set to {_METAL_CACHE_LIMIT_BYTES // (1024 * 1024)}MB")
    except AttributeError:
        log_warn("mx.metal.set_cache_limit not available in this MLX version")
    except Exception as e:
        log_warn(f"Failed to set Metal cache limit: {e}")


def load_embedding_model(config: EmbeddingConfig | None = None) -> tuple[Any, TokenizerWrapper]:
    """Load the MLX embedding model.

    Returns:
        Tuple of (model, tokenizer)
    """
    if config is None:
        config = EmbeddingConfig()

    device = mx.default_device()
    log_info(f"MLX device: {device}")
    if GPU_STR not in str(device).lower():
        log_warn("MLX not using GPU - check Metal availability. Performance will be degraded.")

    # Configure Metal memory limits before loading the model
    configure_metal_memory()

    log_info(f"Loading MLX embedding model: {config.model_name}")
    log_info(f"Using batch size: {config.batch_size}")

    try:
        model, tokenizer = load(config.model_name)
        log_info("Model loaded successfully")
        return model, tokenizer

    except ImportError as e:
        log_error(f"mlx-embeddings not installed. Run: pip install mlx-embeddings\n{e}")
        emit_result(False, error="mlx-embeddings not installed")
        sys.exit(1)
    except Exception as e:
        log_error(f"Failed to load model: {e}")
        emit_result(False, error=f"Failed to load model: {e}")
        sys.exit(1)


def mean_pooling(outputs, attention_mask):
    """Apply mean pooling to get sentence embeddings.

    see: https://milvus.io/ai-quick-reference/why-is-mean-pooling-often-used-on-the-token-outputs-of-a-transformer-like-bert-to-produce-a-sentence-embedding"""
    last_hidden = outputs.last_hidden_state

    mask_expanded = mx.expand_dims(attention_mask, -1)
    mask_expanded = mx.broadcast_to(mask_expanded, last_hidden.shape)

    sum_embeddings = mx.sum(last_hidden * mask_expanded, axis=1)
    sum_mask = mx.clip(mx.sum(mask_expanded, axis=1), a_min=1e-9, a_max=None)

    return sum_embeddings / sum_mask


def normalize_embeddings(embeddings):
    """L2 normalize embeddings...

    see: https://little-book-of.github.io/linear-algebra/books/en-US/book.html#different-kinds-of-norms"""
    norms = mx.sqrt(mx.sum(embeddings * embeddings, axis=-1, keepdims=True))
    return embeddings / mx.clip(norms, a_min=1e-9, a_max=None)


# ModernBERT's local-attention layers see 64 tokens either side of each position
# (local_attention=128). A padding position more than 64 tokens past a row's last
# real token has only padding in its window. Under float16 that window's softmax
# is all -inf, the position becomes NaN, and mean pooling (NaN * 0) spreads the
# NaN to the whole row. Keeping each micro-batch within 64 tokens of padding
# prevents it.
MAX_PADDING_TOKENS = 64


def split_by_padding(lengths: list[int], max_padding: int = MAX_PADDING_TOKENS) -> list[list[int]]:
    """Group row indices so no row in a group is padded by more than `max_padding`."""
    order = sorted(range(len(lengths)), key=lambda i: lengths[i])
    groups: list[list[int]] = []
    for i in order:
        if groups and lengths[i] - lengths[groups[-1][0]] <= max_padding:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


def embed_batch_mlx(
    model,
    tokenizer,
    texts: list[str],
    prefix: str = "search_document: ",
) -> np.ndarray:
    """Generate embeddings for a batch of texts using MLX.

    Args:
        model: The MLX embedding model
        tokenizer: The tokenizer
        texts: List of texts to embed
        prefix: Prefix to add to each text. ModernBERT-embed requires:
                - "search_document: " for documents being indexed
                - "search_query: " for search queries

    Rows are embedded in groups whose token lengths differ by at most
    `MAX_PADDING_TOKENS`, then returned in input order.
    """
    if not texts:
        return np.empty((0, 0), dtype=np.float32)
    prefixed_texts = [f"{prefix}{text}" for text in texts]

    # mlx-embeddings wraps the HF tokenizer in a TokenizerWrapper. The underlying
    # TokenizersBackend doesn't have batch_encode_plus, so use __call__ directly.
    hf_tokenizer = tokenizer._tokenizer
    token_ids: list[list[int]] = hf_tokenizer(prefixed_texts, truncation=True, max_length=512)[
        "input_ids"
    ]
    pad_id = hf_tokenizer.pad_token_id or 0

    parts: list[tuple[list[int], Any]] = []
    for group in split_by_padding([len(ids) for ids in token_ids]):
        width = max(len(token_ids[i]) for i in group)
        ids_np = np.full((len(group), width), pad_id, dtype=np.int32)
        mask_np = np.zeros((len(group), width), dtype=np.int32)
        for row, i in enumerate(group):
            ids_np[row, : len(token_ids[i])] = token_ids[i]
            mask_np[row, : len(token_ids[i])] = 1
        input_ids = mx.array(ids_np)
        attention_mask = mx.array(mask_np)

        outputs = model(input_ids, attention_mask=attention_mask)
        if hasattr(outputs, "text_embeds") and outputs.text_embeds is not None:
            group_embeddings = outputs.text_embeds
        else:
            group_embeddings = normalize_embeddings(mean_pooling(outputs, attention_mask))
        parts.append((group, group_embeddings))

    embeddings = mx.zeros((len(texts), parts[0][1].shape[-1]), dtype=parts[0][1].dtype)
    for group, group_embeddings in parts:
        embeddings[mx.array(group)] = group_embeddings
    del outputs, input_ids, attention_mask, parts

    # Force computation and convert to numpy immediately.
    # This allows MLX to free the entire computation graph (model outputs,
    # intermediate pooling/normalization arrays, tokenizer tensors).
    mx.eval(embeddings)
    result = np.array(embeddings)

    # Brief yield to let WebKit/compositor get GPU time for rendering.
    # 5ms per micro-batch is negligible vs total pipeline time but prevents
    # Metal compute from starving the window server.
    time.sleep(0.005)

    # Explicitly delete MLX arrays to allow garbage collection of the
    # computation graph. Without this, Python references keep the MLX
    # arrays alive, preventing the Metal buffer cache from reusing memory.
    del embeddings

    # Clear Metal buffer cache to return freed GPU memory to the system.
    # Without this, MLX retains freed arrays for potential reuse, which
    # accumulates to 10-20GB+ over hundreds of batches.
    try:
        mx.metal.clear_cache()
    except AttributeError:
        pass  # Older MLX versions may not have this

    return result

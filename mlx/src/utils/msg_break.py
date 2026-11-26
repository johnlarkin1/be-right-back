"""The bubble break token: one sender's consecutive bubbles in one turn.

The Rust export defines the token (`MSG_BREAK_TOKEN`, `<MSG_BREAK>`) and writes
it to `metadata.json` as `msg_break_token`. Training copies that file to the
persona's `chat_metadata.json`. Python reads the token from there and never
defines its own copy. Newlines inside one iMessage stay newlines.

The token is new to the base model, so its rows start untrained. Two steps fix
that without sending gradients down the whole stack:

1. `register_msg_break` copies the paragraph break's rows (`"\\n\\n"`) into the
   token's rows. The model then reads the break as "new paragraph", not noise.
   Training, the eval and the daemon all apply the same copy, because the
   adapter saves only the LoRA weights, not the base rows.
2. Training puts LoRA on the output rows only (see `token_lora_keys`). An
   untied model gets LoRA on `lm_head`. A tied model gets LoRA on the
   embedding, wrapped so that the input side passes no gradient
   (`OutputOnlyLoRAEmbedding`). LoRA on the input side would backprop through
   every layer. Qwen3.5's DeltaNet training path builds arrays per token, and
   a long example then exceeds Metal's buffer limit.

Training, the eval and the inference daemon must all call `register_msg_break`
with the model, so the token gets the same id and the same base rows.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import mlx.core as mx
import mlx.nn as nn
from mlx_lm.tuner.lora import LoRAEmbedding

METADATA_KEY = "msg_break_token"
# The token whose rows seed the break token's rows. Falls back to "\n" when
# the tokenizer splits "\n\n".
SEED_TEXTS = ("\n\n", "\n")

_EMBEDDINGS = (nn.Embedding, nn.QuantizedEmbedding)
_LINEARS = (nn.Linear, nn.QuantizedLinear)


def read_msg_break_token(metadata: dict[str, Any], source: str) -> str:
    """Return the break token from export or chat metadata. `source` names the file."""
    token = metadata.get(METADATA_KEY)
    if not isinstance(token, str) or not token:
        raise ValueError(f"{source} has no {METADATA_KEY}. Re-export the training data.")
    return token


def register_msg_break(tokenizer: Any, token: str, model: nn.Module | None = None) -> int:
    """Add the break token to the tokenizer as a special token. Return its id.

    mlx-lm 0.32+ builds the streaming detokenizer once, at load, so this
    rebuilds it. Otherwise the new id decodes as "!". With `model`, check that the id has an
    embedding row (MLX does not bounds-check), then seed its rows with
    `seed_break_rows`. This works before or after LoRA wraps the modules.
    """
    tokenizer.add_special_tokens({"additional_special_tokens": [token]})
    token_id = tokenizer.convert_tokens_to_ids(token)
    if not isinstance(token_id, int) or token_id == getattr(tokenizer, "unk_token_id", None):
        raise ValueError(f"{token} did not register in the tokenizer")
    _rebuild_detokenizer(tokenizer)
    if model is not None:
        rows = embedding_rows(model)
        if rows is not None and token_id >= rows:
            raise ValueError(f"{token} got id {token_id}, but the embedding table has {rows} rows")
        seed_break_rows(model, token_id, seed_token_id(tokenizer))
    return token_id


def _rebuild_detokenizer(tokenizer: Any) -> None:
    """Rebuild mlx-lm's cached detokenizer so its token map includes added tokens.

    `BPEStreamingDetokenizer` copies the vocab when it is built. An id past that
    copy decodes as "!". mlx-lm before 0.32 has no cached copy, so this does nothing.
    """
    cached = vars(tokenizer).get("_detokenizer")
    inner = vars(tokenizer).get("_tokenizer")
    if cached is not None and inner is not None:
        tokenizer._detokenizer = type(cached)(inner)


def seed_token_id(tokenizer: Any) -> int:
    """Return the id of the first `SEED_TEXTS` entry that is one token."""
    for text in SEED_TEXTS:
        ids = tokenizer.encode(text, add_special_tokens=False)
        if len(ids) == 1:
            return int(ids[0])
    raise ValueError("the tokenizer has no single newline token to seed the break rows")


def _unwrap(module: nn.Module) -> nn.Module:
    """Return the base layer under any LoRA or DoRA wrappers."""
    while not isinstance(module, _EMBEDDINGS + _LINEARS):
        inner = getattr(module, "embedding", None) or getattr(module, "linear", None)
        if not isinstance(inner, nn.Module):
            return module
        module = inner
    return module


def _token_modules(model: nn.Module) -> list[tuple[str, nn.Module]]:
    """Return (path, module) for the embedding table and an untied `lm_head`."""
    found: list[tuple[str, nn.Module]] = []
    for path, module in model.named_modules():
        name = path.split(".")[-1]
        base = _unwrap(module)
        if name == "embed_tokens" and isinstance(base, _EMBEDDINGS):
            found.append((path, module))
        elif name == "lm_head" and isinstance(base, _LINEARS):
            found.append((path, module))
    return found


def embedding_rows(model: nn.Module) -> int | None:
    for path, module in _token_modules(model):
        if path.endswith("embed_tokens"):
            return int(_unwrap(module).weight.shape[0])
    return None


def seed_break_rows(model: nn.Module, break_id: int, seed_id: int) -> None:
    """Copy row `seed_id` to row `break_id` in the embedding and an untied `lm_head`.

    Quantization groups run along a row, so copying the packed weight, scales
    and biases rows copies the row exactly.
    """
    for _, module in _token_modules(model):
        base = _unwrap(module)
        for name in ("weight", "scales", "biases"):
            arr = getattr(base, name, None)
            if arr is None:
                continue
            # MLX item assignment replaces the array's value in place. Set the
            # attribute again anyway, and evaluate now, so the copy never waits
            # on lazy evaluation.
            arr[break_id] = arr[seed_id]
            setattr(base, name, arr)
            mx.eval(arr)


def token_lora_keys(model: nn.Module) -> list[str]:
    """Full module paths to add to the LoRA `keys` so the break's output row trains.

    mlx-lm matches `keys` against each adapted layer's own modules, and also
    against the whole model's module paths. These are the second kind. An
    untied model gets `lm_head` only. A tied model reads its output rows from
    the embedding, so it gets the embedding. Call `output_only_embedding_lora`
    after `linear_to_lora_layers` to stop the input-side gradient.
    """
    modules = _token_modules(model)
    heads = [path for path, _ in modules if path.endswith("lm_head")]
    if heads:
        return heads
    return [path for path, _ in modules if path.endswith("embed_tokens")]


class OutputOnlyLoRAEmbedding(LoRAEmbedding):
    """LoRAEmbedding whose input lookup passes no gradient.

    The forward pass is the same as `LoRAEmbedding`, and the parameters have
    the same names, so the saved adapter loads into a plain `LoRAEmbedding`.
    Only the tied output path (`as_linear`) trains the LoRA weights.
    """

    def __call__(self, x: mx.array) -> mx.array:
        return mx.stop_gradient(super().__call__(x))


def output_only_embedding_lora(model: nn.Module) -> bool:
    """Turn each `LoRAEmbedding` into an `OutputOnlyLoRAEmbedding`. Return True if any.

    The swap changes only the class, so the weights and the optimizer's view of
    them stay the same.
    """
    swapped = False
    for _, module in model.named_modules():
        if type(module) is LoRAEmbedding:
            module.__class__ = OutputOnlyLoRAEmbedding
            swapped = True
    return swapped


@contextmanager
def output_only_token_lora() -> Iterator[None]:
    """Make `mlx_lm.lora.train_model` build output-only embedding LoRA.

    `train_model` calls `linear_to_lora_layers` itself, so this wraps that call
    for the duration of the block.
    """
    import mlx_lm.lora as lora_entry

    original = lora_entry.linear_to_lora_layers

    def wrapped(model: nn.Module, *args: Any, **kwargs: Any) -> Any:
        result = original(model, *args, **kwargs)
        output_only_embedding_lora(model)
        return result

    lora_entry.linear_to_lora_layers = wrapped
    try:
        yield
    finally:
        lora_entry.linear_to_lora_layers = original


# Training multiplies the loss on `<MSG_BREAK>` targets by this. The break is
# about 4% of reply tokens and starts from the paragraph row, so with equal
# weight the adapter under-predicts it: at real bubble ends it puts about half
# the probability on the break that the data does. Validation loss stays unweighted.
BREAK_LOSS_WEIGHT = 3.0


def make_break_weighted_loss(break_id: int, weight: float = BREAK_LOSS_WEIGHT) -> Any:
    """Return mlx-lm's `default_loss` with `<MSG_BREAK>` targets weighted by `weight`.

    The loss is the weighted mean, so the scale stays comparable. The token
    count returned is unweighted, so tokens-per-second reports stay true.
    """

    def loss(model: nn.Module, batch: mx.array, lengths: mx.array) -> tuple[mx.array, mx.array]:
        inputs = batch[:, :-1]
        targets = batch[:, 1:]
        logits = model(inputs)
        steps = mx.arange(1, targets.shape[1] + 1)
        mask = mx.logical_and(steps >= lengths[:, 0:1], steps <= lengths[:, 1:])
        weights = mask * mx.where(targets == break_id, weight, 1.0)
        ce = nn.losses.cross_entropy(logits, targets).astype(mx.float32)
        return (ce * weights).sum() / weights.sum(), mask.sum()

    return loss


@contextmanager
def break_weighted_training(break_id: int, weight: float = BREAK_LOSS_WEIGHT) -> Iterator[None]:
    """Make `mlx_lm.lora.train_model` train with `make_break_weighted_loss`.

    `train_model` calls `train` without a loss, so this wraps that call. `train`
    also passes the loss to validation. `track_validation` in
    `utils/train_debug.py` resets validation to the unweighted loss.
    """
    import mlx_lm.lora as lora_entry

    original = lora_entry.train
    weighted = make_break_weighted_loss(break_id, weight)

    def wrapped(*args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault("loss", weighted)
        return original(*args, **kwargs)

    lora_entry.train = wrapped
    try:
        yield
    finally:
        lora_entry.train = original

"""`<MSG_BREAK>` must get the same id and rows everywhere, and its output row must train.

Training, the eval and the inference daemon each call `register_msg_break`,
which seeds the token's rows from the newline token. Output-only token LoRA
lets the adapter learn the break without backprop through the whole stack,
and `load_adapters` must restore it.
"""

import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mlx_lm")
pytest.importorskip("tokenizers")

import mlx.core as mx  # noqa: E402
import mlx.nn as nn  # noqa: E402
from mlx.utils import tree_flatten  # noqa: E402
from mlx_lm.tuner.datasets import ChatDataset  # noqa: E402
from mlx_lm.tuner.utils import linear_to_lora_layers, load_adapters  # noqa: E402

from fidelity.style import split_bubbles  # noqa: E402
from tests._tiny_lm import make_model, make_model_and_tokenizer, make_tokenizer  # noqa: E402
from utils.msg_break import (  # noqa: E402
    OutputOnlyLoRAEmbedding,
    output_only_embedding_lora,
    read_msg_break_token,
    register_msg_break,
    seed_token_id,
    token_lora_keys,
)

# Test data. The real token comes from the export's metadata.json.
MSG_BREAK_TOKEN = "<MSG_BREAK>"

BUBBLES = ["ya", "whats up\nlol", "free at 6?"]  # a newline inside one bubble stays
REPLY = MSG_BREAK_TOKEN.join(BUBBLES)
USER = MSG_BREAK_TOKEN.join(["hey", "you around?"])


def test_register_gives_one_token_with_a_stable_id():
    model, tok = make_model_and_tokenizer()
    first = register_msg_break(tok, MSG_BREAK_TOKEN, model)
    _, tok2 = make_model_and_tokenizer()
    assert register_msg_break(tok2, MSG_BREAK_TOKEN) == first
    assert tok.encode(MSG_BREAK_TOKEN, add_special_tokens=False) == [first]
    # Registering twice is harmless.
    assert register_msg_break(tok, MSG_BREAK_TOKEN, model) == first


def test_read_token_from_metadata():
    assert read_msg_break_token({"msg_break_token": "<X>"}, "m.json") == "<X>"
    with pytest.raises(ValueError, match="m.json has no msg_break_token"):
        read_msg_break_token({}, "m.json")


def test_register_rejects_an_id_without_an_embedding_row():
    hf = make_tokenizer()
    model = make_model(len(hf))  # no spare rows
    with pytest.raises(ValueError, match="embedding table"):
        register_msg_break(hf, MSG_BREAK_TOKEN, model)


def _find(haystack: list[int], needle: list[int]) -> int:
    for i in range(len(haystack) - len(needle) + 1):
        if haystack[i : i + len(needle)] == needle:
            return i
    return -1


def test_training_and_daemon_tokenize_the_reply_identically():
    from entry.inference_daemon import InferenceDaemon

    _, tok = make_model_and_tokenizer()
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN)
    messages = [{"role": "user", "content": USER}, {"role": "assistant", "content": REPLY}]

    ds = ChatDataset([{"messages": messages}], tok, chat_key="messages", mask_prompt=True)
    train_tokens, offset = ds.process(ds[0])
    end = train_tokens.index(tok.convert_tokens_to_ids("<|im_end|>"), offset)
    train_reply = train_tokens[offset:end]
    assert train_reply.count(break_id) == 2

    # The daemon sees the same reply as an earlier assistant turn in the history.
    daemon = InferenceDaemon(base_model="test-model")
    prompt = daemon._format_chat_prompt([*messages, {"role": "user", "content": "ok"}])
    serve_tokens = tok.encode(prompt, add_special_tokens=False)
    assert _find(serve_tokens, train_reply) >= 0


def test_streamed_text_keeps_the_break():
    from entry.inference_daemon import preview_special_tokens

    _, tok = make_model_and_tokenizer()
    register_msg_break(tok, MSG_BREAK_TOKEN)
    keep = frozenset({MSG_BREAK_TOKEN})
    assert MSG_BREAK_TOKEN not in preview_special_tokens(tok, keep)
    assert MSG_BREAK_TOKEN in preview_special_tokens(tok)
    assert "<|im_end|>" in preview_special_tokens(tok, keep)


def test_streaming_detokenizer_decodes_the_break():
    # mlx-lm 0.32+ builds the BPE detokenizer once, at load. Without a rebuild,
    # the new id decodes as "!" and generated replies never split into bubbles.
    from mlx_lm.tokenizer_utils import BPEStreamingDetokenizer, TokenizerWrapper

    tok = TokenizerWrapper(make_tokenizer(), BPEStreamingDetokenizer)
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN)
    ids = [*tok.encode("hi", add_special_tokens=False), break_id]
    ids += tok.encode("yo", add_special_tokens=False)
    detok = tok.detokenizer
    for token in ids:
        detok.add_token(token)
    detok.finalize()
    assert detok.text == f"hi{MSG_BREAK_TOKEN}yo"


def test_generated_reply_splits_back_into_bubbles():
    _, tok = make_model_and_tokenizer()
    register_msg_break(tok, MSG_BREAK_TOKEN)
    ids = tok.encode(REPLY, add_special_tokens=False)
    assert tok.decode(ids) == REPLY
    assert split_bubbles(tok.decode(ids), MSG_BREAK_TOKEN) == BUBBLES


def _llama(tied: bool, layers: int = 1) -> nn.Module:
    from mlx_lm.models import llama

    args = llama.ModelArgs(
        model_type="llama",
        hidden_size=32,
        num_hidden_layers=layers,
        intermediate_size=64,
        num_attention_heads=4,
        num_key_value_heads=4,
        rms_norm_eps=1e-5,
        vocab_size=len(make_tokenizer()) + 8,
        tie_word_embeddings=tied,
    )
    model = llama.Model(args)
    model.freeze()
    return model


def test_token_lora_keys_tied_and_untied():
    model, _ = make_model_and_tokenizer()
    assert token_lora_keys(model) == ["model.embed_tokens"]
    # Untied: only the output side. Embedding LoRA would backprop through every layer.
    assert token_lora_keys(_llama(tied=False)) == ["lm_head"]


@pytest.mark.parametrize("tied", [True, False])
@pytest.mark.parametrize("wrap_first", [False, True])
def test_register_seeds_the_break_rows_from_the_newline(tied: bool, wrap_first: bool):
    tok = make_model_and_tokenizer()[1]
    model = _llama(tied)
    if wrap_first:  # the daemon and the eval register after the adapter loads
        linear_to_lora_layers(
            model, 1, {"rank": 4, "scale": 1.0, "dropout": 0.0, "keys": token_lora_keys(model)}
        )
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN, model)
    seed = seed_token_id(tok)
    assert seed == tok.encode("\n", add_special_tokens=False)[0]
    inner = model.model.embed_tokens
    table = getattr(inner, "embedding", inner).weight
    assert mx.array_equal(table[break_id], table[seed]).item()
    if not tied:
        head = getattr(model.lm_head, "linear", model.lm_head).weight
        assert mx.array_equal(head[break_id], head[seed]).item()


def _reaches_layer_zero(output_only: bool) -> bool:
    """Train one step with LoRA on the top layer only. Return True if backprop hit layer 0."""
    from mlx_lm.tuner.trainer import default_loss

    model = _llama(tied=True, layers=2)
    keys = ["self_attn.q_proj", *token_lora_keys(model)]
    linear_to_lora_layers(model, 1, {"rank": 4, "scale": 1.0, "dropout": 0.0, "keys": keys})
    if output_only:
        assert output_only_embedding_lora(model)
        assert isinstance(model.model.embed_tokens, OutputOnlyLoRAEmbedding)

    hits: list[int] = []

    @mx.custom_function
    def probe(x: mx.array) -> mx.array:
        return x

    @probe.vjp
    def probe_vjp(primals: Any, cotangent: mx.array, output: Any) -> mx.array:
        hits.append(1)
        return cotangent

    layer0 = model.model.layers[0]
    original = type(layer0).__call__

    class Probed(type(layer0)):  # type: ignore[misc]
        def __call__(self, *args: Any, **kwargs: Any) -> mx.array:
            return probe(original(self, *args, **kwargs))

    layer0.__class__ = Probed
    batch = mx.array([[1, 5, 6, 7, 8, 2]])
    lengths = mx.array([[1, 6]])
    loss_and_grad = nn.value_and_grad(model, lambda m, b, n: default_loss(m, b, n)[0])
    _, grads = loss_and_grad(model, batch, lengths)
    mx.eval(grads)
    return bool(hits)


def test_output_only_lora_stops_backprop_at_the_adapted_layers():
    assert _reaches_layer_zero(output_only=False)  # plain embedding LoRA: the crash
    assert not _reaches_layer_zero(output_only=True)


def _break_nll(model: nn.Module, tokens: list[int], break_id: int) -> float:
    arr = mx.array(tokens)[None]
    logits = model(arr[:, :-1])
    ce = nn.losses.cross_entropy(logits, arr[:, 1:])
    mask = arr[:, 1:] == break_id
    return float((ce * mask).sum().item() / mask.sum().item())


def _fit(use_token_lora: bool, steps: int = 300) -> tuple[nn.Module, Any, dict, list[int], float]:
    """Train the tiny model on replies with breaks. Return the break's held-in NLL.

    `register_msg_break` seeds the break row from the newline row. With tied
    embeddings and no token LoRA, the model cannot tell the two apart, so it
    can never score the break above the newline.
    """
    import mlx.optimizers as optim
    from mlx_lm.tuner.trainer import default_loss

    model, tok = make_model_and_tokenizer(seed=1)
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN, model)
    lora = {"rank": 4, "scale": 2.0, "dropout": 0.0, "keys": token_lora_keys(model)}
    if use_token_lora:
        linear_to_lora_layers(model, 2, lora)
        output_only_embedding_lora(model)

    examples = [
        {
            "messages": [
                {"role": "user", "content": f"q{i}"},
                {"role": "assistant", "content": MSG_BREAK_TOKEN.join(["ok", f"{i}", "yes"])},
            ]
        }
        for i in range(6)
    ]
    ds = ChatDataset(examples, tok, chat_key="messages", mask_prompt=True)
    batches = []
    for i in range(len(ds)):
        tokens, offset = ds.process(ds[i])
        batches.append((mx.array(tokens)[None], mx.array([[offset, len(tokens)]])))

    opt = optim.Adam(learning_rate=3e-3)
    loss_and_grad = nn.value_and_grad(model, lambda m, b, lens: default_loss(m, b, lens)[0])
    model.train()
    for step in range(steps):
        batch, lengths = batches[step % len(batches)]
        _, grads = loss_and_grad(model, batch, lengths)
        opt.update(model, grads)
        mx.eval(model.parameters(), opt.state)
    model.eval()
    probe = ds.process(ds[0])[0]
    return model, break_id, lora, probe, _break_nll(model, probe, break_id)


def test_token_lora_learns_a_break_the_layers_cannot():
    _, _, _, _, layers_only = _fit(use_token_lora=False)
    _, _, _, _, with_tokens = _fit(use_token_lora=True)
    # Layer LoRA alone stays near log(2): the break ties with the newline.
    assert layers_only > 0.5
    assert with_tokens < 0.1


def test_token_lora_saves_and_loads_with_the_adapter(tmp_path: Path):
    model, break_id, lora, probe, nll = _fit(use_token_lora=True)
    weights = dict(tree_flatten(model.trainable_parameters()))
    assert "model.embed_tokens.lora_a" in weights
    mx.save_safetensors(str(tmp_path / "adapters.safetensors"), weights)
    config = {"fine_tune_type": "lora", "num_layers": 2, "lora_parameters": lora}
    (tmp_path / "adapter_config.json").write_text(json.dumps(config))

    fresh, fresh_tok = make_model_and_tokenizer(seed=1)
    load_adapters(fresh, str(tmp_path))  # the daemon's load(adapter_path=...) calls this
    # The daemon registers after the adapter loads. That seeds the same base rows.
    assert register_msg_break(fresh_tok, MSG_BREAK_TOKEN, fresh) == break_id
    fresh.eval()
    assert _break_nll(fresh, probe, break_id) == pytest.approx(nll, rel=1e-3)


def test_repetition_penalty_skips_the_break_and_end_tokens():
    from utils.sampling import make_repetition_penalty, structure_token_ids

    _, tok = make_model_and_tokenizer()
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN)
    end_id = tok.convert_tokens_to_ids("<|im_end|>")
    exempt = structure_token_ids(tok, MSG_BREAK_TOKEN)
    assert break_id in exempt and end_id in exempt

    word = tok.encode("y", add_special_tokens=False)[0]
    recent = mx.array([word, break_id, end_id])
    logits = mx.full((1, len(tok.get_vocab()) + 8), 2.0)
    out = make_repetition_penalty(2.0, 20, exempt)(recent, logits)
    assert out[0, word].item() == 1.0  # a repeated word is penalized
    assert out[0, break_id].item() == 2.0  # structure tokens are not
    assert out[0, end_id].item() == 2.0


def test_break_weighted_loss_matches_default_at_weight_one():
    from mlx_lm.tuner.trainer import default_loss

    from utils.msg_break import make_break_weighted_loss

    model, tok = make_model_and_tokenizer()
    break_id = register_msg_break(tok, MSG_BREAK_TOKEN, model)
    messages = [{"role": "user", "content": USER}, {"role": "assistant", "content": REPLY}]
    ds = ChatDataset([{"messages": messages}], tok, chat_key="messages", mask_prompt=True)
    tokens, offset = ds.process(ds[0])
    batch, lengths = mx.array(tokens)[None], mx.array([[offset, len(tokens)]])

    base, n = default_loss(model, batch, lengths)
    same, n1 = make_break_weighted_loss(break_id, 1.0)(model, batch, lengths)
    heavier, n3 = make_break_weighted_loss(break_id, 3.0)(model, batch, lengths)
    assert same.item() == pytest.approx(base.item(), rel=1e-5)
    assert n.item() == n1.item() == n3.item()  # token counts stay unweighted
    assert heavier.item() != pytest.approx(base.item(), rel=1e-3)


def test_break_weighted_training_wraps_train_and_restores_it():
    import mlx_lm.lora as lora_entry

    from utils.msg_break import break_weighted_training

    original = lora_entry.train
    seen = {}
    lora_entry.train = lambda *a, **k: seen.update(k)
    try:
        with break_weighted_training(7):
            lora_entry.train(model=None)
        assert callable(seen["loss"])
    finally:
        lora_entry.train = original


def test_validation_uses_the_unweighted_loss(tmp_path: Path):
    from mlx_lm.tuner import trainer

    from utils.train_debug import MemoryLog, track_validation

    seen = {}
    original = trainer.evaluate
    trainer.evaluate = lambda *a, **k: seen.update(k) or 0.0
    try:
        log = MemoryLog(tmp_path / "memory_log.jsonl")
        with track_validation(log):
            trainer.evaluate(loss=lambda *a: None)
        log.close()
        assert seen["loss"] is trainer.default_loss
    finally:
        trainer.evaluate = original

"""Tests for held-out perplexity and the end-to-end fidelity run.

Uses a tiny random model on CPU, so these run on Linux with `mlx[cpu]` too.
"""

import math

import pytest

pytest.importorskip("mlx.core")
pytest.importorskip("mlx_lm")
pytest.importorskip("tokenizers")

import mlx.core as mx  # noqa: E402
import ujson as json  # noqa: E402

from fidelity import run as fidelity_run  # noqa: E402
from fidelity.heldout import split_examples, write_heldout  # noqa: E402
from fidelity.perplexity import (  # noqa: E402
    adapter_disabled,
    compare_base_and_adapter,
    score_examples,
    skip_think_scaffold,
    system_prompt_tokens,
    verify_adapter_loaded,
    with_system_prompt,
)
from fidelity.report import to_markdown, verdict  # noqa: E402
from tests._tiny_lm import make_model_and_tokenizer, make_tokenizer, train_lora  # noqa: E402

BREAK = "<MSG_BREAK>"


def save_adapter(model, path, rename: bool = False) -> None:
    from mlx.utils import tree_flatten

    weights = dict(tree_flatten(model.trainable_parameters()))
    if rename:
        weights = {f"language_model.{k}": v for k, v in weights.items()}
    mx.save_safetensors(str(path / "adapters.safetensors"), weights)


def chat(user: str, reply: str) -> dict:
    return {
        "messages": [{"role": "user", "content": user}, {"role": "assistant", "content": reply}]
    }


EXAMPLES = [
    chat("you around?", f"ya{BREAK}whats up"),
    chat("dinner tonight?", f"down{BREAK}where"),
    chat("did you see that", f"lol ya{BREAK}wild"),
    chat("call me later", f"k{BREAK}after 6"),
]


def test_untrained_adapter_gives_zero_delta():
    """A no-op adapter (LoRA B starts at zero) must not look like an improvement."""
    model, tok = make_model_and_tokenizer()
    tok.add_special_tokens({"additional_special_tokens": [BREAK]})
    result = compare_base_and_adapter(model, tok, EXAMPLES, max_seq_length=512, break_token=BREAK)
    assert result["base"]["perplexity"] == pytest.approx(result["adapter"]["perplexity"])
    assert result["all_tokens"]["delta"] == pytest.approx(0.0, abs=1e-6)
    assert verdict(result) == "not_improved"


def test_trained_adapter_lowers_perplexity():
    model, tok = make_model_and_tokenizer()
    tok.add_special_tokens({"additional_special_tokens": [BREAK]})
    train_lora(model, tok, EXAMPLES)
    result = compare_base_and_adapter(model, tok, EXAMPLES, max_seq_length=512, break_token=BREAK)
    assert result["adapter"]["perplexity"] < result["base"]["perplexity"]
    assert result["all_tokens"]["delta"] > 0
    assert result["excl_break"]["delta"] > 0
    assert verdict(result) == "improved"


def test_adapter_disabled_restores_scales():
    model, _ = make_model_and_tokenizer()
    scales = [m.scale for m in model.modules() if hasattr(m, "lora_a")]
    with adapter_disabled(model) as n:
        assert n == len(scales) > 0
        assert all(m.scale == 0.0 for m in model.modules() if hasattr(m, "lora_a"))
    assert [m.scale for m in model.modules() if hasattr(m, "lora_a")] == scales


def test_only_final_assistant_tokens_count():
    model, tok = make_model_and_tokenizer()
    short = score_examples(model, tok, [chat("hi", "yo")], max_seq_length=512)
    long_prompt = score_examples(model, tok, [chat("hi " * 50, "yo")], max_seq_length=512)
    # "yo" + "<|im_end|>" + "\n" = 4 target tokens in the char-level tokenizer.
    assert short.tokens == long_prompt.tokens == 4


def test_break_tokens_are_counted_separately():
    model, tok = make_model_and_tokenizer()
    tok.add_special_tokens({"additional_special_tokens": [BREAK]})
    r = score_examples(
        model, tok, [chat("hi", f"a{BREAK}b")], max_seq_length=512, break_token=BREAK
    )
    assert r.tokens - r.tokens_excl_break == 1
    assert r.boundaries is not None
    assert (r.boundaries["breaks"], r.boundaries["ends"]) == (1, 1)
    assert 0.0 <= r.boundaries["breaks_mean_p_break"] <= 1.0


def test_boundary_stats_read_the_choice_before_each_break_and_the_end():
    from fidelity.perplexity import _boundary_stats, boundary_points

    brk, end = 5, 6
    # tokens: prompt 0 1 | reply 2 BRK 3 END 4. logits[t] predicts tokens[t + 1].
    tokens = [0, 1, 2, brk, 3, end, 4]
    points = boundary_points(tokens, 2, brk, end)
    assert points == [(2, True), (4, False)]  # stops at the first end
    # Both points prefer break: right at the break, wrong at the end.
    stats = _boundary_stats(points, [[0.9, 0.1], [0.6, 0.3]]).to_dict()
    assert (stats["breaks"], stats["ends"]) == (1, 1)
    assert stats["breaks_pick_break_rate"] == 1.0
    assert stats["ends_pick_break_rate"] == 1.0
    assert stats["ends_mean_p_end"] == 0.3


def test_truncated_examples_are_skipped():
    model, tok = make_model_and_tokenizer()
    r = score_examples(model, tok, [chat("x" * 100, "yo")], max_seq_length=20)
    assert r.examples == 0
    assert r.skipped == 1
    assert math.isnan(r.perplexity)


def test_with_system_prompt_keeps_existing_system():
    ex = {"messages": [{"role": "system", "content": "s"}, {"role": "assistant", "content": "a"}]}
    assert with_system_prompt(ex, "other") is ex
    assert with_system_prompt(EXAMPLES[0], "p")["messages"][0] == {"role": "system", "content": "p"}


def test_system_prompt_tokens_with_a_template_that_needs_a_user_turn():
    # Qwen3.5's template raises "No user query found" on a system-only conversation.
    tok = make_tokenizer()
    tok.chat_template = (
        "{% if messages | selectattr('role', 'equalto', 'user') | list | length == 0 %}"
        "{{ raise_exception('No user query found in messages.') }}{% endif %}" + tok.chat_template
    )
    system = {"role": "system", "content": "abc"}
    # "<|im_start|>" + "system\n" + "abc" + "<|im_end|>" + "\n": 1 + 7 + 3 + 1 + 1 tokens
    assert system_prompt_tokens(tok, [system, {"role": "user", "content": "yo"}]) == 13
    assert system_prompt_tokens(tok, [{"role": "user", "content": "yo"}]) == 0


def test_run_eval_end_to_end(tmp_path, monkeypatch):
    examples = EXAMPLES * 10
    data = tmp_path / "train.jsonl"
    data.write_text("\n".join(json.dumps(e) for e in examples))
    persona = tmp_path / "persona"
    persona.mkdir()
    (persona / "training_metadata.json").write_text(
        json.dumps(
            {
                "base_model": "tiny",
                "contact_name": "Sam",
                "training_data_path": str(data),
                "training_config": {"training": {"max_seq_length": 256}},
            }
        )
    )
    (persona / "chat_metadata.json").write_text(
        json.dumps({"system_prompt": "You are Sam.", "msg_break_token": BREAK})
    )
    _, _, idx = split_examples(examples)
    write_heldout(
        persona,
        data_path=data,
        total_examples=len(examples),
        val_indices=idx,
        seed=0,
        val_fraction=0.1,
    )

    model, tok = make_model_and_tokenizer()
    save_adapter(model, persona)
    import mlx_lm

    monkeypatch.setattr(mlx_lm, "load", lambda *a, **k: (model, tok))
    report = fidelity_run.run_eval(
        fidelity_run.EvalOptions(persona_dir=persona, generate=2, max_tokens=8)
    )

    assert report["heldout"] == {"method": "seeded_shuffle", "available": 4, "used": 4}
    assert report["system_prompt"] == "chat_metadata.json"
    assert report["verdict"] == "not_improved"  # untrained adapter
    assert len(report["style"]["samples"]) == 2
    assert report["perplexity"]["adapter"]["examples"] == 4

    json_path, md_path = fidelity_run.write_report(report, tmp_path / "out")
    assert json.loads(json_path.read_text())["verdict"] == "not_improved"
    md = md_path.read_text()
    assert "Held-out perplexity" in md and "Style distance" in md
    assert "Bubble breaks" in md
    assert to_markdown(report) == md
    mx.clear_cache()


def test_verify_adapter_loaded_accepts_matching_weights(tmp_path):
    model, _ = make_model_and_tokenizer()
    save_adapter(model, tmp_path)
    assert verify_adapter_loaded(model, tmp_path) > 0


def test_verify_adapter_loaded_rejects_other_base_model(tmp_path):
    """The real failure: a Qwen3.5 adapter (language_model.* keys) loaded onto Qwen3."""
    model, _ = make_model_and_tokenizer()
    save_adapter(model, tmp_path, rename=True)
    with pytest.raises(ValueError, match="different base model"):
        verify_adapter_loaded(model, tmp_path)


def test_verify_adapter_loaded_rejects_weights_that_did_not_load(tmp_path):
    trained, tok = make_model_and_tokenizer()
    tok.add_special_tokens({"additional_special_tokens": [BREAK]})
    train_lora(trained, tok, EXAMPLES, steps=2)
    save_adapter(trained, tmp_path)
    fresh, _ = make_model_and_tokenizer()  # LoRA B still zero: names match, values do not
    with pytest.raises(ValueError, match="did not load"):
        verify_adapter_loaded(fresh, tmp_path)


def test_think_scaffold_is_not_scored():
    model, _ = make_model_and_tokenizer()
    hf = make_tokenizer()
    # Qwen3-style template: an empty think block opens the final assistant reply.
    hf.chat_template = (
        "{% for m in messages %}<|im_start|>{{ m['role'] }}\n"
        "{% if loop.last and m['role'] == 'assistant' %}<think>\n\n</think>\n\n{% endif %}"
        "{{ m['content'] }}<|im_end|>\n{% endfor %}"
        "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"
    )
    from mlx_lm.tokenizer_utils import TokenizerWrapper

    r = score_examples(model, TokenizerWrapper(hf), [chat("hi", "yo")], max_seq_length=512)
    assert r.think_scaffold_masked == 1
    assert r.tokens == 4  # "yo" + "<|im_end|>" + "\n", same as without the scaffold


def test_skip_think_scaffold_only_moves_on_exact_match():
    assert skip_think_scaffold([1, 2, 3, 4, 5], 1, [2, 3]) == 3
    assert skip_think_scaffold([1, 2, 9, 4, 5], 1, [2, 3]) == 1
    assert skip_think_scaffold([1, 2, 3], 1, []) == 1

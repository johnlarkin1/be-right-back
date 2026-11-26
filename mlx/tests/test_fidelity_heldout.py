"""Tests for the seeded train/held-out split (issue #228)."""

import pytest
import ujson as json

from fidelity.heldout import (
    HELDOUT_FILENAME,
    legacy_tail_indices,
    load_heldout,
    split_examples,
    write_heldout,
)


def make_examples(n: int) -> list[dict]:
    return [{"messages": [{"role": "assistant", "content": str(i)}]} for i in range(n)]


def test_split_is_deterministic_for_a_seed():
    examples = make_examples(200)
    assert split_examples(examples, seed=3)[2] == split_examples(examples, seed=3)[2]
    assert split_examples(examples, seed=3)[2] != split_examples(examples, seed=4)[2]


def test_val_is_not_the_chronological_tail():
    examples = make_examples(200)
    _, val, indices = split_examples(examples)
    assert len(val) == 20
    assert indices != legacy_tail_indices(200)
    assert indices != list(range(indices[0], indices[0] + len(indices)))  # not contiguous


def test_split_partitions_every_example_once():
    examples = make_examples(57)
    train, val, indices = split_examples(examples)
    assert len(train) + len(val) == 57
    assert {e["messages"][0]["content"] for e in train}.isdisjoint(
        {e["messages"][0]["content"] for e in val}
    )
    assert [examples[i] for i in indices] == val


@pytest.mark.parametrize(("n", "expected_val"), [(0, 0), (1, 0), (2, 1), (5, 1), (15, 2)])
def test_small_datasets_keep_at_least_one_train_example(n, expected_val):
    train, val, _ = split_examples(make_examples(n))
    assert len(val) == expected_val
    assert len(train) == n - expected_val


def test_load_heldout_reads_written_indices(tmp_path):
    examples = make_examples(40)
    _, val, indices = split_examples(examples, seed=7)
    write_heldout(
        tmp_path,
        data_path=tmp_path / "train.jsonl",
        total_examples=40,
        val_indices=indices,
        seed=7,
        val_fraction=0.1,
    )
    loaded, method = load_heldout(tmp_path, examples)
    assert loaded == val
    assert method == "seeded_shuffle"


def test_load_heldout_falls_back_to_legacy_tail(tmp_path):
    examples = make_examples(30)
    loaded, method = load_heldout(tmp_path, examples)
    assert method == "legacy_tail"
    assert loaded == examples[27:]


def test_load_heldout_rejects_reexported_data(tmp_path):
    (tmp_path / HELDOUT_FILENAME).write_text(
        json.dumps({"total_examples": 50, "val_indices": [1, 2]})
    )
    with pytest.raises(ValueError, match="re-exported"):
        load_heldout(tmp_path, make_examples(40))


def _write_jsonl(path, examples):
    path.write_text("".join(json.dumps(e) + "\n" for e in examples))


def test_load_heldout_rejects_same_count_reexport(tmp_path):
    # The export keeps only the newest examples, so a re-export at the cap keeps the count.
    data = tmp_path / "train.jsonl"
    _write_jsonl(data, make_examples(40))
    _, _, indices = split_examples(make_examples(40))
    write_heldout(
        tmp_path,
        data_path=data,
        total_examples=40,
        val_indices=indices,
        seed=0,
        val_fraction=0.1,
    )
    shifted = make_examples(41)[1:]
    _write_jsonl(data, shifted)
    with pytest.raises(ValueError, match="SHA-256"):
        load_heldout(tmp_path, shifted, data_path=data)


def test_load_heldout_accepts_unchanged_data(tmp_path):
    data = tmp_path / "train.jsonl"
    examples = make_examples(40)
    _write_jsonl(data, examples)
    _, val, indices = split_examples(examples)
    write_heldout(
        tmp_path,
        data_path=data,
        total_examples=40,
        val_indices=indices,
        seed=0,
        val_fraction=0.1,
    )
    assert json.loads((tmp_path / HELDOUT_FILENAME).read_text())["data_sha256"]
    loaded, _ = load_heldout(tmp_path, examples, data_path=data)
    assert loaded == val


def test_legacy_tail_rejects_reexported_data(tmp_path):
    with pytest.raises(ValueError, match="training_metadata.json"):
        load_heldout(tmp_path, make_examples(40), trained_examples=50)
    loaded, method = load_heldout(tmp_path, make_examples(30), trained_examples=30)
    assert method == "legacy_tail"
    assert loaded == make_examples(30)[27:]

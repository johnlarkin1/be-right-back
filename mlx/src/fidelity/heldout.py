"""Train/held-out split shared by training and the fidelity eval.

Training writes the held-out indices to `heldout.json` in the persona directory.
The eval reads that file, so it scores only examples the adapter never trained on.
"""

import hashlib
import random
from pathlib import Path
from typing import Any

import ujson as json

HELDOUT_FILENAME = "heldout.json"
SPLIT_VERSION = 1
DEFAULT_SEED = 0
DEFAULT_VAL_FRACTION = 0.1
# Below this many held-out examples, val loss and perplexity are too noisy to act on.
MIN_VAL_EXAMPLES = 10

Example = dict[str, Any]


def split_examples(
    examples: list[Example],
    *,
    seed: int = DEFAULT_SEED,
    val_fraction: float = DEFAULT_VAL_FRACTION,
) -> tuple[list[Example], list[Example], list[int]]:
    """Split examples into train and held-out sets with a seeded shuffle.

    The JSONL export is in conversation order, so a plain tail slice would hold out
    only the newest messages. A seeded shuffle gives a representative sample and the
    same split on every run.

    Returns (train, val, val_indices). `val_indices` index into `examples`, sorted.
    A dataset with fewer than 2 examples gets an empty held-out set.
    """
    n = len(examples)
    if n < 2:
        return list(examples), [], []

    n_val = max(1, round(n * val_fraction))
    n_val = min(n_val, n - 1)

    order = list(range(n))
    random.Random(seed).shuffle(order)
    val_indices = sorted(order[:n_val])
    val_set = set(val_indices)

    train = [ex for i, ex in enumerate(examples) if i not in val_set]
    val = [examples[i] for i in val_indices]
    return train, val, val_indices


def legacy_tail_indices(n: int, val_fraction: float = DEFAULT_VAL_FRACTION) -> list[int]:
    """Held-out indices for adapters trained before `heldout.json` existed.

    Old training held out the chronological tail: `examples[int(n * 0.9):]`.
    """
    return list(range(int(n * (1 - val_fraction)), n))


def data_sha256(path: Path) -> str:
    """SHA-256 of the training data file. Ties `heldout.json` to one exact export."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_heldout(
    persona_dir: Path,
    *,
    data_path: Path,
    total_examples: int,
    val_indices: list[int],
    seed: int,
    val_fraction: float,
    sha256: str | None = None,
) -> Path:
    """Write `heldout.json`. `sha256` defaults to the hash of `data_path` now."""
    if sha256 is None and data_path.is_file():
        sha256 = data_sha256(data_path)
    path = persona_dir / HELDOUT_FILENAME
    payload = {
        "version": SPLIT_VERSION,
        "method": "seeded_shuffle",
        "seed": seed,
        "val_fraction": val_fraction,
        "data_path": str(data_path),
        "data_sha256": sha256,
        "total_examples": total_examples,
        "val_indices": val_indices,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return path


class HeldoutMismatchError(ValueError):
    """The held-out set was written for different training data."""


def load_heldout(
    persona_dir: Path,
    examples: list[Example],
    *,
    data_path: Path | None = None,
    trained_examples: int | None = None,
) -> tuple[list[Example], str]:
    """Return the held-out examples for a persona and the method that chose them.

    Uses `heldout.json` when present. It must match the data by example count, and
    by SHA-256 when both the file and the hash are known. The export keeps only the
    newest examples, so a re-export can keep the count and still shift every index.

    Without `heldout.json`, falls back to the legacy chronological tail. That path
    checks the count against `trained_examples` (from `training_metadata.json`).
    Raises HeldoutMismatchError when the held-out set does not match the training data.
    """
    path = persona_dir / HELDOUT_FILENAME
    if not path.exists():
        if trained_examples is not None and trained_examples != len(examples):
            raise HeldoutMismatchError(
                _mismatch("training_metadata.json", trained_examples, examples)
            )
        indices = legacy_tail_indices(len(examples))
        return [examples[i] for i in indices], "legacy_tail"

    with open(path, encoding="utf-8") as f:
        payload = json.load(f)

    expected = payload.get("total_examples")
    if expected != len(examples):
        raise HeldoutMismatchError(_mismatch(str(path), expected, examples))
    expected_sha = payload.get("data_sha256")
    if expected_sha and data_path is not None and data_path.is_file():
        if data_sha256(data_path) != expected_sha:
            raise HeldoutMismatchError(
                f"{data_path} changed since training ({path} has a different SHA-256). "
                "The data was re-exported, so the held-out set is unknown. Retrain."
            )
    indices = payload["val_indices"]
    return [examples[i] for i in indices], str(payload.get("method", "seeded_shuffle"))


def _mismatch(source: str, expected: Any, examples: list[Example]) -> str:
    return (
        f"{source} was written for {expected} examples, but the training data has "
        f"{len(examples)}. The data was re-exported after training, so the held-out "
        "set is unknown. Retrain, or pass --allow-legacy-split to use the tail."
    )

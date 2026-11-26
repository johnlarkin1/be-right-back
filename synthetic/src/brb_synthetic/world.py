"""Loading the authored world from disk.

Layout under ``world/``::

    cast.json          one Cast object
    arcs/*.json        one Arc object, or a list of them, per file
    gold.jsonl         one GoldQuery per line

Files are read in sorted order so the resulting ``World`` -- and therefore every
ROWID in the built database -- is stable across machines.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from brb_synthetic.models import Arc, Cast, GoldQuery, World

CAST_FILENAME = "cast.json"
ARCS_DIRNAME = "arcs"
GOLD_FILENAME = "gold.jsonl"


class WorldLoadError(RuntimeError):
    """A manifest file is missing or does not validate.

    Raised with the offending path already in the message; authoring errors are
    the common case here and a bare pydantic traceback does not say which file.
    """


def load_world(root: Path) -> World:
    """Read and fully validate the world manifest rooted at ``root``."""
    cast = _load_cast(root / CAST_FILENAME)
    arcs = _load_arcs(root / ARCS_DIRNAME)
    gold = _load_gold(root / GOLD_FILENAME)

    try:
        return World(cast=cast, arcs=arcs, gold=gold)
    except ValidationError as exc:
        raise WorldLoadError(f"world at {root} is internally inconsistent:\n{exc}") from exc


def _load_cast(path: Path) -> Cast:
    raw = _read_json(path)
    try:
        return Cast.model_validate(raw)
    except ValidationError as exc:
        raise WorldLoadError(f"{path}: {exc}") from exc


def _load_arcs(directory: Path) -> list[Arc]:
    if not directory.is_dir():
        raise WorldLoadError(f"no arcs directory at {directory}")

    paths = sorted(directory.glob("*.json"))
    if not paths:
        raise WorldLoadError(f"no arc files found in {directory}")

    arcs: list[Arc] = []
    for path in paths:
        raw = _read_json(path)
        entries = raw if isinstance(raw, list) else [raw]
        for index, entry in enumerate(entries):
            try:
                arcs.append(Arc.model_validate(entry))
            except ValidationError as exc:
                raise WorldLoadError(f"{path} (arc #{index}): {exc}") from exc
    return arcs


def _load_gold(path: Path) -> list[GoldQuery]:
    if not path.exists():
        raise WorldLoadError(f"no gold file at {path}")

    queries: list[GoldQuery] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        try:
            queries.append(GoldQuery.model_validate_json(stripped))
        except ValidationError as exc:
            raise WorldLoadError(f"{path}:{lineno}: {exc}") from exc
    if not queries:
        raise WorldLoadError(f"{path} contains no gold queries")
    return queries


def _read_json(path: Path) -> Any:
    if not path.exists():
        raise WorldLoadError(f"missing manifest file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorldLoadError(f"{path}: invalid JSON at line {exc.lineno}: {exc.msg}") from exc

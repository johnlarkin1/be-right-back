"""Installing a built corpus where the app will find it.

Nothing downstream reads ``~/Library/Messages/chat.db`` directly -- ingestion,
contacts and Casper all consume a *snapshot directory*. ``get_all_snapshots``
in ``crates/messages-db/src/db/snapshot.rs`` accepts any directory under
``~/.be-right-back/data/raw/`` whose name matches ``YYYYMMDD_HHMMSS``, and
``get_or_create_snapshot`` returns the newest one without touching the live
database. Dropping a synthetic snapshot there therefore runs the whole pipeline
on fake data with no changes to production code.

Two hazards to be aware of, both surfaced by ``install`` as warnings:

*   ``MAX_SNAPSHOTS = 1``, so anything that calls ``create_snapshot()`` will
    delete the synthetic snapshot as "old".
*   ``latest_live_message_date()`` reads the *real* chat.db for staleness, so a
    machine with real messages will consider the synthetic index stale and may
    prompt a re-ingest that clobbers it.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from brb_synthetic.build import ADDRESSBOOK_SNAPSHOT_FILENAME, CHAT_SNAPSHOT_FILENAME

#: Mirrors ``get_raw_data_dir()`` in ``crates/common``.
RAW_DATA_SUBPATH = Path(".be-right-back/data/raw")

#: The directory-name pattern ``get_all_snapshots`` filters on. Anything else is
#: invisible to the app.
SNAPSHOT_DIR_FORMAT = "%Y%m%d_%H%M%S"

#: Marker file so ``install`` can tell its own snapshots from real ones and never
#: delete a genuine snapshot of the user's messages.
MARKER_FILENAME = ".brb-synthetic"


@dataclass
class InstallReport:
    snapshot_dir: Path
    replaced: list[Path]
    real_snapshots_left_alone: list[Path]


def snapshot_root(home: Path | None = None) -> Path:
    return (home or Path.home()) / RAW_DATA_SUBPATH


def install(
    built_dir: Path,
    *,
    home: Path | None = None,
    replace_synthetic: bool = True,
    timestamp: datetime | None = None,
) -> InstallReport:
    """Copy a built corpus into a fresh, app-visible snapshot directory.

    Args:
        built_dir: Directory containing ``chat_snapshot.db`` and
            ``addressbook_snapshot.db``.
        home: Override the home directory, for tests.
        replace_synthetic: Remove previously installed *synthetic* snapshots.
            Real snapshots are never touched, regardless of this flag.
        timestamp: Override the snapshot directory name, for reproducibility.

    Returns:
        An ``InstallReport`` naming the new directory and anything removed.
    """
    chat_db = built_dir / CHAT_SNAPSHOT_FILENAME
    addressbook_db = built_dir / ADDRESSBOOK_SNAPSHOT_FILENAME
    if not chat_db.exists():
        raise FileNotFoundError(f"no {CHAT_SNAPSHOT_FILENAME} in {built_dir}; run `build` first")

    root = snapshot_root(home)
    root.mkdir(parents=True, exist_ok=True)

    existing = _existing_snapshots(root)
    synthetic = [path for path in existing if (path / MARKER_FILENAME).exists()]
    real = [path for path in existing if path not in synthetic]

    replaced: list[Path] = []
    if replace_synthetic:
        for path in synthetic:
            shutil.rmtree(path)
            replaced.append(path)

    stamp = (timestamp or datetime.now()).strftime(SNAPSHOT_DIR_FORMAT)
    destination = root / stamp
    # A same-second reinstall would otherwise collide with itself.
    suffix = 1
    while destination.exists():
        destination = root / f"{stamp[:-1]}{suffix}"
        suffix += 1
    destination.mkdir()

    shutil.copy2(chat_db, destination / CHAT_SNAPSHOT_FILENAME)
    if addressbook_db.exists():
        shutil.copy2(addressbook_db, destination / ADDRESSBOOK_SNAPSHOT_FILENAME)
    for sidecar in ("gold.resolved.jsonl", "build-manifest.json"):
        source = built_dir / sidecar
        if source.exists():
            shutil.copy2(source, destination / sidecar)
    (destination / MARKER_FILENAME).write_text(
        "Synthetic corpus installed by brb-synthetic. Safe to delete.\n", encoding="utf-8"
    )

    return InstallReport(
        snapshot_dir=destination,
        replaced=replaced,
        real_snapshots_left_alone=real,
    )


def _existing_snapshots(root: Path) -> list[Path]:
    """Directories the app would recognise as snapshots, newest first."""
    candidates = [path for path in root.iterdir() if path.is_dir() and _is_snapshot_name(path.name)]
    return sorted(candidates, reverse=True)


def _is_snapshot_name(name: str) -> bool:
    """Replicates the filter in ``get_all_snapshots``: 8 digits, '_', 6 digits."""
    return len(name) == 15 and name[:8].isdigit() and name[8] == "_" and name[9:].isdigit()


def uninstall(home: Path | None = None) -> list[Path]:
    """Remove every synthetic snapshot, leaving real ones untouched."""
    root = snapshot_root(home)
    if not root.exists():
        return []
    removed: list[Path] = []
    for path in _existing_snapshots(root):
        if (path / MARKER_FILENAME).exists():
            shutil.rmtree(path)
            removed.append(path)
    return removed

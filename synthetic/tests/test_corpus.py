"""Tests for the synthetic corpus builder.

These guard the three properties the corpus is worthless without: it is
byte-reproducible, its filler cannot answer a gold query, and installing it
never destroys a real snapshot of someone's actual messages.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import pytest

from brb_synthetic.build import (
    ADDRESSBOOK_SNAPSHOT_FILENAME,
    CHAT_SNAPSHOT_FILENAME,
    build_corpus,
    write_sidecars,
)
from brb_synthetic.filler import FillerCollisionError, generate_filler, protected_terms
from brb_synthetic.install import MARKER_FILENAME, install, snapshot_root, uninstall
from brb_synthetic.verify import verify
from brb_synthetic.world import load_world

WORLD_ROOT = Path(__file__).resolve().parents[1] / "world"
REPO_ROOT = Path(__file__).resolve().parents[2]
ANCHOR = datetime(2026, 7, 26)

#: Kept small so the suite stays fast; the invariants do not depend on volume.
TEST_TARGET = 1200


@pytest.fixture(scope="module")
def world():
    return load_world(WORLD_ROOT)


@pytest.fixture(scope="module")
def built(world, tmp_path_factory):
    output = tmp_path_factory.mktemp("corpus")
    report = build_corpus(world, output, anchor=ANCHOR, total_target=TEST_TARGET)
    write_sidecars(report, output)
    return output, report


def test_world_loads_and_cross_references_resolve(world):
    assert world.cast.contacts
    assert world.arcs
    assert world.gold


def test_every_stratum_is_covered(world):
    expected = {
        "fact",
        "semantic",
        "temporal_range",
        "superlative",
        "aggregation",
        "recency",
        "cross_contact",
    }
    assert {query.stratum for query in world.gold} == expected


def test_build_is_byte_reproducible(world, tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    for output in (first, second):
        build_corpus(world, output, anchor=ANCHOR, total_target=TEST_TARGET)

    assert (first / CHAT_SNAPSHOT_FILENAME).read_bytes() == (
        second / CHAT_SNAPSHOT_FILENAME
    ).read_bytes()
    assert (first / ADDRESSBOOK_SNAPSHOT_FILENAME).read_bytes() == (
        second / ADDRESSBOOK_SNAPSHOT_FILENAME
    ).read_bytes()


def test_rowids_are_chronological(built):
    output, _ = built
    connection = sqlite3.connect(output / CHAT_SNAPSHOT_FILENAME)
    inversions = connection.execute(
        """
        SELECT COUNT(*) FROM (
          SELECT date, LAG(date) OVER (ORDER BY ROWID) AS previous FROM message
        ) WHERE previous IS NOT NULL AND date < previous
        """
    ).fetchone()[0]
    connection.close()
    assert inversions == 0


def test_app_queries_accept_the_database(built):
    output, _ = built
    report = verify(
        output / CHAT_SNAPSHOT_FILENAME,
        REPO_ROOT,
        output / ADDRESSBOOK_SNAPSHOT_FILENAME,
    )
    assert report.ok
    assert report.resolvable_display_names == len(report.contacts)


def test_group_chats_are_excluded_from_one_to_one(built):
    """A leaked group chat would corrupt every per-contact metric."""
    output, _ = built
    report = verify(output / CHAT_SNAPSHOT_FILENAME, REPO_ROOT)
    assert report.group_only_messages > 0
    assert report.total_p2p_messages + report.group_only_messages >= len(report.contacts)


def test_gold_resolves_to_real_messages(built):
    output, report = built
    connection = sqlite3.connect(output / CHAT_SNAPSHOT_FILENAME)
    try:
        for record in report.resolved_gold:
            assert record["gold_message_ids"], f"{record['id']} resolved to no messages"
            for rowid in record["gold_message_ids"]:
                row = connection.execute(
                    "SELECT text FROM message WHERE ROWID = ?", (rowid,)
                ).fetchone()
                assert row is not None, f"{record['id']} points at missing ROWID {rowid}"
    finally:
        connection.close()


def test_hard_negatives_are_distinct_from_gold(built):
    _, report = built
    for record in report.resolved_gold:
        overlap = set(record["gold_message_ids"]) & set(record["hard_negative_message_ids"])
        assert not overlap, f"{record['id']} lists the same message as gold and negative"


def test_filler_never_uses_gold_vocabulary(world):
    """The corpus's load-bearing invariant."""
    forbidden = protected_terms(world)
    assert forbidden, "no protected terms extracted -- the guard would be vacuous"

    filler = generate_filler(world, total_target=TEST_TARGET)
    for messages in filler.values():
        for message in messages:
            words = {word.lower().strip(".,!?") for word in message.text.split()}
            assert not (words & forbidden), f"filler leaked gold vocabulary: {message.text!r}"


def test_collision_guard_actually_fires(world):
    """A guard that cannot fail is not a guard."""
    poisoned = world.model_copy(deep=True)
    poisoned.cast.contacts[0].filler.openers.append("hey, how was Nobu")
    with pytest.raises(FillerCollisionError, match="nobu"):
        generate_filler(poisoned, total_target=TEST_TARGET)


def test_install_preserves_real_snapshots(built, tmp_path):
    output, _ = built
    home = tmp_path / "home"
    real = snapshot_root(home) / "20260101_120000"
    real.mkdir(parents=True)
    (real / CHAT_SNAPSHOT_FILENAME).write_text("irreplaceable real data")

    report = install(output, home=home, timestamp=datetime(2026, 7, 26, 6, 0, 0))
    assert (report.snapshot_dir / MARKER_FILENAME).exists()
    assert real.exists(), "install destroyed a real snapshot"

    removed = uninstall(home)
    assert report.snapshot_dir in removed
    assert real.exists(), "uninstall destroyed a real snapshot"


def test_install_is_visible_to_the_apps_snapshot_scan(built, tmp_path):
    """The directory name must match the 15-char pattern get_all_snapshots filters on."""
    output, _ = built
    home = tmp_path / "home"
    report = install(output, home=home, timestamp=datetime(2026, 7, 26, 6, 0, 0))
    name = report.snapshot_dir.name
    assert len(name) == 15
    assert name[:8].isdigit() and name[8] == "_" and name[9:].isdigit()

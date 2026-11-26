"""Tests for the ingestion date range and min-messages-per-contact filters.

The filters are date math plus a count threshold, so these tests run the real
queries against a throwaway SQLite database shaped like the iMessage snapshot.
"""

import sqlite3
from datetime import UTC, datetime

import pytest

from constants import APPLE_EPOCH_OFFSET
from data.loaders import get_contact_ids_and_counts, read_messages_for_contacts
from utils.time import iso_date_to_apple_seconds

# Minimal slice of the iMessage snapshot schema the message queries touch.
_SCHEMA = """
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, uncanonicalized_id TEXT, person_centric_id TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, room_name TEXT, guid TEXT);
CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
CREATE TABLE message (
    ROWID INTEGER PRIMARY KEY,
    text TEXT,
    attributedBody BLOB,
    date INTEGER,
    is_from_me INTEGER,
    item_type INTEGER,
    is_system_message INTEGER,
    associated_message_guid TEXT,
    associated_message_type INTEGER DEFAULT 0
);
"""


def _apple_ns(date_str: str) -> int:
    """ISO date -> Apple-epoch nanoseconds at 12:00 UTC on that day."""
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=12, tzinfo=UTC)
    return (int(day.timestamp()) - APPLE_EPOCH_OFFSET) * 1_000_000_000


@pytest.fixture
def snapshot_db(tmp_path):
    """A snapshot with two contacts: `+1555` is chatty, `+1999` is quiet."""
    path = tmp_path / "chat_snapshot.db"
    conn = sqlite3.connect(str(path))
    conn.executescript(_SCHEMA)

    handles = [(1, "+1555"), (2, "+1999")]
    for rowid, contact_id in handles:
        conn.execute(
            "INSERT INTO handle (ROWID, id, uncanonicalized_id, person_centric_id) VALUES (?, ?, ?, NULL)",
            (rowid, contact_id, contact_id),
        )
        conn.execute(
            "INSERT INTO chat (ROWID, room_name, guid) VALUES (?, NULL, ?)", (rowid, f"p2p-{rowid}")
        )
        conn.execute(
            "INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)", (rowid, rowid)
        )

    # (handle rowid, date, text). +1555 has 3 messages in 2024 and 1 in 2023;
    # +1999 has 1 message in 2024, so it loses a min-messages >= 2 filter.
    rows = [
        (1, "2023-06-15", "old one"),
        (1, "2024-01-01", "first day of window"),
        (1, "2024-06-15", "middle"),
        (1, "2024-12-31", "last day of window"),
        (2, "2024-06-15", "only message"),
    ]
    for message_id, (chat_id, date_str, text) in enumerate(rows, start=1):
        conn.execute(
            "INSERT INTO message (ROWID, text, attributedBody, date, is_from_me, item_type,"
            " is_system_message, associated_message_guid) VALUES (?, ?, NULL, ?, 0, 0, 0, NULL)",
            (message_id, text, _apple_ns(date_str)),
        )
        conn.execute(
            "INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)",
            (chat_id, message_id),
        )

    conn.commit()
    conn.close()
    return path


# ---------------------------------------------------------------------------
# iso_date_to_apple_seconds
# ---------------------------------------------------------------------------


def test_start_bound_is_midnight_of_the_day():
    # 2001-01-01 is the Apple epoch itself.
    assert iso_date_to_apple_seconds("2001-01-01") == 0
    assert iso_date_to_apple_seconds("2001-01-02") == 86_400


def test_end_bound_covers_the_whole_day():
    assert iso_date_to_apple_seconds("2001-01-01", end_of_day=True) == 86_399


def test_missing_date_means_no_bound():
    assert iso_date_to_apple_seconds(None) is None
    assert iso_date_to_apple_seconds("") is None
    assert iso_date_to_apple_seconds(None, end_of_day=True) is None


# ---------------------------------------------------------------------------
# Date range (inclusive on both ends)
# ---------------------------------------------------------------------------


def test_no_filters_reads_every_contact_and_message(snapshot_db):
    assert dict(get_contact_ids_and_counts(snapshot_db)) == {"+1555": 4, "+1999": 1}
    assert len(read_messages_for_contacts(snapshot_db, ["+1555", "+1999"])) == 5


def test_date_range_drops_messages_outside_the_window(snapshot_db):
    start = iso_date_to_apple_seconds("2024-01-01")
    end = iso_date_to_apple_seconds("2024-12-31", end_of_day=True)

    assert dict(get_contact_ids_and_counts(snapshot_db, start, end)) == {"+1555": 3, "+1999": 1}

    texts = {m["text"] for m in read_messages_for_contacts(snapshot_db, ["+1555"], start, end)}
    assert texts == {"first day of window", "middle", "last day of window"}


def test_both_bounds_are_inclusive(snapshot_db):
    """A one-day window around a message keeps it; shifting a day drops it."""
    start = iso_date_to_apple_seconds("2024-01-01")
    end = iso_date_to_apple_seconds("2024-01-01", end_of_day=True)
    assert dict(get_contact_ids_and_counts(snapshot_db, start, end)) == {"+1555": 1}

    day_before_end = iso_date_to_apple_seconds("2023-12-31", end_of_day=True)
    assert get_contact_ids_and_counts(snapshot_db, start, day_before_end) == []


def test_one_sided_bounds_work(snapshot_db):
    start_only = iso_date_to_apple_seconds("2024-01-01")
    assert dict(get_contact_ids_and_counts(snapshot_db, start_only, None)) == {
        "+1555": 3,
        "+1999": 1,
    }

    end_only = iso_date_to_apple_seconds("2023-12-31", end_of_day=True)
    assert dict(get_contact_ids_and_counts(snapshot_db, None, end_only)) == {"+1555": 1}


def test_second_resolution_timestamps_are_handled(snapshot_db):
    """Old snapshots store `date` in seconds, not nanoseconds."""
    conn = sqlite3.connect(str(snapshot_db))
    conn.execute("UPDATE message SET date = date / 1000000000")
    conn.commit()
    conn.close()

    start = iso_date_to_apple_seconds("2024-01-01")
    end = iso_date_to_apple_seconds("2024-12-31", end_of_day=True)
    assert dict(get_contact_ids_and_counts(snapshot_db, start, end)) == {"+1555": 3, "+1999": 1}


# ---------------------------------------------------------------------------
# Minimum messages per contact
# ---------------------------------------------------------------------------


def test_min_messages_drops_quiet_contacts(snapshot_db):
    assert dict(get_contact_ids_and_counts(snapshot_db, None, None, 2)) == {"+1555": 4}


def test_min_messages_counts_only_messages_inside_the_date_range(snapshot_db):
    """+1555 has 4 lifetime messages but only 1 in this window, so a min of 2 drops it."""
    start = iso_date_to_apple_seconds("2023-01-01")
    end = iso_date_to_apple_seconds("2023-12-31", end_of_day=True)

    assert dict(get_contact_ids_and_counts(snapshot_db, start, end)) == {"+1555": 1}
    assert get_contact_ids_and_counts(snapshot_db, start, end, 2) == []


def test_min_messages_threshold_is_inclusive(snapshot_db):
    assert dict(get_contact_ids_and_counts(snapshot_db, None, None, 1)) == {"+1555": 4, "+1999": 1}
    assert dict(get_contact_ids_and_counts(snapshot_db, None, None, 4)) == {"+1555": 4}
    assert get_contact_ids_and_counts(snapshot_db, None, None, 5) == []


def test_zero_and_none_minimum_filter_nothing(snapshot_db):
    unfiltered = dict(get_contact_ids_and_counts(snapshot_db))
    assert dict(get_contact_ids_and_counts(snapshot_db, None, None, 0)) == unfiltered
    assert dict(get_contact_ids_and_counts(snapshot_db, None, None, None)) == unfiltered


# ---------------------------------------------------------------------------
# Contact ordering
# ---------------------------------------------------------------------------


def test_contacts_come_back_heaviest_first(snapshot_db):
    """The embedding pipeline and the UI both rely on this order.

    Batches are cut from this list, so the heaviest contacts embed first. The
    "Contacts (largest first)" tile in IngestionProgress.tsx labels itself on
    that promise: 40 of 470 contacts can be 78% of the work.
    """
    counts = [count for _, count in get_contact_ids_and_counts(snapshot_db)]
    assert counts == sorted(counts, reverse=True)
    assert counts == [4, 1]

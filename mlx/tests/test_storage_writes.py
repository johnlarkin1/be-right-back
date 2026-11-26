"""Chunk and daily-message writes land in the real DuckDB schema."""

from pathlib import Path

import duckdb
import numpy as np
import pytest

from data.storage import compute_daily_messages_to_conn, is_valid_embedding, write_chunks_bulk

_SCHEMA = Path(__file__).resolve().parents[2] / "crates" / "ingestion" / "sql" / "duckdb_schema.sql"

# 2024-06-15 12:00 UTC as Apple-epoch nanoseconds.
_TS = (1718452800 - 978307200) * 1_000_000_000


@pytest.fixture
def conn():
    """In-memory DuckDB with the tables ingestion writes. Skips VSS-only statements."""
    c = duckdb.connect()
    for stmt in _SCHEMA.read_text().split(";"):
        if not stmt.strip() or "HNSW" in stmt or "vss" in stmt.lower():
            continue
        c.execute(stmt)
    yield c
    c.close()


def _chunk(message_ids: list[int], embedding: np.ndarray) -> dict:
    return {
        "text": "[Contact: Sam | 2024-06-15]\nMe: dinner?\nSam: yes",
        "contact_id": "+15550001",
        "contact_display": "Sam",
        "contact_name": "Sam",
        "start_message_id": message_ids[0],
        "end_message_id": message_ids[-1],
        "message_count": len(message_ids),
        "start_timestamp": _TS,
        "end_timestamp": _TS,
        "messages": [
            {"sender": "Me", "text": "dinner?", "ts": _TS, "message_id": mid} for mid in message_ids
        ],
        "embedding": embedding,
    }


def test_chunks_store_embeddings_exactly(conn):
    rng = np.random.default_rng(0)
    vecs = rng.standard_normal((3, 768)).astype(np.float32)
    chunks = [_chunk([10 + i], v) for i, v in enumerate(vecs)]

    assert write_chunks_bulk(conn, chunks, run_id=7, chunk_id_offset=100) == 3

    rows = conn.execute(
        "SELECT chunk_id, embedding, ingestion_id FROM message_chunks ORDER BY chunk_id"
    ).fetchall()
    assert [r[0] for r in rows] == [100, 101, 102]
    assert all(r[2] == 7 for r in rows)
    np.testing.assert_array_equal(np.array([r[1] for r in rows], dtype=np.float32), vecs)


def test_message_ids_are_the_chunks_own_messages(conn):
    # ROWIDs are global across chats, so 10..500 would also cover other conversations.
    write_chunks_bulk(conn, [_chunk([10, 250, 500], np.ones(768, dtype=np.float32))], run_id=1)

    (ids,) = conn.execute("SELECT message_ids FROM message_chunks").fetchone()
    assert ids == [10, 250, 500]


def test_daily_messages_are_aggregated_per_day_contact_and_direction(conn):
    messages = [
        {"timestamp": _TS, "contact_id": "a", "is_from_me": 1},
        {"timestamp": _TS, "contact_id": "a", "is_from_me": 1},
        {"timestamp": _TS, "contact_id": "a", "is_from_me": 0},
        {"timestamp": _TS, "contact_id": "b", "is_from_me": 0},
    ]
    assert compute_daily_messages_to_conn(conn, messages) == 3

    rows = conn.execute(
        "SELECT CAST(date AS VARCHAR), contact_id, is_from_me, message_count "
        "FROM daily_messages ORDER BY contact_id, is_from_me"
    ).fetchall()
    assert rows == [
        ("2024-06-15", "a", False, 1),
        ("2024-06-15", "a", True, 2),
        ("2024-06-15", "b", False, 1),
    ]


@pytest.mark.parametrize(
    ("embedding", "ok"),
    [
        (np.ones(768, dtype=np.float32), True),
        ([0.5] * 768, True),
        (None, False),
        (np.ones(767, dtype=np.float32), False),
        (np.full(768, np.nan, dtype=np.float32), False),
        ([None] * 768, False),
    ],
)
def test_is_valid_embedding_accepts_arrays_and_lists(embedding, ok):
    assert is_valid_embedding(embedding) is ok

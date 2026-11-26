import sqlite3
from collections import defaultdict
from collections.abc import Mapping
from pathlib import Path

import duckdb
import numpy as np
import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16

from constants import MIN_MESSAGE_CHARS, OBJECT_REPLACEMENT_CHAR
from data.storage import configure_duckdb_memory, ensure_vss_extension
from progress.analytics import AnalyticsStage, AnalyticsStats, emit_progress
from progress.base import log_info, log_warn
from queries import duckdb as duckdb_queries
from queries import sqlite as sqlite_queries
from queries.duckdb import ChunkTable
from utils.attributed_body import decode_attributed_body
from utils.chunk_text import chunk_dialogue
from utils.verification_codes import is_verification_code

_REACTION_PREFIXES = [
    "Liked",
    "Loved",
    "Disliked",
    "Laughed at",
    "Emphasized",
    "Questioned",
]


def _is_reaction_message(text: str) -> bool:
    """Check if a message is an iMessage tapback reaction (e.g. 'Liked "hey"')."""
    stripped = text.strip()
    for prefix in _REACTION_PREFIXES:
        if stripped.startswith(prefix) or stripped.startswith(f"You {prefix.lower()}"):
            if '"' in stripped or "\u201c" in stripped:
                return True
    return False


def clean_message_text(
    text: str | None,
    min_chars: int = MIN_MESSAGE_CHARS,
) -> str | None:
    if not text:
        return None
    cleaned = text.replace(OBJECT_REPLACEMENT_CHAR, "").strip()
    if len(cleaned) < min_chars:
        return None
    if _is_reaction_message(cleaned):
        return None
    # Automated sign-in codes carry no conversation and form a topic of their own.
    if is_verification_code(cleaned):
        return None
    return cleaned


def _process_message_text(msg: dict) -> str | None:
    """Extract and clean text from a message dict, modifying it in place.

    Handles plain text and attributedBody decoding, then frees the binary blob.
    Returns a category string for counting: "text", "decoded", or None (no text).
    """
    text = msg.get("text")
    attributed_body = msg.get("attributedBody")

    result = None
    if text and text.strip():
        cleaned = clean_message_text(text)
        if cleaned:
            msg["text"] = cleaned
            result = "text"
        else:
            msg["text"] = None
    elif attributed_body:
        decoded = decode_attributed_body(bytes(attributed_body))
        cleaned = clean_message_text(decoded)
        if cleaned:
            msg["text"] = cleaned
            result = "decoded"
        else:
            msg["text"] = None
    else:
        msg["text"] = None

    # Free the binary attributedBody blob immediately after text extraction.
    msg.pop("attributedBody", None)
    return result


def group_by_contact(messages: list[dict]) -> Mapping[str, list[dict]]:
    groups: defaultdict[str, list[dict]] = defaultdict(list)
    for msg in messages:
        contact_id = msg.get("contact_id") or "unknown"
        groups[contact_id].append(msg)
    return groups


def get_contact_ids_and_counts(
    snapshot_db: Path,
    start_seconds: int | None = None,
    end_seconds: int | None = None,
    min_messages: int | None = None,
) -> list[tuple[str, int]]:
    """Get unique contact IDs with their message counts (lightweight query).

    Used by the batched pipeline to discover all contacts before processing
    them in memory-efficient batches. Returns contacts sorted by message
    count descending (heaviest contacts first).

    The bounds are inclusive Apple-epoch seconds. `min_messages` applies to the
    count inside those bounds, so it drops contacts that are quiet in the window.
    """
    conn = sqlite3.connect(str(snapshot_db))
    query = sqlite_queries.build_contact_ids_query(start_seconds, end_seconds, min_messages)
    results = [(row[0], row[1]) for row in conn.execute(query).fetchall()]
    conn.close()
    log_info(f"Found {len(results)} contacts, {sum(c for _, c in results):,} total messages")
    return results


def read_messages_for_contacts(
    snapshot_db: Path,
    contact_ids: list[str],
    start_seconds: int | None = None,
    end_seconds: int | None = None,
) -> list[dict]:
    """Read messages for a specific set of contacts using streaming cursor.

    Uses streaming cursor to avoid holding attributedBody blobs in memory.
    """
    conn = sqlite3.connect(str(snapshot_db))
    conn.row_factory = sqlite3.Row

    query = sqlite_queries.build_messages_for_contacts_query(
        len(contact_ids), start_seconds, end_seconds
    )
    cursor = conn.execute(query, contact_ids)

    messages: list[dict] = []
    for row in cursor:
        msg = dict(row)
        _process_message_text(msg)
        if msg.get("contact_id") and msg.get("text"):
            messages.append(msg)

    conn.close()
    return messages


def load_embeddings_from_duckdb(
    db_path: Path,
    use_analytics_chunks: bool = True,
) -> tuple[np.ndarray, list[dict]]:
    table_name: ChunkTable = "analytics_chunks" if use_analytics_chunks else "message_chunks"
    log_info(f"Loading embeddings from: {db_path} (table: {table_name})")
    emit_progress(AnalyticsStage.LOADING, 0, f"Loading embeddings from {table_name}...")

    conn = duckdb.connect(str(db_path), read_only=True)
    configure_duckdb_memory(conn, memory_limit="2GB")
    ensure_vss_extension(conn)

    count_query = duckdb_queries.SELECT_CHUNK_COUNT.format(table_name=table_name)
    result = conn.execute(count_query).fetchone()
    total_chunks: int = result[0] if result else 0

    if total_chunks == 0 and use_analytics_chunks:
        log_info("No analytics_chunks found, falling back to message_chunks")
        conn.close()
        return load_embeddings_from_duckdb(db_path, use_analytics_chunks=False)

    log_info(f"Found {total_chunks:,} chunks in {table_name}")

    emit_progress(
        AnalyticsStage.LOADING,
        10,
        f"Found {total_chunks:,} chunks",
        AnalyticsStats(total_chunks=total_chunks),
    )

    rows = conn.execute(duckdb_queries.build_embeddings_query(table_name)).fetchall()

    conn.close()

    embeddings = []
    metadata = []

    for i, row in enumerate(rows):
        chunk_id, embedding, contact_id, contact_name, chunk_data_json, end_timestamp = row

        embeddings.append(np.array(embedding, dtype=np.float32))

        try:
            chunk_data = json.loads(chunk_data_json) if chunk_data_json else {}
        except (json.JSONDecodeError, TypeError):
            chunk_data = {}

        # Header-free "Me:/Them:" text. The contact header and sender names
        # would otherwise leak into keywords and cluster labels.
        dialogue = chunk_dialogue(chunk_data, contact_name or "")

        metadata.append(
            {
                "chunk_id": chunk_id,
                "contact_id": contact_id or "",
                "contact_name": contact_name or "",
                "message_preview": dialogue[:150],
                "chunk_date": end_timestamp,
                "dialogue": dialogue,
            }
        )

        if (i + 1) % (total_chunks // 10 + 1) == 0:
            pct = int((i + 1) / total_chunks * 100)
            emit_progress(
                AnalyticsStage.LOADING,
                min(pct, 100),
                f"Loaded {i + 1:,}/{total_chunks:,} chunks",
                AnalyticsStats(chunks_processed=i + 1, total_chunks=total_chunks),
            )

    embeddings_array = np.vstack(embeddings)
    log_info(f"Loaded embeddings: shape={embeddings_array.shape}")

    emit_progress(
        AnalyticsStage.LOADING,
        100,
        f"Loaded {total_chunks:,} embeddings",
        AnalyticsStats(chunks_processed=total_chunks, total_chunks=total_chunks),
    )

    return embeddings_array, metadata


def build_contact_name_lookup(addressbook_db: Path | None) -> dict[str, str]:
    if addressbook_db is None or not addressbook_db.exists():
        return {}

    try:
        conn = sqlite3.connect(str(addressbook_db))
        conn.row_factory = sqlite3.Row

        lookup = {}
        for row in conn.execute(sqlite_queries.CONTACT_LOOKUP_QUERY):
            phone = row["phone"]
            first = row["first_name"] or ""
            last = row["last_name"] or ""
            name = f"{first} {last}".strip()
            if phone and name:
                # Normalize phone number (remove spaces, dashes)
                normalized = "".join(c for c in phone if c.isdigit() or c == "+")
                lookup[normalized] = name

        conn.close()
        log_info(f"Built contact lookup with {len(lookup)} entries")
        return lookup

    except Exception as e:
        log_warn(f"Failed to build contact lookup: {e}")
        return {}


def get_contact_display_name(
    contact_id: str,
    contact_display: str,
    lookup: dict[str, str],
) -> str:
    """Get the best display name for a contact."""
    normalized = "".join(c for c in contact_id if c.isdigit() or c == "+")
    if normalized in lookup:
        return lookup[normalized]
    return contact_display or contact_id

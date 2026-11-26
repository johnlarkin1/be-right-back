"""Load sample data from iMessage snapshot for benchmarking.

Uses utilities from the main mlx source to avoid code duplication.
"""

import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

# Add main mlx/src to path for imports from main application code
_MLX_SRC = Path(__file__).parent.parent.parent.parent / "mlx" / "src"
if str(_MLX_SRC) not in sys.path:
    sys.path.insert(0, str(_MLX_SRC))

try:
    from utils.attributed_body import decode_attributed_body

    _ATTRIBUTED_BODY_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import attributed_body decoder: {e}")
    _ATTRIBUTED_BODY_AVAILABLE = False

    # Fallback if decode not available
    def decode_attributed_body(data: bytes | None) -> str | None:
        return None


@dataclass
class Message:
    """A single message from the database."""

    message_id: int
    text: str
    timestamp: int
    is_from_me: bool
    contact_id: str
    contact_display: str


@dataclass
class SampleData:
    """Sample data for benchmarking."""

    messages: list[Message]
    contact_id: str
    contact_display: str

    @property
    def message_count(self) -> int:
        return len(self.messages)


def find_snapshot_db() -> Path | None:
    """Find the most recent snapshot database."""
    brb_dir = Path.home() / ".be-right-back" / "data" / "raw"
    if not brb_dir.exists():
        return None

    # Find most recent snapshot directory
    snapshots = sorted(brb_dir.iterdir(), reverse=True)
    for snapshot_dir in snapshots:
        db_path = snapshot_dir / "chat_snapshot.db"
        if db_path.exists():
            return db_path

    return None


def get_contact_with_most_messages(db_path: Path) -> tuple[str, str, int]:
    """Find the contact with the most messages."""
    conn = sqlite3.connect(str(db_path))

    query = """
        WITH p2p_chats AS (
            SELECT ch.ROWID AS chat_id
            FROM chat ch
            LEFT JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
            LEFT JOIN handle h ON h.ROWID = chj.handle_id
            WHERE ch.room_name IS NULL
              AND ch.guid NOT LIKE '%;chat%'
            GROUP BY ch.ROWID
            HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
        )
        SELECT
            h.id as contact_id,
            COALESCE(h.uncanonicalized_id, h.id) as contact_display,
            COUNT(*) as message_count
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN p2p_chats pc ON pc.chat_id = cmj.chat_id
        JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE m.item_type = 0
          AND m.is_system_message = 0
          AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
        GROUP BY h.id
        ORDER BY message_count DESC
        LIMIT 1
    """

    result = conn.execute(query).fetchone()
    conn.close()

    if result:
        return result[0], result[1], result[2]
    raise ValueError("No contacts found in database")


def load_messages_for_contact(
    db_path: Path, contact_id: str, limit: int | None = None
) -> list[Message]:
    """Load messages for a specific contact."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    limit_clause = f"LIMIT {limit}" if limit else ""

    query = f"""
        WITH p2p_chats AS (
            SELECT ch.ROWID AS chat_id
            FROM chat ch
            LEFT JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
            LEFT JOIN handle h ON h.ROWID = chj.handle_id
            WHERE ch.room_name IS NULL
              AND ch.guid NOT LIKE '%;chat%'
            GROUP BY ch.ROWID
            HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
        )
        SELECT
            m.ROWID as message_id,
            m.text,
            m.attributedBody,
            m.date as timestamp,
            m.is_from_me,
            h.id as contact_id,
            COALESCE(h.uncanonicalized_id, h.id) as contact_display
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN p2p_chats pc ON pc.chat_id = cmj.chat_id
        JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
        JOIN handle h ON h.ROWID = chj.handle_id
        WHERE h.id = ?
          AND m.item_type = 0
          AND m.is_system_message = 0
          AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
        ORDER BY m.date
        {limit_clause}
    """

    cursor = conn.execute(query, [contact_id])
    rows = cursor.fetchall()
    conn.close()

    print(f"  Fetched {len(rows)} rows from database")

    messages = []
    skipped_no_text = 0
    skipped_decode_failed = 0

    for row in rows:
        text = row["text"]

        # Try to decode attributedBody if text is empty
        if not text or not text.strip():
            attributed_body = row["attributedBody"]
            if attributed_body:
                text = decode_attributed_body(attributed_body)
                if not text:
                    skipped_decode_failed += 1
            else:
                skipped_no_text += 1

        # Skip if still no text
        if not text or not text.strip():
            continue

        messages.append(
            Message(
                message_id=row["message_id"],
                text=text,
                timestamp=row["timestamp"],
                is_from_me=bool(row["is_from_me"]),
                contact_id=row["contact_id"],
                contact_display=row["contact_display"],
            )
        )

    if skipped_no_text > 0 or skipped_decode_failed > 0:
        print(f"  Skipped: {skipped_no_text} no text, {skipped_decode_failed} decode failed")

    return messages


def load_sample_data(sample_size: int = 10000) -> SampleData:
    """Load sample data for benchmarking.

    Args:
        sample_size: Number of messages to load

    Returns:
        SampleData with messages from the contact with most messages
    """
    db_path = find_snapshot_db()
    if not db_path:
        raise FileNotFoundError("No snapshot database found. Run ingestion first: brb ingest")

    print(f"Using snapshot: {db_path}")

    # Find contact with most messages
    contact_id, contact_display, total_count = get_contact_with_most_messages(db_path)
    print(f"Selected contact: {contact_display} ({total_count} total messages)")

    # Load messages
    messages = load_messages_for_contact(db_path, contact_id, limit=sample_size)
    print(f"Loaded {len(messages)} messages for benchmarking")

    return SampleData(
        messages=messages,
        contact_id=contact_id,
        contact_display=contact_display,
    )


if __name__ == "__main__":
    # Quick test
    data = load_sample_data(1000)
    print(f"\nSample data loaded:")
    print(f"  Contact: {data.contact_display}")
    print(f"  Messages: {data.message_count}")
    print(f"  First message: {data.messages[0].text[:50]}...")

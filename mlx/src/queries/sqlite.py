"""SQLite queries for iMessage database access."""

# Common CTE that identifies peer-to-peer (1:1) chats, excluding group chats.
# Shared across message queries to ensure consistent chat filtering.
_P2P_CHATS_CTE = """
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
"""

# Common WHERE clause for message filtering
_MESSAGE_FILTERS = """
        WHERE m.item_type = 0
          AND m.is_system_message = 0
          -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
          AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
          AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
"""

# Common JOIN clause for message queries
_MESSAGE_JOINS = """
        FROM message m
        JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        JOIN p2p_chats pc ON pc.chat_id = cmj.chat_id
        JOIN chat_handle_join chj ON chj.chat_id = cmj.chat_id
        JOIN handle h ON h.ROWID = chj.handle_id
"""


# iMessage stores `m.date` as nanoseconds since the Apple epoch on modern macOS
# and as plain seconds on older ones. Normalize to seconds before comparing.
# The 2-billion threshold matches `normalize_cocoa_timestamp` in crates/common.
_NORMALIZED_DATE = "(CASE WHEN m.date > 2000000000 THEN m.date / 1000000000 ELSE m.date END)"


def build_date_filter(start_seconds: int | None, end_seconds: int | None) -> str:
    """Build inclusive date-range predicates in Apple-epoch seconds.

    Returns an empty string when both bounds are None, so an unfiltered query
    is byte-identical to the one before this filter existed.
    """
    clauses = []
    if start_seconds is not None:
        clauses.append(f"          AND {_NORMALIZED_DATE} >= {int(start_seconds)}")
    if end_seconds is not None:
        clauses.append(f"          AND {_NORMALIZED_DATE} <= {int(end_seconds)}")
    return "\n" + "\n".join(clauses) if clauses else ""


def build_contact_ids_query(
    start_seconds: int | None = None,
    end_seconds: int | None = None,
    min_messages: int | None = None,
) -> str:
    """Get unique contact IDs with their message counts.

    Used by the batched pipeline to discover contacts before processing them
    in memory-efficient batches. `min_messages` counts only the messages that
    survive the date filter, so a contact with a long history but little
    activity inside the window is dropped.
    """
    having = f"\n        HAVING COUNT(*) >= {int(min_messages)}" if min_messages else ""
    return f"""
        {_P2P_CHATS_CTE}
        SELECT h.id as contact_id, COUNT(*) as msg_count
        {_MESSAGE_JOINS}
        {_MESSAGE_FILTERS}{build_date_filter(start_seconds, end_seconds)}
        GROUP BY h.id{having}
        ORDER BY COUNT(*) DESC
    """


def build_messages_for_contacts_query(
    contact_count: int,
    start_seconds: int | None = None,
    end_seconds: int | None = None,
) -> str:
    """Get messages for a specific set of contacts.

    Uses parameterized placeholders for contact IDs to enable batched reading.
    The contact_count parameter determines the number of ? placeholders.
    """
    placeholders = ",".join("?" * contact_count)
    return f"""
        {_P2P_CHATS_CTE}
        SELECT
            m.ROWID as message_id,
            m.text,
            m.attributedBody,
            m.date as timestamp,
            m.is_from_me,
            h.id as contact_id,
            COALESCE(h.uncanonicalized_id, h.id) as contact_display
        {_MESSAGE_JOINS}
        {_MESSAGE_FILTERS}{build_date_filter(start_seconds, end_seconds)}
          AND h.id IN ({placeholders})
        ORDER BY h.id, m.date
    """


CONTACT_LOOKUP_QUERY = """
    SELECT
        ZABCDPHONENUMBER.ZFULLNUMBER as phone,
        ZABCDRECORD.ZFIRSTNAME as first_name,
        ZABCDRECORD.ZLASTNAME as last_name
    FROM ZABCDPHONENUMBER
    JOIN ZABCDRECORD ON ZABCDPHONENUMBER.ZOWNER = ZABCDRECORD.Z_PK
    WHERE ZABCDPHONENUMBER.ZFULLNUMBER IS NOT NULL
"""

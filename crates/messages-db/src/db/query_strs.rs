//! SQL query strings for iMessage database access

/// Query to list contacts with message counts at or above a minimum threshold (1:1 only)
///
/// Use min_messages=1 to get all contacts with at least one message.
/// The parameterized threshold allows efficient filtering at the SQL level.
pub const LIST_ALL_CONTACTS_WITH_MIN_MESSAGES: &str = r#"
    WITH p2p_chats AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      LEFT JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      LEFT JOIN handle h             ON h.ROWID     = chj.handle_id
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    ),
    p2p_messages AS (
      SELECT cmj.chat_id,
             m.ROWID AS message_id,
             m.date
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      WHERE m.item_type = 0
        AND m.is_system_message = 0
        -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
        AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    )
    SELECT
      h.id,
      COUNT(DISTINCT pm.message_id) AS message_count,
      MIN(pm.date)                  AS earliest_message,
      MAX(pm.date)                  AS latest_message
    FROM p2p_chats pc
    JOIN chat_handle_join chj ON chj.chat_id = pc.chat_id
    JOIN handle h             ON h.ROWID     = chj.handle_id
    JOIN p2p_messages pm      ON pm.chat_id  = pc.chat_id
    GROUP BY h.id
    HAVING message_count >= ?
    ORDER BY message_count DESC
    "#;

/// Query to list all contacts with message counts including group chats
/// This provides a view of overall interaction frequency across all conversations
/// Counts all messages in any chat where the contact participated (1:1 and group)
pub const LIST_ALL_CONTACTS_INCLUDING_GROUPS: &str = r#"
    WITH all_chats AS (
      -- Get all chats (both 1:1 and group) for each handle
      SELECT ch.ROWID AS chat_id,
             h.id AS handle_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h ON h.ROWID = chj.handle_id
    ),
    all_messages AS (
      -- Get all messages from all chats
      SELECT cmj.chat_id,
             m.ROWID AS message_id,
             m.date
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      WHERE m.item_type = 0
        AND m.is_system_message = 0
        -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
        AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    )
    SELECT
      ac.handle_id AS id,
      COUNT(DISTINCT am.message_id) AS message_count,
      MIN(am.date)                  AS earliest_message,
      MAX(am.date)                  AS latest_message
    FROM all_chats ac
    JOIN all_messages am ON am.chat_id = ac.chat_id
    GROUP BY ac.handle_id
    HAVING message_count > 0
    ORDER BY message_count DESC
    "#;

/// Query to get all one on one messages for a specific contact
pub const GET_MESSAGES_FOR_CONTACT: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
             COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT DISTINCT
      m.ROWID  AS rowid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.service
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
      AND m.item_type = 0
      AND m.is_system_message = 0
      -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
      AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    ORDER BY m.date ASC, m.ROWID ASC
    "#;

/// Query to get one-on-one messages for a contact with pagination (LIMIT/OFFSET)
pub const GET_MESSAGES_FOR_CONTACT_PAGINATED: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
             COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT DISTINCT
      m.ROWID  AS rowid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.service
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
      AND m.item_type = 0
      AND m.is_system_message = 0
      -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
      AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    ORDER BY m.date ASC, m.ROWID ASC
    LIMIT ? OFFSET ?
    "#;

/// Query to get the MOST RECENT one-on-one messages for a contact.
///
/// Identical chat-selection logic to [`GET_MESSAGES_FOR_CONTACT`], but ordered
/// newest-first so `LIMIT ?` returns the latest N messages. Callers reverse the
/// result into chronological (oldest-first) order for display.
pub const GET_RECENT_MESSAGES_FOR_CONTACT: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
             COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT DISTINCT
      m.ROWID  AS rowid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.service
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
      AND m.item_type = 0
      AND m.is_system_message = 0
      -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
      AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    ORDER BY m.date DESC, m.ROWID DESC
    LIMIT ?
    "#;

/// Query to get the one-on-one messages CLOSEST to a target date for a contact.
///
/// Identical chat-selection logic to [`GET_MESSAGES_FOR_CONTACT`]. The target is
/// passed as a Unix timestamp (seconds); `m.date` is normalized from Apple Cocoa
/// time inline using the same heuristic as `common::cocoa_to_unix` (values above
/// 2e9 are nanoseconds, otherwise seconds; both offset by 978307200). The N rows
/// nearest the target are returned; callers sort them chronologically for display.
pub const GET_MESSAGES_FOR_CONTACT_AROUND_DATE: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
             COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT rowid, text, attributedBody, is_from_me, date, service
    FROM (
      SELECT DISTINCT
        m.ROWID  AS rowid,
        m.text   AS text,
        m.attributedBody AS attributedBody,
        m.is_from_me AS is_from_me,
        m.date   AS date,
        m.service AS service,
        ABS(
          (CASE WHEN m.date > 2000000000 THEN m.date / 1000000000 ELSE m.date END + 978307200) - ?
        ) AS dist
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
        AND m.item_type = 0
        AND m.is_system_message = 0
        -- drop Tapbacks (2000-2999) and Tapback removals (3000-3999)
        AND COALESCE(m.associated_message_type, 0) NOT BETWEEN 2000 AND 3999
    )
    ORDER BY dist ASC
    LIMIT ?
    "#;

/// Query to build phone number lookup from AddressBook
pub const BUILD_PHONE_LOOKUP: &str = r#"
        SELECT
            r.ZFIRSTNAME,
            r.ZLASTNAME,
            r.ZMIDDLENAME,
            r.ZNICKNAME,
            p.ZFULLNUMBER
        FROM ZABCDRECORD r
        JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
        WHERE p.ZFULLNUMBER IS NOT NULL
    "#;

/// Query to build email address lookup from AddressBook
pub const BUILD_EMAIL_LOOKUP: &str = r#"
        SELECT
            r.ZFIRSTNAME,
            r.ZLASTNAME,
            r.ZMIDDLENAME,
            r.ZNICKNAME,
            e.ZADDRESS
        FROM ZABCDRECORD r
        JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
        WHERE e.ZADDRESS IS NOT NULL
    "#;

/// Query to count reactions (tapbacks) for a specific contact
/// A Tapback has `associated_message_type` 2000-2999. Removals (3000-3999) do not count.
pub const GET_REACTIONS_COUNT_FOR_CONTACT: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
             COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT
      COUNT(*) AS total_reactions,
      SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) AS reactions_from_me,
      SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) AS reactions_from_them
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
      AND m.associated_message_type BETWEEN 2000 AND 2999
    "#;

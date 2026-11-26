use crate::utils::build_display_name;
use common::{BrbError, Contact, Conversation, Message, Result};
use phonenumber::{Mode, country::Id};
use rusqlite::{Connection, Result as RusqliteResult};
use std::collections::HashMap;
use std::path::Path;
use tracing::{debug, warn};

use super::parser::{message_row_to_message, row_to_contact};
use super::query_strs;
use super::schema::MessageRow;
use super::snapshot::{open_addressbook_snapshot, open_chat_snapshot};

// ============================================================================
// Contact Query API
// ============================================================================

/// Options for querying contacts.
///
/// Use the builder methods to customize the query:
/// ```ignore
/// let options = ContactQueryOptions::default()
///     .min_messages(50)
///     .skip_display_names();
/// let contacts = list_contacts(&snapshot_dir, options)?;
/// ```
#[derive(Clone, Debug)]
pub struct ContactQueryOptions {
    /// Minimum message count filter (default: 1, i.e., all contacts with messages)
    pub min_messages: usize,
    /// Include group chat participants (default: false, i.e., 1:1 only)
    pub include_groups: bool,
    /// Skip display name population from AddressBook (default: false)
    /// Set to true when you'll populate display names separately (e.g., from cached lookups)
    pub skip_display_names: bool,
}

impl Default for ContactQueryOptions {
    fn default() -> Self {
        Self {
            min_messages: 1,
            include_groups: false,
            skip_display_names: false,
        }
    }
}

impl ContactQueryOptions {
    /// Set minimum message count filter
    pub fn min_messages(mut self, min: usize) -> Self {
        self.min_messages = min;
        self
    }

    /// Include group chat participants in results
    pub fn include_groups(mut self) -> Self {
        self.include_groups = true;
        self
    }

    /// Skip display name population (for manual population from cached lookups)
    pub fn skip_display_names(mut self) -> Self {
        self.skip_display_names = true;
        self
    }
}

/// Query contacts from the Messages database.
///
/// Use `ContactQueryOptions` to customize the query:
/// - `min_messages`: Filter by minimum message count (default: 1)
/// - `include_groups`: Include group chat participants (default: false)
/// - `skip_display_names`: Skip AddressBook lookup for caching scenarios (default: false)
///
/// # Examples
/// ```ignore
/// // All 1:1 contacts with display names
/// let contacts = list_contacts(&snapshot_dir, ContactQueryOptions::default())?;
///
/// // Contacts with 50+ messages, no display name lookup
/// let contacts = list_contacts(&snapshot_dir, ContactQueryOptions::default()
///     .min_messages(50)
///     .skip_display_names())?;
/// ```
pub fn list_contacts(snapshot_dir: &Path, options: ContactQueryOptions) -> Result<Vec<Contact>> {
    let conn = open_chat_snapshot(snapshot_dir)?;

    let mut contacts = if options.include_groups {
        // Group query - filter min_messages in Rust since query doesn't support it
        let mut stmt = conn.prepare(query_strs::LIST_ALL_CONTACTS_INCLUDING_GROUPS)?;
        let all_contacts: Vec<Contact> = stmt
            .query_map([], row_to_contact)?
            .collect::<RusqliteResult<Vec<Contact>>>()?;

        if options.min_messages > 1 {
            all_contacts
                .into_iter()
                .filter(|c| c.message_count >= options.min_messages)
                .collect()
        } else {
            all_contacts
        }
    } else {
        // 1:1 query with SQL-level min_messages filter
        let mut stmt = conn.prepare(query_strs::LIST_ALL_CONTACTS_WITH_MIN_MESSAGES)?;
        stmt.query_map([options.min_messages as i64], row_to_contact)?
            .collect::<RusqliteResult<Vec<Contact>>>()?
    };

    if !options.skip_display_names {
        populate_display_names(snapshot_dir, &mut contacts)?;
    }

    Ok(contacts)
}

// ============================================================================
// Message Queries
// ============================================================================

/// Get all messages for a specific contact
///
/// Returns messages in chronological order (oldest first).
/// Skips messages that fail to decode (e.g., attachment-only messages, invalid attributedBody).
/// Respects BRB_DEV_MESSAGE_LIMIT env var if set (for faster development iteration).
pub fn get_messages_for_contact(conn: &Connection, contact_id: &str) -> Result<Vec<Message>> {
    use common::get_dev_message_limit;

    // Use paginated query if dev limit is set, otherwise fetch all
    if let Some(limit) = get_dev_message_limit() {
        debug!(limit, "BRB_DEV_MESSAGE_LIMIT is set, limiting message fetch");
        return get_messages_for_contact_paginated(conn, contact_id, limit, 0);
    }

    let mut stmt = conn.prepare(query_strs::GET_MESSAGES_FOR_CONTACT)?;

    collect_messages(&mut stmt, [contact_id])
}

/// Run a prepared message query and decode the rows, skipping any message that
/// fails to decode (attachment-only messages, invalid `attributedBody`).
fn collect_messages(stmt: &mut rusqlite::Statement, params: impl rusqlite::Params) -> Result<Vec<Message>> {
    Ok(stmt
        .query_and_then(params, |row| {
            let mr = MessageRow::from_row(row)?;
            message_row_to_message(mr)
        })?
        .filter_map(|result| match result {
            Ok(msg) => Some(msg),
            Err(e) => {
                debug!(error = ?e, "Skipping message without text (likely attachment-only)");
                None
            }
        })
        .collect())
}

/// Get all message rows for a specific contact (including raw attributedBody)
///
/// Returns MessageRow objects with text and attributedBody fields for length calculation.
/// Returns messages in chronological order (oldest first).
pub fn get_message_rows_for_contact(conn: &Connection, contact_id: &str) -> Result<Vec<MessageRow>> {
    let mut stmt = conn.prepare(query_strs::GET_MESSAGES_FOR_CONTACT)?;
    let mut query_result = stmt.query([contact_id])?;

    let mut rows = Vec::new();
    while let Some(row) = query_result.next()? {
        rows.push(MessageRow::from_row(row)?);
    }

    Ok(rows)
}

/// Get reaction counts for a specific contact
///
/// Returns (total_reactions, reactions_from_me, reactions_from_them).
/// A Tapback has `associated_message_type` 2000-2999.
pub fn get_reactions_count(conn: &Connection, contact_id: &str) -> Result<(usize, usize, usize)> {
    let mut stmt = conn.prepare(query_strs::GET_REACTIONS_COUNT_FOR_CONTACT)?;

    let result = stmt.query_row([contact_id], |row| {
        let total: i64 = row.get(0)?;
        let from_me: Option<i64> = row.get(1).ok();
        let from_them: Option<i64> = row.get(2).ok();
        Ok((
            total as usize,
            from_me.unwrap_or(0) as usize,
            from_them.unwrap_or(0) as usize,
        ))
    })?;

    Ok(result)
}

/// Get messages for a contact with pagination
///
/// Returns messages in chronological order (oldest first).
/// Supports limit and offset for pagination.
/// Skips messages that fail to decode (e.g., attachment-only messages, invalid attributedBody).
pub fn get_messages_for_contact_paginated(
    conn: &Connection,
    contact_id: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<Message>> {
    let mut stmt = conn.prepare(query_strs::GET_MESSAGES_FOR_CONTACT_PAGINATED)?;

    collect_messages(&mut stmt, [contact_id, &limit.to_string(), &offset.to_string()])
}

/// Get the most recent messages for a contact.
///
/// Returns up to `limit` messages in chronological order (oldest first), but
/// selected from the *newest* end of the conversation — i.e. the latest `limit`
/// messages. This is the correct primitive for "show me the most recent
/// messages"; `get_messages_for_contact_paginated` returns the *oldest* messages
/// (it orders ascending with LIMIT/OFFSET), which is wrong for recency.
/// Skips messages that fail to decode (e.g. attachment-only messages).
pub fn get_recent_messages_for_contact(conn: &Connection, contact_id: &str, limit: usize) -> Result<Vec<Message>> {
    let mut stmt = conn.prepare(query_strs::GET_RECENT_MESSAGES_FOR_CONTACT)?;

    let mut messages = collect_messages(&mut stmt, rusqlite::params![contact_id, limit as i64])?;

    // The query returns newest-first; reverse to chronological (oldest-first).
    messages.reverse();
    Ok(messages)
}

/// Get the messages closest in time to a target date for a contact.
///
/// `target_unix_secs` is a Unix timestamp (seconds since 1970-01-01). Returns up
/// to `count` messages nearest that instant — looking both before and after it —
/// in chronological order (oldest first). Unlike fetching a fixed prefix of the
/// history and filtering in memory, this windows on the date directly, so it
/// works for any target date regardless of conversation volume.
/// Skips messages that fail to decode (e.g. attachment-only messages).
pub fn get_messages_for_contact_around_date(
    conn: &Connection,
    contact_id: &str,
    target_unix_secs: i64,
    count: usize,
) -> Result<Vec<Message>> {
    let mut stmt = conn.prepare(query_strs::GET_MESSAGES_FOR_CONTACT_AROUND_DATE)?;

    let mut messages = collect_messages(&mut stmt, rusqlite::params![contact_id, target_unix_secs, count as i64])?;

    // The query returns nearest-first (by |date - target|); sort to chronological.
    messages.sort_by_key(|m| m.timestamp);
    Ok(messages)
}

/// Get a complete conversation for a contact with display name from AddressBook
///
/// This is a convenience function that combines contact info and messages.
pub fn get_conversation(snapshot_dir: &Path, contact_id: &str) -> Result<Conversation> {
    let conn = open_chat_snapshot(snapshot_dir)?;
    let messages = get_messages_for_contact(&conn, contact_id)?;
    if messages.is_empty() {
        return Err(BrbError::NotFound(format!(
            "No messages found for contact {}",
            contact_id
        )));
    }

    let start_date = messages
        .first()
        .map(|msg| msg.timestamp)
        .expect("messages vector is not empty, so this is safe");
    let end_date = messages
        .last()
        .map(|msg| msg.timestamp)
        .expect("messages vector is not empty, so this is safe");

    let display_name = if let Ok(addressbookconn) = open_addressbook_snapshot(snapshot_dir) {
        let is_phone = contact_id.contains(char::is_numeric);
        if is_phone {
            build_phone_lookup(&addressbookconn)
                .ok()
                .and_then(|map| normalize_phone_number(contact_id).and_then(|normalized| map.get(&normalized).cloned()))
        } else {
            build_email_lookup(&addressbookconn)
                .ok()
                .and_then(|map| map.get(&contact_id.to_lowercase()).cloned())
        }
    } else {
        None
    };

    let contact = Contact {
        id: contact_id.to_string(),
        display_name,
        message_count: messages.len(),
        earliest_message: Some(start_date),
        latest_message: Some(end_date),
    };

    Ok(Conversation {
        contact,
        messages,
        start_date,
        end_date,
    })
}

/// Get every 1:1 conversation with at least `min_messages` messages, for "You" training.
///
/// Group chats are excluded. One person can have several handles (phone and email)
/// that Apple merges into the same chats, so a message is kept only the first time
/// it appears. Conversations are ordered by message count, largest first.
pub fn get_self_conversations(snapshot_dir: &Path, min_messages: usize) -> Result<Vec<Conversation>> {
    let contacts = list_contacts(snapshot_dir, ContactQueryOptions::default().min_messages(min_messages))?;
    let conn = open_chat_snapshot(snapshot_dir)?;
    let mut seen_ids = std::collections::HashSet::new();
    let mut conversations = Vec::with_capacity(contacts.len());

    for mut contact in contacts {
        let messages: Vec<Message> = get_messages_for_contact(&conn, &contact.id)?
            .into_iter()
            .filter(|m| seen_ids.insert(m.id))
            .collect();
        let (Some(first), Some(last)) = (messages.first(), messages.last()) else {
            continue;
        };
        let (start_date, end_date) = (first.timestamp, last.timestamp);
        contact.message_count = messages.len();
        conversations.push(Conversation {
            contact,
            messages,
            start_date,
            end_date,
        });
    }

    if conversations.is_empty() {
        return Err(BrbError::NotFound(format!(
            "No 1:1 conversations with at least {min_messages} messages"
        )));
    }

    debug!(
        conversations = conversations.len(),
        "Loaded conversations for self training"
    );
    Ok(conversations)
}

/// Normalize a phone number to E.164 format for matching
///
/// Uses the phonenumber crate to parse and normalize phone numbers.
/// Defaults to US region if no country code is present.
///
/// Note: This function is slow (~30ms per call) due to comprehensive parsing.
/// For batch operations, consider normalizing all phone numbers upfront
/// and caching the results.
pub fn normalize_phone_number(phone: &str) -> Option<String> {
    match phonenumber::parse(Some(Id::US), phone) {
        Ok(parsed) => {
            let normalized = parsed.format().mode(Mode::E164).to_string();
            Some(normalized)
        }
        Err(_) => None,
    }
}

/// Build a lookup map from phone numbers to display names
///
/// Queries all phone numbers from AddressBook and normalizes them for matching.
/// Returns a HashMap of normalized phone number -> display name.
pub fn build_phone_lookup(addressbookconn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = addressbookconn.prepare(query_strs::BUILD_PHONE_LOOKUP)?;
    let mut phone_map = HashMap::new();

    let rows = stmt.query_map([], |row| {
        let first_name: Option<String> = row.get(0).ok();
        let last_name: Option<String> = row.get(1).ok();
        let middle_name: Option<String> = row.get(2).ok();
        let nickname: Option<String> = row.get(3).ok();
        let full_number: Option<String> = row.get(4).ok();
        Ok((first_name, last_name, middle_name, nickname, full_number))
    })?;

    for row in rows.flatten() {
        if let Some(db_number) = &row.4
            && let Some(normalized) = normalize_phone_number(db_number)
        {
            let name = build_display_name(row.0, row.1, row.2, row.3);
            phone_map.insert(normalized, name);
        }
    }

    debug!(entries = phone_map.len(), "Built phone number lookup map");
    Ok(phone_map)
}

/// Build a lookup map from email addresses to display names
///
/// Queries all email addresses from AddressBook.
/// Returns a HashMap of lowercase email -> display name.
pub fn build_email_lookup(addressbookconn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = addressbookconn.prepare(query_strs::BUILD_EMAIL_LOOKUP)?;
    let mut email_map = HashMap::new();

    let rows = stmt.query_map([], |row| {
        let first_name: Option<String> = row.get(0).ok();
        let last_name: Option<String> = row.get(1).ok();
        let middle_name: Option<String> = row.get(2).ok();
        let nickname: Option<String> = row.get(3).ok();
        let email: Option<String> = row.get(4).ok();
        Ok((first_name, last_name, middle_name, nickname, email))
    })?;

    for row in rows.flatten() {
        if let Some(email) = &row.4 {
            let name = build_display_name(row.0, row.1, row.2, row.3);
            email_map.insert(email.to_lowercase(), name);
        }
    }

    debug!(entries = email_map.len(), "Built email lookup map");
    Ok(email_map)
}

/// Populate display names using pre-built lookup maps (for caching)
///
/// Use this when you have already-built phone and email lookup maps
/// to avoid rebuilding them for each query.
pub fn populate_display_names_with_cache(
    contacts: &mut [Contact],
    phone_map: &HashMap<String, String>,
    email_map: &HashMap<String, String>,
) {
    let mut matched = 0;
    let mut unmatched = 0;

    for contact in contacts.iter_mut() {
        let contact_id = &contact.id;

        let is_phone = contact_id.contains(char::is_numeric);
        let display_name = if is_phone {
            normalize_phone_number(contact_id).and_then(|normalized| phone_map.get(&normalized).cloned())
        } else {
            email_map.get(&contact_id.to_lowercase()).cloned()
        };

        if let Some(name) = display_name {
            contact.display_name = Some(name);
            matched += 1;
        } else {
            unmatched += 1;
        }
    }

    debug!(
        matched,
        unmatched,
        total = contacts.len(),
        "Populated display names from cached maps"
    );
}

/// Populate display names from AddressBook for a list of contacts
///
/// Builds lookup maps from AddressBook and uses them to populate display names efficiently.
/// Updates contacts in-place.
fn populate_display_names(snapshot_dir: &Path, contacts: &mut [Contact]) -> Result<()> {
    let addressbookconn = match open_addressbook_snapshot(snapshot_dir) {
        Ok(conn) => conn,
        Err(e) => {
            warn!(error = ?e, "AddressBook snapshot not available, skipping display name population");
            return Ok(());
        }
    };

    let phone_map = build_phone_lookup(&addressbookconn).unwrap_or_default();
    let email_map = build_email_lookup(&addressbookconn).unwrap_or_default();

    populate_display_names_with_cache(contacts, &phone_map, &email_map);

    Ok(())
}

#[cfg(test)]
mod recency_tests {
    //! Regression tests for the message-window queries.
    //!
    //! The bug: `get_conversation_context` asked for "recent" messages but the
    //! only available query (`get_messages_for_contact_paginated`) orders ASC and
    //! returns the OLDEST rows, so a high-volume contact always reported its
    //! earliest history. These tests pin the corrected primitives:
    //! `get_recent_messages_for_contact` (newest end) and
    //! `get_messages_for_contact_around_date` (windowed on the date).

    use super::*;
    use chrono::{TimeZone, Utc};
    use common::COCOA_TO_UNIX_OFFSET;

    const CONTACT: &str = "+15550001111";
    const DAY_SECS: i64 = 86_400;

    /// Build an in-memory iMessage DB with `n_days` daily messages for one 1:1
    /// contact, starting at `start_unix`. Message `i` lands at `start_unix + i*day`.
    fn build_db(start_unix: i64, n_days: i64) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, person_centric_id TEXT, service TEXT);
             CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, room_name TEXT, guid TEXT);
             CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
             CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
             CREATE TABLE message (
               ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER,
               date INTEGER, service TEXT, item_type INTEGER, is_system_message INTEGER,
               associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0
             );",
        )
        .unwrap();

        // One handle (no person_centric_id), one peer-to-peer chat, linked.
        conn.execute(
            "INSERT INTO handle (ROWID, id, person_centric_id, service) VALUES (1, ?1, NULL, 'iMessage')",
            [CONTACT],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat (ROWID, room_name, guid) VALUES (1, NULL, 'iMessage;-;+15550001111')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1)", [])
            .unwrap();

        for i in 0..n_days {
            let cocoa_secs = (start_unix + i * DAY_SECS) - COCOA_TO_UNIX_OFFSET; // store as cocoa seconds
            let rowid = i + 1;
            conn.execute(
                "INSERT INTO message (ROWID, text, attributedBody, is_from_me, date, service, item_type, is_system_message, associated_message_guid)
                 VALUES (?1, ?2, NULL, 0, ?3, 'iMessage', 0, 0, NULL)",
                rusqlite::params![rowid, format!("message day {i}"), cocoa_secs],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, ?1)",
                [rowid],
            )
            .unwrap();
        }
        conn
    }

    // 2023-08-01T00:00:00Z, 1000 daily messages -> through ~2026-04-26.
    const START_UNIX: i64 = 1_690_848_000;
    const N_DAYS: i64 = 1000;

    #[test]
    fn recent_returns_newest_not_oldest() {
        let conn = build_db(START_UNIX, N_DAYS);
        let recent = get_recent_messages_for_contact(&conn, CONTACT, 10).unwrap();

        assert_eq!(recent.len(), 10);
        // Chronological (oldest-first) within the returned window.
        assert!(recent.windows(2).all(|w| w[0].timestamp <= w[1].timestamp));
        // The last row is the newest message in the whole conversation (day 999).
        let newest_unix = START_UNIX + (N_DAYS - 1) * DAY_SECS;
        assert_eq!(
            recent.last().unwrap().timestamp,
            Utc.timestamp_opt(newest_unix, 0).unwrap()
        );
        // And the window is the *newest* 10 days, nowhere near the 2023 start.
        assert_eq!(
            recent.first().unwrap().timestamp,
            Utc.timestamp_opt(newest_unix - 9 * DAY_SECS, 0).unwrap()
        );
    }

    #[test]
    fn around_date_recent_target_returns_recent_rows() {
        // The exact failure mode: ask for messages around a RECENT date on a
        // high-volume contact. The old path fetched only the oldest N*10 rows and
        // could never reach here; the windowed query returns rows at the target.
        let conn = build_db(START_UNIX, N_DAYS);
        let target_unix = START_UNIX + 900 * DAY_SECS; // deep into the conversation
        let around = get_messages_for_contact_around_date(&conn, CONTACT, target_unix, 10).unwrap();

        assert_eq!(around.len(), 10);
        assert!(around.windows(2).all(|w| w[0].timestamp <= w[1].timestamp));
        // Every returned message is within ~6 days of the target (the 10 nearest).
        for m in &around {
            assert!(
                (m.timestamp.timestamp() - target_unix).abs() <= 6 * DAY_SECS,
                "message at {} is too far from target",
                m.timestamp
            );
        }
    }

    #[test]
    fn paginated_still_returns_oldest() {
        // Documents the contrast: the pre-existing paginated query is oldest-first.
        // This is why it was the wrong primitive for "recent".
        let conn = build_db(START_UNIX, N_DAYS);
        let page = get_messages_for_contact_paginated(&conn, CONTACT, 10, 0).unwrap();
        assert_eq!(
            page.first().unwrap().timestamp,
            Utc.timestamp_opt(START_UNIX, 0).unwrap()
        );
    }

    /// Add one row of `associated_message_type` to the 1:1 chat. Real Tapback rows
    /// carry text and an attributedBody, such as `Loved “hey”`.
    fn insert_typed(conn: &Connection, rowid: i64, text: &str, is_from_me: bool, assoc_type: i64) {
        conn.execute(
            "INSERT INTO message (ROWID, text, attributedBody, is_from_me, date, service, item_type, is_system_message, associated_message_guid, associated_message_type)
             VALUES (?1, ?2, X'00', ?3, ?4, 'iMessage', 0, 0, 'p:0/TARGET', ?5)",
            rusqlite::params![rowid, text, is_from_me, rowid, assoc_type],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, ?1)",
            [rowid],
        )
        .unwrap();
    }

    #[test]
    fn tapbacks_with_text_are_not_messages_but_are_counted() {
        let conn = build_db(START_UNIX, 3);
        insert_typed(&conn, 100, "Loved \u{201c}message day 0\u{201d}", true, 2000);
        insert_typed(
            &conn,
            101,
            "Reacted \u{1f602} to \u{201c}message day 1\u{201d}",
            false,
            2006,
        );
        insert_typed(
            &conn,
            102,
            "Removed a heart from \u{201c}message day 0\u{201d}",
            true,
            3000,
        );

        let messages = get_messages_for_contact(&conn, CONTACT).unwrap();
        assert_eq!(messages.len(), 3, "only the 3 real messages remain");
        assert!(messages.iter().all(|m| m.text.starts_with("message day")));

        // Removals (3000) are not Tapbacks.
        assert_eq!(get_reactions_count(&conn, CONTACT).unwrap(), (2, 1, 1));
    }
}

//! Tapbacks (iMessage reactions) read from a chat.db snapshot.
//!
//! chat.db stores each Tapback as a `message` row. `associated_message_type`
//! gives the kind: 2000-2007 adds a Tapback, 3000-3007 removes one.
//! `associated_message_guid` points at the target message as `p:<part>/<guid>`,
//! `bp:<guid>` (a link or app balloon), or a bare guid.
//!
//! [`list_tapbacks`] reads every row and nets removals out, so the result holds
//! only the Tapbacks that are still on a message.

use std::collections::HashMap;

use common::Result;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// The kind of a Tapback. The order matches `associated_message_type - 2000`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TapbackKind {
    Love,
    Like,
    Dislike,
    Laugh,
    Emphasize,
    Question,
    Emoji,
    Sticker,
}

impl TapbackKind {
    pub const ALL: [TapbackKind; 8] = [
        TapbackKind::Love,
        TapbackKind::Like,
        TapbackKind::Dislike,
        TapbackKind::Laugh,
        TapbackKind::Emphasize,
        TapbackKind::Question,
        TapbackKind::Emoji,
        TapbackKind::Sticker,
    ];

    /// Map an `associated_message_type` to (kind, is_removal).
    /// Returns `None` for types that are not Tapbacks.
    pub fn from_associated_type(assoc_type: i64) -> Option<(TapbackKind, bool)> {
        let (offset, removal) = match assoc_type {
            2000..=2007 => (assoc_type - 2000, false),
            3000..=3007 => (assoc_type - 3000, true),
            _ => return None,
        };
        Some((Self::ALL[offset as usize], removal))
    }

    pub fn as_str(self) -> &'static str {
        match self {
            TapbackKind::Love => "love",
            TapbackKind::Like => "like",
            TapbackKind::Dislike => "dislike",
            TapbackKind::Laugh => "laugh",
            TapbackKind::Emphasize => "emphasize",
            TapbackKind::Question => "question",
            TapbackKind::Emoji => "emoji",
            TapbackKind::Sticker => "sticker",
        }
    }

    pub fn parse(s: &str) -> Option<TapbackKind> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

/// One Tapback that is still on its target message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tapback {
    /// ROWID of the Tapback row in chat.db.
    pub message_rowid: i64,
    pub chat_id: i64,
    /// Handle of the other person in a 1:1 chat. `None` in a group chat.
    pub contact_id: Option<String>,
    /// Handle of the person who reacted. `None` when it is you.
    pub sender_id: Option<String>,
    pub is_from_me: bool,
    pub kind: TapbackKind,
    /// The emoji, for [`TapbackKind::Emoji`] on macOS 15 and later.
    pub emoji: Option<String>,
    /// ROWID of the target message. `None` when the snapshot lacks it.
    pub target_rowid: Option<i64>,
    /// Message part the Tapback is on (`p:<part>/`). 0 for a whole message.
    pub target_part: i64,
    /// True when the target is a link or app balloon (`bp:`).
    pub target_is_balloon: bool,
    pub target_from_me: Option<bool>,
    /// Handle of the target's sender. `None` when it is you or unknown.
    pub target_sender_id: Option<String>,
    /// Unix seconds.
    pub reacted_at: i64,
}

/// Split `associated_message_guid` into (target guid, part, is_balloon).
pub fn parse_target_guid(raw: &str) -> (&str, i64, bool) {
    if let Some(rest) = raw.strip_prefix("bp:") {
        return (rest, 0, true);
    }
    if let Some(rest) = raw.strip_prefix("p:")
        && let Some((part, guid)) = rest.split_once('/')
    {
        return (guid, part.parse().unwrap_or(0), false);
    }
    (raw, 0, false)
}

/// Read every Tapback in the snapshot, with removals netted out.
pub fn list_tapbacks(conn: &Connection) -> Result<Vec<Tapback>> {
    let emoji_col = if has_column(conn, "message", "associated_message_emoji")? {
        "m.associated_message_emoji"
    } else {
        "NULL"
    };
    let sql = LIST_TAPBACK_ROWS.replace("{EMOJI}", emoji_col);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(RawTapback {
            rowid: row.get(0)?,
            date: row.get(1)?,
            is_from_me: row.get::<_, i64>(2)? != 0,
            assoc_type: row.get(3)?,
            emoji: row.get(4)?,
            sender_id: row.get(5)?,
            chat_id: row.get(6)?,
            contact_id: row.get(7)?,
            target_raw: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            target_rowid: row.get(9)?,
            target_from_me: row.get::<_, Option<i64>>(10)?.map(|v| v != 0),
            target_sender_id: row.get(11)?,
        })
    })?;
    let raw = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(net_tapbacks(raw))
}

/// One Tapback row as read from chat.db, before netting.
#[derive(Debug, Clone)]
struct RawTapback {
    rowid: i64,
    date: i64,
    is_from_me: bool,
    assoc_type: i64,
    emoji: Option<String>,
    sender_id: Option<String>,
    chat_id: i64,
    contact_id: Option<String>,
    target_raw: String,
    target_rowid: Option<i64>,
    target_from_me: Option<bool>,
    target_sender_id: Option<String>,
}

/// Apply adds and removals in date order.
///
/// A person holds at most one Tapback on a message part. A new add replaces
/// their earlier one, and a removal clears it.
fn net_tapbacks(rows: Vec<RawTapback>) -> Vec<Tapback> {
    // (sender, chat, target guid with part) -> index into `out`
    let mut active: HashMap<(Option<String>, i64, String), usize> = HashMap::new();
    let mut out: Vec<Option<Tapback>> = Vec::new();

    for r in rows {
        let Some((kind, removal)) = TapbackKind::from_associated_type(r.assoc_type) else {
            continue;
        };
        let sender = if r.is_from_me { None } else { r.sender_id.clone() };
        let key = (sender.clone(), r.chat_id, r.target_raw.clone());
        if let Some(i) = active.remove(&key) {
            out[i] = None;
        }
        if removal {
            continue;
        }
        let (_, target_part, target_is_balloon) = parse_target_guid(&r.target_raw);
        active.insert(key, out.len());
        out.push(Some(Tapback {
            message_rowid: r.rowid,
            chat_id: r.chat_id,
            contact_id: r.contact_id,
            sender_id: sender,
            is_from_me: r.is_from_me,
            kind,
            emoji: r.emoji.filter(|e| !e.is_empty()),
            target_rowid: r.target_rowid,
            target_part,
            target_is_balloon,
            target_from_me: r.target_from_me,
            target_sender_id: if r.target_from_me == Some(true) {
                None
            } else {
                r.target_sender_id
            },
            reacted_at: common::cocoa_to_unix(r.date),
        }));
    }
    out.into_iter().flatten().collect()
}

/// Read the given messages by ROWID, with their text decoded.
///
/// Messages without decodable text (an attachment alone, for example) are left out.
pub fn messages_by_rowid(conn: &Connection, rowids: &[i64]) -> Result<Vec<common::Message>> {
    if rowids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; rowids.len()].join(", ");
    let sql = format!(
        "SELECT ROWID, text, attributedBody, is_from_me, date, service FROM message WHERE ROWID IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(rowids), |row| {
        Ok(super::schema::MessageRow::from_row(row))
    })?;
    let mut out = Vec::new();
    for row in rows {
        if let Ok(message) = super::parser::message_row_to_message(row??) {
            out.push(message);
        }
    }
    Ok(out)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Every Tapback row (2000-3999) with its chat, sender and resolved target.
///
/// `{EMOJI}` is replaced with the emoji column, or `NULL` on macOS versions
/// before the column existed. `p2p_chats` matches the 1:1 chat rule in
/// `query_strs.rs`; the contact is the chat's smallest handle id.
const LIST_TAPBACK_ROWS: &str = r#"
    WITH p2p_chats AS (
      SELECT ch.ROWID AS chat_id, MIN(h.id) AS contact_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT
      m.ROWID,
      m.date,
      m.is_from_me,
      m.associated_message_type,
      {EMOJI},
      sh.id,
      cmj.chat_id,
      p2p.contact_id,
      m.associated_message_guid,
      t.ROWID,
      t.is_from_me,
      th.id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN p2p_chats p2p ON p2p.chat_id = cmj.chat_id
    LEFT JOIN handle sh ON sh.ROWID = m.handle_id
    LEFT JOIN message t ON t.guid = CASE
        WHEN m.associated_message_guid LIKE 'p:%/%'
          THEN substr(m.associated_message_guid, instr(m.associated_message_guid, '/') + 1)
        WHEN m.associated_message_guid LIKE 'bp:%'
          THEN substr(m.associated_message_guid, 4)
        ELSE m.associated_message_guid
      END
    LEFT JOIN handle th ON th.ROWID = t.handle_id
    WHERE m.associated_message_type BETWEEN 2000 AND 3999
    ORDER BY m.date ASC, m.ROWID ASC
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// A chat.db with one 1:1 chat (Sam) and one group chat (Sam + Kim).
    fn build_db(with_emoji_column: bool) -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let emoji = if with_emoji_column {
            ", associated_message_emoji TEXT"
        } else {
            ""
        };
        conn.execute_batch(&format!(
            "CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, person_centric_id TEXT);
             CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, room_name TEXT, guid TEXT);
             CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
             CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
             CREATE TABLE message (
               ROWID INTEGER PRIMARY KEY, guid TEXT, handle_id INTEGER, is_from_me INTEGER,
               date INTEGER, associated_message_guid TEXT, associated_message_type INTEGER DEFAULT 0 {emoji}
             );
             INSERT INTO handle VALUES (1, '+1555', NULL), (2, '+1999', NULL);
             INSERT INTO chat VALUES (1, NULL, 'iMessage;-;+1555'), (2, 'chat123', 'iMessage;+;chat123');
             INSERT INTO chat_handle_join VALUES (1, 1), (2, 1), (2, 2);"
        ))
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, rowid: i64, chat: i64, from_me: bool, handle: i64, assoc: Option<(&str, i64)>) {
        let (guid, assoc_type) = assoc.unwrap_or(("", 0));
        conn.execute(
            "INSERT INTO message (ROWID, guid, handle_id, is_from_me, date, associated_message_guid, associated_message_type)
             VALUES (?1, ?2, ?3, ?4, ?5, NULLIF(?6, ''), ?7)",
            rusqlite::params![rowid, format!("G{rowid}"), handle, from_me, rowid * 1_000_000_000, guid, assoc_type],
        )
        .unwrap();
        conn.execute("INSERT INTO chat_message_join VALUES (?1, ?2)", [chat, rowid])
            .unwrap();
    }

    #[test]
    fn parses_target_guid_forms() {
        assert_eq!(parse_target_guid("p:0/ABC"), ("ABC", 0, false));
        assert_eq!(parse_target_guid("p:2/ABC"), ("ABC", 2, false));
        assert_eq!(parse_target_guid("bp:ABC"), ("ABC", 0, true));
        assert_eq!(parse_target_guid("ABC"), ("ABC", 0, false));
    }

    #[test]
    fn maps_associated_types() {
        assert_eq!(
            TapbackKind::from_associated_type(2000),
            Some((TapbackKind::Love, false))
        );
        assert_eq!(
            TapbackKind::from_associated_type(2006),
            Some((TapbackKind::Emoji, false))
        );
        assert_eq!(
            TapbackKind::from_associated_type(3003),
            Some((TapbackKind::Laugh, true))
        );
        assert_eq!(TapbackKind::from_associated_type(0), None);
        assert_eq!(TapbackKind::from_associated_type(1000), None);
        assert_eq!(TapbackKind::parse("emphasize"), Some(TapbackKind::Emphasize));
    }

    #[test]
    fn resolves_targets_and_nets_removals() {
        let conn = build_db(false);
        // 1:1 chat: Sam writes 1, I write 2.
        insert(&conn, 1, 1, false, 1, None);
        insert(&conn, 2, 1, true, 0, None);
        // I love Sam's message, then switch to laugh: only laugh stays.
        insert(&conn, 3, 1, true, 0, Some(("p:0/G1", 2000)));
        insert(&conn, 4, 1, true, 0, Some(("p:0/G1", 2003)));
        // Sam likes my message, then removes it.
        insert(&conn, 5, 1, false, 1, Some(("p:0/G2", 2001)));
        insert(&conn, 6, 1, false, 1, Some(("p:0/G2", 3001)));
        // Sam emphasizes my message.
        insert(&conn, 7, 1, false, 1, Some(("p:0/G2", 2004)));
        // Group chat: Kim loves Sam's message, which is not in the snapshot.
        insert(&conn, 8, 2, false, 2, Some(("bp:MISSING", 2000)));

        let tapbacks = list_tapbacks(&conn).unwrap();
        assert_eq!(tapbacks.len(), 3);

        let laugh = &tapbacks[0];
        assert_eq!(laugh.message_rowid, 4);
        assert_eq!(laugh.kind, TapbackKind::Laugh);
        assert!(laugh.is_from_me);
        assert_eq!(laugh.sender_id, None);
        assert_eq!(laugh.contact_id.as_deref(), Some("+1555"));
        assert_eq!(laugh.target_rowid, Some(1));
        assert_eq!(laugh.target_from_me, Some(false));
        assert_eq!(laugh.target_sender_id.as_deref(), Some("+1555"));
        assert_eq!(laugh.reacted_at, 4 + common::COCOA_TO_UNIX_OFFSET);

        let emph = &tapbacks[1];
        assert_eq!(emph.kind, TapbackKind::Emphasize);
        assert_eq!(emph.sender_id.as_deref(), Some("+1555"));
        assert_eq!(emph.target_from_me, Some(true));
        assert_eq!(emph.target_sender_id, None);

        let group = &tapbacks[2];
        assert_eq!(group.contact_id, None);
        assert_eq!(group.sender_id.as_deref(), Some("+1999"));
        assert_eq!(group.target_rowid, None);
        assert!(group.target_is_balloon);
    }

    #[test]
    fn reads_messages_by_rowid() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB,
               is_from_me INTEGER, date INTEGER, service TEXT);
             INSERT INTO message VALUES (1, 'see you at 6', NULL, 1, 10, 'iMessage'),
               (2, NULL, NULL, 1, 20, 'iMessage'), (3, 'other', NULL, 0, 30, 'iMessage');",
        )
        .unwrap();
        let messages = messages_by_rowid(&conn, &[1, 2]).unwrap();
        assert_eq!(messages.len(), 1, "a row without text is left out");
        assert_eq!(messages[0].text, "see you at 6");
        assert!(messages_by_rowid(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn reads_emoji_when_column_exists() {
        let conn = build_db(true);
        insert(&conn, 1, 1, false, 1, None);
        insert(&conn, 2, 1, true, 0, Some(("p:0/G1", 2006)));
        conn.execute(
            "UPDATE message SET associated_message_emoji = '\u{1f602}' WHERE ROWID = 2",
            [],
        )
        .unwrap();

        let tapbacks = list_tapbacks(&conn).unwrap();
        assert_eq!(tapbacks.len(), 1);
        assert_eq!(tapbacks[0].kind, TapbackKind::Emoji);
        assert_eq!(tapbacks[0].emoji.as_deref(), Some("\u{1f602}"));
    }
}

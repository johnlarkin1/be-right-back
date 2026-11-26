//! Tapback aggregates for Insights, read from the `tapbacks` table in brb.db.
//!
//! "Given" means a Tapback you put on someone else's message. "Received" means
//! someone else's Tapback on your message. Both count 1:1 and group chats.
//! Every query reads the current ingestion only.

use common::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

/// Optional time window, in unix seconds, inclusive.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackWindow {
    pub start: Option<i64>,
    pub end: Option<i64>,
}

/// Tapbacks of one kind, split by direction.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackKindCount {
    /// love | like | dislike | laugh | emphasize | question | emoji | sticker
    pub kind: String,
    pub given: i64,
    pub received: i64,
}

/// Tapback totals and kind mix, for everyone or for one contact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackSummary {
    pub given: i64,
    pub received: i64,
    /// Kinds with at least one Tapback, most used first.
    pub by_kind: Vec<TapbackKindCount>,
}

/// One person's Tapback exchange with you.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackContact {
    pub contact_id: String,
    pub display_name: Option<String>,
    /// Your Tapbacks on their messages.
    pub given: i64,
    /// Their Tapbacks on your messages.
    pub received: i64,
    /// The kind you use most on their messages.
    pub top_given_kind: Option<String>,
    /// The kind they use most on your messages.
    pub top_received_kind: Option<String>,
}

/// Tapbacks of one kind in one month.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackMonth {
    /// "2024-01"
    pub period: String,
    pub kind: String,
    pub given: i64,
    pub received: i64,
}

/// SQL predicates shared by every query. `?1`/`?2` are the window bounds.
const CURRENT: &str = "t.ingestion_id = (SELECT curr_ingestion_id FROM app_state WHERE id = 1)
      AND (?1 IS NULL OR t.reacted_at >= ?1)
      AND (?2 IS NULL OR t.reacted_at <= ?2)";
const GIVEN: &str = "(t.is_from_me = 1 AND t.target_from_me = 0)";
const RECEIVED: &str = "(t.is_from_me = 0 AND t.target_from_me = 1)";

/// Totals and kind mix. With `contact_id`, only Tapbacks between you and that person.
pub fn summary(conn: &Connection, contact_id: Option<&str>, window: TapbackWindow) -> Result<TapbackSummary> {
    let sql = format!(
        "SELECT t.kind,
                SUM(CASE WHEN {GIVEN} AND (?3 IS NULL OR t.target_sender_id = ?3) THEN 1 ELSE 0 END),
                SUM(CASE WHEN {RECEIVED} AND (?3 IS NULL OR t.sender_id = ?3) THEN 1 ELSE 0 END)
         FROM tapbacks t
         WHERE {CURRENT}
         GROUP BY t.kind"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut by_kind = stmt
        .query_map(params![window.start, window.end, contact_id], |r| {
            Ok(TapbackKindCount {
                kind: r.get(0)?,
                given: r.get(1)?,
                received: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    by_kind.retain(|k| k.given + k.received > 0);
    by_kind.sort_by(|a, b| {
        (b.given + b.received)
            .cmp(&(a.given + a.received))
            .then(a.kind.cmp(&b.kind))
    });

    Ok(TapbackSummary {
        given: by_kind.iter().map(|k| k.given).sum(),
        received: by_kind.iter().map(|k| k.received).sum(),
        by_kind,
    })
}

/// People ranked by Tapbacks exchanged with you (given + received), largest first.
pub fn contacts(conn: &Connection, window: TapbackWindow, limit: usize) -> Result<Vec<TapbackContact>> {
    let sql = format!(
        "WITH exchanged AS (
           SELECT t.target_sender_id AS person, t.kind, 1 AS given, 0 AS received
           FROM tapbacks t WHERE {CURRENT} AND {GIVEN} AND t.target_sender_id IS NOT NULL
           UNION ALL
           SELECT t.sender_id, t.kind, 0, 1
           FROM tapbacks t WHERE {CURRENT} AND {RECEIVED} AND t.sender_id IS NOT NULL
         ),
         per_kind AS (
           SELECT person, kind, SUM(given) AS given, SUM(received) AS received
           FROM exchanged GROUP BY person, kind
         ),
         names AS (
           SELECT c.contact_id, MAX(c.display_name) AS display_name
           FROM contacts c
           WHERE c.ingestion_id = (SELECT curr_ingestion_id FROM app_state WHERE id = 1)
           GROUP BY c.contact_id
         )
         SELECT p.person, n.display_name, SUM(p.given), SUM(p.received),
           (SELECT kind FROM per_kind k WHERE k.person = p.person AND k.given > 0
              ORDER BY k.given DESC, k.kind LIMIT 1),
           (SELECT kind FROM per_kind k WHERE k.person = p.person AND k.received > 0
              ORDER BY k.received DESC, k.kind LIMIT 1)
         FROM per_kind p
         LEFT JOIN names n ON n.contact_id = p.person
         GROUP BY p.person
         ORDER BY SUM(p.given) + SUM(p.received) DESC, p.person
         LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![window.start, window.end, limit as i64], |r| {
        Ok(TapbackContact {
            contact_id: r.get(0)?,
            display_name: r.get(1)?,
            given: r.get(2)?,
            received: r.get(3)?,
            top_given_kind: r.get(4)?,
            top_received_kind: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Given and received Tapbacks per month and kind, oldest month first (UTC months).
pub fn monthly(conn: &Connection, window: TapbackWindow) -> Result<Vec<TapbackMonth>> {
    let sql = format!(
        "SELECT strftime('%Y-%m', t.reacted_at, 'unixepoch') AS period, t.kind,
                SUM(CASE WHEN {GIVEN} THEN 1 ELSE 0 END),
                SUM(CASE WHEN {RECEIVED} THEN 1 ELSE 0 END)
         FROM tapbacks t
         WHERE {CURRENT} AND ({GIVEN} OR {RECEIVED})
         GROUP BY period, t.kind
         ORDER BY period, t.kind"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![window.start, window.end], |r| {
        Ok(TapbackMonth {
            period: r.get(0)?,
            kind: r.get(1)?,
            given: r.get(2)?,
            received: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// How often one emoji was used as a Tapback.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct TapbackEmoji {
    pub emoji: String,
    pub given: i64,
    pub received: i64,
}

/// One of your messages and the Tapbacks others put on it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct ReactedMessage {
    /// ROWID of your message in the snapshot.
    pub message_rowid: i64,
    /// Your message text. `None` when it has no text (a photo, for example).
    pub text: Option<String>,
    /// When you sent it, unix seconds. `None` when the snapshot lacks it.
    pub sent_at: Option<i64>,
    /// The 1:1 contact. `None` in a group chat.
    pub contact_id: Option<String>,
    pub contact_name: Option<String>,
    /// Tapbacks from others on this message.
    pub tapbacks: i64,
    /// Distinct people who reacted.
    pub people: i64,
    /// Kinds on this message, most used first.
    pub kinds: Vec<TapbackKindCount>,
}

/// Emoji Tapbacks (macOS 15 and later), most used first.
pub fn top_emojis(conn: &Connection, window: TapbackWindow, limit: usize) -> Result<Vec<TapbackEmoji>> {
    let sql = format!(
        "SELECT t.emoji,
                SUM(CASE WHEN {GIVEN} THEN 1 ELSE 0 END) AS given,
                SUM(CASE WHEN {RECEIVED} THEN 1 ELSE 0 END) AS received
         FROM tapbacks t
         WHERE {CURRENT} AND t.kind = 'emoji' AND t.emoji IS NOT NULL AND ({GIVEN} OR {RECEIVED})
         GROUP BY t.emoji
         ORDER BY given + received DESC, t.emoji
         LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![window.start, window.end, limit as i64], |r| {
        Ok(TapbackEmoji {
            emoji: r.get(0)?,
            given: r.get(1)?,
            received: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Your messages with the most Tapbacks from others. `text` and `sent_at` are
/// left empty: [`fill_message_text`] reads them from the snapshot.
pub fn most_reacted(conn: &Connection, window: TapbackWindow, limit: usize) -> Result<Vec<ReactedMessage>> {
    let sql = format!(
        "WITH names AS (
           SELECT c.contact_id, MAX(c.display_name) AS display_name
           FROM contacts c
           WHERE c.ingestion_id = (SELECT curr_ingestion_id FROM app_state WHERE id = 1)
           GROUP BY c.contact_id
         )
         SELECT t.target_rowid, MAX(t.contact_id), MAX(n.display_name),
                COUNT(*), COUNT(DISTINCT t.sender_id),
                GROUP_CONCAT(t.kind)
         FROM tapbacks t
         LEFT JOIN names n ON n.contact_id = t.contact_id
         WHERE {CURRENT} AND {RECEIVED} AND t.target_rowid IS NOT NULL
         GROUP BY t.target_rowid
         ORDER BY COUNT(*) DESC, MAX(t.reacted_at) DESC
         LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![window.start, window.end, limit as i64], |r| {
        let kinds: String = r.get(5)?;
        Ok(ReactedMessage {
            message_rowid: r.get(0)?,
            text: None,
            sent_at: None,
            contact_id: r.get(1)?,
            contact_name: r.get(2)?,
            tapbacks: r.get(3)?,
            people: r.get(4)?,
            kinds: count_kinds(&kinds),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Count a comma-separated kind list into kinds, most used first.
fn count_kinds(list: &str) -> Vec<TapbackKindCount> {
    let mut counts: Vec<TapbackKindCount> = Vec::new();
    for kind in list.split(',').filter(|k| !k.is_empty()) {
        match counts.iter_mut().find(|c| c.kind == kind) {
            Some(c) => c.received += 1,
            None => counts.push(TapbackKindCount {
                kind: kind.to_string(),
                given: 0,
                received: 1,
            }),
        }
    }
    counts.sort_by(|a, b| b.received.cmp(&a.received).then(a.kind.cmp(&b.kind)));
    counts
}

/// Snapshot directory of the current ingestion, if any.
pub fn current_snapshot_dir(conn: &Connection) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row(
            "SELECT i.snapshot_dir FROM ingestion_meta i
             JOIN app_state a ON a.curr_ingestion_id = i.id WHERE a.id = 1",
            [],
            |r| r.get(0),
        )
        .optional()?)
}

/// Fill `text` and `sent_at` from the chat snapshot.
pub fn fill_message_text(chat: &Connection, messages: &mut [ReactedMessage]) -> Result<()> {
    let rowids: Vec<i64> = messages.iter().map(|m| m.message_rowid).collect();
    let found = messages_db::db::tapbacks::messages_by_rowid(chat, &rowids)?;
    for m in messages.iter_mut() {
        if let Some(f) = found.iter().find(|f| f.id == m.message_rowid) {
            m.text = Some(f.text.clone());
            m.sent_at = Some(f.timestamp.timestamp());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (rowid, sender, is_from_me, kind, target_from_me, target_sender, reacted_at)
    type Row = (
        i64,
        Option<&'static str>,
        bool,
        &'static str,
        bool,
        Option<&'static str>,
        i64,
    );

    /// brb.db with ingestion 2 current. Ingestion 1 holds a stale row.
    fn build_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../sql/sqlite_schema.sql")).unwrap();
        conn.execute_batch(
            "INSERT INTO ingestion_meta (id, snapshot_dir, snapshot_time, ingestion_duration_secs, message_count, contact_count)
               VALUES (1, 'a', 't', 0, 0, 0), (2, 'b', 't', 0, 0, 0);
             UPDATE app_state SET curr_ingestion_id = 2 WHERE id = 1;
             INSERT INTO contacts (ingestion_id, contact_id, display_name, message_count)
               VALUES (2, '+1555', 'Sam', 10);",
        )
        .unwrap();
        let rows: &[Row] = &[
            (1, None, true, "love", false, Some("+1555"), 1_704_067_200), // 2024-01-01, given to Sam
            (2, None, true, "love", false, Some("+1555"), 1_706_745_600), // 2024-02-01
            (3, None, true, "laugh", false, Some("+1999"), 1_706_745_600), // given to Kim
            (4, Some("+1555"), false, "laugh", true, None, 1_706_745_600), // Sam on mine
            (5, Some("+1999"), false, "like", false, Some("+1555"), 1_706_745_600), // Kim on Sam's: neither
            (6, None, true, "like", true, None, 1_706_745_600),           // me on my own: neither
        ];
        for (rowid, sender, from_me, kind, target_from_me, target_sender, at) in rows {
            conn.execute(
                "INSERT INTO tapbacks (ingestion_id, message_rowid, chat_id, sender_id, is_from_me, kind,
                   target_rowid, target_from_me, target_sender_id, reacted_at)
                 VALUES (2, ?1, 1, ?2, ?3, ?4, 100, ?5, ?6, ?7)",
                params![rowid, sender, from_me, kind, target_from_me, target_sender, at],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO tapbacks (ingestion_id, message_rowid, chat_id, is_from_me, kind, target_from_me, target_sender_id, reacted_at)
             VALUES (1, 1, 1, 1, 'dislike', 0, '+1555', 0)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn summary_counts_given_and_received() {
        let conn = build_db();
        let all = summary(&conn, None, TapbackWindow::default()).unwrap();
        assert_eq!((all.given, all.received), (3, 1));
        assert_eq!(
            all.by_kind,
            vec![
                TapbackKindCount {
                    kind: "laugh".into(),
                    given: 1,
                    received: 1
                },
                TapbackKindCount {
                    kind: "love".into(),
                    given: 2,
                    received: 0
                },
            ]
        );

        let sam = summary(&conn, Some("+1555"), TapbackWindow::default()).unwrap();
        assert_eq!((sam.given, sam.received), (2, 1));
    }

    #[test]
    fn window_limits_rows() {
        let conn = build_db();
        let feb = TapbackWindow {
            start: Some(1_706_745_600),
            end: None,
        };
        let s = summary(&conn, Some("+1555"), feb).unwrap();
        assert_eq!((s.given, s.received), (1, 1));
    }

    #[test]
    fn contacts_rank_by_exchange() {
        let conn = build_db();
        let people = contacts(&conn, TapbackWindow::default(), 10).unwrap();
        assert_eq!(people.len(), 2);
        assert_eq!(people[0].contact_id, "+1555");
        assert_eq!(people[0].display_name.as_deref(), Some("Sam"));
        assert_eq!((people[0].given, people[0].received), (2, 1));
        assert_eq!(people[0].top_given_kind.as_deref(), Some("love"));
        assert_eq!(people[0].top_received_kind.as_deref(), Some("laugh"));
        assert_eq!(people[1].contact_id, "+1999");
        assert_eq!(people[1].top_received_kind, None);
    }

    #[test]
    fn most_reacted_ranks_your_messages() {
        let conn = build_db();
        // Two more Tapbacks from others on message 100 (Sam's row 4 is already there).
        conn.execute_batch(
            "INSERT INTO tapbacks (ingestion_id, message_rowid, chat_id, contact_id, sender_id, is_from_me, kind,
               target_rowid, target_from_me, reacted_at)
             VALUES (2, 20, 1, '+1555', '+1999', 0, 'love', 100, 1, 1706745600),
                    (2, 21, 1, '+1555', '+1777', 0, 'laugh', 100, 1, 1706745600),
                    (2, 22, 1, '+1555', '+1999', 0, 'emoji', 200, 1, 1706745600);
             UPDATE tapbacks SET emoji = '\u{1f602}' WHERE message_rowid = 22;",
        )
        .unwrap();
        let top = most_reacted(&conn, TapbackWindow::default(), 5).unwrap();
        assert_eq!(top[0].message_rowid, 100);
        assert_eq!((top[0].tapbacks, top[0].people), (3, 3));
        assert_eq!(top[0].kinds[0].kind, "laugh");
        assert_eq!(top[0].kinds[0].received, 2);
        assert_eq!(top[1].message_rowid, 200);
        assert_eq!(top[1].contact_name.as_deref(), Some("Sam"));

        let emojis = top_emojis(&conn, TapbackWindow::default(), 5).unwrap();
        assert_eq!(
            emojis,
            vec![TapbackEmoji {
                emoji: "\u{1f602}".into(),
                given: 0,
                received: 1
            }]
        );
    }

    #[test]
    fn fills_text_from_the_snapshot() {
        let chat = Connection::open_in_memory().unwrap();
        chat.execute_batch(
            "CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB,
               is_from_me INTEGER, date INTEGER, service TEXT);
             INSERT INTO message VALUES (100, 'see you at 6', NULL, 1, 10, 'iMessage');",
        )
        .unwrap();
        let mut messages = vec![ReactedMessage {
            message_rowid: 100,
            text: None,
            sent_at: None,
            contact_id: None,
            contact_name: None,
            tapbacks: 1,
            people: 1,
            kinds: vec![],
        }];
        fill_message_text(&chat, &mut messages).unwrap();
        assert_eq!(messages[0].text.as_deref(), Some("see you at 6"));
        assert_eq!(messages[0].sent_at, Some(10 + common::COCOA_TO_UNIX_OFFSET));
    }

    #[test]
    fn monthly_groups_by_month_and_kind() {
        let conn = build_db();
        let months = monthly(&conn, TapbackWindow::default()).unwrap();
        let summary: Vec<_> = months
            .iter()
            .map(|m| (m.period.as_str(), m.kind.as_str(), m.given, m.received))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("2024-01", "love", 1, 0),
                ("2024-02", "laugh", 1, 1),
                ("2024-02", "love", 1, 0),
            ]
        );
    }
}

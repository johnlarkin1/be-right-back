//! Contact statistics computation for pre-computed stats table.
//!
//! This module computes statistics for all contacts during ingestion,
//! storing them in SQLite for O(1) lookup instead of O(n) on-demand computation.

use std::collections::HashMap;
use std::path::Path;

use common::{BrbError, Contact, Message, Result};
use messages_db::db::queries::{ContactQueryOptions, get_messages_for_contact, list_contacts};
use messages_db::db::snapshot::open_chat_snapshot;
use serde::{Deserialize, Serialize};
use tracing::info;

/// Response time threshold - gaps > 24 hours are ignored (new conversation)
const RESPONSE_TIME_THRESHOLD_SECS: f64 = 86400.0;

/// Pre-computed statistics for a single contact.
///
/// These stats are computed once during ingestion and stored in SQLite,
/// allowing instant retrieval when users click on a contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactStats {
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub message_count: i64,
    pub messages_from_me: i64,
    pub messages_from_them: i64,
    pub date_range_start: Option<String>,
    pub date_range_end: Option<String>,
    pub avg_message_length: f64,
    pub emoji_rate: f64,
    pub top_emojis: Vec<String>,
    pub avg_response_time_secs: Option<f64>,
}

/// Per-contact stats plus the aggregated "You" stats, from one pass over the snapshot.
#[derive(Debug, Clone)]
pub struct AllContactStats {
    pub contacts: Vec<ContactStats>,
    pub you: ContactStats,
}

/// Compute per-contact stats and "You" stats in one pass over every contact.
///
/// Each contact's messages are read and decoded once and feed both results.
/// This used to be two loops that each decoded every message.
///
/// `should_stop` is checked before each contact. When it returns true, the
/// function returns `BrbError::Cancelled`.
pub fn compute_all_stats(snapshot_dir: &Path, should_stop: impl Fn() -> bool) -> Result<AllContactStats> {
    let contacts = list_contacts(snapshot_dir, ContactQueryOptions::default().skip_display_names())?;
    let total = contacts.len();
    info!("Computing stats for {} contacts", total);

    // Open the chat snapshot once and reuse for all contacts
    let conn = open_chat_snapshot(snapshot_dir)?;
    let mut results = Vec::with_capacity(total);
    let mut you = YouStats::default();

    for contact in &contacts {
        if should_stop() {
            return Err(BrbError::Cancelled("Contact stats cancelled".to_string()));
        }

        let messages = match get_messages_for_contact(&conn, &contact.id) {
            Ok(msgs) => msgs,
            Err(e) => {
                // Log but don't fail the entire ingestion for one bad contact
                tracing::warn!(
                    contact_id = %contact.id,
                    error = %e,
                    "failed to read messages for contact stats, skipping"
                );
                continue;
            }
        };

        you.add(contact, &messages);
        if let Some(stats) = single_contact_stats(contact, &messages) {
            results.push(stats);
        }
    }

    info!("Computed stats for {} contacts", results.len());
    Ok(AllContactStats {
        contacts: results,
        you: you.finish(),
    })
}

/// Compute statistics for a single contact. Returns `None` when it has no messages.
fn single_contact_stats(contact: &Contact, messages: &[Message]) -> Option<ContactStats> {
    if messages.is_empty() {
        return None;
    }

    // Basic counts
    let from_me: i64 = messages.iter().filter(|m| m.is_from_me).count() as i64;
    let from_them = messages.len() as i64 - from_me;

    // Their messages for style stats (we compute style from their messages only)
    let their_msgs: Vec<&Message> = messages.iter().filter(|m| !m.is_from_me).collect();

    // Average message length (their messages)
    let avg_len = if their_msgs.is_empty() {
        0.0
    } else {
        their_msgs.iter().map(|m| m.text.len()).sum::<usize>() as f64 / their_msgs.len() as f64
    };

    // Emoji stats (their messages)
    let (emoji_rate, top_emojis) = compute_emoji_stats(&their_msgs);

    // Response time (their responses to my messages)
    let avg_response = compute_response_time(messages);

    Some(ContactStats {
        contact_id: contact.id.clone(),
        contact_name: contact.display_name.clone(),
        message_count: messages.len() as i64,
        messages_from_me: from_me,
        messages_from_them: from_them,
        date_range_start: contact.earliest_message.map(|d| d.format("%Y-%m-%d").to_string()),
        date_range_end: contact.latest_message.map(|d| d.format("%Y-%m-%d").to_string()),
        avg_message_length: avg_len,
        emoji_rate,
        top_emojis,
        avg_response_time_secs: avg_response,
    })
}

/// The 5 most frequently used emojis, most frequent first.
fn top_emojis(counts: HashMap<char, usize>) -> Vec<String> {
    let mut emoji_vec: Vec<_> = counts.into_iter().collect();
    emoji_vec.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    emoji_vec.into_iter().take(5).map(|(c, _)| c.to_string()).collect()
}

/// Compute emoji statistics from a set of messages.
///
/// Returns (emoji_rate, top_5_emojis) where:
/// - emoji_rate is average emojis per message
/// - top_5_emojis is the 5 most frequently used emojis
fn compute_emoji_stats(messages: &[&Message]) -> (f64, Vec<String>) {
    if messages.is_empty() {
        return (0.0, Vec::new());
    }

    let mut emoji_counts: HashMap<char, usize> = HashMap::new();
    let mut total_emojis = 0;

    for m in messages {
        for c in m.text.chars() {
            if is_emoji(c) {
                *emoji_counts.entry(c).or_insert(0) += 1;
                total_emojis += 1;
            }
        }
    }

    let emoji_rate = total_emojis as f64 / messages.len() as f64;

    let top_emojis = top_emojis(emoji_counts);

    (emoji_rate, top_emojis)
}

/// Compute average response time (their response to my messages).
///
/// Only considers responses within 24 hours (gaps longer than that are
/// treated as new conversation threads, not responses).
fn compute_response_time(messages: &[Message]) -> Option<f64> {
    let mut response_times = Vec::new();

    for i in 1..messages.len() {
        let prev = &messages[i - 1];
        let curr = &messages[i];

        // Looking for: my message followed by their response
        if prev.is_from_me && !curr.is_from_me {
            let gap_secs = (curr.timestamp - prev.timestamp).num_seconds() as f64;

            // Only count reasonable response times (positive and < 24 hours)
            if gap_secs > 0.0 && gap_secs < RESPONSE_TIME_THRESHOLD_SECS {
                response_times.push(gap_secs);
            }
        }
    }

    if response_times.is_empty() {
        None
    } else {
        Some(response_times.iter().sum::<f64>() / response_times.len() as f64)
    }
}

fn is_emoji(c: char) -> bool {
    matches!(c,
        '\u{1F600}'..='\u{1F64F}' | // Emoticons
        '\u{1F300}'..='\u{1F5FF}' | // Misc Symbols and Pictographs
        '\u{1F680}'..='\u{1F6FF}' | // Transport and Map
        '\u{1F700}'..='\u{1F77F}' | // Alchemical Symbols
        '\u{1F780}'..='\u{1F7FF}' | // Geometric Shapes Extended
        '\u{1F800}'..='\u{1F8FF}' | // Supplemental Arrows-C
        '\u{1F900}'..='\u{1F9FF}' | // Supplemental Symbols and Pictographs
        '\u{1FA00}'..='\u{1FA6F}' | // Chess Symbols
        '\u{1FA70}'..='\u{1FAFF}' | // Symbols and Pictographs Extended-A
        '\u{2600}'..='\u{26FF}'   | // Misc symbols
        '\u{2700}'..='\u{27BF}'   | // Dingbats
        '\u{FE00}'..='\u{FE0F}'   | // Variation Selectors
        '\u{1F000}'..='\u{1F02F}'   // Mahjong Tiles
    )
}

/// Running totals for the "You" stats: every `is_from_me` message across all contacts.
#[derive(Default)]
struct YouStats {
    total_messages: i64,
    total_chars: usize,
    emoji_counts: HashMap<char, usize>,
    total_emojis: usize,
    earliest_date: Option<chrono::DateTime<chrono::Utc>>,
    latest_date: Option<chrono::DateTime<chrono::Utc>>,
}

impl YouStats {
    fn add(&mut self, contact: &Contact, messages: &[Message]) {
        for msg in messages.iter().filter(|m| m.is_from_me) {
            self.total_messages += 1;
            self.total_chars += msg.text.len();
            for c in msg.text.chars() {
                if is_emoji(c) {
                    *self.emoji_counts.entry(c).or_insert(0) += 1;
                    self.total_emojis += 1;
                }
            }
        }

        // Track date range across all contacts
        if let Some(date) = contact.earliest_message {
            self.earliest_date = Some(self.earliest_date.map_or(date, |e| e.min(date)));
        }
        if let Some(date) = contact.latest_message {
            self.latest_date = Some(self.latest_date.map_or(date, |l| l.max(date)));
        }
    }

    /// The aggregated "You" stats, with `contact_id = "you"`.
    fn finish(self) -> ContactStats {
        let per_message = |n: usize| {
            if self.total_messages > 0 {
                n as f64 / self.total_messages as f64
            } else {
                0.0
            }
        };
        let avg_message_length = per_message(self.total_chars);
        let emoji_rate = per_message(self.total_emojis);
        let top_emojis = top_emojis(self.emoji_counts);

        info!(
            total_messages = self.total_messages,
            avg_message_length,
            emoji_rate,
            top_emojis_count = top_emojis.len(),
            "Computed 'You' stats"
        );

        ContactStats {
            contact_id: "you".to_string(),
            contact_name: Some("You".to_string()),
            message_count: self.total_messages,
            messages_from_me: self.total_messages, // All messages are from me
            messages_from_them: 0,
            date_range_start: self.earliest_date.map(|d| d.format("%Y-%m-%d").to_string()),
            date_range_end: self.latest_date.map(|d| d.format("%Y-%m-%d").to_string()),
            avg_message_length,
            emoji_rate,
            top_emojis,
            avg_response_time_secs: None, // Not applicable for "You"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_emoji() {
        assert!(is_emoji('😊'));
        assert!(is_emoji('🎉'));
        assert!(is_emoji('❤'));
        assert!(!is_emoji('a'));
        assert!(!is_emoji('1'));
        assert!(!is_emoji(' '));
    }

    fn msg(id: i64, text: &str, is_from_me: bool, secs: i64) -> Message {
        Message {
            id,
            text: text.to_string(),
            is_from_me,
            timestamp: chrono::DateTime::from_timestamp(secs, 0).unwrap(),
            service: common::ServiceType::IMessage,
        }
    }

    fn contact(id: &str, earliest: i64, latest: i64) -> Contact {
        Contact {
            id: id.to_string(),
            display_name: None,
            message_count: 0,
            earliest_message: chrono::DateTime::from_timestamp(earliest, 0),
            latest_message: chrono::DateTime::from_timestamp(latest, 0),
        }
    }

    #[test]
    fn one_pass_fills_contact_and_you_stats() {
        let day = 86_400;
        let a = contact("+1a", day, 3 * day);
        let a_msgs = vec![msg(1, "dinner? 🍕", true, day), msg(2, "yes 😊😊", false, day + 60)];
        let b = contact("+1b", 5 * day, 9 * day);
        let b_msgs = vec![msg(3, "hi", true, 5 * day)];

        let mut you = YouStats::default();
        you.add(&a, &a_msgs);
        you.add(&b, &b_msgs);
        let you = you.finish();

        assert_eq!(you.message_count, 2, "only is_from_me messages count");
        assert_eq!(you.top_emojis, vec!["🍕".to_string()]);
        assert_eq!(you.date_range_start.as_deref(), Some("1970-01-02"));
        assert_eq!(you.date_range_end.as_deref(), Some("1970-01-10"));

        let stats = single_contact_stats(&a, &a_msgs).unwrap();
        assert_eq!((stats.messages_from_me, stats.messages_from_them), (1, 1));
        assert_eq!(
            stats.top_emojis,
            vec!["😊".to_string()],
            "style stats use their messages"
        );
        assert_eq!(stats.avg_response_time_secs, Some(60.0));
    }

    #[test]
    fn contact_without_messages_gets_no_stats_but_widens_you_dates() {
        let c = contact("+1c", 0, 86_400 * 400);
        assert!(single_contact_stats(&c, &[]).is_none());

        let mut you = YouStats::default();
        you.add(&c, &[]);
        let you = you.finish();
        assert_eq!(you.message_count, 0);
        assert_eq!(you.avg_message_length, 0.0);
        assert_eq!(you.date_range_end.as_deref(), Some("1971-02-05"));
    }
}

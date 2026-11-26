/// Message text parsing, especially for attributedBody decoding
use common::{BrbError, Contact, Message, Result, cocoa_to_unix};
use rusqlite::{Result as RusqliteResult, Row};
use unicode_normalization::UnicodeNormalization;

use super::schema::MessageRow;

/// Extract message text from a MessageRow
///
/// Messages can be stored in either the `text` field (plain text)
/// or the `attributedBody` field (NSKeyedArchive NSAttributedString).
/// This function handles both cases.
pub fn extract_message_text(row: &MessageRow) -> Result<String> {
    // First try the plain text field
    if let Some(text) = &row.text
        && !text.is_empty()
    {
        return Ok(normalize_text(text));
    }

    // If text is empty or null, try decoding attributedBody
    // The attributedBody is a binary NSKeyedArchive containing an NSAttributedString
    if let Some(attributed_body) = &row.attributed_body
        && let Some(decoded_text) = crate::utils::decode_attributed_body(attributed_body)
    {
        return Ok(normalize_text(&decoded_text));
    }

    // If both text and attributedBody are empty/null, return empty string
    Ok(String::new())
}

/// Normalize text for consistent handling of Unicode and emoji
fn normalize_text(text: &str) -> String {
    // Use NFC normalization (canonical composition)
    text.nfc().collect()
}

pub fn row_to_contact(row: &Row<'_>) -> RusqliteResult<Contact> {
    let id: String = row.get(0)?;
    let count: i64 = row.get(1)?;

    // Get the timestamps (can be in seconds OR nanoseconds depending on macOS version)
    let earliest_cocoa: RusqliteResult<i64> = row.get(2);
    let latest_cocoa: RusqliteResult<i64> = row.get(3);

    let earliest_message = earliest_cocoa
        .ok()
        .and_then(|ts| cocoa_timestamp_to_datetime(cocoa_to_unix(ts)).ok());

    let latest_message = latest_cocoa
        .ok()
        .and_then(|ts| cocoa_timestamp_to_datetime(cocoa_to_unix(ts)).ok());

    Ok(Contact {
        id,
        display_name: None,
        message_count: count as usize,
        earliest_message,
        latest_message,
    })
}

pub fn message_row_to_message(row: MessageRow) -> Result<Message> {
    let text = extract_message_text(&row)?;
    if text.is_empty() {
        return Err(BrbError::InvalidData("Empty message text".to_string()));
    }

    let timestamp = cocoa_timestamp_to_datetime(row.to_unix_timestamp())?;

    Ok(Message {
        id: row.rowid,
        text,
        is_from_me: row.is_from_me,
        timestamp,
        service: row.parse_service(),
    })
}

/// Convert Unix timestamp to DateTime<Utc>
fn cocoa_timestamp_to_datetime(unix_timestamp: i64) -> Result<chrono::DateTime<chrono::Utc>> {
    use chrono::TimeZone;
    chrono::Utc
        .timestamp_opt(unix_timestamp, 0)
        .single()
        .ok_or_else(|| BrbError::InvalidData(format!("Invalid timestamp: {}", unix_timestamp)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_text() {
        let text = "Hello 👋 World";
        let normalized = normalize_text(text);
        assert_eq!(normalized, "Hello 👋 World");
    }
}

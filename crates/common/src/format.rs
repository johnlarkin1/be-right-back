//! Formatting utilities.

use chrono::{DateTime, Utc};

/// Format a byte count as a human-readable string (e.g., "1.5 GB", "340.2 MB").
pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * 1024;
    const GB: u64 = 1024 * 1024 * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Convert a timestamp to a human-readable relative time string.
pub fn relative_time(timestamp: DateTime<Utc>) -> String {
    relative_time_with_now(timestamp, Utc::now())
}

/// [`relative_time`] against a caller-supplied instant.
///
/// The retrieval eval pins every clock a search reads so a fixture with fixed
/// timestamps keeps producing the same output tomorrow; a wall clock here would
/// leak the current date into formatted results.
pub fn relative_time_with_now(timestamp: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let days = now.signed_duration_since(timestamp).num_days();
    match days {
        0 => "today".into(),
        1 => "yesterday".into(),
        2..=6 => format!("{days} days ago"),
        7..=29 => {
            let w = days / 7;
            format!("{w} week{} ago", if w == 1 { "" } else { "s" })
        }
        30..=364 => {
            let m = days / 30;
            format!("{m} month{} ago", if m == 1 { "" } else { "s" })
        }
        _ => {
            let y = days / 365;
            format!("{y} year{} ago", if y == 1 { "" } else { "s" })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1_048_576), "1.0 MB");
        assert_eq!(format_bytes(1_073_741_824), "1.0 GB");
        assert_eq!(format_bytes(1_500_000_000), "1.4 GB");
    }

    #[test]
    fn test_relative_time() {
        // Test "today"
        let now = Utc::now();
        assert_eq!(relative_time(now), "today");

        // Test "yesterday"
        let yesterday = now - chrono::Duration::days(1);
        assert_eq!(relative_time(yesterday), "yesterday");

        // Test weeks
        let two_weeks = now - chrono::Duration::days(14);
        assert_eq!(relative_time(two_weeks), "2 weeks ago");

        // Test months
        let three_months = now - chrono::Duration::days(90);
        assert_eq!(relative_time(three_months), "3 months ago");

        // Test years
        let two_years = now - chrono::Duration::days(730);
        assert_eq!(relative_time(two_years), "2 years ago");
    }
}

//! Apple Cocoa timestamp conversion utilities.
//!
//! Apple stores iMessage timestamps in two formats depending on macOS version:
//! - Nanoseconds since 2001-01-01 (newer macOS, values > 2_000_000_000)
//! - Seconds since 2001-01-01 (older macOS, values <= 2_000_000_000)

use crate::COCOA_TO_UNIX_OFFSET;

/// Normalize an Apple Cocoa timestamp to seconds.
///
/// Detects whether the timestamp is in nanoseconds (> 2 billion) or seconds
/// and converts nanoseconds to seconds if needed.
pub fn normalize_cocoa_timestamp(ts: i64) -> i64 {
    if ts > 2_000_000_000 { ts / 1_000_000_000 } else { ts }
}

/// Convert an Apple Cocoa timestamp to a Unix timestamp (seconds since 1970-01-01).
pub fn cocoa_to_unix(cocoa_ts: i64) -> i64 {
    normalize_cocoa_timestamp(cocoa_ts) + COCOA_TO_UNIX_OFFSET
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_seconds() {
        // Already in seconds (value <= 2 billion)
        assert_eq!(normalize_cocoa_timestamp(700_000_000), 700_000_000);
    }

    #[test]
    fn test_normalize_nanoseconds() {
        // In nanoseconds (value > 2 billion)
        assert_eq!(normalize_cocoa_timestamp(700_000_000_000_000_000), 700_000_000);
    }

    #[test]
    fn test_cocoa_to_unix() {
        // 2001-01-01 00:00:00 UTC in Cocoa = 0, in Unix = 978307200
        assert_eq!(cocoa_to_unix(0), COCOA_TO_UNIX_OFFSET);
    }
}

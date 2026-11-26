/// Date and time utilities
use chrono::{DateTime, Utc};
use common::{BrbError, Result};

/// Parse a date string in YYYY-MM-DD format to a DateTime<Utc>
///
/// The time is set to 00:00:00 UTC
///
/// # Example
/// ```
/// use messages_db::utils::date::parse_date;
/// let dt = parse_date("2024-01-15").unwrap();
/// ```
pub fn parse_date(date_str: &str) -> Result<DateTime<Utc>> {
    let naive_date = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|e| {
        BrbError::DateTimeParse(format!(
            "Invalid date format '{}': {}. Expected YYYY-MM-DD",
            date_str, e
        ))
    })?;

    let naive_datetime = naive_date
        .and_hms_opt(0, 0, 0)
        .ok_or_else(|| BrbError::DateTimeParse("Failed to create datetime from date".to_string()))?;

    Ok(DateTime::<Utc>::from_naive_utc_and_offset(naive_datetime, Utc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_date_valid() {
        let dt = parse_date("2024-01-15").unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-15");
        assert_eq!(dt.format("%H:%M:%S").to_string(), "00:00:00");
    }

    #[test]
    fn test_parse_date_invalid_format() {
        assert!(parse_date("01/15/2024").is_err());
        assert!(parse_date("15-01-2024").is_err());
        assert!(parse_date("not-a-date").is_err());
        assert!(parse_date("2024-13-01").is_err()); // Invalid month
        assert!(parse_date("2024-01-32").is_err()); // Invalid day
    }
}

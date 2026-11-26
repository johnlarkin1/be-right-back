//! Get message volume by period tool for Casper agent.
//!
//! Queries the `daily_activity` table in DuckDB to find which contacts
//! the user messaged most during a specific date range.

use serde_json::Value;
use tracing::{debug, warn};

use super::{is_phone_number, load_contact_names};
use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::VectorDb;

/// Tool for getting message volume per contact within a date range.
///
/// Perfect for answering questions like "who did I talk to most in college?"
/// or "who was I closest to in 2023?". Queries the pre-computed `daily_activity`
/// table in DuckDB which has per-date, per-contact message counts.
pub struct GetMessageVolumeTool;

impl Tool for GetMessageVolumeTool {
    fn name(&self) -> &'static str {
        "get_message_volume_by_period"
    }

    fn description(&self) -> &'static str {
        "Get message counts per contact within a date range. Use this to find who the user talked to most during a specific time period (e.g., college years, 2023, last summer)."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "min_date": {
                    "type": "string",
                    "description": "Start date in YYYY-MM-DD format (inclusive)"
                },
                "max_date": {
                    "type": "string",
                    "description": "End date in YYYY-MM-DD format (inclusive)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of contacts to return (default: 10)"
                }
            },
            "required": ["min_date", "max_date"]
        })
    }

    fn execute(&self, args: Value) -> Result<ToolResult> {
        let min_date = match args.get("min_date").and_then(|v| v.as_str()) {
            Some(d) => d,
            None => return Ok(ToolResult::error("min_date is required (YYYY-MM-DD)")),
        };

        let max_date = match args.get("max_date").and_then(|v| v.as_str()) {
            Some(d) => d,
            None => return Ok(ToolResult::error("max_date is required (YYYY-MM-DD)")),
        };

        let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(10).clamp(1, 100) as usize;

        // Validate date format
        let parsed_min = match chrono::NaiveDate::parse_from_str(min_date, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => {
                return Ok(ToolResult::error(format!(
                    "Invalid min_date format: '{}'. Use YYYY-MM-DD.",
                    min_date
                )));
            }
        };
        let parsed_max = match chrono::NaiveDate::parse_from_str(max_date, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => {
                return Ok(ToolResult::error(format!(
                    "Invalid max_date format: '{}'. Use YYYY-MM-DD.",
                    max_date
                )));
            }
        };
        if parsed_min > parsed_max {
            return Ok(ToolResult::error(format!(
                "min_date ({}) must be before or equal to max_date ({})",
                min_date, max_date
            )));
        }

        debug!(
            min_date = min_date,
            max_date = max_date,
            limit = limit,
            "Executing get_message_volume_by_period"
        );

        // Open DuckDB (read-only) at the canonical path.
        let db = match VectorDb::open_readonly() {
            Ok(db) => db,
            Err(e) => return Ok(ToolResult::error(format!("Failed to open vector database: {}", e))),
        };
        let conn = db.connection();

        // Over-fetch to compensate for unresolved phone numbers that get filtered out
        let fetch_limit = limit * 3;

        // Query daily_activity for top contacts by message volume in the date range.
        // CAST the sums to BIGINT: DuckDB widens SUM() of an integer column to HUGEINT
        // (i128), which fails `row.get::<_, i64>()` for *every* row — silently dropping
        // them all and returning a false "no activity" result. Total volume is well
        // within i64, so BIGINT is safe and lets the i64 reads below succeed.
        let mut stmt = match conn.prepare(
            "SELECT contact_id,
                    CAST(SUM(message_count) AS BIGINT)  as total,
                    CAST(SUM(sent_count) AS BIGINT)     as sent,
                    CAST(SUM(received_count) AS BIGINT) as received
             FROM daily_activity
             WHERE date >= CAST(?1 AS DATE) AND date <= CAST(?2 AS DATE)
             GROUP BY contact_id
             ORDER BY total DESC
             LIMIT ?3",
        ) {
            Ok(s) => s,
            Err(e) => return Ok(ToolResult::error(format!("Query preparation failed: {}", e))),
        };

        let rows = match stmt.query_map(duckdb::params![min_date, max_date, fetch_limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        }) {
            Ok(r) => r,
            Err(e) => return Ok(ToolResult::error(format!("Query failed: {}", e))),
        };

        // Load contact names for display
        let contact_names = load_contact_names();

        let mut results: Vec<Value> = Vec::new();
        let mut row_errors = 0usize;
        for row in rows {
            // Don't silently swallow per-row decode errors: a type mismatch here is
            // how the HUGEINT bug masqueraded as "no activity". Surface it instead.
            let (contact_id, total, sent, received) = match row {
                Ok(r) => r,
                Err(e) => {
                    row_errors += 1;
                    if row_errors == 1 {
                        warn!(error = %e, "get_message_volume_by_period: failed to decode a row");
                    }
                    continue;
                }
            };

            // Resolve display name
            let display_name = contact_names
                .get(&contact_id)
                .cloned()
                .unwrap_or_else(|| contact_id.clone());

            // Skip unresolved phone numbers
            if is_phone_number(&display_name) {
                continue;
            }

            results.push(serde_json::json!({
                "contact_id": contact_id,
                "contact_name": display_name,
                "total_messages": total,
                "sent": sent,
                "received": received,
            }));

            if results.len() >= limit {
                break;
            }
        }

        if results.is_empty() {
            return Ok(ToolResult::success(serde_json::json!({
                "period": { "start": min_date, "end": max_date },
                "contacts": [],
                "count": 0,
                "note": "No message activity found in this date range. Try a wider range or check if ingestion has been run."
            })));
        }

        let count = results.len();
        Ok(ToolResult::success(serde_json::json!({
            "period": { "start": min_date, "end": max_date },
            "contacts": results,
            "count": count
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = GetMessageVolumeTool;
        assert_eq!(tool.name(), "get_message_volume_by_period");
        assert!(tool.description().contains("message counts"));
        let params = tool.parameters();
        let required = params["required"].as_array().unwrap();
        assert!(required.contains(&Value::String("min_date".to_string())));
        assert!(required.contains(&Value::String("max_date".to_string())));
    }

    #[test]
    fn test_invalid_dates() {
        let tool = GetMessageVolumeTool;

        // Invalid min_date
        let result = tool
            .execute(serde_json::json!({"min_date": "not-a-date", "max_date": "2023-12-31"}))
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("Invalid min_date"));

        // Invalid max_date
        let result = tool
            .execute(serde_json::json!({"min_date": "2023-01-01", "max_date": "bad"}))
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("Invalid max_date"));
    }

    #[test]
    fn test_reversed_dates() {
        let tool = GetMessageVolumeTool;
        let result = tool
            .execute(serde_json::json!({"min_date": "2024-01-01", "max_date": "2023-01-01"}))
            .unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("must be before"));
    }

    #[test]
    fn test_missing_dates() {
        let tool = GetMessageVolumeTool;

        // Missing min_date
        let result = tool.execute(serde_json::json!({"max_date": "2023-12-31"})).unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("min_date is required"));

        // Missing max_date
        let result = tool.execute(serde_json::json!({"min_date": "2023-01-01"})).unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("max_date is required"));
    }
}

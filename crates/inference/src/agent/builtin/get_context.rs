//! Get conversation context tool for Casper agent.

use chrono::NaiveDate;
use serde_json::Value;
use tracing::debug;

use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use messages_db::db::{get_latest_snapshot, open_chat_snapshot, queries};

/// Tool for getting conversation context around a specific time or position.
///
/// This tool retrieves a window of messages from a conversation,
/// useful for exploring the context around search results or specific dates.
pub struct GetConversationContextTool;

impl GetConversationContextTool {
    /// Format a message for display.
    fn format_message(msg: &common::Message) -> Value {
        serde_json::json!({
            "id": msg.id,
            "text": msg.text,
            "is_from_me": msg.is_from_me,
            "timestamp": msg.timestamp.to_rfc3339(),
            "date": msg.timestamp.format("%Y-%m-%d %H:%M").to_string()
        })
    }
}

impl Tool for GetConversationContextTool {
    fn name(&self) -> &'static str {
        "get_conversation_context"
    }

    fn description(&self) -> &'static str {
        "Get messages from a conversation around a specific date or position. Useful for exploring context around search results."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The contact ID. Use the id value from the [CONTEXT] block (e.g., +15551234567) or from list_contacts results. Do NOT use display names."
                },
                "around_date": {
                    "type": "string",
                    "description": "Date to get messages around (YYYY-MM-DD format). If not provided, returns most recent messages."
                },
                "message_count": {
                    "type": "integer",
                    "description": "Number of messages to retrieve (default: 20, max: 100)"
                }
            },
            "required": ["contact_id"]
        })
    }

    fn execute(&self, args: Value) -> Result<ToolResult> {
        let raw_contact_id = match args.get("contact_id").and_then(|v| v.as_str()) {
            Some(id) => id,
            None => return Ok(ToolResult::error("contact_id is required")),
        };
        // Resolve display names to actual contact IDs (phone/email)
        let resolved = super::resolve_contact_id(raw_contact_id);
        let contact_id = resolved.as_str();

        let around_date = args.get("around_date").and_then(|v| v.as_str());
        let message_count = args
            .get("message_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(20)
            .min(100) as usize;

        debug!(
            contact_id = contact_id,
            around_date = ?around_date,
            message_count = message_count,
            "Executing get_conversation_context"
        );

        // Get the latest snapshot
        let snapshot_path = match get_latest_snapshot() {
            Ok(Some(path)) => path,
            Ok(None) => {
                return Ok(ToolResult::error(
                    "No message database snapshot found. Please run ingestion first.",
                ));
            }
            Err(e) => return Ok(ToolResult::error(format!("Failed to get snapshot: {}", e))),
        };

        // Open the database
        let conn = match open_chat_snapshot(&snapshot_path) {
            Ok(c) => c,
            Err(e) => return Ok(ToolResult::error(format!("Failed to open database: {}", e))),
        };

        // Fetch the right window directly from the DB:
        //   - around_date given -> the messages closest in time to that date
        //   - otherwise         -> the most RECENT messages
        // Both come back in chronological (oldest-first) order. This previously
        // fetched a fixed prefix of the conversation (the OLDEST messages, since
        // the paginated query orders ascending) and treated it as "recent", so
        // high-volume contacts always reported their earliest history instead of
        // recent activity.
        let filtered_messages: Vec<common::Message> = if let Some(date_str) = around_date {
            // Anchor the target at noon UTC so "nearest by date" is symmetric.
            let target_date = match NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
                Ok(d) => d,
                Err(_) => {
                    return Ok(ToolResult::error(format!(
                        "Invalid date format: {}. Use YYYY-MM-DD.",
                        date_str
                    )));
                }
            };
            let target_unix_secs = target_date.and_hms_opt(12, 0, 0).unwrap().and_utc().timestamp();

            match queries::get_messages_for_contact_around_date(&conn, contact_id, target_unix_secs, message_count) {
                Ok(msgs) => msgs,
                Err(e) => return Ok(ToolResult::error(format!("Failed to fetch messages: {}", e))),
            }
        } else {
            match queries::get_recent_messages_for_contact(&conn, contact_id, message_count) {
                Ok(msgs) => msgs,
                Err(e) => return Ok(ToolResult::error(format!("Failed to fetch messages: {}", e))),
            }
        };

        if filtered_messages.is_empty() {
            return Ok(ToolResult::success(serde_json::json!({
                "contact_id": contact_id,
                "messages": [],
                "count": 0,
                "note": "No messages found for this contact"
            })));
        }

        // Format response
        let messages_json: Vec<Value> = filtered_messages.iter().map(Self::format_message).collect();

        let date_range = if !filtered_messages.is_empty() {
            Some(serde_json::json!({
                "start": filtered_messages.first().unwrap().timestamp.format("%Y-%m-%d").to_string(),
                "end": filtered_messages.last().unwrap().timestamp.format("%Y-%m-%d").to_string()
            }))
        } else {
            None
        };

        Ok(ToolResult::success(serde_json::json!({
            "contact_id": contact_id,
            "messages": messages_json,
            "count": filtered_messages.len(),
            "date_range": date_range,
            "around_date": around_date
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = GetConversationContextTool;
        assert_eq!(tool.name(), "get_conversation_context");
        assert!(tool.description().contains("context"));
        assert!(
            tool.parameters()["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String("contact_id".to_string()))
        );
    }
}

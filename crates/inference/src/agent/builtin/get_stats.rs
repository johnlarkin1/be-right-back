//! Get contact statistics tool for Casper agent.

use serde_json::Value;
use tracing::debug;

use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::MetadataDb;

/// Tool for getting detailed statistics about a contact's conversation.
///
/// Returns message counts, date ranges, average message length,
/// emoji usage, and response times.
pub struct GetContactStatsTool;

impl Tool for GetContactStatsTool {
    fn name(&self) -> &'static str {
        "get_contact_stats"
    }

    fn description(&self) -> &'static str {
        "Get detailed statistics about a conversation with a contact, including message counts, date ranges, and messaging patterns."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The contact ID. Use the id value from the [CONTEXT] block (e.g., +15551234567) or from list_contacts results. Do NOT use display names."
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

        debug!(contact_id = contact_id, "Executing get_contact_stats");

        // Open metadata database at the canonical path.
        let db = match MetadataDb::open() {
            Ok(db) => db,
            Err(e) => return Ok(ToolResult::error(format!("Failed to open database: {}", e))),
        };

        // Get stats for the contact
        let stats = match db.get_contact_stats(contact_id) {
            Ok(Some(s)) => s,
            Ok(None) => {
                return Ok(ToolResult::error(format!(
                    "No statistics found for contact: {}",
                    contact_id
                )));
            }
            Err(e) => return Ok(ToolResult::error(format!("Failed to fetch stats: {}", e))),
        };

        // Format response
        Ok(ToolResult::success(serde_json::json!({
            "contact_id": stats.contact_id,
            "contact_name": stats.contact_name,
            "total_messages": stats.message_count,
            "messages_from_you": stats.messages_from_me,
            "messages_from_them": stats.messages_from_them,
            "date_range": {
                "start": stats.date_range_start,
                "end": stats.date_range_end
            },
            "average_message_length": stats.avg_message_length,
            "emoji_rate": stats.emoji_rate,
            "top_emojis": stats.top_emojis,
            "average_response_time_seconds": stats.avg_response_time_secs
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = GetContactStatsTool;
        assert_eq!(tool.name(), "get_contact_stats");
        assert!(tool.description().contains("statistics"));
        assert!(
            tool.parameters()["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String("contact_id".to_string()))
        );
    }
}

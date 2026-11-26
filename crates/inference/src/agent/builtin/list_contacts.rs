//! List contacts tool for Casper agent.

use serde_json::Value;
use tracing::debug;

use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::MetadataDb;

/// Tool for listing contacts with their message counts.
///
/// This tool queries the metadata database for all contacts
/// and returns them with optional filtering by name or message count.
pub struct ListContactsTool;

impl Tool for ListContactsTool {
    fn name(&self) -> &'static str {
        "list_contacts"
    }

    fn description(&self) -> &'static str {
        "List all contacts with their message counts. Can optionally filter by name."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "search": {
                    "type": "string",
                    "description": "Optional name filter (case-insensitive partial match)"
                },
                "min_messages": {
                    "type": "integer",
                    "description": "Minimum message count (default: 1)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 20)"
                }
            },
            "required": []
        })
    }

    fn execute(&self, args: Value) -> Result<ToolResult> {
        let search = args.get("search").and_then(|v| v.as_str());
        let min_messages = args.get("min_messages").and_then(|v| v.as_i64()).unwrap_or(1);
        let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20) as usize;

        debug!(
            search = ?search,
            min_messages = min_messages,
            limit = limit,
            "Executing list_contacts"
        );

        // Open metadata database at the canonical path.
        let db = match MetadataDb::open() {
            Ok(db) => db,
            Err(e) => return Ok(ToolResult::error(format!("Failed to open database: {}", e))),
        };

        // Get all contacts
        let contacts = match db.get_all_contacts() {
            Ok(c) => c,
            Err(e) => return Ok(ToolResult::error(format!("Failed to fetch contacts: {}", e))),
        };

        // Filter by min_messages
        let filtered: Vec<_> = contacts
            .into_iter()
            .filter(|c| c.message_count >= min_messages)
            .filter(|c| {
                // Apply search filter if provided
                if let Some(query) = search {
                    let query_lower = query.to_lowercase();
                    c.display_name
                        .as_ref()
                        .map(|n| n.to_lowercase().contains(&query_lower))
                        .unwrap_or(false)
                        || c.contact_id.to_lowercase().contains(&query_lower)
                } else {
                    true
                }
            })
            .take(limit)
            .collect();

        // Handle empty results with a helpful note
        if filtered.is_empty() {
            return Ok(ToolResult::success(serde_json::json!({
                "contacts": [],
                "count": 0,
                "search": search,
                "min_messages": min_messages,
                "note": "No contacts found. The database may need to be ingested first, or try adjusting the search criteria."
            })));
        }

        // Format response
        let contacts_json: Vec<Value> = filtered
            .iter()
            .map(|c| {
                serde_json::json!({
                    "contact_id": c.contact_id,
                    "name": c.display_name.as_deref().unwrap_or(&c.contact_id),
                    "message_count": c.message_count,
                    "earliest_message": c.earliest_message,
                    "latest_message": c.latest_message
                })
            })
            .collect();

        Ok(ToolResult::success(serde_json::json!({
            "contacts": contacts_json,
            "count": filtered.len(),
            "search": search,
            "min_messages": min_messages
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = ListContactsTool;
        assert_eq!(tool.name(), "list_contacts");
        assert!(tool.description().contains("contacts"));
        assert!(tool.parameters()["properties"]["search"].is_object());
    }
}

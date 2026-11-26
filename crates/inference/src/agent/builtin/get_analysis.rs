//! Get conversation analysis tool for Casper agent.

use serde_json::Value;
use tracing::{debug, warn};

use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::MetadataDb;

/// Character cap on the analysis markdown handed to the model.
///
/// Live analyses run 2,520 / 3,567 / 10,253 chars (min/median/max), so this passes
/// the large majority through untouched while bounding the worst case.
const MAX_ANALYSIS_CHARS: usize = 6000;

/// Tool for retrieving pre-computed conversation analysis for a contact.
///
/// Returns a detailed markdown summary covering communication patterns,
/// relationship dynamics, and conversation topics. The analysis is generated
/// during ingestion by the LLM.
pub struct GetConversationAnalysisTool;

impl Tool for GetConversationAnalysisTool {
    fn name(&self) -> &'static str {
        "get_conversation_analysis"
    }

    fn description(&self) -> &'static str {
        "Get a pre-computed analysis of your conversation style and relationship with a contact. Returns a detailed markdown summary covering communication patterns, topics, and dynamics."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The contact ID (phone number or email) to get the analysis for. Do NOT use display names — call list_contacts to get the ID."
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

        debug!(contact_id = contact_id, "Executing get_conversation_analysis");

        // Open metadata database at the canonical path.
        let db = match MetadataDb::open() {
            Ok(db) => db,
            Err(e) => return Ok(ToolResult::error(format!("Failed to open database: {}", e))),
        };

        // Get the conversation analysis for the contact
        match db.get_conversation_analysis(contact_id) {
            Ok(Some(analysis)) => {
                // Analyses run to 10k+ chars. The full markdown goes into the model's
                // context verbatim (mod.rs feeds tool data straight back), so two calls
                // in one turn would spend ~20k chars of budget on one tool.
                let full_len = analysis.analysis_markdown.len();
                let markdown = crate::agent::truncate(analysis.analysis_markdown, MAX_ANALYSIS_CHARS);
                let truncated = full_len > markdown.len();
                if truncated {
                    debug!(
                        contact_id = contact_id,
                        full_len, "get_conversation_analysis: truncated analysis for context budget"
                    );
                }
                Ok(ToolResult::success(serde_json::json!({
                    "contact_id": analysis.contact_id,
                    "analysis": markdown,
                    "truncated": truncated,
                    "model": analysis.model_id,
                    "created_at": analysis.created_at
                })))
            }
            // "This contact has no analysis" is a fact, not a failure. Returning it as an
            // error dead-ends the agent loop: the model reads the error as transient and
            // retries, the duplicate-call guard fires, and because the record is
            // unsuccessful the forced answer becomes the hardcoded "I encountered an
            // error while searching" — and `synthesize_from_tool_results` skips
            // unsuccessful records too, so the fallback can't rescue it either. Only 15
            // contacts have analyses, so every other contact hit that dead end while
            // search_messages would have answered fine.
            Ok(None) => Ok(ToolResult::success(serde_json::json!({
                "contact_id": contact_id,
                "available": false,
                "note": "No pre-computed analysis exists for this contact. Use search_messages \
                         and get_contact_stats to answer from raw messages instead — do not \
                         retry this tool for this contact."
            }))),
            Err(e) => {
                warn!(contact_id = contact_id, error = %e, "get_conversation_analysis: query failed");
                Ok(ToolResult::error(format!("Failed to fetch analysis: {}", e)))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = GetConversationAnalysisTool;
        assert_eq!(tool.name(), "get_conversation_analysis");
        assert!(tool.description().contains("analysis"));
        assert!(
            tool.parameters()["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String("contact_id".to_string()))
        );
    }

    #[test]
    fn test_missing_contact_id() {
        let tool = GetConversationAnalysisTool;
        let args = serde_json::json!({});
        let result = tool.execute(args).unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("contact_id is required"));
    }
}

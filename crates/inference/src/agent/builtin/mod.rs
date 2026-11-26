//! Built-in tools for the Casper agent.
//!
//! This module provides the default tools available to Casper:
//!
//! - [`ListContactsTool`]: List contacts with message counts
//! - [`SearchMessagesTool`]: Semantic search over messages (Phase 3)
//! - [`GetConversationContextTool`]: Get messages around a point in time
//! - [`GetContactStatsTool`]: Get conversation statistics
//! - [`GetMessageVolumeTool`]: Message volume per contact in a date range
//! - [`GetConversationAnalysisTool`]: Pre-computed conversation analysis
//! - [`GetTopicClustersTool`]: Topic clusters from Leiden analysis

pub mod get_analysis;
pub mod get_context;
pub mod get_stats;
pub mod get_topics;
pub mod get_volume;
pub mod list_contacts;
pub mod search_messages;

pub use get_analysis::GetConversationAnalysisTool;
pub use get_context::GetConversationContextTool;
pub use get_stats::GetContactStatsTool;
pub use get_topics::GetTopicClustersTool;
pub use get_volume::GetMessageVolumeTool;
pub use list_contacts::ListContactsTool;
pub use search_messages::{RankedSearch, SearchMessagesTool};

use std::collections::HashMap;

use tracing::{debug, warn};

/// Load all contact names from brb.db into a HashMap for batch lookups.
pub(crate) fn load_contact_names() -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(brb_db) = common::get_brb_sqlite_db()
        && let Ok(conn) = rusqlite::Connection::open(&brb_db)
    {
        let mut stmt = match conn.prepare("SELECT contact_id, display_name FROM contacts") {
            Ok(s) => s,
            Err(_) => return map,
        };
        let rows = match stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        }) {
            Ok(r) => r,
            Err(_) => return map,
        };
        for row in rows.flatten() {
            if let (id, Some(name)) = row
                && !name.is_empty()
            {
                map.insert(id, name);
            }
        }
    }
    map
}

/// Check if a string looks like a phone number (unresolved contact).
pub(crate) fn is_phone_number(name: &str) -> bool {
    !name.is_empty()
        && (name.starts_with('+')
            || name
                .chars()
                .all(|c| c.is_ascii_digit() || c == '+' || c == '-' || c == ' ' || c == '(' || c == ')'))
}

/// Resolve a display name to a contact_id (phone/email) by looking up brb.db.
///
/// The LLM thinks in terms of names, but the database uses phone numbers/emails
/// as contact identifiers. This function bridges the gap with a case-insensitive
/// partial match against the contacts table.
///
/// Returns the original value if it already looks like a phone number or email.
pub(crate) fn resolve_contact_id(raw_id: &str) -> String {
    // If it already looks like a phone/email, use as-is
    if raw_id.starts_with('+')
        || raw_id.contains('@')
        || (!raw_id.is_empty()
            && raw_id
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == ' ' || c == '(' || c == ')'))
    {
        debug!(
            contact_id = raw_id,
            "Contact ID already looks like phone/email, using as-is"
        );
        return raw_id.to_string();
    }

    // Otherwise, try to resolve the display name to a contact_id
    match resolve_name_to_contact_id(raw_id) {
        Some(id) => {
            debug!(display_name = raw_id, resolved_id = %id, "Resolved display name → contact_id");
            id
        }
        None => {
            warn!(
                display_name = raw_id,
                "Failed to resolve display name to contact_id, using raw value"
            );
            raw_id.to_string()
        }
    }
}

/// Look up a display name in brb.db and return the matching contact_id.
///
/// Uses a multi-strategy approach for robustness:
/// 1. Exact match on display_name (case-insensitive)
/// 2. Prefix match (e.g., "Riley" matches "Riley Chen")
/// 3. Contains match (e.g., "Chen" matches "Riley Chen")
/// 4. Fallback: search contact_name column in DuckDB message_chunks
fn resolve_name_to_contact_id(name: &str) -> Option<String> {
    let brb_db = common::get_brb_sqlite_db().ok()?;
    let conn = rusqlite::Connection::open(&brb_db).ok()?;

    // Strip emoji and extra whitespace for fuzzy matching
    let clean_name: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    debug!(raw_name = name, clean_name = %clean_name, "Resolving display name to contact_id");

    // Strategy 1: Exact match (case-insensitive)
    let result: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM contacts WHERE LOWER(display_name) = LOWER(?1) LIMIT 1",
            [&clean_name],
            |row| row.get(0),
        )
        .ok();

    if let Some(ref id) = result {
        debug!(display_name = name, contact_id = %id, strategy = "exact", "Resolved display name to contact_id");
        return result;
    }

    // Strategy 2: Prefix match (e.g., "Riley" matches "Riley Chen")
    let result: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM contacts WHERE display_name LIKE ?1 LIMIT 1",
            [format!("{}%", clean_name)],
            |row| row.get(0),
        )
        .ok();

    if let Some(ref id) = result {
        debug!(display_name = name, contact_id = %id, strategy = "prefix", "Resolved display name to contact_id");
        return result;
    }

    // Strategy 3: Contains match (e.g., "Chen" matches "Riley Chen")
    let result: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM contacts WHERE display_name LIKE ?1 LIMIT 1",
            [format!("%{}%", clean_name)],
            |row| row.get(0),
        )
        .ok();

    if let Some(ref id) = result {
        debug!(display_name = name, contact_id = %id, strategy = "contains", "Resolved display name to contact_id");
        return result;
    }

    // Strategy 4: Fallback — search contact_name column in DuckDB message_chunks
    if let Some(id) = resolve_name_from_duckdb(&clean_name) {
        debug!(display_name = name, contact_id = %id, strategy = "duckdb_fallback", "Resolved display name via DuckDB");
        return Some(id);
    }

    warn!("Could not resolve display name to contact_id in any database");
    debug!(display_name = name, clean_name = %clean_name, "Unresolved display name");
    None
}

/// Fallback: search DuckDB message_chunks for a matching contact_name.
fn resolve_name_from_duckdb(name: &str) -> Option<String> {
    let db = ingestion::VectorDb::open_readonly().ok()?;
    let conn = db.connection();

    let pattern = format!("%{}%", name);
    let result: Option<String> = conn
        .query_row(
            "SELECT contact_id FROM message_chunks WHERE LOWER(contact_name) LIKE LOWER(?1) LIMIT 1",
            [&pattern],
            |row| row.get(0),
        )
        .ok();

    result
}

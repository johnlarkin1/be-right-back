//! Contact listing commands.
//!
//! Provides Tauri commands for:
//! - Listing all contacts with their training status
//! - Getting detailed statistics for a single contact
//! - Getting statistics for the "You" persona

use std::path::Path;

use ingestion::{MetadataDb, StoredContact};
use messages_db::db::{
    queries::{list_contacts, ContactQueryOptions},
    snapshot::get_latest_snapshot,
};
use personas::registry::PersonaRegistry;
use tracing::{debug, info};

use super::types::{ContactDetailStats, ContactWithStatus, YouStats};

const YOU_TOP_CONTACTS: usize = 20;
const MIN_MESSAGES_THRESHOLD: usize = common::SELF_TRAINING_MIN_MESSAGES;

/// Pre-warm the contacts cache in the background.
///
/// Called on app startup to populate the cache before the user navigates to contacts.
/// Returns the number of contacts loaded, or an error if no snapshot exists.
pub async fn prewarm_contacts_cache(app: tauri::AppHandle) -> Result<usize, String> {
    use tauri::Manager;

    let state = app.state::<crate::AppState>();
    let snapshot_dir = get_latest_snapshot()
        .map_err(|e| format!("Failed to check for snapshot: {}", e))?
        .ok_or_else(|| "No snapshot exists yet".to_string())?;

    // Check if cache is already valid
    {
        let cache = state.contacts_cache.read().await;
        if cache.is_valid_for(&snapshot_dir) {
            return Ok(cache.contacts.len());
        }
    }

    // Build the cache (same logic as get_all_contacts)
    let result = build_contacts_cache(&snapshot_dir).await?;
    let count = result.len();

    // Store in cache
    {
        let mut cache = state.contacts_cache.write().await;
        cache.snapshot_dir = Some(snapshot_dir);
        cache.contacts = result;
    }

    Ok(count)
}

/// Build the contacts list (shared logic between get_all_contacts and prewarm)
///
/// This is the FAST path: reads pre-computed contacts from brb.db (SQLite).
/// Display names were resolved during ingestion, so no phone normalization needed here.
async fn build_contacts_cache(_snapshot_dir: &Path) -> Result<Vec<ContactWithStatus>, String> {
    // Open brb.db and read pre-computed contacts (O(1) lookup, ~10ms instead of ~10s)
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata database: {}", e))?;

    // Get contacts with pre-resolved display names from ingestion
    let stored_contacts: Vec<StoredContact> = metadata_db
        .get_all_contacts()
        .map_err(|e| format!("Failed to get contacts: {}", e))?;

    // Filter to contacts with MIN_MESSAGES_THRESHOLD or more messages
    let contacts: Vec<StoredContact> = stored_contacts
        .into_iter()
        .filter(|c| c.message_count >= MIN_MESSAGES_THRESHOLD as i64)
        .collect();

    info!(count = contacts.len(), "Loaded contacts from brb.db (fast path)");

    // "You" is the only persona the app trains.
    let has_you_persona = PersonaRegistry::load(common::SELF_PERSONA_ID).is_ok();

    // Calculate total messages from "me" across all contacts for "You" stats
    let total_messages_from_me: usize = contacts.iter().map(|c| (c.message_count / 2) as usize).sum();

    // Find latest date across all contacts
    let latest = contacts.iter().filter_map(|c| c.latest_message.as_ref()).max().cloned();

    // Build result list starting with "You" entry
    let mut result = Vec::with_capacity(contacts.len() + 1);

    // Add "You" entry first. It is the only persona the user can train.
    result.push(ContactWithStatus {
        contact_id: common::SELF_PERSONA_ID.to_string(),
        display_name: Some("You".to_string()),
        message_count: total_messages_from_me,
        last_message_date: latest.clone(),
        has_persona: has_you_persona,
        is_you: true,
    });

    // Add all other contacts
    for contact in contacts {
        let contact_id = contact.contact_id.clone();
        result.push(ContactWithStatus {
            contact_id: contact_id.clone(),
            display_name: contact
                .display_name
                .or_else(|| Some(format_contact_id(&contact.contact_id))),
            message_count: contact.message_count as usize,
            last_message_date: contact.latest_message,
            has_persona: false,
            is_you: false,
        });
    }

    Ok(result)
}

/// Get all contacts from the snapshot with their training status.
/// The "You" entry is always first.
/// Returns an error if no snapshot exists - create one first via run_ingestion.
///
/// Uses caching to avoid expensive database operations on repeated calls.
/// Only returns contacts with MIN_MESSAGES_THRESHOLD (50) or more messages.
#[tauri::command]
pub async fn get_all_contacts(state: tauri::State<'_, crate::AppState>) -> Result<Vec<ContactWithStatus>, String> {
    let snapshot_dir = get_latest_snapshot()
        .map_err(|e| format!("Failed to check for snapshot: {}", e))?
        .ok_or_else(|| "No snapshot exists. Create a snapshot first.".to_string())?;

    // Check if cache is valid
    {
        let cache = state.contacts_cache.read().await;
        if cache.is_valid_for(&snapshot_dir) {
            debug!("Using cached contact list ({} contacts)", cache.contacts.len());
            return Ok(cache.contacts.clone());
        }
    }

    // Cache miss - rebuild using shared logic
    debug!("Building contact cache (min_messages={})", MIN_MESSAGES_THRESHOLD);
    let result = build_contacts_cache(&snapshot_dir).await?;

    // Update cache
    {
        let mut cache = state.contacts_cache.write().await;
        cache.snapshot_dir = Some(snapshot_dir);
        cache.contacts = result.clone();
        debug!("Contact cache updated ({} contacts)", cache.contacts.len());
    }

    Ok(result)
}

/// Get detailed statistics for a single contact.
///
/// Uses pre-computed stats from SQLite (O(1) lookup) instead of computing
/// on-demand from the full conversation (O(n) per call).
/// Stats are computed during ingestion and stored in the contact_stats table.
///
/// Returns an error if no snapshot exists or stats haven't been computed.
#[tauri::command]
pub async fn get_contact_detail_stats(contact_id: String) -> Result<ContactDetailStats, String> {
    // Handle "you" special case
    if contact_id == "you" {
        return get_you_detail_stats().await;
    }

    // Read pre-computed stats from SQLite (O(1) lookup)
    let db = ingestion::MetadataDb::open().map_err(|e| format!("Failed to open database: {}", e))?;

    let stats = db
        .get_contact_stats(&contact_id)
        .map_err(|e| format!("Failed to query stats: {}", e))?
        .ok_or_else(|| {
            format!(
                "No stats found for contact: {}. Try running ingestion first.",
                contact_id
            )
        })?;

    Ok(ContactDetailStats {
        contact_id: stats.contact_id,
        display_name: stats.contact_name,
        message_count: stats.message_count as usize,
        messages_from_me: stats.messages_from_me as usize,
        messages_from_them: stats.messages_from_them as usize,
        date_range_start: stats.date_range_start,
        date_range_end: stats.date_range_end,
        avg_message_length: stats.avg_message_length,
        emoji_rate: stats.emoji_rate,
        avg_response_time_secs: stats.avg_response_time_secs,
        top_emojis: stats.top_emojis,
    })
}

/// Fallback estimation for "You" stats when cache is not available.
async fn get_you_stats_fallback() -> Result<YouStats, String> {
    let snapshot_dir = get_latest_snapshot()
        .map_err(|e| format!("Failed to check for snapshot: {}", e))?
        .ok_or_else(|| "No snapshot exists. Create a snapshot first.".to_string())?;

    let mut contacts = list_contacts(&snapshot_dir, ContactQueryOptions::default())
        .map_err(|e| format!("Failed to list contacts: {}", e))?;

    // Sort by message count descending and take top N
    contacts.sort_by_key(|c| std::cmp::Reverse(c.message_count));
    let top_contacts: Vec<_> = contacts.into_iter().take(YOU_TOP_CONTACTS).collect();

    // Estimate messages from me (roughly half of total with each contact)
    let total_messages: usize = top_contacts.iter().map(|c| c.message_count / 2).sum();

    // Find date range
    let earliest = top_contacts
        .iter()
        .filter_map(|c| c.earliest_message)
        .min()
        .map(|d| d.format("%Y-%m-%d").to_string());

    let latest = top_contacts
        .iter()
        .filter_map(|c| c.latest_message)
        .max()
        .map(|d| d.format("%Y-%m-%d").to_string());

    // Get top contact names
    let top_contact_names: Vec<String> = top_contacts
        .iter()
        .take(5)
        .map(|c| c.display_name.clone().unwrap_or_else(|| format_contact_id(&c.id)))
        .collect();

    Ok(YouStats {
        total_messages,
        contacts_included: top_contacts.len(),
        date_range_start: earliest,
        date_range_end: latest,
        avg_message_length: 0.0, // Fallback has no accurate data
        emoji_rate: 0.0,         // Fallback has no accurate data
        top_contacts: top_contact_names,
    })
}

/// Get detailed stats for "You" (internal helper)
///
/// Reads directly from cached stats to include top_emojis.
async fn get_you_detail_stats() -> Result<ContactDetailStats, String> {
    let metadata_db = ingestion::MetadataDb::open().map_err(|e| format!("Failed to open database: {}", e))?;

    // Try to read cached "You" stats (includes top_emojis)
    if let Ok(Some(stats)) = metadata_db.get_contact_stats("you") {
        return Ok(ContactDetailStats {
            contact_id: common::SELF_PERSONA_ID.to_string(),
            display_name: Some("You".to_string()),
            message_count: stats.message_count as usize,
            messages_from_me: stats.message_count as usize,
            messages_from_them: 0,
            date_range_start: stats.date_range_start,
            date_range_end: stats.date_range_end,
            avg_message_length: stats.avg_message_length,
            emoji_rate: stats.emoji_rate,
            avg_response_time_secs: None,
            top_emojis: stats.top_emojis, // Now populated from cache!
        });
    }

    // Fallback to estimation
    let you_stats = get_you_stats_fallback().await?;

    Ok(ContactDetailStats {
        contact_id: common::SELF_PERSONA_ID.to_string(),
        display_name: Some("You".to_string()),
        message_count: you_stats.total_messages,
        messages_from_me: you_stats.total_messages,
        messages_from_them: 0,
        date_range_start: you_stats.date_range_start,
        date_range_end: you_stats.date_range_end,
        avg_message_length: you_stats.avg_message_length,
        emoji_rate: you_stats.emoji_rate,
        avg_response_time_secs: None,
        top_emojis: vec![], // Fallback has no emoji data
    })
}

/// Format a contact ID for display (truncate phone numbers, format emails)
fn format_contact_id(contact_id: &str) -> String {
    if contact_id.starts_with('+') || contact_id.chars().all(|c| c.is_ascii_digit() || c == '+') {
        // Phone number - show last 4 digits
        let digits: String = contact_id.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 4 {
            format!("(...{})", &digits[digits.len() - 4..])
        } else {
            contact_id.to_string()
        }
    } else {
        // Email or other - truncate if too long
        if contact_id.len() > 20 {
            format!("{}...", &contact_id[..17])
        } else {
            contact_id.to_string()
        }
    }
}

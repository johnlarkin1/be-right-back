use common::Result;
use messages_db::db::{self, queries::ContactQueryOptions};
use tracing::info;

/// Handle the 'view' command - view messages from a conversation
pub fn handle_view(contact_id: &str, limit: usize, offset: usize) -> Result<()> {
    info!(contact_id = %contact_id, limit = %limit, offset = %offset, "Viewing messages");

    // Get or create snapshot
    let snapshot_path = match db::get_latest_snapshot()? {
        Some(path) => {
            info!(?path, "Using existing snapshot");
            path
        }
        None => {
            info!("No snapshot found, creating new snapshot");
            db::create_snapshot()?
        }
    };

    // Get display name by looking up in contacts list (more efficient than fetching all messages)
    let contacts = db::queries::list_contacts(&snapshot_path, ContactQueryOptions::default())?;
    let display_name = contacts
        .iter()
        .find(|c| c.id == contact_id)
        .and_then(|c| c.display_name.as_deref())
        .unwrap_or(contact_id);

    // Open the snapshot for paginated query
    let conn = db::open_chat_snapshot(&snapshot_path)?;

    // Get paginated messages
    let messages = db::queries::get_messages_for_contact_paginated(&conn, contact_id, limit, offset)?;

    if messages.is_empty() {
        println!("No messages found for contact: {}", contact_id);
        return Ok(());
    }

    println!(
        "\nMessages for {} (showing {} messages, offset {})",
        display_name,
        messages.len(),
        offset
    );
    println!();

    // Display messages in a readable format
    for msg in messages {
        let sender = if msg.is_from_me {
            "Me".to_string()
        } else {
            display_name.to_string()
        };
        let timestamp = msg.timestamp.format("%Y-%m-%d %H:%M:%S");

        // Check if message is just an attachment (object replacement character)
        let text = if msg.text.trim() == "\u{FFFC}" || msg.text.trim().chars().all(|c| c == '\u{FFFC}') {
            "<attachment>".to_string()
        } else if msg.text.is_empty() {
            "<empty>".to_string()
        } else {
            // Replace object replacement characters with [attachment] inline
            msg.text.replace('\u{FFFC}', "[attachment]")
        };

        println!("[{}] {} ({}):", timestamp, sender, msg.service);
        println!("  {}", text);
        println!();
    }

    Ok(())
}

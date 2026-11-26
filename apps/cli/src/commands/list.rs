use crate::cli::OutputFormat;
use comfy_table::{Cell, Color, Table, presets::UTF8_FULL};
use common::Result;
use messages_db::db::{self, queries::ContactQueryOptions};
use tracing::info;

/// Handle the 'list' command - show all contacts with message counts
pub fn handle_list(min_messages: usize, format: OutputFormat, include_groups: bool) -> Result<()> {
    info!(min_messages = %min_messages, include_groups = %include_groups, "Listing contacts...");
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

    // Build query options
    let mut options = ContactQueryOptions::default().min_messages(min_messages);
    if include_groups {
        info!("Including messages from group chats");
        options = options.include_groups();
    }

    let contacts = db::queries::list_contacts(&snapshot_path, options)?;
    info!(total = %contacts.len(), "Contacts filtered");
    let output = match format {
        OutputFormat::Table => {
            let mut table = Table::new();
            table.load_preset(UTF8_FULL).set_header(vec![
                Cell::new("Contact ID").fg(Color::Cyan),
                Cell::new("Display Name").fg(Color::Cyan),
                Cell::new("Messages").fg(Color::Cyan),
                Cell::new("Earliest Message").fg(Color::Cyan),
                Cell::new("Latest Message").fg(Color::Cyan),
            ]);

            for contact in &contacts {
                let earliest = contact
                    .earliest_message
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "N/A".to_string());
                let latest = contact
                    .latest_message
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "N/A".to_string());

                table.add_row(vec![
                    &contact.id,
                    contact.display_name.as_deref().unwrap_or("(unknown)"),
                    &contact.message_count.to_string(),
                    &earliest,
                    &latest,
                ]);
            }

            table.to_string()
        }
        OutputFormat::Csv => {
            let mut csv = String::new();
            csv.push_str("contact_id,display_name,message_count,earliest_message,latest_message\n");
            for contact in &contacts {
                let name = contact.display_name.as_deref().unwrap_or("");
                let earliest = contact
                    .earliest_message
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "".to_string());
                let latest = contact
                    .latest_message
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "".to_string());
                csv.push_str(&format!(
                    "{},{},{},{},{}\n",
                    contact.id, name, contact.message_count, earliest, latest
                ));
            }
            csv
        }
        OutputFormat::Json => serde_json::to_string_pretty(&contacts).unwrap(),
    };

    println!("{}", output);
    Ok(())
}

/// Ingest command - runs full ingestion pipeline with progress
use common::Result;
use indicatif::{ProgressBar, ProgressStyle};
use ingestion::{IngestionConfig, IngestionStage, IngestionStats};
use tracing::info;

pub fn handle_ingest(force_snapshot: bool) -> Result<()> {
    info!(force_snapshot, "Starting ingestion pipeline");

    let config = IngestionConfig {
        create_snapshot: force_snapshot,
    };

    // Create a progress bar with a template that supports multi-line status
    let pb = ProgressBar::new(100);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{bar:40.cyan/blue}] {pos:>3}% {msg}")
            .unwrap()
            .progress_chars("=>-"),
    );

    let result = ingestion::run_ingestion(config, |stage, percent, message, stats| {
        // Calculate overall progress based on stage and stage percent
        // Each stage is ~17% of total (6 stages)
        let stage_weight = 17u64;
        let base_progress = stage.index() as u64 * stage_weight;
        let overall_progress = base_progress + (percent as u64 * stage_weight / 100);

        pb.set_position(overall_progress.min(100));
        pb.set_message(format_progress_message(stage, percent, message, &stats));

        if stage == IngestionStage::Analyzing && percent >= 100 {
            pb.finish_with_message("Ingestion complete!");
        }
    })?;

    println!();
    println!("Ingestion completed successfully:");
    println!("  Snapshot: {}", result.snapshot_dir.display());
    println!("  Messages: {}", result.message_count);
    println!("  Contacts: {}", result.contact_count);
    println!("  Chunks: {}", result.chunk_count);
    println!("  Duration: {}s", result.duration_secs);

    Ok(())
}

/// Format seconds into human-readable duration (e.g., "1h 23m 45s" or "5m 30s")
fn format_duration(secs: u64) -> String {
    if secs >= 3600 {
        let hours = secs / 3600;
        let mins = (secs % 3600) / 60;
        let secs = secs % 60;
        format!("{}h {}m {}s", hours, mins, secs)
    } else if secs >= 60 {
        let mins = secs / 60;
        let secs = secs % 60;
        format!("{}m {}s", mins, secs)
    } else {
        format!("{}s", secs)
    }
}

/// Format detailed stats for embedding phase
fn format_embedding_stats(stats: &IngestionStats) -> String {
    let mut parts = Vec::new();

    // Contact progress
    if let Some(contact) = &stats.current_contact {
        // Truncate long contact names
        let display_contact = if contact.contact_name.len() > 15 {
            format!("{}...", &contact.contact_name[..12])
        } else {
            contact.contact_name.clone()
        };
        parts.push(display_contact);
    }

    // Contacts progress
    if stats.total_contacts > 0 {
        parts.push(format!(
            "contact: {}/{}",
            stats.contacts_processed, stats.total_contacts
        ));
    }

    // Chunks created/embedded
    if stats.chunks_created > 0 {
        parts.push(format!("chunks: {}", stats.chunks_embedded));
    }

    // ETA
    if let Some(remaining) = stats.estimated_remaining_secs {
        parts.push(format!("ETA: {}", format_duration(remaining)));
    }

    parts.join(" | ")
}

fn format_progress_message(stage: IngestionStage, percent: u8, message: &str, stats: &IngestionStats) -> String {
    let stage_name = match stage {
        IngestionStage::Snapshot => "Snapshot",
        IngestionStage::Parsing => "Parsing",
        IngestionStage::Chunking => "Chunking",
        IngestionStage::Embedding => "Embed",
        IngestionStage::Saving => "Saving",
        IngestionStage::Analyzing => "Analyze",
    };

    // During embedding/chunking phase, show detailed stats
    if (stage == IngestionStage::Embedding || stage == IngestionStage::Chunking) && stats.current_contact.is_some() {
        format!("[{:<8}] {:>3}% {}", stage_name, percent, format_embedding_stats(stats))
    } else if stats.total_messages > 0 {
        // Show basic message/contact counts for other phases
        format!(
            "[{:<8}] {:>3}% {} ({} msgs, {} contacts)",
            stage_name, percent, message, stats.total_messages, stats.total_contacts
        )
    } else {
        format!("[{:<8}] {:>3}% {}", stage_name, percent, message)
    }
}

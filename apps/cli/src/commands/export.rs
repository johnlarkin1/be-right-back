use crate::constants::SAMPLE_CONVERSATION_BLOCKS;
use common::{
    BrbError, Conversation, Result, SELF_PERSONA_ID, SELF_TRAINING_MIN_MESSAGES, get_processed_data_dir,
    write_json_file,
};
use indicatif::{ProgressBar, ProgressStyle};
use messages_db::{db, utils};
use std::path::PathBuf;
use tracing::info;
use training::export;

/// Handle the 'export' command: export the user's own replies as "You" training data (JSONL)
pub fn handle_export(output_dir: Option<String>, date_from: Option<String>, date_to: Option<String>) -> Result<()> {
    info!(?date_from, ?date_to, "Exporting \"You\" training data");

    let snapshot_path = db::snapshot::get_or_create_snapshot()?;
    let mut conversations = db::queries::get_self_conversations(&snapshot_path, SELF_TRAINING_MIN_MESSAGES)?;
    if date_from.is_some() || date_to.is_some() {
        conversations = conversations
            .into_iter()
            .map(|c| apply_date_filter(c, date_from.clone(), date_to.clone()))
            .collect::<Result<Vec<_>>>()?;
        conversations.retain(|c| !c.messages.is_empty());
    }

    if conversations.is_empty() {
        info!("No messages found in this date range.");
        return Ok(());
    }
    let all_messages: Vec<_> = conversations.iter().flat_map(|c| c.messages.iter().cloned()).collect();
    info!(
        conversations = conversations.len(),
        total_messages = all_messages.len(),
        "Total messages found"
    );

    let output_base = if let Some(dir) = output_dir {
        PathBuf::from(dir)
    } else {
        get_processed_data_dir()?
    };
    let persona_dir = output_base.join(SELF_PERSONA_ID);
    std::fs::create_dir_all(&persona_dir)?;

    let jsonl_path = persona_dir.join("train.jsonl");
    let metadata_path = persona_dir.join("metadata.json");
    info!(jsonl_path = ?jsonl_path.display(), "Output file");
    info!(metadata_path = ?metadata_path.display(), "Metadata file");

    info!("Starting persona analysis pipeline...");
    // 1. Sample conversation blocks for LLM self-analysis
    let conversation_blocks = export::sample_self_blocks(&conversations, SAMPLE_CONVERSATION_BLOCKS)?;
    info!(
        blocks_sampled = conversation_blocks.len(),
        "Conversation blocks sampled"
    );

    // 2. Calculate programmatic stats of the user's own messages
    let persona_stats = export::calculate_persona_stats(&all_messages)?;

    // 3. Run LLM self-analysis (with graceful fallback)
    let llm_analysis = match export::analyze_persona_with_llm(conversation_blocks) {
        Ok(Some(analysis)) => {
            info!(analysis_length = analysis.len(), "LLM analysis completed successfully");
            Some(analysis)
        }
        Ok(None) => {
            info!("LLM analysis skipped or failed, will use fallback prompt");
            None
        }
        Err(e) => {
            info!(error = %e, "LLM analysis failed, using fallback prompt");
            None
        }
    };

    // 4. Build system prompt from stats and LLM analysis
    let system_prompt = if llm_analysis.is_some() || persona_stats.emoji_rate > 0.0 {
        export::build_system_prompt(Some(&persona_stats), llm_analysis.as_deref())?
    } else {
        export::build_fallback_prompt()
    };

    info!(prompt_length = system_prompt.len(), "System prompt built");

    let progress = ProgressBar::new(100);
    progress.set_style(
        ProgressStyle::default_bar()
            .template("[{elapsed_precise}] {bar:40.cyan/blue} {pos}/{len} {msg}")
            .map_err(|e| BrbError::Template(e.to_string()))?
            .progress_chars("=>-"),
    );
    progress.set_message("Generating training examples...");

    let mut metadata = export::export_self_to_jsonl(
        &conversations,
        &jsonl_path,
        Some(|current, total| {
            progress.set_length(total as u64);
            progress.set_position(current as u64);
            if current % 100 == 0 || current == total {
                progress.set_message(format!("Writing examples ({}/{})", current, total));
            }
        }),
    )?;

    metadata.system_prompt = Some(system_prompt);
    metadata.persona_stats = Some(persona_stats);
    metadata.llm_analysis = llm_analysis;

    progress.finish_with_message(format!("Exported {} training examples", metadata.training_examples));
    write_json_file(&metadata_path, &metadata)?;
    info!(
        training_examples = metadata.training_examples,
        total_messages    = metadata.total_messages,
        date_range_start  = %metadata.date_range_start.format("%Y-%m-%d"),
        date_range_end    = %metadata.date_range_end.format("%Y-%m-%d"),
        avg_user_msg_length      = metadata.avg_user_msg_length,
        avg_assistant_msg_length = metadata.avg_assistant_msg_length,
        jsonl_path    = %jsonl_path.display(),
        metadata_path = %metadata_path.display(),
        "Export complete!"
    );

    Ok(())
}

/// Apply date filtering to a conversation
fn apply_date_filter(
    mut conversation: Conversation,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Conversation> {
    let from_dt = if let Some(date_str) = date_from {
        Some(utils::parse_date(&date_str)?)
    } else {
        None
    };

    let to_dt = if let Some(date_str) = date_to {
        Some(utils::parse_date(&date_str)?)
    } else {
        None
    };

    let original_count = conversation.messages.len();
    conversation.messages.retain(|msg| match (from_dt, to_dt) {
        (Some(from), Some(to)) => msg.timestamp >= from && msg.timestamp <= to,
        (Some(from), None) => msg.timestamp >= from,
        (None, Some(to)) => msg.timestamp <= to,
        (None, None) => true,
    });

    let filtered_count = conversation.messages.len();

    if filtered_count < original_count {
        info!(
            original = original_count,
            filtered = filtered_count,
            removed = original_count - filtered_count,
            "Applied date filter"
        );
    }
    if let (Some(first), Some(last)) = (conversation.messages.first(), conversation.messages.last()) {
        conversation.start_date = first.timestamp;
        conversation.end_date = last.timestamp;
    }
    Ok(conversation)
}

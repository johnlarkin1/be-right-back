//! Conversation analysis commands for personality insights.
//!
//! These commands provide LLM-based personality analysis using Qwen3.5.
//! Results are cached in SQLite for O(1) lookup on subsequent requests.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::Arc;

use common::{recommended_persona_model, scripts, Conversation, PythonEnvironment};
use inference::MLXPythonEngine;
use ingestion::{ConversationAnalysis, MetadataDb};
use messages_db::db::{
    queries::{get_conversation, get_messages_for_contact},
    snapshot,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};
use training::export::{sample_conversation_blocks, ConversationBlock};

/// Calculate Phase 1 block count for quote extraction.
///
/// Range: 15-25 blocks, scaling at ~1 block per 400 messages.
/// Optimized for ~60 second target with reduced quote count (5 quotes).
fn calculate_phase1_blocks(total_messages: usize) -> usize {
    let base = 15;
    let max = 25; // Reduced for faster generation (~60s target)
    let messages_per_block = 400;

    let adaptive = total_messages / messages_per_block;
    base.max(adaptive.min(max))
}

/// Calculate Phase 2 block count for personality analysis.
///
/// Range: 20-30 blocks, scaling at ~1 block per 300 messages.
/// Phase 2 needs less raw data since it has curated quotes from Phase 1.
fn calculate_phase2_blocks(total_messages: usize) -> usize {
    let base = 20;
    let max = 30;
    let messages_per_block = 300;

    let adaptive = total_messages / messages_per_block;
    base.max(adaptive.min(max))
}

/// Compute relationship metadata from a conversation for LLM context.
///
/// Returns a JSON object with statistics that help the LLM understand
/// the depth and nature of the relationship.
fn compute_relationship_metadata(conversation: &Conversation) -> serde_json::Value {
    let messages = &conversation.messages;

    if messages.is_empty() {
        return serde_json::json!({});
    }

    let from_me = messages.iter().filter(|m| m.is_from_me).count();
    let from_them = messages.len() - from_me;

    let first_date = messages.first().map(|m| m.timestamp.format("%Y-%m-%d").to_string());
    let last_date = messages.last().map(|m| m.timestamp.format("%Y-%m-%d").to_string());

    let span_days = messages
        .first()
        .zip(messages.last())
        .map(|(f, l)| (l.timestamp - f.timestamp).num_days())
        .unwrap_or(0);

    let avg_per_week = if span_days > 0 {
        (messages.len() as f64 / span_days as f64) * 7.0
    } else {
        0.0
    };

    serde_json::json!({
        "total_messages": messages.len(),
        "messages_from_me": from_me,
        "messages_from_them": from_them,
        "first_message_date": first_date,
        "last_message_date": last_date,
        "conversation_span_days": span_days,
        "avg_messages_per_week": avg_per_week
    })
}

/// A conversation block with contact attribution for "You" analysis.
///
/// Extends ConversationBlock with `with_contact` field to show how
/// communication style varies across different relationships.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributedBlock {
    #[serde(flatten)]
    pub block: ConversationBlock,
    /// Name of the contact this conversation was with. The Python self-analysis
    /// prompt reads it as `contact_name`.
    #[serde(rename = "contact_name")]
    pub with_contact: String,
}

/// Number of top contacts to sample from for "You" analysis
const YOU_SAMPLE_CONTACTS: usize = 20;

/// Blocks to sample per contact for "You" analysis
const BLOCKS_PER_CONTACT: usize = 3;

/// Sample conversation blocks from multiple top contacts for "You" analysis.
///
/// Returns attributed blocks that show which contact each conversation was with,
/// enabling analysis of style variation across different relationships.
fn sample_multi_contact_blocks(
    snapshot_dir: &std::path::Path,
    metadata_db: &MetadataDb,
    target_total: usize,
) -> Result<(Vec<AttributedBlock>, serde_json::Value), String> {
    // Get top contacts by message count
    let contacts = metadata_db
        .get_all_contacts()
        .map_err(|e| format!("Failed to get contacts: {}", e))?;

    // Take top N contacts, excluding "you"
    let top_contacts: Vec<_> = contacts
        .into_iter()
        .filter(|c| c.contact_id != "you")
        .take(YOU_SAMPLE_CONTACTS)
        .collect();

    if top_contacts.is_empty() {
        return Err("No contacts found for 'You' analysis".to_string());
    }

    info!(
        top_contacts = top_contacts.len(),
        "Sampling from top contacts for 'You' analysis"
    );

    let mut all_blocks: Vec<AttributedBlock> = Vec::new();
    let mut total_messages: usize = 0;
    let mut messages_from_me: usize = 0;
    let mut earliest_date: Option<String> = None;
    let mut latest_date: Option<String> = None;

    // Calculate how many blocks to sample per contact
    let blocks_per = (target_total / top_contacts.len()).clamp(1, BLOCKS_PER_CONTACT);

    // Open the chat snapshot once and reuse for all contacts
    let conn =
        snapshot::open_chat_snapshot(snapshot_dir).map_err(|e| format!("Failed to open chat snapshot: {}", e))?;

    for contact in &top_contacts {
        // Get messages directly without rebuilding AddressBook lookups
        let messages = match get_messages_for_contact(&conn, &contact.contact_id) {
            Ok(msgs) => msgs,
            Err(e) => {
                warn!(
                    contact_id = %contact.contact_id,
                    error = %e,
                    "Failed to get conversation, skipping"
                );
                continue;
            }
        };

        if messages.is_empty() {
            continue;
        }

        // Update aggregate stats
        total_messages += messages.len();
        messages_from_me += messages.iter().filter(|m| m.is_from_me).count();

        // Track date range
        if let Some(first) = messages.first() {
            let date_str = first.timestamp.format("%Y-%m-%d").to_string();
            earliest_date = Some(earliest_date.map_or(date_str.clone(), |e| if date_str < e { date_str } else { e }));
        }
        if let Some(last) = messages.last() {
            let date_str = last.timestamp.format("%Y-%m-%d").to_string();
            latest_date = Some(latest_date.map_or(date_str.clone(), |l| if date_str > l { date_str } else { l }));
        }

        // Sample blocks from this contact
        let contact_name = contact
            .display_name
            .clone()
            .unwrap_or_else(|| format!("Contact {}", &contact.contact_id[..8.min(contact.contact_id.len())]));

        match sample_conversation_blocks(&messages, blocks_per) {
            Ok(blocks) => {
                for block in blocks {
                    all_blocks.push(AttributedBlock {
                        block,
                        with_contact: contact_name.clone(),
                    });
                }
            }
            Err(e) => {
                warn!(
                    contact_id = %contact.contact_id,
                    error = %e,
                    "Failed to sample blocks, skipping"
                );
            }
        }
    }

    if all_blocks.is_empty() {
        return Err("No conversation blocks found across all contacts".to_string());
    }

    // Build aggregate metadata for "You"
    let span_days = earliest_date
        .as_ref()
        .zip(latest_date.as_ref())
        .and_then(|(e, l)| {
            chrono::NaiveDate::parse_from_str(e, "%Y-%m-%d")
                .ok()
                .zip(chrono::NaiveDate::parse_from_str(l, "%Y-%m-%d").ok())
                .map(|(early, late)| (late - early).num_days())
        })
        .unwrap_or(0);

    let avg_per_week = if span_days > 0 {
        (messages_from_me as f64 / span_days as f64) * 7.0
    } else {
        0.0
    };

    let metadata = serde_json::json!({
        "total_messages": messages_from_me,  // Only count messages from "me"
        "messages_from_me": messages_from_me,
        "messages_from_them": total_messages - messages_from_me,
        "first_message_date": earliest_date,
        "last_message_date": latest_date,
        "conversation_span_days": span_days,
        "avg_messages_per_week": avg_per_week,
        "contacts_sampled": top_contacts.len()
    });

    info!(
        total_blocks = all_blocks.len(),
        contacts_sampled = top_contacts.len(),
        total_messages_from_me = messages_from_me,
        "Completed multi-contact sampling for 'You' analysis"
    );

    Ok((all_blocks, metadata))
}

/// Result type for conversation analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationAnalysisResult {
    pub contact_id: String,
    pub analysis_markdown: String,
    pub model_id: String,
    pub generation_duration_secs: Option<i64>,
    pub created_at: String,
    pub from_cache: bool,
}

impl From<ConversationAnalysis> for ConversationAnalysisResult {
    fn from(analysis: ConversationAnalysis) -> Self {
        Self {
            contact_id: analysis.contact_id,
            analysis_markdown: analysis.analysis_markdown,
            model_id: analysis.model_id,
            generation_duration_secs: analysis.generation_duration_secs,
            created_at: analysis.created_at,
            from_cache: true,
        }
    }
}

/// Progress event emitted during analysis generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgressEvent {
    pub phase: String,
    pub content: Option<String>,
    pub is_complete: bool,
    pub error: Option<String>,
}

/// Python script output types
#[derive(Debug, Deserialize)]
struct PythonEvent {
    #[serde(rename = "type")]
    event_type: String,
    phase: Option<String>,
    content: Option<String>,
    duration_secs: Option<i64>,
    error: Option<String>,
    // Phase 1 completion data
    quotes_count: Option<usize>,
    topics_count: Option<usize>,
    insights_count: Option<usize>,
}

/// Get cached conversation analysis for a contact.
///
/// Returns the cached analysis if it exists, or None if no analysis has been generated.
/// This is an O(1) lookup from SQLite.
#[tauri::command]
pub async fn get_conversation_analysis(contact_id: String) -> Result<Option<ConversationAnalysisResult>, String> {
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;

    match metadata_db.get_conversation_analysis(&contact_id) {
        Ok(Some(analysis)) => {
            info!(contact_id = %contact_id, "Found cached conversation analysis");
            Ok(Some(analysis.into()))
        }
        Ok(None) => {
            debug!(contact_id = %contact_id, "No cached analysis found");
            Ok(None)
        }
        Err(e) => {
            error!(error = %e, "Failed to get conversation analysis");
            Err(format!("Failed to get analysis: {}", e))
        }
    }
}

/// Analyze a contact's conversation and generate personality insights.
///
/// This command:
/// 1. Checks the SQLite cache first (unless force_refresh is true)
/// 2. Samples conversation blocks from the contact's messages
/// 3. Spawns the Python analysis script with streaming progress
/// 4. Emits "analysis-progress" events during generation
/// 5. Caches the result in SQLite
/// 6. Returns the complete analysis
#[tauri::command]
pub async fn analyze_conversation(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
    contact_id: String,
    contact_name: String,
    force_refresh: bool,
) -> Result<ConversationAnalysisResult, String> {
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;

    // Check cache first (unless force_refresh)
    if !force_refresh {
        if let Ok(Some(cached)) = metadata_db.get_conversation_analysis(&contact_id) {
            info!(contact_id = %contact_id, "Returning cached analysis");
            return Ok(cached.into());
        }
    }

    // Emit initial progress
    emit_progress(&app, "loading_model", None, false, None);

    // Ensure Python environment is set up
    let env = PythonEnvironment::ensure(&app)
        .await
        .map_err(|e| format!("Failed to setup Python: {}", e))?;

    // Get snapshot directory
    let snapshot_dir = snapshot::get_or_create_snapshot().map_err(|e| format!("Failed to get snapshot: {}", e))?;

    // Sample conversation blocks
    emit_progress(&app, "sampling", None, false, None);

    // Check if this is "You" analysis (requires multi-contact sampling)
    let is_you_analysis = contact_id.to_lowercase() == "you";

    let input = if is_you_analysis {
        // "You" analysis: sample from multiple top contacts
        info!("Starting 'You' self-analysis with multi-contact sampling");

        let phase1_target = 30; // More blocks for comprehensive self-analysis
        let (phase1_blocks, metadata) = sample_multi_contact_blocks(&snapshot_dir, &metadata_db, phase1_target)?;

        if phase1_blocks.is_empty() {
            return Err("No conversation blocks to analyze for 'You'".to_string());
        }

        // For phase2, use same blocks but potentially different sampling
        let phase2_target = 25;
        let (phase2_blocks, _) = sample_multi_contact_blocks(&snapshot_dir, &metadata_db, phase2_target)?;

        info!(
            phase1_blocks = phase1_blocks.len(),
            phase2_blocks = phase2_blocks.len(),
            "Sampled multi-contact blocks for 'You' self-analysis"
        );

        // Prepare input with contact_id to trigger self-analysis in Python
        serde_json::json!({
            "contact_id": "you",
            "contact_name": "You",
            "phase1_conversation_blocks": phase1_blocks,
            "phase2_conversation_blocks": phase2_blocks,
            "streaming": true,
            "metadata": metadata,
            "max_tokens_phase1": 1500,  // Slightly more for self-analysis
            "max_tokens_phase2": 3000
        })
    } else {
        // Standard contact analysis: sample from single conversation
        let conversation =
            get_conversation(&snapshot_dir, &contact_id).map_err(|e| format!("Failed to load messages: {}", e))?;

        if conversation.messages.is_empty() {
            return Err(format!("No messages found for contact {}", contact_id));
        }

        info!(
            contact_id = %contact_id,
            message_count = conversation.messages.len(),
            "Loaded messages for analysis"
        );

        // Sample conversation blocks for two-phase analysis
        // Phase 1: More blocks for comprehensive quote extraction
        let phase1_target = calculate_phase1_blocks(conversation.messages.len());
        let phase1_blocks = sample_conversation_blocks(&conversation.messages, phase1_target)
            .map_err(|e| format!("Failed to sample Phase 1 conversations: {}", e))?;

        // Phase 2: Fewer blocks for analysis context (quotes come from Phase 1)
        let phase2_target = calculate_phase2_blocks(conversation.messages.len());
        let phase2_blocks = sample_conversation_blocks(&conversation.messages, phase2_target)
            .map_err(|e| format!("Failed to sample Phase 2 conversations: {}", e))?;

        if phase1_blocks.is_empty() {
            return Err("No conversation blocks to analyze".to_string());
        }

        info!(
            phase1_blocks = phase1_blocks.len(),
            phase1_target,
            phase2_blocks = phase2_blocks.len(),
            phase2_target,
            total_messages = conversation.messages.len(),
            "Sampled conversation blocks for two-phase analysis"
        );

        // Compute relationship metadata for richer LLM context
        let metadata = compute_relationship_metadata(&conversation);
        serde_json::json!({
            "contact_id": contact_id,
            "contact_name": contact_name,
            "phase1_conversation_blocks": phase1_blocks,
            "phase2_conversation_blocks": phase2_blocks,
            "streaming": true,
            "metadata": metadata,
            "max_tokens_phase1": 1200,
            "max_tokens_phase2": 3200
        })
    };

    // Try daemon-first path (avoids ~5-10s model cold start)
    if let Some(result) = try_analyze_via_daemon(state.casper_engine.clone(), &app, &input, &contact_id).await {
        return result;
    }

    let input_json = serde_json::to_string(&input).map_err(|e| format!("Failed to serialize input: {}", e))?;

    // DEBUG: Write input JSON to file for debugging analyze_persona issues
    let debug_path = std::env::temp_dir().join("brb_debug_input.json");
    if let Err(e) = std::fs::write(&debug_path, &input_json) {
        warn!(error = %e, "Failed to write debug input file");
    } else {
        info!(path = ?debug_path, bytes = input_json.len(), "DEBUG: Wrote analysis input to temp file");
    }

    // Get script path
    let script_path = env.script(scripts::ANALYZE_PERSONA);
    if !script_path.exists() {
        return Err(format!("Analysis script not found: {:?}", script_path));
    }

    debug!(
        python = ?env.python_bin,
        script = ?script_path,
        "Running personality analysis"
    );

    // Spawn Python subprocess
    let mut child = Command::new(&env.python_bin)
        .arg(&script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Inherited, not piped: an undrained pipe blocks a chatty child once the
        // buffer fills. Inheriting keeps Python tracebacks in the app log.
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to start analysis: {}", e))?;

    // Write input to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin
            .write_all(input_json.as_bytes())
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    }

    // Read stdout line by line for streaming events
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);

    let mut final_content: Option<String> = None;
    let mut duration_secs: Option<i64> = None;
    let mut error_msg: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                warn!(error = %e, "Failed to read stdout line");
                continue;
            }
        };

        // Try to parse as JSON event
        if let Ok(event) = serde_json::from_str::<PythonEvent>(&line) {
            match event.event_type.as_str() {
                "phase" => {
                    if let Some(phase) = &event.phase {
                        // Map internal phase names to user-friendly labels
                        let display_phase = phase.as_str();
                        info!(phase = %phase, display_phase = %display_phase, "Analysis progress");
                        emit_progress(&app, display_phase, None, false, None);
                    }
                }
                "phase1_complete" => {
                    // Log Phase 1 summary
                    info!(
                        quotes_count = ?event.quotes_count,
                        topics_count = ?event.topics_count,
                        insights_count = ?event.insights_count,
                        "Phase 1 extraction complete"
                    );
                    // Emit progress indicating Phase 1 is done
                    emit_progress(&app, "phase1_complete", None, false, None);
                }
                "complete" => {
                    final_content = event.content;
                    duration_secs = event.duration_secs;
                    emit_progress(&app, "complete", final_content.clone(), true, None);
                    info!(duration_secs = ?duration_secs, "Two-phase analysis complete");
                }
                "error" => {
                    error_msg = event.error.clone();
                    emit_progress(&app, "error", None, true, event.error);
                }
                _ => {
                    debug!(event_type = %event.event_type, "Unknown event type");
                }
            }
        } else {
            // Not JSON, might be debug output - ignore
            debug!(line = %line, "Non-JSON output from Python");
        }
    }

    // Wait for process to finish
    let status = child.wait().map_err(|e| format!("Analysis process failed: {}", e))?;

    if !status.success() {
        // Python reports the failure as a JSON error event on stdout; its stderr is inherited.
        return Err(error_msg.unwrap_or_else(|| "Analysis failed".to_string()));
    }

    // Check if we got a result
    let analysis_markdown = final_content.ok_or("No analysis content received from Python")?;

    // Get current ingestion ID for caching
    let app_state = metadata_db
        .get_app_state()
        .map_err(|e| format!("Failed to get app state: {}", e))?;
    let ingestion_id = app_state
        .curr_ingestion_id
        .ok_or("No current ingestion - please run ingestion first")?;

    // Create analysis result
    let analysis = ConversationAnalysis {
        contact_id: contact_id.clone(),
        analysis_markdown: analysis_markdown.clone(),
        model_id: recommended_persona_model().to_string(),
        generation_duration_secs: duration_secs,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Cache to SQLite
    if let Err(e) = metadata_db.save_conversation_analysis(&analysis, ingestion_id) {
        warn!(error = %e, "Failed to cache analysis (continuing anyway)");
    } else {
        info!(contact_id = %contact_id, "Cached conversation analysis");
    }

    Ok(ConversationAnalysisResult {
        contact_id,
        analysis_markdown,
        model_id: recommended_persona_model().to_string(),
        generation_duration_secs: duration_secs,
        created_at: analysis.created_at,
        from_cache: false,
    })
}

/// Try to run analysis through the persistent Casper daemon (avoids ~5-10s model cold start).
///
/// Returns `Some(result)` if the daemon path was attempted (success or failure),
/// or `None` if the daemon was unavailable (busy or not initialized) to trigger subprocess fallback.
async fn try_analyze_via_daemon(
    casper_engine: Arc<Mutex<Option<MLXPythonEngine>>>,
    app: &AppHandle,
    input: &serde_json::Value,
    contact_id: &str,
) -> Option<Result<ConversationAnalysisResult, String>> {
    // try_lock: if Casper is busy, fall back to subprocess
    let mut guard = match casper_engine.try_lock() {
        Ok(g) => g,
        Err(_) => {
            info!("Casper engine busy, falling back to subprocess for analysis");
            return None;
        }
    };

    // If no engine exists yet, fall back to subprocess (which loads 8-bit model)
    let engine = match guard.as_mut() {
        Some(e) => e,
        None => {
            info!("No Casper engine initialized, falling back to subprocess for analysis");
            return None;
        }
    };

    info!("Attempting analysis via persistent Casper daemon");

    // Clone what we need for the blocking task
    let input_clone = input.clone();
    let contact_id_clone = contact_id.to_string();
    let app_clone = app.clone();

    // Run the blocking analysis in a spawn_blocking task.
    // We need to use the engine directly, which requires taking it temporarily.
    // Instead, we'll run the analysis inline since we hold the mutex.
    let app_for_progress = app.clone();
    let result = engine.analyze_persona(&input_clone, |phase, phase1_stats| {
        if let Some((quotes, topics, insights)) = phase1_stats {
            info!(
                quotes_count = quotes,
                topics_count = topics,
                insights_count = insights,
                "Phase 1 extraction complete (daemon)"
            );
        }
        emit_progress(&app_for_progress, phase, None, false, None);
    });

    // Release the lock before doing any further work
    drop(guard);

    match result {
        Ok((analysis_markdown, duration_secs)) => {
            info!(
                contact_id = %contact_id_clone,
                duration_secs,
                "Analysis complete via daemon"
            );
            emit_progress(&app_clone, "complete", Some(analysis_markdown.clone()), true, None);

            // Cache the result
            let cache_result = cache_analysis_result(&contact_id_clone, &analysis_markdown, duration_secs);

            match cache_result {
                Ok(result) => Some(Ok(result)),
                Err(e) => {
                    warn!(error = %e, "Failed to cache daemon analysis result, returning anyway");
                    Some(Ok(ConversationAnalysisResult {
                        contact_id: contact_id_clone,
                        analysis_markdown,
                        model_id: recommended_persona_model().to_string(),
                        generation_duration_secs: Some(duration_secs),
                        created_at: chrono::Utc::now().to_rfc3339(),
                        from_cache: false,
                    }))
                }
            }
        }
        Err(e) => {
            warn!(error = %e, "Daemon analysis failed, falling back to subprocess");
            // Return None to trigger subprocess fallback
            None
        }
    }
}

/// Cache analysis result to SQLite and return the result struct.
fn cache_analysis_result(
    contact_id: &str,
    analysis_markdown: &str,
    duration_secs: i64,
) -> Result<ConversationAnalysisResult, String> {
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;

    let app_state = metadata_db
        .get_app_state()
        .map_err(|e| format!("Failed to get app state: {}", e))?;
    let ingestion_id = app_state
        .curr_ingestion_id
        .ok_or("No current ingestion - please run ingestion first")?;

    let analysis = ConversationAnalysis {
        contact_id: contact_id.to_string(),
        analysis_markdown: analysis_markdown.to_string(),
        model_id: recommended_persona_model().to_string(),
        generation_duration_secs: Some(duration_secs),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    if let Err(e) = metadata_db.save_conversation_analysis(&analysis, ingestion_id) {
        warn!(error = %e, "Failed to cache analysis (continuing anyway)");
    } else {
        info!(contact_id = %contact_id, "Cached conversation analysis (daemon path)");
    }

    Ok(ConversationAnalysisResult {
        contact_id: contact_id.to_string(),
        analysis_markdown: analysis_markdown.to_string(),
        model_id: recommended_persona_model().to_string(),
        generation_duration_secs: Some(duration_secs),
        created_at: analysis.created_at,
        from_cache: false,
    })
}

/// Emit analysis progress event to frontend
fn emit_progress(app: &AppHandle, phase: &str, content: Option<String>, is_complete: bool, error: Option<String>) {
    let event = AnalysisProgressEvent {
        phase: phase.to_string(),
        content,
        is_complete,
        error,
    };

    if let Err(e) = app.emit("analysis-progress", &event) {
        warn!(error = %e, "Failed to emit analysis progress event");
    }
}

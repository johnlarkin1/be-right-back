//! Casper agent commands for searching and exploring iMessage history.
//!
//! Casper is an AI agent that can answer questions about your message history
//! using semantic search and tool calling.

use common::PythonEnvironment;
use inference::agent::{AgentConfig, AgentProgressEvent, CasperAgent, MentionedContact, ToolCallRecord};
use inference::InferenceError;
use ingestion::{CasperThread, MetadataDb};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

/// Simplified tool call information for frontend.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ToolCallInfo {
    pub tool_name: String,
    pub success: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
}

impl From<&ToolCallRecord> for ToolCallInfo {
    fn from(record: &ToolCallRecord) -> Self {
        Self {
            tool_name: record.tool_name.clone(),
            success: record.result.success,
            duration_ms: record.duration_ms,
            error: record.result.error.clone(),
        }
    }
}

/// Events emitted during Casper agent execution for real-time UI updates.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CasperEvent {
    /// Agent has started processing the question.
    Started { question: String },

    /// Agent is generating a response (thinking).
    Thinking { iteration: usize, max_iterations: usize },

    /// Agent is about to call a tool.
    ToolStart {
        tool_name: String,
        #[ts(type = "Record<string, unknown>")]
        arguments: Value,
        iteration: usize,
    },

    /// Tool call completed.
    ToolComplete {
        tool_name: String,
        success: bool,
        duration_ms: u64,
        result_preview: String,
    },

    /// New text for the live answer preview, as the model generates it.
    Token { text: String },

    /// Clear the live answer preview. The streamed text belonged to a tool
    /// call or a rejected draft, not the final answer.
    TokenReset,

    /// The user stopped the run. No `Complete` follows.
    Cancelled,

    /// Agent completed with final answer.
    Complete {
        answer: String,
        iterations: usize,
        duration_ms: u64,
        tool_calls: Vec<ToolCallInfo>,
        thinking: Option<String>,
        thinking_enabled: bool,
    },

    /// An error occurred.
    Error { message: String },
}

/// History message for conversation context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CasperHistoryMessage {
    pub role: String,
    pub content: String,
}

/// Helper to emit a Casper event to the frontend.
fn emit_casper_event(app: &AppHandle, event: CasperEvent) {
    if let Err(e) = app.emit("casper-progress", &event) {
        warn!(error = %e, "Failed to emit casper event");
    }
}

/// Ask Casper a question with real-time progress events.
///
/// Uses a persistent MLX Python engine that stays alive across calls.
/// Emits events as the agent works: started, thinking, tool_start,
/// tool_complete, token, token_reset, complete, cancelled, error.
/// `cancel_casper` stops the run.
#[tauri::command]
pub async fn ask_casper_streaming(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
    question: String,
    history: Vec<CasperHistoryMessage>,
    max_iterations: Option<usize>,
    enable_thinking: Option<bool>,
    mentions: Option<Vec<MentionedContact>>,
) -> Result<(), String> {
    let thinking = enable_thinking.unwrap_or(false);
    let mentions = mentions.unwrap_or_default();
    info!(
        question = %question,
        history_len = history.len(),
        thinking = thinking,
        mentions = mentions.len(),
        "Casper streaming query received"
    );

    let cancel = state.begin_casper_run();
    let result = run_casper(
        &state,
        &app,
        question,
        history,
        max_iterations,
        thinking,
        mentions,
        &cancel,
    )
    .await;
    state.end_casper_run(&cancel);
    result
}

/// Stop the Casper run in progress.
///
/// The run stops at the next generated token or agent step and emits a
/// `cancelled` event. Returns false if no run was in progress.
#[tauri::command]
pub fn cancel_casper(state: tauri::State<'_, crate::AppState>) -> bool {
    let cancelled = state.cancel_casper_run();
    info!(cancelled, "Casper cancel requested");
    cancelled
}

/// The body of `ask_casper_streaming`, run under a registered cancel token.
#[allow(clippy::too_many_arguments)]
async fn run_casper(
    state: &crate::AppState,
    app: &AppHandle,
    question: String,
    history: Vec<CasperHistoryMessage>,
    max_iterations: Option<usize>,
    thinking: bool,
    mentions: Vec<MentionedContact>,
    cancel: &inference::CancelToken,
) -> Result<(), String> {
    let app = app.clone();

    // Ensure Python environment exists (fast no-op when already set up)
    if let Err(e) = PythonEnvironment::ensure(&app).await {
        let msg = format!("Failed to setup Python environment: {e}");
        emit_casper_event(&app, CasperEvent::Error { message: msg.clone() });
        return Err(msg);
    }

    let max_iters = max_iterations.unwrap_or(5);

    // Emit started event
    emit_casper_event(
        &app,
        CasperEvent::Started {
            question: question.clone(),
        },
    );

    // Take engine from persistent state (lazy-init if needed)
    let mut guard = match state.get_or_create_casper_engine().await {
        Ok(g) => g,
        Err(e) => {
            let msg = format!("Failed to start engine: {e}");
            emit_casper_event(&app, CasperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };
    let engine = match guard.take() {
        Some(e) => e,
        None => {
            let msg = "Casper engine not available".to_string();
            emit_casper_event(&app, CasperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    let config = AgentConfig::default()
        .with_max_iterations(max_iters)
        .with_enable_thinking(thinking)
        .with_mentions(mentions);
    let mut agent = match CasperAgent::with_engine(config, engine) {
        Ok(a) => a,
        Err(e) => {
            let msg = format!("Failed to create agent: {e}");
            emit_casper_event(&app, CasperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    // Convert history to ChatMessage format
    use inference::config::ChatMessage;
    let chat_history: Vec<ChatMessage> = history
        .iter()
        .map(|m| match m.role.as_str() {
            "user" => ChatMessage::user(&m.content),
            "assistant" => ChatMessage::assistant(&m.content),
            _ => ChatMessage::user(&m.content), // fallback
        })
        .collect();

    // Run the agent with real-time progress events
    let app_ref = app.clone();
    let result = agent
        .ask_with_history_cancellable(
            &question,
            &chat_history,
            |event| match event {
                AgentProgressEvent::Thinking {
                    iteration,
                    max_iterations,
                } => {
                    emit_casper_event(
                        &app_ref,
                        CasperEvent::Thinking {
                            iteration,
                            max_iterations,
                        },
                    );
                }
                AgentProgressEvent::ToolStart {
                    tool_name,
                    arguments,
                    iteration,
                } => {
                    emit_casper_event(
                        &app_ref,
                        CasperEvent::ToolStart {
                            tool_name,
                            arguments,
                            iteration,
                        },
                    );
                }
                AgentProgressEvent::ToolComplete {
                    tool_name,
                    success,
                    duration_ms,
                    result_preview,
                    ..
                } => {
                    emit_casper_event(
                        &app_ref,
                        CasperEvent::ToolComplete {
                            tool_name,
                            success,
                            duration_ms,
                            result_preview,
                        },
                    );
                }
                AgentProgressEvent::Answering => {}
                AgentProgressEvent::AnswerToken { text } => {
                    emit_casper_event(&app_ref, CasperEvent::Token { text });
                }
                AgentProgressEvent::AnswerReset => {
                    emit_casper_event(&app_ref, CasperEvent::TokenReset);
                }
            },
            cancel,
        )
        .await;

    // Always put engine back (alive or dead)
    if let Some(mut engine) = agent.take_engine() {
        if engine.is_alive() {
            *guard = Some(engine);
        } else {
            warn!("Casper engine process died (streaming), will re-create on next query");
        }
    } else {
        warn!("Agent returned no engine (streaming, take_engine() returned None), will re-create on next query");
    }

    let response = match result {
        Ok(r) => r,
        Err(InferenceError::Cancelled) => {
            info!("Casper streaming query cancelled");
            emit_casper_event(&app, CasperEvent::Cancelled);
            return Ok(());
        }
        Err(e) => {
            let msg = format!("Agent error: {e}");
            emit_casper_event(&app, CasperEvent::Error { message: msg.clone() });
            return Err(msg);
        }
    };

    info!(
        iterations = response.iterations,
        duration_ms = response.duration_ms,
        tool_calls = response.tool_calls.len(),
        "Casper streaming query complete"
    );

    // Emit complete event
    emit_casper_event(
        &app,
        CasperEvent::Complete {
            answer: response.answer,
            iterations: response.iterations,
            duration_ms: response.duration_ms,
            tool_calls: response.tool_calls.iter().map(ToolCallInfo::from).collect(),
            thinking: response.thinking,
            thinking_enabled: thinking,
        },
    );

    Ok(())
}

/// Model info for the Casper agent, based on system VRAM tier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CasperModelInfo {
    /// Human-readable name (e.g. "Qwen3.5-9B")
    pub display_name: String,
    /// HuggingFace model ID (4-bit variant used for agent)
    pub model_id: String,
    /// Tier name (e.g. "9b", "4b")
    pub tier_name: String,
    /// Quantization level (e.g. "4-bit")
    pub quantization: String,
}

/// Get info about which model Casper will use (respects user preference).
#[tauri::command]
pub fn get_casper_model_info(state: tauri::State<'_, crate::AppState>) -> Result<CasperModelInfo, String> {
    let pref = state.get_model_preference();
    let tier = common::model_tiers::get_tier_for_preference(pref.as_deref());
    let quant = common::model_tiers::get_quantization_for_preference(pref.as_deref());
    Ok(CasperModelInfo {
        display_name: tier.display_name.to_string(),
        model_id: tier.model_for_quantization(quant).to_string(),
        tier_name: tier.name.to_string(),
        quantization: quant.as_str().to_string(),
    })
}

// =============================================================================
// Casper Thread Persistence (saved conversation threads in brb.db)
// =============================================================================

/// A stored Casper message, as `load_casper_thread` returns it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct CasperMessageDto {
    pub id: i64,
    pub role: String,
    pub content: String,
    /// Parsed tool-call array (round-tripped from stored JSON), if any. The
    /// backend never inspects the elements, so the wire type stays opaque;
    /// `types.ts` narrows it to `CasperToolCall[]` for the UI.
    #[ts(type = "Array<Record<string, unknown>> | null")]
    pub tool_calls: Option<Value>,
    pub thinking: Option<String>,
    pub thinking_enabled: bool,
    pub created_at: String,
}

/// Open the SQLite metadata database (brb.db).
fn open_metadata_db() -> Result<MetadataDb, String> {
    MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {e}"))
}

/// Create a new Casper thread, returning its id.
#[tauri::command]
pub fn create_casper_thread(title: String) -> Result<i64, String> {
    let db = open_metadata_db()?;
    db.create_casper_thread(&title)
        .map_err(|e| format!("Failed to create Casper thread: {e}"))
}

/// List all saved Casper threads (most recently updated first).
#[tauri::command]
pub fn list_casper_threads() -> Result<Vec<CasperThread>, String> {
    let db = open_metadata_db()?;
    db.list_casper_threads()
        .map_err(|e| format!("Failed to list Casper threads: {e}"))
}

/// Append a message to a Casper thread, returning the new message id.
#[tauri::command]
pub fn append_casper_message(
    thread_id: i64,
    role: String,
    content: String,
    thinking: Option<String>,
    thinking_enabled: Option<bool>,
    tool_calls: Option<Value>,
) -> Result<i64, String> {
    let db = open_metadata_db()?;
    let tool_calls_json = match tool_calls {
        Some(v) if !v.is_null() => {
            Some(serde_json::to_string(&v).map_err(|e| format!("Failed to serialize tool calls: {e}"))?)
        }
        _ => None,
    };
    db.append_casper_message(
        thread_id,
        &role,
        &content,
        thinking.as_deref(),
        thinking_enabled.unwrap_or(false),
        tool_calls_json.as_deref(),
    )
    .map_err(|e| format!("Failed to append Casper message: {e}"))
}

/// Load all messages for a Casper thread, shaped for the frontend.
#[tauri::command]
pub fn load_casper_thread(thread_id: i64) -> Result<Vec<CasperMessageDto>, String> {
    let db = open_metadata_db()?;
    let rows = db
        .load_casper_messages(thread_id)
        .map_err(|e| format!("Failed to load Casper thread: {e}"))?;
    let messages = rows
        .into_iter()
        .map(|m| CasperMessageDto {
            id: m.id,
            role: m.role,
            content: m.content,
            tool_calls: m
                .tool_calls
                .as_deref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok()),
            thinking: m.thinking,
            thinking_enabled: m.thinking_enabled,
            created_at: m.created_at,
        })
        .collect();
    Ok(messages)
}

/// Rename a Casper thread.
#[tauri::command]
pub fn rename_casper_thread(thread_id: i64, title: String) -> Result<(), String> {
    let db = open_metadata_db()?;
    db.rename_casper_thread(thread_id, &title)
        .map_err(|e| format!("Failed to rename Casper thread: {e}"))
}

/// Delete a Casper thread and all of its messages.
#[tauri::command]
pub fn delete_casper_thread(thread_id: i64) -> Result<(), String> {
    let db = open_metadata_db()?;
    db.delete_casper_thread(thread_id)
        .map_err(|e| format!("Failed to delete Casper thread: {e}"))
}

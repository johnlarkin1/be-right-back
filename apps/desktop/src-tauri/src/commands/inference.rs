//! Inference commands for chatting with trained personas.

use common::SELF_PERSONA_ID;
use inference::{prompts, ChatMessage as InfChatMessage, GenerationConfig};
use ingestion::{
    apply_recency_boost, format_persona_context, plan_search, MetadataDb, SearchOptions, SearchResult, VectorDb,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tracing::{debug, info};

use crate::AppState;
use training::constants::MSG_BREAK_TOKEN;

/// Join consecutive same-role messages into one turn, separated by `MSG_BREAK_TOKEN`.
fn join_bubbles(history: &[ChatMessage]) -> Vec<(&str, String)> {
    let mut turns: Vec<(&str, String)> = Vec::new();
    for msg in history {
        match turns.last_mut() {
            Some((role, content)) if *role == msg.role => {
                content.push_str(MSG_BREAK_TOKEN);
                content.push_str(&msg.content);
            }
            _ => turns.push((msg.role.as_str(), msg.content.clone())),
        }
    }
    turns
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ChatMessage {
    pub role: String, // "user", "assistant", or "system"
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatTokenPayload {
    pub token: String,
    pub done: bool,
}

/// Metadata about a chat response, sent before its first token.
#[derive(Debug, Clone, Serialize)]
pub struct ChatMetaPayload {
    pub rag_result_count: usize,
    /// Separates the reply's bubbles. The UI splits the reply on it.
    pub msg_break_token: &'static str,
}

/// Chat with the "You" persona, streaming tokens as they're generated.
///
/// The command takes no persona id. "You" is the only persona the app trains.
///
/// This command emits events for real-time UI updates:
/// - `chat-meta`: Emitted once before streaming starts (contains ChatMetaPayload)
/// - `chat-token`: Emitted for each generated token (contains ChatTokenPayload)
#[tauri::command]
pub async fn chat_with_persona_streaming(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    message: String,
    history: Vec<ChatMessage>,
    enable_thinking: Option<bool>,
) -> Result<(), String> {
    let persona_id = SELF_PERSONA_ID;
    info!(
        persona_id,
        message_len = message.len(),
        history_len = history.len(),
        backend = %state.backend,
        "Streaming chat request received"
    );

    let mut system_prompt = get_system_prompt(persona_id)?;

    // RAG first — place conversation excerpts before personality profile so the
    // 4B model gives them more attention (closer to the identity/instructions).
    let mut rag_count = 0usize;
    if let Some((ctx, count)) = retrieve_persona_context(persona_id, &message).await {
        system_prompt.push_str(&ctx);
        rag_count = count;
    }

    // Inject Conversation Analysis personality profile after RAG
    inject_conversation_analysis(persona_id, &mut system_prompt);

    // Emit RAG metadata before streaming starts
    app.emit(
        "chat-meta",
        ChatMetaPayload {
            rag_result_count: rag_count,
            msg_break_token: MSG_BREAK_TOKEN,
        },
    )
    .map_err(|e| format!("Failed to emit chat-meta: {e}"))?;

    let mut messages: Vec<InfChatMessage> = vec![InfChatMessage::system(system_prompt)];

    // History already includes the current user message (appended by the frontend).
    // Don't push `message` again to avoid duplicating it in the prompt.
    // The UI sends one entry per bubble. Training data has one turn per sender,
    // so join each run of same-role bubbles the way the export does.
    for (role, content) in join_bubbles(&history) {
        match role {
            "user" => messages.push(InfChatMessage::user(&content)),
            "assistant" => messages.push(InfChatMessage::assistant(&content)),
            _ => {}
        }
    }

    // Persona chat is user-controlled: the frontend always sends `enable_thinking`
    // (default off, persisted under `brb-thinking-mode`), which intentionally
    // overrides `GenerationConfig::chat()`'s thinking-on default. Personas imitate
    // a texting voice, so chain-of-thought costs latency and tokens without
    // improving the reply. Casper keeps the crate default — it reasons before
    // emitting tool calls.
    let mut config = GenerationConfig::chat();
    if let Some(et) = enable_thinking {
        config.enable_thinking = et;
        if et {
            // A Qwen3.5 <think> block can use 1-2k tokens on its own (see the
            // note on `GenerationConfig::agent()`), so anything near chat()'s 256
            // truncates mid-thought and leaves no answer to show.
            config.max_tokens = 2048;
        }
    }

    let mut engine_guard = state.get_or_create_engine().await?;
    let engine = engine_guard.as_mut().ok_or("Engine not initialized")?;

    if engine.current_persona() != Some(persona_id) {
        engine.load_persona(persona_id).await.map_err(|e| format!("{e}"))?;
    }

    // Use streaming generation
    let mut rx = engine
        .generate_streaming(&messages, &config)
        .await
        .map_err(|e| format!("Failed to start streaming: {e}"))?;

    while let Some(token) = rx.recv().await {
        app.emit("chat-token", ChatTokenPayload { token, done: false })
            .map_err(|e| format!("Failed to emit token: {e}"))?;
    }

    // Signal completion
    app.emit(
        "chat-token",
        ChatTokenPayload {
            token: String::new(),
            done: true,
        },
    )
    .map_err(|e| format!("Failed to emit completion: {e}"))?;

    info!("Streaming generation complete");

    Ok(())
}

/// Retrieve relevant conversation history from the vector database to ground
/// persona responses in actual facts. Returns `None` on any failure so that
/// chat always works even without RAG data. On success, returns the formatted
/// context string and the number of results used.
async fn retrieve_persona_context(persona_id: &str, user_message: &str) -> Option<(String, usize)> {
    // Short messages like "hey" or "lol" don't benefit from RAG.
    if user_message.len() < 10 {
        debug!(
            persona_id,
            msg_len = user_message.len(),
            "Skipping RAG for short message"
        );
        return None;
    }

    // Step 0: Run query planner for temporal extraction and date filtering.
    // We use the planner for date ranges and recency, but embed the RAW query
    // instead of the cleaned one. The cleaned query strips stop words which is
    // good for BM25, but for semantic embedding the full sentence captures
    // intent much better (e.g., "where did you go to school" -> educational
    // background intent, vs just "school" which is too generic).
    let plan = plan_search(user_message);
    let prefer_recent = plan.prefer_recent;
    let plan_min_date = plan.min_date;
    let plan_max_date = plan.max_date;

    debug!(
        persona_id,
        raw_query = user_message,
        ?plan_min_date,
        ?plan_max_date,
        prefer_recent,
        "RAG query planner result"
    );

    // Step 1: Embed the raw query (full sentence for better semantic matching)
    let eq = user_message.to_string();
    let embedding = match tokio::task::spawn_blocking(move || ingestion::embed_query(&eq)).await {
        Ok(Ok(emb)) => emb,
        Ok(Err(e)) => {
            debug!("RAG embed_query failed: {e}");
            return None;
        }
        Err(e) => {
            debug!("RAG embed_query task join error: {e}");
            return None;
        }
    };

    // Step 2: Search the vector database across every conversation.
    //
    // We use semantic-only search (not hybrid) for persona chat because:
    // - Casual factual mentions (e.g., "I was Harvard 2020") rank well by
    //   cosine similarity but poorly in RRF (they don't match BM25/keyword
    //   searches for "school" since they don't contain that word literally)
    // - format_persona_context handles size budgeting, so we over-fetch and
    //   let it pick the best chunks within the character limit
    let results = match tokio::task::spawn_blocking(move || -> Result<Vec<SearchResult>, String> {
        // Read-only: persona-chat RAG is a pure query (see system.rs note).
        let db = VectorDb::open_readonly().map_err(|e| format!("{e}"))?;

        let options = SearchOptions::new()
            .with_limit(100)
            .with_min_similarity(0.15)
            .with_date_range(plan_min_date, plan_max_date);

        db.search(&embedding, options).map_err(|e| format!("{e}"))
    })
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            debug!("RAG search failed: {e}");
            return None;
        }
        Err(e) => {
            debug!("RAG search task join error: {e}");
            return None;
        }
    };

    if results.is_empty() {
        debug!(persona_id, "RAG search returned no results");
        return None;
    }

    // Step 3: Apply recency boost if the query planner detected temporal intent
    let mut results = results;
    apply_recency_boost(&mut results, prefer_recent);

    // The grounding indicator must report excerpts that actually reached the
    // prompt, not raw hits — filtering and the char budget discard most of them.
    let ctx = format_persona_context(&results)?;
    info!(
        persona_id,
        raw_results = results.len(),
        chunk_count = ctx.chunk_count,
        context_len = ctx.text.len(),
        "RAG context retrieved for persona chat"
    );
    Some((ctx.text, ctx.chunk_count))
}

/// Inject Conversation Analysis personality profile into the system prompt.
///
/// If the system prompt doesn't already contain a personality/communication style
/// section (from training-time analysis), this loads the cached Conversation Analysis
/// from SQLite and appends a truncated version to provide personality context.
fn inject_conversation_analysis(persona_id: &str, system_prompt: &mut String) {
    // Skip if the system prompt already has personality analysis from training
    if system_prompt.contains("Personality") || system_prompt.contains("Communication Style") {
        debug!(
            persona_id,
            "System prompt already contains personality section, skipping injection"
        );
        return;
    }

    let db = match MetadataDb::open() {
        Ok(d) => d,
        Err(e) => {
            debug!("Failed to open MetadataDb for analysis injection: {e}");
            return;
        }
    };

    let analysis = match db.get_conversation_analysis(persona_id) {
        Ok(Some(a)) => a,
        Ok(None) => {
            debug!(persona_id, "No conversation analysis found for persona");
            return;
        }
        Err(e) => {
            debug!("Failed to fetch conversation analysis: {e}");
            return;
        }
    };

    // Truncate to ~1500 chars at a section boundary (## or \n\n)
    let max_chars = 1500;
    let text = &analysis.analysis_markdown;
    let truncated = if text.len() <= max_chars {
        text.clone()
    } else {
        // Find a valid char boundary at or before max_chars
        let safe_boundary = text.floor_char_boundary(max_chars);
        // Try to truncate at a markdown section boundary
        let search_area = &text[..safe_boundary];
        let cutoff = search_area
            .rfind("\n## ")
            .or_else(|| search_area.rfind("\n\n"))
            .unwrap_or(safe_boundary);
        text[..cutoff].to_string()
    };

    info!(
        persona_id,
        analysis_len = truncated.len(),
        "Injecting conversation analysis into system prompt"
    );

    system_prompt.push_str(&format!("\n\n## Personality Profile\n\n{truncated}"));
}

/// Get the system prompt for a persona
fn get_system_prompt(persona_id: &str) -> Result<String, String> {
    let persona_dir = personas::get_persona_dir(persona_id).map_err(|e| e.to_string())?;
    let metadata_path = persona_dir.join("chat_metadata.json");

    if !metadata_path.exists() {
        return Ok(prompts::DEFAULT_SYSTEM_PROMPT.to_string());
    }

    let content = std::fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
    let metadata: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Use pre-generated system prompt if available
    if let Some(prompt) = metadata.get("system_prompt").and_then(|v| v.as_str()) {
        if !prompt.is_empty() {
            return Ok(prompt.to_string());
        }
    }

    // Fallback to basic prompt
    let contact_name = metadata
        .get("contact_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown");

    Ok(prompts::build_persona_fallback_prompt(contact_name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn join_bubbles_merges_same_role_runs() {
        let history = vec![
            msg("user", "hey"),
            msg("user", "you around?"),
            msg("assistant", "ya"),
            msg("assistant", "two\nlines"),
            msg("user", "ok"),
        ];
        let turns = join_bubbles(&history);
        let expected = vec![
            ("user", format!("hey{MSG_BREAK_TOKEN}you around?")),
            ("assistant", format!("ya{MSG_BREAK_TOKEN}two\nlines")),
            ("user", "ok".to_string()),
        ];
        assert_eq!(turns, expected);
    }
}

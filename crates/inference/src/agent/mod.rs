//! Casper agent for searching and interacting with iMessage history.
//!
//! This module provides an AI agent that can use tools to explore message history:
//!
//! - `list_contacts`: List contacts with message counts
//! - `search_messages`: Semantic search over messages
//! - `get_conversation_context`: Get messages around a point in time
//! - `get_contact_stats`: Get conversation statistics
//! - `get_message_volume_by_period`: Message volume per contact in a date range
//! - `get_conversation_analysis`: Pre-computed conversation analysis
//! - `get_topic_clusters`: Topic clusters from Leiden analysis
//!
//! # Architecture
//!
//! The agent uses a Rust-based control loop with Python subprocess for:
//! - Query embedding generation (via MLX)
//! - LLM inference (via MLX)
//!
//! Tool execution happens entirely in Rust for maximum performance.
//!
//! # Example
//!
//! ```ignore
//! use inference::agent::{CasperAgent, AgentConfig};
//! use inference::engines::mlx_python::MLXPythonEngine;
//!
//! // Create agent with engine
//! let engine = MLXPythonEngine::spawn()?;
//! let mut agent = CasperAgent::with_engine(AgentConfig::default(), engine)?;
//!
//! // Ask a question
//! let response = agent.ask("What did Alice say about the party?").await?;
//! println!("{}", response.answer);
//! ```

pub mod answer_stream;
pub mod builtin;
pub mod parser;
pub mod planning;
pub mod prompts;
pub mod tools;
pub mod trace;

use common::DEFAULT_MLX_AGENT_MODEL;
use ingestion::{SearchPlan, SortDirection, expand_search_queries, plan_search};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tracing::{debug, info, warn};

use self::answer_stream::AnswerStream;
use crate::cancel::CancelToken;
use crate::config::{ChatMessage, GenerationConfig};
use crate::engines::mlx_python::MLXPythonEngine;
use crate::error::{InferenceError, Result};

pub use parser::{ParsedResponse, format_tool_response, parse_tool_calls};
pub use prompts::{
    CASPER_SYSTEM_PROMPT_QWEN3, SYNTHESIS_PROMPT, build_system_prompt_qwen3, build_system_prompt_qwen3_with_base,
};
pub use tools::{Tool, ToolCall, ToolCallRecord, ToolRegistry, ToolResult};

/// A contact the user explicitly tagged with "@" in the Casper input.
///
/// Carries the stable `contact_id` (phone/email) so the agent can scope its
/// DuckDB + SQLite queries to it without re-resolving a display name.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "inference.ts")]
pub struct MentionedContact {
    /// Stable contact identifier (phone number or email).
    pub contact_id: String,
    /// Human-readable name shown in the UI.
    pub display_name: String,
}

/// Configuration for the Casper agent.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Maximum number of tool call iterations before giving up.
    pub max_iterations: usize,
    /// Generation configuration for LLM calls.
    pub generation_config: GenerationConfig,
    /// Optional custom system prompt.
    pub system_prompt: Option<String>,
    /// Whether thinking mode is enabled for this agent session.
    pub enable_thinking: bool,
    /// Contacts the user tagged with "@" for this turn (scopes the search).
    pub mentioned_contacts: Vec<MentionedContact>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_iterations: 5, // Allow enough rounds for multi-step inference (prefetch + 2-3 searches + answer)
            generation_config: GenerationConfig::agent(),
            system_prompt: None,
            enable_thinking: false,
            mentioned_contacts: Vec::new(),
        }
    }
}

impl AgentConfig {
    /// Create a config with a custom max iterations.
    pub fn with_max_iterations(mut self, max: usize) -> Self {
        self.max_iterations = max;
        self
    }

    /// Create a config with a custom system prompt.
    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    /// Enable or disable thinking mode.
    pub fn with_enable_thinking(mut self, enable: bool) -> Self {
        self.enable_thinking = enable;
        self.generation_config.enable_thinking = enable;
        self
    }

    /// Set the contacts the user tagged with "@" for this turn.
    pub fn with_mentions(mut self, mentions: Vec<MentionedContact>) -> Self {
        self.mentioned_contacts = mentions;
        self
    }
}

/// Progress events emitted during agent execution for real-time UI updates.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentProgressEvent {
    /// Agent is about to generate a response (thinking).
    Thinking { iteration: usize, max_iterations: usize },
    /// Agent is about to execute a tool.
    ToolStart {
        tool_name: String,
        arguments: Value,
        iteration: usize,
    },
    /// A tool call has completed.
    ToolComplete {
        tool_name: String,
        success: bool,
        duration_ms: u64,
        result_preview: String,
        iteration: usize,
    },
    /// Agent is generating the final answer (no more tool calls).
    Answering,
    /// New text for the live answer preview.
    ///
    /// The preview is raw model output with thinking and tool calls removed.
    /// The final `AgentResponse::answer` replaces it.
    AnswerToken { text: String },
    /// Clear the live answer preview.
    ///
    /// Sent when text already streamed belongs to an iteration that did not
    /// produce the final answer (a tool call, or a response the guards rejected).
    AnswerReset,
}

/// Response from the Casper agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResponse {
    /// The final answer text.
    pub answer: String,
    /// Record of all tool calls made.
    pub tool_calls: Vec<ToolCallRecord>,
    /// Number of iterations taken.
    pub iterations: usize,
    /// Total time taken in milliseconds.
    pub duration_ms: u64,
    /// Thinking content from the model (for display in collapsible UI).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}

/// The Casper agent for exploring iMessage history.
///
/// Casper is an AI agent that can search and retrieve information from
/// the user's iMessage history using a set of built-in tools.
pub struct CasperAgent {
    /// Configuration for the agent.
    config: AgentConfig,
    /// Registry of available tools.
    tools: ToolRegistry,
    /// Optional MLX Python engine for inference and embeddings.
    engine: Option<MLXPythonEngine>,
}

impl CasperAgent {
    /// Create a new Casper agent with default tools but no engine.
    ///
    /// This registers the built-in tools:
    /// - `list_contacts`
    /// - `search_messages`
    /// - `get_conversation_context`
    /// - `get_contact_stats`
    /// - `get_message_volume_by_period`
    /// - `get_conversation_analysis`
    /// - `get_topic_clusters`
    ///
    /// You must call `set_engine()` or use `with_engine()` before calling `ask()`.
    /// Uses Qwen3 model by default for reliable tool calling.
    pub fn new(config: AgentConfig) -> Result<Self> {
        let tools = Self::create_builtin_tools();

        info!(
            tools = tools.len(),
            max_iterations = config.max_iterations,
            "Created Casper agent with built-in tools (no engine)"
        );

        Ok(Self {
            config,
            tools,
            engine: None,
        })
    }

    /// Create a new Casper agent with an engine ready for inference.
    ///
    /// This is the recommended constructor for interactive use.
    /// Uses Qwen3 model by default for reliable tool calling.
    pub fn with_engine(config: AgentConfig, engine: MLXPythonEngine) -> Result<Self> {
        let tools = Self::create_builtin_tools();

        info!(
            tools = tools.len(),
            max_iterations = config.max_iterations,
            "Created Casper agent with built-in tools and engine"
        );

        Ok(Self {
            config,
            tools,
            engine: Some(engine),
        })
    }

    /// Create a Casper agent with custom tools.
    pub fn with_tools(config: AgentConfig, tools: ToolRegistry) -> Self {
        Self {
            config,
            tools,
            engine: None,
        }
    }

    /// Create the built-in tools.
    ///
    /// All tools use `common::get_db_dir()` internally for database access,
    /// ensuring consistent path resolution across the codebase.
    fn create_builtin_tools() -> ToolRegistry {
        let mut tools = ToolRegistry::new();
        tools.register(builtin::ListContactsTool);
        tools.register(builtin::GetContactStatsTool);
        tools.register(builtin::GetConversationContextTool);
        tools.register(builtin::SearchMessagesTool::new());
        tools.register(builtin::GetMessageVolumeTool);
        tools.register(builtin::GetConversationAnalysisTool);
        tools.register(builtin::GetTopicClustersTool);
        tools
    }

    /// Take the engine out of the agent (for reuse elsewhere).
    pub fn take_engine(&mut self) -> Option<MLXPythonEngine> {
        self.engine.take()
    }

    /// Get a reference to the tool registry.
    pub fn tools(&self) -> &ToolRegistry {
        &self.tools
    }

    /// Build the system prompt for this agent.
    ///
    /// Uses Qwen3's standard OpenAI function calling format.
    fn build_system_prompt(&self) -> String {
        match &self.config.system_prompt {
            Some(custom) => prompts::build_system_prompt_qwen3_with_base(custom, &self.tools),
            None => prompts::build_system_prompt_qwen3(&self.tools),
        }
    }

    /// Execute a single tool call.
    fn execute_tool_call(&self, call: &ToolCall) -> ToolCallRecord {
        let start = Instant::now();

        debug!(tool = call.name, args = ?call.arguments, "Executing tool");

        let result = match self.tools.execute(call) {
            Ok(result) => result,
            Err(e) => {
                warn!(tool = call.name, error = %e, "Tool execution failed");
                ToolResult::error(e.to_string())
            }
        };

        let duration_ms = start.elapsed().as_millis() as u64;

        debug!(
            tool = call.name,
            success = result.success,
            duration_ms = duration_ms,
            "Tool execution complete"
        );

        ToolCallRecord {
            tool_name: call.name.clone(),
            arguments: call.arguments.clone(),
            result,
            duration_ms,
        }
    }

    /// Execute all tool calls, emitting progress events.
    fn execute_tool_calls_with_progress<F: FnMut(AgentProgressEvent)>(
        &self,
        calls: &[ToolCall],
        iteration: usize,
        progress: &mut F,
    ) -> Vec<ToolCallRecord> {
        let mut records = Vec::new();

        for call in calls {
            progress(AgentProgressEvent::ToolStart {
                tool_name: call.name.clone(),
                arguments: call.arguments.clone(),
                iteration,
            });

            let record = self.execute_tool_call(call);

            let result_preview = if record.result.success {
                // search_messages is not truncated - the frontend needs valid JSON to render result cards.
                // Other tools get a short preview since they're only shown in expandable sections.
                if call.name == "search_messages" {
                    record.result.data.to_string()
                } else {
                    truncate(record.result.data.to_string(), 200)
                }
            } else {
                record
                    .result
                    .error
                    .clone()
                    .unwrap_or_else(|| "Unknown error".to_string())
            };

            progress(AgentProgressEvent::ToolComplete {
                tool_name: call.name.clone(),
                success: record.result.success,
                duration_ms: record.duration_ms,
                result_preview,
                iteration,
            });

            records.push(record);
        }

        records
    }

    /// Ask the agent a question.
    ///
    /// The agent will:
    /// 1. Generate a response using the LLM
    /// 2. Parse any tool calls from the response
    /// 3. Execute tools and format results
    /// 4. Continue until the LLM provides a final answer (no more tool calls)
    ///
    /// # Errors
    ///
    /// Returns `InferenceError::NotInitialized` if no engine is configured.
    pub async fn ask(&mut self, question: &str) -> Result<AgentResponse> {
        self.ask_with_history(question, &[]).await
    }

    /// Ask with conversation history.
    ///
    /// The history should contain previous user/assistant messages.
    /// The system prompt is automatically added.
    pub async fn ask_with_history(&mut self, question: &str, history: &[ChatMessage]) -> Result<AgentResponse> {
        self.ask_with_history_progress(question, history, |_| {}).await
    }

    /// Ask with conversation history and a progress callback.
    ///
    /// Same as `ask_with_history` but emits `AgentProgressEvent`s in real-time
    /// via the provided callback, allowing callers to forward events to a UI.
    pub async fn ask_with_history_progress<F: FnMut(AgentProgressEvent)>(
        &mut self,
        question: &str,
        history: &[ChatMessage],
        progress: F,
    ) -> Result<AgentResponse> {
        self.ask_with_history_cancellable(question, history, progress, &CancelToken::new())
            .await
    }

    /// Ask with history, progress events, and cancellation.
    ///
    /// Streams the answer as `AnswerToken` events while the model generates.
    /// When `cancel` fires, the run stops at the next generation token or
    /// iteration boundary and returns `InferenceError::Cancelled`. The engine
    /// goes back into the agent either way.
    pub async fn ask_with_history_cancellable<F: FnMut(AgentProgressEvent)>(
        &mut self,
        question: &str,
        history: &[ChatMessage],
        mut progress: F,
        cancel: &CancelToken,
    ) -> Result<AgentResponse> {
        let start = Instant::now();

        // Build conversation with system prompt (before borrowing engine)
        let system_prompt = self.build_system_prompt();
        let max_iterations = self.config.max_iterations;
        let generation_config = self.config.generation_config.clone();

        let mut messages = vec![ChatMessage::system(&system_prompt)];

        // Add history
        messages.extend(history.iter().cloned());

        // For inferential questions (relationship, frequency, "who" questions),
        // automatically prefetch top contacts so the LLM has frequency data
        // without needing to call list_contacts itself. This compensates for
        // smaller models that may not follow multi-step tool strategies.
        let mut enriched_question = if Self::is_inferential_question(question) {
            info!("Detected inferential question, prefetching top contacts");
            match self.prefetch_top_contacts() {
                Some(context) => format!("{}\n\n{}", question, context),
                None => question.to_string(),
            }
        } else {
            question.to_string()
        };

        // If the user tagged contacts with "@", append an authoritative context
        // block with their exact contact_ids so the model filters on them. When
        // exactly one is tagged we also hard-inject it into search_messages calls
        // below (see `forced_contact_id`), so filtering happens even if the model
        // forgets to pass it.
        if let Some(block) = Self::build_mention_context(&self.config.mentioned_contacts) {
            info!(
                count = self.config.mentioned_contacts.len(),
                "User tagged contacts with @, adding mention context"
            );
            enriched_question = format!("{enriched_question}\n\n{block}");
        }
        let forced_contact_id: Option<String> = match self.config.mentioned_contacts.as_slice() {
            [single] => Some(single.contact_id.clone()),
            _ => None,
        };

        // Add the current question (with optional context enrichment)
        messages.push(ChatMessage::user(&enriched_question));

        info!(question = question, "Starting agent loop");

        // Take engine out temporarily to avoid borrow conflicts
        let mut engine = self.engine.take().ok_or(InferenceError::NotInitialized)?;

        // Load the Qwen3 agent model
        debug!("Using Qwen3 model for agent");
        let model_to_load = Some(DEFAULT_MLX_AGENT_MODEL);

        // Load the model (hot-swap if needed)
        if let Err(e) = engine.load_model_with_override(model_to_load) {
            self.engine = Some(engine);
            return Err(e);
        }

        // Resolve the per-turn date/recency plan up front: regex first, and only
        // when the regex finds no range but the question clearly references time
        // do we spend one short LLM call to extract it. This plan becomes the
        // default date filter for every search_messages call this turn (the model
        // can still override per call). See agent::planning.
        let turn_plan = planning::resolve_turn_plan(&mut engine, question, chrono::Utc::now()).await;
        if cancel.is_cancelled() {
            self.engine = Some(engine);
            return Err(InferenceError::Cancelled);
        }
        if turn_plan.min_date.is_some() || turn_plan.max_date.is_some() {
            info!(
                min_date = ?turn_plan.min_date.map(|d| d.format("%Y-%m-%d").to_string()),
                max_date = ?turn_plan.max_date.map(|d| d.format("%Y-%m-%d").to_string()),
                prefer_recent = turn_plan.prefer_recent,
                "Resolved turn date plan"
            );
        }

        let mut all_tool_calls = Vec::new();
        let mut iterations = 0;
        let mut previous_responses: Vec<String> = Vec::new();
        let mut last_tool_call_json: Option<String> = None;

        // Ordered loop transcript for the optional turn trace. Only populated when
        // CASPER_TRACE_DIR is set, so normal runs pay nothing (no result cloning).
        let trace_on = trace::trace_dir().is_some();
        let mut trace_events: Vec<trace::TraceEvent> = Vec::new();

        let result = loop {
            if cancel.is_cancelled() {
                info!(iteration = iterations, "Agent run cancelled");
                break Err(InferenceError::Cancelled);
            }

            iterations += 1;

            if iterations > max_iterations {
                warn!(
                    iterations = iterations,
                    max = max_iterations,
                    "Exceeded max iterations, running synthesis pass"
                );

                // Add synthesis prompt to ask LLM to summarize findings
                messages.push(ChatMessage::user(prompts::SYNTHESIS_PROMPT));

                // Run one final generation (expecting no tool calls)
                let mut preview = AnswerStream::new();
                let generated = engine
                    .generate_with_tokens(
                        &messages,
                        &generation_config,
                        |token| {
                            if let Some(text) = preview.push(token) {
                                progress(AgentProgressEvent::AnswerToken { text });
                            }
                        },
                        cancel,
                    )
                    .await;
                let synthesis = match generated {
                    Err(InferenceError::Cancelled) => break Err(InferenceError::Cancelled),
                    Ok(r) => {
                        info!(
                            raw_len = r.len(),
                            raw_preview = %r.chars().take(300).collect::<String>(),
                            "Synthesis pass raw response"
                        );
                        // Parse to extract just the text (ignore any accidental tool calls)
                        let text = match parse_tool_calls(&r) {
                            Ok(parsed) => {
                                info!(
                                    has_thinking = parsed.thinking.is_some(),
                                    has_tool_calls = parsed.has_tool_calls,
                                    text_len = parsed.final_text().len(),
                                    "Synthesis pass parsed"
                                );
                                parsed.final_text()
                            }
                            Err(_) => r,
                        };
                        // Guard against empty synthesis (model generated only <think> block
                        // with no answer text). Fall back to tool result summary.
                        if text.trim().is_empty() {
                            warn!("Synthesis pass returned empty text, falling back to tool result summary");
                            Self::synthesize_from_tool_results(&all_tool_calls)
                        } else {
                            text
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "Synthesis generation failed, using fallback");
                        "I gathered some information but couldn't complete the full analysis. Please try a more specific question.".to_string()
                    }
                };

                if trace_on {
                    trace_events.push(trace::TraceEvent::Answer {
                        iteration: iterations,
                        outcome: "synthesis".to_string(),
                        text: synthesis.clone(),
                    });
                }

                break Ok(AgentResponse {
                    answer: synthesis,
                    tool_calls: all_tool_calls,
                    iterations,
                    duration_ms: start.elapsed().as_millis() as u64,
                    thinking: None,
                });
            }

            // Emit thinking event before LLM generation
            progress(AgentProgressEvent::Thinking {
                iteration: iterations,
                max_iterations,
            });

            debug!(iteration = iterations, "Generating LLM response");

            // Generate response, streaming any answer text as a live preview
            let mut preview = AnswerStream::new();
            let generated = engine
                .generate_with_tokens(
                    &messages,
                    &generation_config,
                    |token| {
                        if let Some(text) = preview.push(token) {
                            progress(AgentProgressEvent::AnswerToken { text });
                        }
                    },
                    cancel,
                )
                .await;
            // Clears the preview when this iteration does not end the turn.
            let streamed = preview.has_emitted();
            let reset_preview = |progress: &mut F| {
                if streamed {
                    progress(AgentProgressEvent::AnswerReset);
                }
            };
            let response = match generated {
                Ok(r) => r,
                Err(e) => {
                    // Put engine back before returning error
                    self.engine = Some(engine);
                    return Err(e);
                }
            };

            info!(
                iteration = iterations,
                response_len = response.len(),
                response_preview = %response.chars().take(300).collect::<String>(),
                "LLM response received"
            );

            // Parse the response for tool calls first (before repetition check)
            // This way we can distinguish between repeated tool calls and repeated answers
            let parsed = match parse_tool_calls(&response) {
                Ok(p) => p,
                Err(e) => {
                    self.engine = Some(engine);
                    return Err(e);
                }
            };

            // Record this iteration's thinking (skip empty/whitespace-only).
            if trace_on
                && let Some(t) = parsed.thinking.as_ref()
                && !t.trim().is_empty()
            {
                trace_events.push(trace::TraceEvent::Think {
                    iteration: iterations,
                    text: t.clone(),
                });
            }

            if parsed.has_tool_calls {
                reset_preview(&mut progress);

                // Check for repeated tool calls (model stuck calling same tool)
                let current_tool_json = serde_json::to_string(&parsed.tool_calls).ok();
                if let (Some(current), Some(last)) = (&current_tool_json, &last_tool_call_json)
                    && current == last
                {
                    warn!(
                        tool_calls = ?parsed.tool_calls,
                        "Detected repeated tool call, forcing answer"
                    );
                    // Force the model to give an answer based on the last tool results
                    let last_result = all_tool_calls
                        .last()
                        .map(|r| {
                            if r.result.success {
                                format!(
                                    "Based on the tool results, I couldn't find the information you're looking for. {}",
                                    r.result.data.get("note").and_then(|n| n.as_str()).unwrap_or("")
                                )
                            } else {
                                "I encountered an error while searching. Please try again.".to_string()
                            }
                        })
                        .unwrap_or_else(|| "I was unable to find the requested information.".to_string());

                    if trace_on {
                        let tool = parsed
                            .tool_calls
                            .first()
                            .map(|c| c.name.as_str())
                            .unwrap_or("<unknown>");
                        trace_events.push(trace::TraceEvent::Guard {
                            iteration: iterations,
                            reason: "duplicate_tool_call".to_string(),
                            detail: format!(
                                "Tool call for `{tool}` is byte-identical to the previous iteration's \
                                 (last_tool_call_json == current). The model is looping; forcing an \
                                 answer from the results we already have."
                            ),
                        });
                        trace_events.push(trace::TraceEvent::Answer {
                            iteration: iterations,
                            outcome: "forced".to_string(),
                            text: last_result.clone(),
                        });
                    }

                    break Ok(AgentResponse {
                        answer: last_result,
                        tool_calls: all_tool_calls,
                        iterations,
                        duration_ms: start.elapsed().as_millis() as u64,
                        thinking: parsed.thinking.clone(),
                    });
                }
                last_tool_call_json = current_tool_json;

                info!(
                    count = parsed.tool_calls.len(),
                    iteration = iterations,
                    "Executing tool calls"
                );

                // Inject embeddings for search_messages calls.
                // Run on a blocking thread because embed_query() does synchronous
                // socket I/O to the Python daemon, which would starve the tokio
                // executor under concurrent queries.
                let question_owned = question.to_string();
                let tool_calls = parsed.tool_calls;
                let turn_plan_for_inject = turn_plan.clone();
                let forced_contact_for_inject = forced_contact_id.clone();
                let (engine_back, calls_result) = tokio::task::spawn_blocking(move || {
                    let result = CasperAgent::inject_embeddings(
                        &mut engine,
                        tool_calls,
                        &question_owned,
                        &turn_plan_for_inject,
                        forced_contact_for_inject.as_deref(),
                    );
                    (engine, result)
                })
                .await
                .map_err(|e| InferenceError::BackendError(format!("embedding task panicked: {e}")))?;
                engine = engine_back;
                let calls = match calls_result {
                    Ok(c) => c,
                    Err(e) => {
                        self.engine = Some(engine);
                        return Err(e);
                    }
                };

                // Execute all tool calls with real-time progress events
                let mut records = self.execute_tool_calls_with_progress(&calls, iterations, &mut progress);

                // Cross-encoder rerank: re-sort search_messages results by relevance
                Self::rerank_search_results(&mut engine, &mut records);

                // Format the (potentially reranked) results for the LLM
                let formatted_response = Self::format_tool_records(&records);

                // Record each call + its result in the loop transcript, in the
                // order (and ranking) the model actually saw.
                if trace_on {
                    for r in &records {
                        trace_events.push(trace::TraceEvent::ToolCall {
                            iteration: iterations,
                            tool_name: r.tool_name.clone(),
                            arguments: trace::clean_args(&r.arguments),
                        });
                        trace_events.push(trace::TraceEvent::ToolResponse {
                            iteration: iterations,
                            tool_name: r.tool_name.clone(),
                            success: r.result.success,
                            duration_ms: r.duration_ms,
                            data: r.result.data.clone(),
                            error: r.result.error.clone(),
                        });
                    }
                }

                all_tool_calls.extend(records);

                // Add assistant message with ONLY the tool calls in Qwen3.5 XML format
                // Don't include any hallucinated text that came after the tool call
                let tool_call_xml = parser::format_tool_calls_xml(&calls);
                messages.push(ChatMessage::assistant(&tool_call_xml));

                // Add tool response
                messages.push(ChatMessage::tool_response(&formatted_response));

                // Track this response for repetition detection
                previous_responses.push(response.clone());
            } else {
                let answer = parsed.final_text();

                // Detect empty responses (model generated only <think></think> + EOS).
                // Common with small quantized models on simple/meta questions.
                // Nudge the model to actually respond.
                if iterations < max_iterations && answer.trim().is_empty() {
                    warn!(
                        iteration = iterations,
                        "Detected empty response, nudging model to answer"
                    );

                    if trace_on {
                        trace_events.push(trace::TraceEvent::Guard {
                            iteration: iterations,
                            reason: "empty_response".to_string(),
                            detail: "Model returned an empty response (only a <think> block + EOS, \
                                     no answer text). Nudging it to respond directly."
                                .to_string(),
                        });
                    }

                    reset_preview(&mut progress);
                    messages.push(ChatMessage::assistant(&response));
                    messages.push(ChatMessage::user(
                        "Please respond to the user's question directly with a helpful answer.",
                    ));
                    previous_responses.push(response.clone());
                    continue;
                }

                // Detect when the model narrates intent to search instead of
                // actually calling tools (common small-model failure mode).
                // If the answer reads like a plan ("Let me search...", "I'll try...")
                // and we haven't exhausted iterations, nudge it to act.
                if iterations < max_iterations && Self::is_narrated_intent(&answer) {
                    warn!(
                        answer_preview = %answer.chars().take(120).collect::<String>(),
                        iteration = iterations,
                        "Detected narrated intent instead of tool call, nudging model to act"
                    );

                    if trace_on {
                        // The rejected "answer" the model narrated instead of acting.
                        trace_events.push(trace::TraceEvent::Answer {
                            iteration: iterations,
                            outcome: "narrated".to_string(),
                            text: answer.clone(),
                        });
                        trace_events.push(trace::TraceEvent::Guard {
                            iteration: iterations,
                            reason: "narrated_intent".to_string(),
                            detail: "is_narrated_intent() matched — the model described what it \
                                     plans to do but emitted no <tool_call>. Rejecting it as a final \
                                     answer and nudging it to actually call the tool."
                                .to_string(),
                        });
                    }

                    // Add the model's response, then a nudge to actually call tools
                    reset_preview(&mut progress);
                    messages.push(ChatMessage::assistant(&response));
                    messages.push(ChatMessage::user(
                        "Don't describe what you plan to do — actually call the tool now. \
                         Use <tool_call> to search.",
                    ));
                    previous_responses.push(response.clone());
                    continue;
                }

                // No tool calls - this is the final answer
                progress(AgentProgressEvent::Answering);

                let mut answer = answer;
                let mut answer_kind = "final";

                // Check for repetitive text answers (model stuck generating same text)
                if Self::is_repetitive(&answer, &previous_responses) {
                    warn!(
                        answer_preview = %answer.chars().take(100).collect::<String>(),
                        "Detected repetitive text answer, synthesizing from tool results"
                    );
                    if trace_on {
                        trace_events.push(trace::TraceEvent::Guard {
                            iteration: iterations,
                            reason: "repetitive_text".to_string(),
                            detail: "Answer prefix matched an earlier response (is_repetitive) — \
                                     the model is repeating itself. Synthesizing from tool results \
                                     instead of returning the looped text."
                                .to_string(),
                        });
                    }
                    // Synthesize a proper answer from tool results instead of using looped text
                    answer = Self::synthesize_from_tool_results(&all_tool_calls);
                    answer_kind = "synthesis";
                }

                // Final guard: never return an empty answer to the user
                if answer.trim().is_empty() {
                    warn!("Final answer is empty, falling back to tool result summary");
                    answer = Self::synthesize_from_tool_results(&all_tool_calls);
                    answer_kind = "synthesis";
                }

                info!(
                    iterations = iterations,
                    answer_len = answer.len(),
                    "Agent reached final answer"
                );

                if trace_on {
                    trace_events.push(trace::TraceEvent::Answer {
                        iteration: iterations,
                        outcome: answer_kind.to_string(),
                        text: answer.clone(),
                    });
                }

                let duration_ms = start.elapsed().as_millis() as u64;

                break Ok(AgentResponse {
                    answer,
                    tool_calls: all_tool_calls,
                    iterations,
                    duration_ms,
                    thinking: parsed.thinking,
                });
            }
        };

        // Put engine back
        self.engine = Some(engine);

        // Optional dev-only turn trace (no-op unless CASPER_TRACE_DIR is set).
        // Captures the full turn — plan, tool calls, retrieved snippets, answer —
        // for the website's agent-loop playground and live-loop debugging.
        if let Ok(ref response) = result {
            trace::write_turn(question, &turn_plan, response, &trace_events);
        }

        result
    }

    /// Check if response is repetitive compared to previous responses.
    ///
    /// Detects when the model is stuck in a loop by checking if the current
    /// response's prefix matches any previous response.
    fn is_repetitive(response: &str, previous: &[String]) -> bool {
        // Only check responses with substantial content
        if response.len() < 50 {
            return false;
        }
        let prefix_len = response.floor_char_boundary(50.min(response.len()));
        let prefix = &response[..prefix_len];
        previous.iter().any(|prev| prev.contains(prefix))
    }

    /// Detect when the model describes what it plans to do instead of making tool calls.
    ///
    /// Small models sometimes narrate "Let me search for..." or "I'll try..." instead of
    /// actually emitting `<tool_call>` blocks. This catches those cases so the agent loop
    /// can nudge the model to act.
    fn is_narrated_intent(response: &str) -> bool {
        let lower = response.to_lowercase();
        // Must contain a planning phrase
        let has_planning_phrase = [
            "let me search",
            "let me try",
            "let me refine",
            "let me check",
            "let me look",
            "i'll search",
            "i'll try",
            "i'll check",
            "i'll look",
            "i will search",
            "i will try",
            "i should search",
            "i should try",
            "i need to search",
            "i need to try",
        ]
        .iter()
        .any(|phrase| lower.contains(phrase));

        if !has_planning_phrase {
            return false;
        }

        // Confirm it doesn't contain a substantive answer (short narration = intent, not answer)
        // If the response is very long, it might be a real answer that happens to mention
        // "let me check" as a transition. Keep the threshold generous.
        response.len() < 1500
    }

    /// Format a number with comma separators (e.g., 88935 -> "88,935").
    fn format_number(n: i64) -> String {
        let s = n.to_string();
        let mut result = String::new();
        let chars: Vec<char> = s.chars().collect();
        for (i, c) in chars.iter().enumerate() {
            if i > 0 && (chars.len() - i).is_multiple_of(3) {
                result.push(',');
            }
            result.push(*c);
        }
        result
    }

    /// Synthesize a human-readable answer from tool results.
    ///
    /// Used as a fallback when the model generates repetitive/looped text.
    /// Extracts data from tool results and formats it into a proper response.
    fn synthesize_from_tool_results(tool_calls: &[ToolCallRecord]) -> String {
        // Look at the most recent successful tool result
        for record in tool_calls.iter().rev() {
            if !record.result.success {
                continue;
            }

            match record.tool_name.as_str() {
                "list_contacts" => {
                    // Extract contacts array and format top result
                    if let Some(contacts) = record.result.data.get("contacts").and_then(|c| c.as_array())
                        && let Some(first) = contacts.first()
                    {
                        let name = first.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown");
                        let count = first.get("message_count").and_then(|c| c.as_i64()).unwrap_or(0);
                        return format!(
                            "Based on your message history, {} is your most frequent contact with {} messages.",
                            name,
                            Self::format_number(count)
                        );
                    }
                }
                "get_contact_stats" => {
                    // Extract contact stats and format summary
                    if let Some(name) = record.result.data.get("contact_name").and_then(|n| n.as_str()) {
                        let total = record
                            .result
                            .data
                            .get("total_messages")
                            .and_then(|t| t.as_i64())
                            .unwrap_or(0);
                        let sent = record
                            .result
                            .data
                            .get("sent_messages")
                            .and_then(|s| s.as_i64())
                            .unwrap_or(0);
                        let received = record
                            .result
                            .data
                            .get("received_messages")
                            .and_then(|r| r.as_i64())
                            .unwrap_or(0);
                        return format!(
                            "Your conversation with {} has {} total messages ({} sent, {} received).",
                            name,
                            Self::format_number(total),
                            Self::format_number(sent),
                            Self::format_number(received)
                        );
                    }
                }
                "search_messages" => {
                    // Extract search results summary
                    if let Some(results) = record.result.data.get("results").and_then(|r| r.as_array()) {
                        if results.is_empty() {
                            return "I searched your messages but didn't find any relevant results.".to_string();
                        }
                        let count = results.len();
                        return format!(
                            "I found {} relevant message{}. Would you like me to show you the details?",
                            count,
                            if count == 1 { "" } else { "s" }
                        );
                    }
                }
                "get_conversation_context" => {
                    // Extract conversation context summary
                    if let Some(messages) = record.result.data.get("messages").and_then(|m| m.as_array()) {
                        let count = messages.len();
                        return format!(
                            "I retrieved {} message{} from the conversation context.",
                            count,
                            if count == 1 { "" } else { "s" }
                        );
                    }
                }
                "get_message_volume_by_period" => {
                    if let Some(contacts) = record.result.data.get("contacts").and_then(|c| c.as_array()) {
                        if contacts.is_empty() {
                            return "I didn't find any message activity in that time period.".to_string();
                        }
                        if let Some(first) = contacts.first() {
                            let name = first.get("contact_name").and_then(|n| n.as_str()).unwrap_or("Unknown");
                            let total = first.get("total_messages").and_then(|t| t.as_i64()).unwrap_or(0);
                            return format!(
                                "In that period you messaged {} most, with {} messages.",
                                name,
                                Self::format_number(total)
                            );
                        }
                    }
                }
                "get_conversation_analysis" => {
                    // An analysis that simply doesn't exist comes back successful with
                    // `available: false` — say so plainly rather than claiming an error.
                    if record.result.data.get("available") == Some(&serde_json::Value::Bool(false)) {
                        return "I don't have a pre-computed analysis for that contact. Try asking \
                                me to search your messages with them instead."
                            .to_string();
                    }
                    if let Some(analysis) = record.result.data.get("analysis").and_then(|a| a.as_str())
                        && !analysis.is_empty()
                    {
                        return format!(
                            "Here's what I found in your conversation analysis:\n\n{}",
                            truncate(analysis.to_string(), 1200)
                        );
                    }
                }
                "get_topic_clusters" => {
                    if let Some(clusters) = record.result.data.get("clusters").and_then(|c| c.as_array()) {
                        if clusters.is_empty() {
                            return "I couldn't find any topic clusters to summarize.".to_string();
                        }
                        let labels: Vec<&str> = clusters
                            .iter()
                            .filter_map(|c| c.get("label").and_then(|l| l.as_str()))
                            .take(5)
                            .collect();
                        if !labels.is_empty() {
                            return format!("Your main conversation topics are: {}.", labels.join(", "));
                        }
                    }
                }
                _ => {}
            }
        }

        // Fallback if we couldn't extract useful data
        "I was unable to complete the request. Please try rephrasing your question.".to_string()
    }
}

/// Truncate a string to a maximum length, adding "..." if truncated.
/// Uses char boundaries to avoid panicking on multi-byte UTF-8 characters.
fn truncate(s: String, max_len: usize) -> String {
    if s.len() <= max_len {
        s
    } else {
        let target = max_len.saturating_sub(3);
        // Find the nearest char boundary at or before `target`
        let end = s.floor_char_boundary(target);
        format!("{}...", &s[..end])
    }
}

impl CasperAgent {
    /// Detect whether a question is inferential/relational, requiring frequency data.
    ///
    /// These questions benefit from having top contact data pre-injected so the LLM
    /// can reason about messaging patterns without needing to call `list_contacts` first.
    fn is_inferential_question(question: &str) -> bool {
        let q = question.to_lowercase();
        // Relationship/identity questions
        let relationship_patterns = [
            "girlfriend",
            "boyfriend",
            "partner",
            "dating",
            "relationship",
            "wife",
            "husband",
            "significant other",
            "best friend",
            "closest friend",
            "closest to",
            "talk to most",
            "text the most",
            "message the most",
            "who do i",
            "who am i",
            "who is my",
            "who are my",
            "most frequent",
            "top contact",
            "communication style",
            // NB: no "describe my relationship" entry — "relationship" above already
            // matches it, since this is a substring scan over the lowercased question.
            "what do i talk about",
            "what topics",
            "what do we discuss",
            "what do i discuss",
        ];
        relationship_patterns.iter().any(|p| q.contains(p))
    }

    /// Pre-fetch the top contacts by message count.
    ///
    /// Returns a formatted context string with the user's most frequent contacts,
    /// or None if the data can't be fetched.
    fn prefetch_top_contacts(&self) -> Option<String> {
        let tool = self.tools.get("list_contacts")?;
        let result = tool
            .execute(serde_json::json!({
                "limit": 15,
                "min_messages": 50
            }))
            .ok()?;

        if !result.success {
            return None;
        }

        let contacts = result.data.get("contacts")?.as_array()?;
        if contacts.is_empty() {
            return None;
        }

        let mut lines = Vec::new();
        lines.push("[CONTEXT: Your top contacts by message volume]".to_string());
        for (i, c) in contacts.iter().enumerate() {
            let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("Unknown");
            let cid = c.get("contact_id").and_then(|v| v.as_str()).unwrap_or("");
            let count = c.get("message_count").and_then(|v| v.as_i64()).unwrap_or(0);
            let latest = c.get("latest_message").and_then(|v| v.as_str()).unwrap_or("unknown");
            lines.push(format!(
                "{}. {} (id: {}) - {} messages (last: {})",
                i + 1,
                name,
                cid,
                Self::format_number(count),
                latest
            ));
        }
        lines.push(
            "IMPORTANT: When calling tools, use the contact_id value shown in parentheses (e.g., +15551234567), NOT the display name."
                .to_string(),
        );

        Some(lines.join("\n"))
    }

    /// Build a context block for contacts the user explicitly tagged with "@".
    ///
    /// Returns `None` when nothing was tagged. The block lists each contact's
    /// exact `contact_id` and instructs the model to filter on it, reinforcing
    /// the hard `_contact_id` injection done in `inject_embeddings`.
    fn build_mention_context(mentions: &[MentionedContact]) -> Option<String> {
        if mentions.is_empty() {
            return None;
        }
        let mut lines = Vec::with_capacity(mentions.len() + 2);
        lines.push("[CONTEXT: Contacts the user explicitly tagged with @]".to_string());
        for m in mentions {
            lines.push(format!("- {} (id: {})", m.display_name, m.contact_id));
        }
        lines.push(
            "The user tagged these contacts on purpose. Pass the matching contact_id above to \
             search_messages, get_contact_stats, and get_conversation_context. Do NOT search other \
             contacts unless the question clearly asks about someone else."
                .to_string(),
        );
        Some(lines.join("\n"))
    }

    /// Inject embeddings for search_messages tool calls.
    ///
    /// The search_messages tool requires an embedding vector, which we generate
    /// using the MLX Python daemon's embedding model. This function does blocking
    /// I/O and must be called from `spawn_blocking` (see call site).
    fn inject_embeddings(
        engine: &mut MLXPythonEngine,
        mut calls: Vec<ToolCall>,
        user_question: &str,
        turn_plan: &SearchPlan,
        forced_contact_id: Option<&str>,
    ) -> Result<Vec<ToolCall>> {
        for call in &mut calls {
            if call.name == "search_messages" {
                // Use the model's query if provided, otherwise fall back to the user's question.
                // Small quantized models sometimes omit the "query" argument entirely, or
                // (observed in the wild) emit an EMPTY string — e.g. on "what have we talked
                // about lately", where the model leans on the contact+date filter and leaves
                // the topic blank. An empty query embeds to nothing ("All sub-query embeddings
                // failed"), so treat empty/whitespace the same as missing and fall back.
                let query = call
                    .arguments
                    .get("query")
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| {
                        warn!("search_messages called without a usable query, using user question as fallback");
                        user_question.to_string()
                    });

                // Persist the resolved query so downstream consumers (BM25 text, reranking,
                // result metadata) see the same non-empty string we embed below. Overwrite
                // unconditionally: when the model passed an empty query, the stale "" must
                // not survive — `or_insert_with` would leave it in place.
                if let Value::Object(ref mut map) = call.arguments {
                    map.insert("query".to_string(), Value::String(query.clone()));
                }

                // Hard-filter on a single tagged contact: inject its contact_id as a
                // `_`-prefixed key so the search is scoped even if the model omitted
                // (or hallucinated) `contact_id`. This reflects an explicit user
                // choice, so the tool prefers `_contact_id` over the model's own
                // `contact_id` (see `pick_contact_id_arg`). Like `_min_date`, this
                // `_`-prefixed key is stripped from tool-call history.
                if let (Some(cid), Value::Object(map)) = (forced_contact_id, &mut call.arguments) {
                    map.entry("_contact_id".to_string())
                        .or_insert_with(|| Value::String(cid.to_string()));
                }

                // Inject the per-turn plan (regex + LLM fallback, computed from the
                // user's question) as internal `_`-prefixed fallbacks. The model's
                // own explicit, *parseable* min_date/max_date/limit still win in the
                // tool; these only fill the gap when the model omitted a date OR
                // emitted an unparseable one (e.g. "2026-04-31"). Injecting the
                // visible `min_date` arg directly was the old behavior, but a
                // present-but-invalid model date slipped past the `contains_key`
                // guard and silently dropped the whole turn plan, searching all of
                // history. `_`-prefixed keys are stripped from tool-call history by
                // `format_tool_calls_xml`, same as `_embedding`/`_result_count`.
                if let Value::Object(ref mut map) = call.arguments {
                    if let Some(min) = turn_plan.min_date {
                        map.entry("_min_date".to_string())
                            .or_insert(Value::String(min.format("%Y-%m-%d").to_string()));
                    }
                    if let Some(max) = turn_plan.max_date {
                        map.entry("_max_date".to_string())
                            .or_insert(Value::String(max.format("%Y-%m-%d").to_string()));
                    }
                    map.entry("_prefer_recent".to_string())
                        .or_insert(Value::Bool(turn_plan.prefer_recent));
                    if let Some(dir) = turn_plan.superlative {
                        let s = match dir {
                            SortDirection::Newest => "newest",
                            SortDirection::Oldest => "oldest",
                        };
                        map.entry("_superlative".to_string())
                            .or_insert(Value::String(s.to_string()));
                    }
                    map.entry("_result_count".to_string())
                        .or_insert(Value::from(turn_plan.result_count as u64));
                }

                debug!(query = %query, "Generating embedding for search query");

                // Clean + expand the query into focused sub-queries, then embed
                // each (multi-vector RRF fusion). The CLEANED query — not the raw
                // model string, which may be a diluted keyword pile — drives the
                // primary embedding; this is the single highest-leverage recall fix.
                // Falls back to the raw query if cleaning empties it.
                let cleaned = plan_search(&query)
                    .search_queries
                    .into_iter()
                    .find(|s| !s.is_empty())
                    .unwrap_or_else(|| query.clone());
                let sub_queries = expand_search_queries(&cleaned, 3);

                // Embed each sub-query using the daemon (blocking I/O - see TODO above).
                let mut embeddings: Vec<Value> = Vec::with_capacity(sub_queries.len());
                for sq in &sub_queries {
                    match engine.embed_query(sq) {
                        Ok(emb) => embeddings.push(Value::Array(emb.into_iter().map(Value::from).collect())),
                        Err(e) => {
                            warn!(error = %e, "Failed to embed sub-query, skipping");
                            debug!(sub_query = %sq, "Sub-query that failed to embed");
                        }
                    }
                }
                if embeddings.is_empty() {
                    warn!("All sub-query embeddings failed, skipping injection");
                    continue;
                }

                // Inject the embeddings so the tool can run multi-vector fusion.
                if let Value::Object(ref mut map) = call.arguments {
                    map.insert("_embeddings".to_string(), Value::Array(embeddings));
                }

                debug!("Embedding injected for search_messages");
            }
        }

        Ok(calls)
    }

    /// Rerank search_messages results using a cross-encoder model.
    ///
    /// After hybrid search returns results ranked by RRF score, the cross-encoder
    /// provides a more precise relevance score by jointly encoding (query, passage)
    /// pairs. This is more accurate than bi-encoder similarity but too slow for
    /// initial retrieval, hence the retrieve-then-rerank pattern.
    ///
    /// Modifies tool records in-place. If reranking fails (e.g., model not available),
    /// the original ordering is preserved.
    fn rerank_search_results(engine: &mut MLXPythonEngine, records: &mut [ToolCallRecord]) {
        for record in records.iter_mut() {
            if record.tool_name != "search_messages" || !record.result.success {
                continue;
            }

            // Extract query and results array
            let query = match record.result.data.get("query").and_then(|v| v.as_str()) {
                Some(q) => q.to_string(),
                None => continue,
            };

            let results = match record.result.data.get("results").and_then(|v| v.as_array()) {
                Some(arr) if arr.len() >= 2 => arr.clone(),
                _ => continue, // Nothing to rerank with 0 or 1 results
            };

            // Extract conversation text from each result as passages for the cross-encoder
            let passages: Vec<String> = results
                .iter()
                .map(|r| r.get("conversation").and_then(|v| v.as_str()).unwrap_or("").to_string())
                .collect();

            debug!(
                query = %query,
                passages = passages.len(),
                "Reranking search results with cross-encoder"
            );

            // Call the cross-encoder via the daemon
            let scores = match engine.rerank(&query, &passages) {
                Ok(s) => s,
                Err(e) => {
                    warn!(error = %e, "Cross-encoder reranking failed, keeping original order");
                    continue;
                }
            };

            if scores.len() != results.len() {
                warn!(
                    scores = scores.len(),
                    results = results.len(),
                    "Score count mismatch, keeping original order"
                );
                continue;
            }

            // Create (score, result) pairs and sort by score descending
            let mut scored: Vec<(f32, Value)> = scores.into_iter().zip(results).collect();
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

            let reranked: Vec<Value> = scored.into_iter().map(|(_, r)| r).collect();
            let count = reranked.len();

            debug!(count = count, "Reranking complete");

            // Update the tool result with reranked results
            record.result.data = serde_json::json!({
                "query": query,
                "results": reranked,
                "count": count
            });
        }
    }

    /// Format tool call records into a combined response string for the LLM.
    ///
    /// This reconstructs the formatted response from (potentially reranked) records,
    /// matching the format that `execute_tool_calls_with_progress` originally produced.
    fn format_tool_records(records: &[ToolCallRecord]) -> String {
        let responses: Vec<Value> = records
            .iter()
            .map(|r| {
                if r.result.success {
                    r.result.data.clone()
                } else {
                    serde_json::json!({
                        "error": r.result.error.as_deref().unwrap_or("unknown error")
                    })
                }
            })
            .collect();

        let combined = if responses.len() == 1 {
            responses.into_iter().next().unwrap()
        } else {
            Value::Array(responses)
        };

        format_tool_response(&combined)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_config_default() {
        let config = AgentConfig::default();
        assert_eq!(config.max_iterations, 5);
    }

    #[test]
    fn test_agent_config_builder() {
        let config = AgentConfig::default()
            .with_max_iterations(10)
            .with_system_prompt("Custom prompt");
        assert_eq!(config.max_iterations, 10);
        assert_eq!(config.system_prompt, Some("Custom prompt".to_string()));
    }

    #[test]
    fn test_agent_config_with_mentions() {
        let config = AgentConfig::default().with_mentions(vec![MentionedContact {
            contact_id: "+15551234567".to_string(),
            display_name: "Riley Chen".to_string(),
        }]);
        assert_eq!(config.mentioned_contacts.len(), 1);
        assert_eq!(config.mentioned_contacts[0].contact_id, "+15551234567");
    }

    #[test]
    fn test_build_mention_context_empty() {
        assert!(CasperAgent::build_mention_context(&[]).is_none());
    }

    #[test]
    fn test_build_mention_context_single() {
        let mentions = vec![MentionedContact {
            contact_id: "+15551234567".to_string(),
            display_name: "Riley Chen".to_string(),
        }];
        let block = CasperAgent::build_mention_context(&mentions).expect("should build a block");
        assert!(block.contains("[CONTEXT: Contacts the user explicitly tagged with @]"));
        assert!(block.contains("- Riley Chen (id: +15551234567)"));
        assert!(block.contains("Do NOT search other contacts"));
    }

    #[test]
    fn test_build_mention_context_multiple() {
        let mentions = vec![
            MentionedContact {
                contact_id: "+15551234567".to_string(),
                display_name: "Riley".to_string(),
            },
            MentionedContact {
                contact_id: "john@example.com".to_string(),
                display_name: "John".to_string(),
            },
        ];
        let block = CasperAgent::build_mention_context(&mentions).expect("should build a block");
        assert!(block.contains("- Riley (id: +15551234567)"));
        assert!(block.contains("- John (id: john@example.com)"));
    }

    #[test]
    fn test_agent_creation() {
        let config = AgentConfig::default();
        let agent = CasperAgent::new(config).unwrap();
        // Verify built-in tools are registered
        assert_eq!(agent.tools().len(), 7);
        assert!(agent.tools().has_tool("list_contacts"));
        assert!(agent.tools().has_tool("search_messages"));
        assert!(agent.tools().has_tool("get_conversation_context"));
        assert!(agent.tools().has_tool("get_contact_stats"));
        assert!(agent.tools().has_tool("get_message_volume_by_period"));
        assert!(agent.tools().has_tool("get_conversation_analysis"));
        assert!(agent.tools().has_tool("get_topic_clusters"));
    }

    fn record(tool_name: &str, result: ToolResult) -> ToolCallRecord {
        ToolCallRecord {
            tool_name: tool_name.to_string(),
            arguments: serde_json::json!({}),
            result,
            duration_ms: 1,
        }
    }

    /// Every tool in `create_builtin_tools` needs a `synthesize_from_tool_results`
    /// arm, or a successful call still degrades to "I was unable to complete the
    /// request" whenever the synthesis fallback is what produces the answer.
    #[test]
    fn test_synthesize_covers_every_builtin_tool() {
        let agent = CasperAgent::new(AgentConfig::default()).unwrap();
        let fallback = "I was unable to complete the request. Please try rephrasing your question.";

        // A representative successful payload per tool, keyed to what each one returns.
        let payloads: Vec<(&str, serde_json::Value)> = vec![
            (
                "list_contacts",
                serde_json::json!({"contacts": [{"name": "Riley", "message_count": 100}]}),
            ),
            (
                "get_contact_stats",
                serde_json::json!({"contact_name": "Riley", "total_messages": 10, "sent_messages": 5, "received_messages": 5}),
            ),
            ("search_messages", serde_json::json!({"results": [{"id": 1}]})),
            ("get_conversation_context", serde_json::json!({"messages": [{"id": 1}]})),
            (
                "get_message_volume_by_period",
                serde_json::json!({"contacts": [{"contact_name": "Riley", "total_messages": 42}]}),
            ),
            (
                "get_conversation_analysis",
                serde_json::json!({"contact_id": "+1555", "analysis": "You text Riley daily."}),
            ),
            (
                "get_topic_clusters",
                serde_json::json!({"clusters": [{"label": "Dinner plans", "message_count": 9}]}),
            ),
        ];

        for name in agent.tools().tool_names() {
            let payload = payloads
                .iter()
                .find(|(n, _)| *n == name)
                .unwrap_or_else(|| panic!("no synthesize coverage asserted for registered tool `{name}`"))
                .1
                .clone();
            let answer = CasperAgent::synthesize_from_tool_results(&[record(name, ToolResult::success(payload))]);
            assert_ne!(answer, fallback, "`{name}` result fell through to the generic fallback");
        }
    }

    /// A contact with no pre-computed analysis must produce a usable answer that
    /// points at search — not the canned error string. This is the whole reason the
    /// tool returns success with `available: false` instead of `ToolResult::error`.
    #[test]
    fn test_absent_analysis_synthesizes_a_fallback_suggestion() {
        let answer = CasperAgent::synthesize_from_tool_results(&[record(
            "get_conversation_analysis",
            ToolResult::success(serde_json::json!({
                "contact_id": "+15551234567",
                "available": false,
                "note": "No pre-computed analysis exists for this contact."
            })),
        )]);
        assert!(answer.contains("search"), "must redirect to search, got: {answer}");
        assert!(!answer.contains("error"), "absent data must not read as an error");
    }

    #[test]
    fn test_agent_with_custom_tools() {
        use serde_json::Value;

        struct CustomTool;
        impl Tool for CustomTool {
            fn name(&self) -> &'static str {
                "custom"
            }
            fn description(&self) -> &'static str {
                "Custom tool"
            }
            fn parameters(&self) -> Value {
                serde_json::json!({})
            }
            fn execute(&self, _: Value) -> Result<ToolResult> {
                Ok(ToolResult::success(serde_json::json!({"result": "ok"})))
            }
        }

        let mut tools = ToolRegistry::new();
        tools.register(CustomTool);

        let agent = CasperAgent::with_tools(AgentConfig::default(), tools);
        assert!(agent.tools().has_tool("custom"));
    }

    #[test]
    fn test_is_inferential_question() {
        // Should match relationship/inference questions
        assert!(CasperAgent::is_inferential_question("Who is my girlfriend?"));
        assert!(CasperAgent::is_inferential_question("who do i text the most?"));
        assert!(CasperAgent::is_inferential_question("Who is my best friend?"));
        assert!(CasperAgent::is_inferential_question("Am I dating anyone?"));
        assert!(CasperAgent::is_inferential_question("who am i closest to?"));
        assert!(CasperAgent::is_inferential_question(
            "Who are my most frequent contacts?"
        ));

        // One assertion per pattern added for the analysis/topics tools. Without these,
        // a pattern that can never fire (already covered by a shorter substring) looks
        // identical to a working one.
        assert!(CasperAgent::is_inferential_question(
            "What's my communication style with Riley?"
        ));
        assert!(CasperAgent::is_inferential_question("what do i talk about with john?"));
        assert!(CasperAgent::is_inferential_question("What topics come up with Riley?"));
        assert!(CasperAgent::is_inferential_question("what do we discuss most?"));
        assert!(CasperAgent::is_inferential_question("what do i discuss with my mom?"));
        // Covered by the shorter "relationship" entry, which is why a separate
        // "describe my relationship" pattern would be dead code.
        assert!(CasperAgent::is_inferential_question(
            "Describe my relationship with Riley"
        ));

        // Should NOT match regular search questions
        assert!(!CasperAgent::is_inferential_question(
            "What did Alice say about the party?"
        ));
        assert!(!CasperAgent::is_inferential_question(
            "Search for messages about travel"
        ));
        assert!(!CasperAgent::is_inferential_question(
            "When was the last time I talked to John?"
        ));
    }
}

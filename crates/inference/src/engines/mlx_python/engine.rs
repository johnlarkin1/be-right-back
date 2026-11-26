//! MLX Python subprocess inference engine.
//!
//! This engine communicates with a Python daemon that uses MLX
//! for inference. Supports two transports:
//! - **Pipe**: spawns a child process, communicates via stdin/stdout (legacy)
//! - **Socket**: connects to a long-lived daemon via Unix domain socket

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Arc;

use common::{
    PythonEnvironment, recommended_agent_model, recommended_persona_model, sanitize_contact_id_for_filename, scripts,
};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use super::protocol::{
    DaemonCommand, DaemonResponse, GenerationConfigForPython, RequestIds, ResponseFrame, check_protocol, encode_command,
};
use crate::cancel::CancelToken;
use crate::config::{ChatMessage, GenerationConfig};
use crate::daemon_connection::DaemonConnection;
use crate::daemon_manager::{DaemonManager, DaemonRole};
use crate::error::{InferenceError, Result};
use crate::traits::AsyncInferenceEngineBackend;

/// Transport layer for communicating with the daemon.
enum Transport {
    /// Pipe-based transport: stdin/stdout of a child process.
    Pipe {
        process: Child,
        stdin: ChildStdin,
        stdout: Option<BufReader<ChildStdout>>,
        pending_stdout: Option<tokio::sync::oneshot::Receiver<BufReader<ChildStdout>>>,
        /// Request ids for commands on this pipe.
        ids: RequestIds,
    },
    /// Socket-based transport: Unix domain socket connection.
    /// Connection is wrapped in Option so it can be temporarily taken for
    /// streaming operations and then reconnected.
    Socket {
        connection: Option<DaemonConnection>,
        manager: Arc<DaemonManager>,
    },
}

/// MLX Python inference engine.
///
/// Manages communication with a Python daemon that handles inference
/// using MLX. Supports both pipe (child process) and socket (UDS) transports.
pub struct MLXPythonEngine {
    /// Transport layer for daemon communication.
    transport: Transport,

    /// Currently loaded persona ID.
    current_persona_id: Option<String>,

    /// Base model being used.
    base_model: String,

    /// Whether the daemon is ready.
    is_ready: bool,
}

impl MLXPythonEngine {
    // ── Pipe-mode constructors (legacy) ────────────────────────────

    /// Spawn a new MLX Python daemon via pipe transport.
    ///
    /// This starts the inference_daemon.py script and waits for it
    /// to signal readiness. Uses the recommended Qwen3.5 model for personas.
    pub fn spawn() -> Result<Self> {
        Self::spawn_with_model(recommended_persona_model())
    }

    /// Spawn a daemon for the Casper agent with Qwen3.5 model (pipe mode).
    pub fn spawn_for_agent() -> Result<Self> {
        Self::spawn_with_model(recommended_agent_model())
    }

    /// Spawn with a specific base model (pipe mode).
    pub fn spawn_with_model(base_model: &str) -> Result<Self> {
        let env = PythonEnvironment::get()
            .map_err(|e| InferenceError::BackendError(format!("Python environment not found: {e}")))?;
        let python_path = &env.python_bin;
        let script_path = env.script(scripts::INFERENCE_DAEMON);

        info!(
            python = %python_path.display(),
            script = %script_path.display(),
            "spawning MLX Python daemon (pipe mode)"
        );

        let mut process = Command::new(python_path)
            .arg(&script_path)
            .arg("--base-model")
            .arg(base_model)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| InferenceError::BackendError(format!("failed to spawn Python daemon: {e}")))?;

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| InferenceError::BackendError("failed to get stdin handle".to_string()))?;

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| InferenceError::BackendError("failed to get stdout handle".to_string()))?;

        let stdout = BufReader::new(stdout);

        let mut engine = Self {
            transport: Transport::Pipe {
                process,
                stdin,
                stdout: Some(stdout),
                pending_stdout: None,
                ids: RequestIds::default(),
            },
            current_persona_id: None,
            base_model: base_model.to_string(),
            is_ready: false,
        };

        engine.wait_for_ready()?;

        info!("MLX Python daemon ready (pipe mode)");

        Ok(engine)
    }

    // ── Socket-mode constructors ───────────────────────────────────

    /// Connect to a daemon via Unix domain socket.
    ///
    /// Uses `DaemonManager` to ensure the daemon is running and connect.
    /// The daemon persists independently of this engine's lifetime.
    pub async fn connect(role: DaemonRole) -> Result<Self> {
        let manager = Arc::new(DaemonManager::new(role)?);
        Self::connect_with_manager(manager).await
    }

    /// Connect to a daemon using a pre-configured `DaemonManager`.
    ///
    /// Use this when the manager has a model override set (e.g., from user preferences).
    pub async fn connect_with_manager(manager: Arc<DaemonManager>) -> Result<Self> {
        let base_model = manager.base_model();
        let role = manager.role();

        info!(role = %role, model = %base_model, "connecting to daemon via socket");

        let mut connection = manager.connect().await?;

        // A daemon started before an app update keeps running the old script
        // until its idle timeout. Restart it so both sides speak one protocol.
        match connection.wait_for_ready().await {
            Ok(()) => {}
            Err(InferenceError::ProtocolMismatch { daemon, client }) => {
                warn!(role = %role, daemon, client, "daemon runs an old protocol, restarting it");
                drop(connection);
                manager.shutdown().await?;
                connection = manager.connect().await?;
                connection.wait_for_ready().await?;
            }
            Err(e) => return Err(e),
        }

        info!(role = %role, "connected to daemon via socket");

        Ok(Self {
            transport: Transport::Socket {
                connection: Some(connection),
                manager,
            },
            current_persona_id: None,
            base_model,
            is_ready: true,
        })
    }

    /// Connect to the agent daemon via socket.
    pub async fn connect_for_agent() -> Result<Self> {
        Self::connect(DaemonRole::Agent).await
    }

    // ── Transport-agnostic methods ─────────────────────────────────

    /// Wait for the daemon to signal readiness (pipe mode only).
    fn wait_for_ready(&mut self) -> Result<()> {
        debug!("waiting for daemon ready signal");

        let response = self.read_response_skip_logs()?;

        match response {
            DaemonResponse::Ready { protocol } => {
                check_protocol(protocol)?;
                self.is_ready = true;
                Ok(())
            }
            DaemonResponse::Error { message } => Err(InferenceError::BackendError(format!(
                "daemon startup failed: {message}"
            ))),
            other => Err(InferenceError::BackendError(format!(
                "unexpected response while waiting for ready: {other:?}"
            ))),
        }
    }

    /// Send a command to the daemon with a new request id.
    ///
    /// Later reads return only frames for this id.
    fn send_command(&mut self, cmd: &DaemonCommand) -> Result<()> {
        match &mut self.transport {
            Transport::Pipe { stdin, ids, .. } => {
                let json = encode_command(cmd, ids.start())
                    .map_err(|e| InferenceError::BackendError(format!("failed to serialize command: {e}")))?;

                debug!(command = %json, "sending command to daemon");

                writeln!(stdin, "{json}")
                    .map_err(|e| InferenceError::BackendError(format!("failed to write to daemon stdin: {e}")))?;

                stdin
                    .flush()
                    .map_err(|e| InferenceError::BackendError(format!("failed to flush daemon stdin: {e}")))?;

                Ok(())
            }
            Transport::Socket { connection, .. } => {
                let conn = connection.as_mut().ok_or_else(|| {
                    InferenceError::BackendError("socket connection not available (streaming in progress?)".to_string())
                })?;
                // Block on the async send from sync context
                tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(conn.send_command(cmd)))?;
                Ok(())
            }
        }
    }

    /// Reclaim stdout from a previous streaming reader thread if needed (pipe mode).
    fn ensure_stdout(&mut self) {
        if let Transport::Pipe {
            stdout, pending_stdout, ..
        } = &mut self.transport
            && stdout.is_none()
            && let Some(rx) = pending_stdout.take()
            && let Ok(s) = rx.blocking_recv()
        {
            *stdout = Some(s);
        }
    }

    /// Async version of ensure_stdout for use in async contexts (pipe mode).
    async fn ensure_stdout_async(&mut self) {
        // Can't use let-chains here because `rx.await` is async and can't be in a `let &&` chain.
        #[allow(clippy::collapsible_if)]
        if let Transport::Pipe {
            stdout, pending_stdout, ..
        } = &mut self.transport
        {
            if stdout.is_none() {
                if let Some(rx) = pending_stdout.take() {
                    if let Ok(s) = rx.await {
                        *stdout = Some(s);
                    }
                }
            }
        }
    }

    /// Read the next response for the current request.
    ///
    /// Frames stamped with another request id are discarded.
    fn read_response(&mut self) -> Result<DaemonResponse> {
        // Ensure stdout is reclaimed (pipe mode) before reading
        self.ensure_stdout();

        match &mut self.transport {
            Transport::Pipe { stdout, ids, .. } => {
                let reader = stdout.as_mut().ok_or_else(|| {
                    InferenceError::BackendError("stdout not available (streaming in progress?)".to_string())
                })?;

                loop {
                    let mut line = String::new();
                    reader
                        .read_line(&mut line)
                        .map_err(|e| InferenceError::BackendError(format!("failed to read from daemon stdout: {e}")))?;

                    if line.is_empty() {
                        return Err(InferenceError::BackendError(
                            "daemon closed stdout unexpectedly".to_string(),
                        ));
                    }

                    debug!(response = %line.trim(), "received response from daemon");

                    let frame: ResponseFrame = serde_json::from_str(&line).map_err(|e| {
                        InferenceError::BackendError(format!("failed to parse daemon response: {e}. Raw: {line}"))
                    })?;
                    if let Some(response) = ids.accept(frame) {
                        return Ok(response);
                    }
                }
            }
            Transport::Socket { connection, .. } => {
                let conn = connection.as_mut().ok_or_else(|| {
                    InferenceError::BackendError("socket connection not available (streaming in progress?)".to_string())
                })?;
                tokio::task::block_in_place(|| tokio::runtime::Handle::current().block_on(conn.read_response()))
            }
        }
    }

    /// Read responses, skipping any log messages.
    fn read_response_skip_logs(&mut self) -> Result<DaemonResponse> {
        loop {
            let response = self.read_response()?;
            match &response {
                DaemonResponse::Log { level, message } => {
                    debug!(level = %level, message = %message, "daemon log");
                    continue;
                }
                _ => return Ok(response),
            }
        }
    }

    /// Check if the daemon process is still running (pipe mode).
    /// For socket mode, checks if the manager reports the daemon is running.
    pub fn is_alive(&mut self) -> bool {
        match &mut self.transport {
            Transport::Pipe { process, .. } => match process.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) => false,
                Err(_) => false,
            },
            Transport::Socket { manager, .. } => manager.is_running(),
        }
    }

    /// Ping the daemon to check if it's responsive.
    pub fn ping(&mut self) -> Result<bool> {
        self.send_command(&DaemonCommand::Ping)?;

        match self.read_response_skip_logs()? {
            DaemonResponse::Pong => Ok(true),
            DaemonResponse::Error { message } => {
                warn!("ping failed: {message}");
                Ok(false)
            }
            _ => Ok(false),
        }
    }

    /// Load just the base model without any persona adapter.
    pub fn load_base_model(&mut self) -> Result<()> {
        self.load_model_with_override(None)
    }

    /// Load a specific model (for hot-swapping between persona and agent models).
    pub fn load_model_with_override(&mut self, model_override: Option<&str>) -> Result<()> {
        let model_to_load = model_override
            .map(|s| s.to_string())
            .unwrap_or_else(|| self.base_model.clone());

        info!(model = %model_to_load, "loading model (no adapter)");

        if self.current_persona_id.as_deref() == Some("__base__") && model_override.is_none() {
            debug!("base model already loaded, skipping");
            return Ok(());
        }

        let cmd = DaemonCommand::Load {
            persona_id: "__base__".to_string(),
            base_model: model_to_load.clone(),
        };

        self.send_command(&cmd)?;

        match self.read_response_skip_logs()? {
            DaemonResponse::Loaded { persona_id: loaded_id } => {
                info!(persona_id = %loaded_id, model = %model_to_load, "model loaded successfully");
                self.current_persona_id = Some(loaded_id);
                if model_override.is_some() {
                    self.base_model = model_to_load;
                }
                Ok(())
            }
            DaemonResponse::Error { message } => {
                error!(error = %message, "failed to load model");
                Err(InferenceError::BackendError(format!("failed to load model: {message}")))
            }
            other => Err(InferenceError::BackendError(format!(
                "unexpected response loading model: {other:?}"
            ))),
        }
    }

    /// Get the currently loaded model name.
    pub fn current_model(&self) -> &str {
        &self.base_model
    }

    /// Rerank passages using a cross-encoder model.
    pub fn rerank(&mut self, query: &str, passages: &[String]) -> Result<Vec<f32>> {
        if passages.is_empty() {
            return Ok(vec![]);
        }

        debug!(query = query, passages = passages.len(), "reranking passages");

        let cmd = DaemonCommand::Rerank {
            query: query.to_string(),
            passages: passages.to_vec(),
        };

        self.send_command(&cmd)?;

        match self.read_response_skip_logs()? {
            DaemonResponse::RerankResult { scores } => {
                debug!(scores_count = scores.len(), "reranking complete");
                Ok(scores)
            }
            DaemonResponse::Error { message } => {
                error!(error = %message, "reranking failed");
                Err(InferenceError::BackendError(format!("reranking failed: {message}")))
            }
            other => Err(InferenceError::BackendError(format!(
                "unexpected response for rerank: {other:?}"
            ))),
        }
    }

    /// Generate an embedding for a search query.
    pub fn embed_query(&mut self, text: &str) -> Result<Vec<f32>> {
        debug!(text = text, "generating query embedding");

        let cmd = DaemonCommand::EmbedQuery { text: text.to_string() };

        self.send_command(&cmd)?;

        match self.read_response_skip_logs()? {
            DaemonResponse::Embedding { vector, dims } => {
                debug!(dims = dims, "embedding generated successfully");
                Ok(vector)
            }
            DaemonResponse::Error { message } => {
                error!(error = %message, "failed to generate embedding");
                Err(InferenceError::BackendError(format!(
                    "embedding generation failed: {message}"
                )))
            }
            other => Err(InferenceError::BackendError(format!(
                "unexpected response for embedding: {other:?}"
            ))),
        }
    }

    /// Analyze a persona's conversation using the already-loaded LLM.
    pub fn analyze_persona(
        &mut self,
        input: &serde_json::Value,
        mut progress_callback: impl FnMut(&str, Option<(usize, usize, usize)>),
    ) -> Result<(String, i64)> {
        self.ensure_stdout();

        let cmd = DaemonCommand::AnalyzePersona {
            contact_id: input["contact_id"].as_str().unwrap_or("").to_string(),
            contact_name: input["contact_name"].as_str().unwrap_or("").to_string(),
            phase1_conversation_blocks: input["phase1_conversation_blocks"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
            phase2_conversation_blocks: input["phase2_conversation_blocks"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
            metadata: input.get("metadata").cloned(),
            max_tokens_phase1: input["max_tokens_phase1"].as_u64().unwrap_or(1200) as u32,
            max_tokens_phase2: input["max_tokens_phase2"].as_u64().unwrap_or(3200) as u32,
        };

        self.send_command(&cmd)?;

        // Guard against infinite loop if daemon is in a bad state sending
        // unexpected responses. Allow generous budget for progress messages.
        let mut unexpected_count = 0;
        const MAX_UNEXPECTED: usize = 50;

        loop {
            let response = self.read_response_skip_logs()?;
            match response {
                DaemonResponse::AnalysisProgress { phase } => {
                    debug!(phase = %phase, "analysis progress from daemon");
                    progress_callback(&phase, None);
                    unexpected_count = 0; // Reset on valid response
                }
                DaemonResponse::AnalysisPhase1Complete {
                    quotes_count,
                    topics_count,
                    insights_count,
                } => {
                    debug!(
                        quotes = quotes_count,
                        topics = topics_count,
                        insights = insights_count,
                        "analysis phase 1 complete from daemon"
                    );
                    progress_callback("phase1_complete", Some((quotes_count, topics_count, insights_count)));
                    unexpected_count = 0;
                }
                DaemonResponse::AnalysisComplete { content, duration_secs } => {
                    info!(duration_secs, "analysis complete from daemon");
                    return Ok((content, duration_secs));
                }
                DaemonResponse::Error { message } => {
                    error!(error = %message, "analysis failed in daemon");
                    return Err(InferenceError::BackendError(format!(
                        "daemon analysis failed: {message}"
                    )));
                }
                other => {
                    unexpected_count += 1;
                    warn!(response = ?other, count = unexpected_count, "unexpected response during analysis");
                    if unexpected_count >= MAX_UNEXPECTED {
                        return Err(InferenceError::BackendError(format!(
                            "too many unexpected responses ({MAX_UNEXPECTED}) during analysis, daemon may be in a bad state"
                        )));
                    }
                }
            }
        }
    }

    /// Generate a response and pass raw text to `on_token` as it arrives.
    ///
    /// Returns the cleaned response from the daemon's `Complete` frame. The
    /// streamed text is a raw preview: it still holds `<think>` blocks, tool
    /// calls and special tokens that the `Complete` text has cleaned up.
    ///
    /// `cancel` stops the generation and makes this return
    /// `InferenceError::Cancelled`. In socket mode the daemon stops and the
    /// connection stays usable. A pipe daemon reads stdin only between
    /// commands, so cancel kills it: `is_alive()` then returns false and the
    /// caller creates a new engine.
    pub async fn generate_with_tokens<F: FnMut(&str)>(
        &mut self,
        messages: &[ChatMessage],
        config: &GenerationConfig,
        mut on_token: F,
        cancel: &CancelToken,
    ) -> Result<String> {
        if self.current_persona_id.is_none() {
            return Err(InferenceError::NotInitialized);
        }
        if cancel.is_cancelled() {
            return Err(InferenceError::Cancelled);
        }

        self.ensure_stdout_async().await;

        let cmd = DaemonCommand::Generate {
            messages: messages.to_vec(),
            config: GenerationConfigForPython::from(config),
            stream: true,
        };

        if let Transport::Socket { connection, .. } = &mut self.transport {
            let conn = connection.as_mut().ok_or_else(|| {
                InferenceError::BackendError("socket connection not available (streaming in progress?)".to_string())
            })?;
            return conn.generate_with_tokens(&cmd, on_token, cancel).await;
        }

        self.send_command(&cmd)?;

        loop {
            if cancel.is_cancelled() {
                warn!("cancelling pipe-mode generation by stopping the daemon");
                self.kill_pipe_daemon();
                return Err(InferenceError::Cancelled);
            }

            match self.read_response()? {
                DaemonResponse::Token { text, .. } => on_token(&text),
                DaemonResponse::Complete { text } => return Ok(text),
                DaemonResponse::Cancelled => return Err(InferenceError::Cancelled),
                DaemonResponse::Error { message } => return Err(InferenceError::GenerationFailed(message)),
                DaemonResponse::Log { level, message } => {
                    debug!(level = %level, message = %message, "daemon log during streaming generation");
                }
                other => {
                    return Err(InferenceError::BackendError(format!(
                        "unexpected response during generation: {other:?}"
                    )));
                }
            }
        }
    }

    /// Kill a pipe-mode daemon process. Does nothing in socket mode.
    fn kill_pipe_daemon(&mut self) {
        if let Transport::Pipe { process, .. } = &mut self.transport {
            let _ = process.kill();
            let _ = process.wait();
            self.is_ready = false;
            self.current_persona_id = None;
        }
    }

    /// Whether this engine uses a socket transport.
    pub fn is_socket_mode(&self) -> bool {
        matches!(self.transport, Transport::Socket { .. })
    }
}

impl AsyncInferenceEngineBackend for MLXPythonEngine {
    async fn load_persona(&mut self, persona_id: &str) -> Result<()> {
        let sanitized_id = sanitize_contact_id_for_filename(persona_id);
        info!(persona_id, sanitized_id = %sanitized_id, "loading persona");

        if self.current_persona_id.as_deref() == Some(&sanitized_id) {
            debug!("persona already loaded, skipping");
            return Ok(());
        }

        if let Ok(metadata) = personas::PersonaRegistry::load(&sanitized_id) {
            let adapter_model = &metadata.base_model;
            let current_model = &self.base_model;
            if !common::models_compatible(adapter_model, current_model) {
                return Err(InferenceError::AdapterIncompatible(format!(
                    "Persona '{}' was trained with '{}' but the current model is '{}'. \
                     Please retrain this persona to use the new model.",
                    sanitized_id, adapter_model, current_model
                )));
            }
        }

        self.ensure_stdout_async().await;

        let cmd = DaemonCommand::Load {
            persona_id: sanitized_id.clone(),
            base_model: self.base_model.clone(),
        };

        self.send_command(&cmd)?;

        match self.read_response_skip_logs()? {
            DaemonResponse::Loaded { persona_id: loaded_id } => {
                info!(persona_id = %loaded_id, "persona loaded successfully");
                self.current_persona_id = Some(loaded_id);
                Ok(())
            }
            DaemonResponse::Error { message } => {
                error!(error = %message, "failed to load persona");
                Err(InferenceError::AdapterLoadFailed(message))
            }
            other => Err(InferenceError::BackendError(format!("unexpected response: {other:?}"))),
        }
    }

    fn current_persona(&self) -> Option<&str> {
        self.current_persona_id.as_deref()
    }

    async fn generate(&mut self, messages: &[ChatMessage], config: &GenerationConfig) -> Result<String> {
        if self.current_persona_id.is_none() {
            return Err(InferenceError::NotInitialized);
        }

        self.ensure_stdout_async().await;

        let cmd = DaemonCommand::Generate {
            messages: messages.to_vec(),
            config: GenerationConfigForPython::from(config),
            stream: false,
        };

        self.send_command(&cmd)?;

        let mut full_response = String::new();

        loop {
            match self.read_response()? {
                DaemonResponse::Token { text, done } => {
                    full_response.push_str(&text);
                    if done {
                        break;
                    }
                }
                DaemonResponse::Complete { text } => {
                    return Ok(text);
                }
                DaemonResponse::Error { message } => {
                    return Err(InferenceError::GenerationFailed(message));
                }
                DaemonResponse::Log { level, message } => {
                    debug!(level = %level, message = %message, "daemon log during generation");
                    continue;
                }
                other => {
                    return Err(InferenceError::BackendError(format!(
                        "unexpected response during generation: {other:?}"
                    )));
                }
            }
        }

        Ok(full_response)
    }

    async fn generate_streaming(
        &mut self,
        messages: &[ChatMessage],
        config: &GenerationConfig,
    ) -> Result<mpsc::Receiver<String>> {
        if self.current_persona_id.is_none() {
            return Err(InferenceError::NotInitialized);
        }

        self.ensure_stdout_async().await;

        let cmd = DaemonCommand::Generate {
            messages: messages.to_vec(),
            config: GenerationConfigForPython::from(config),
            stream: false,
        };

        self.send_command(&cmd)?;

        let (tx, rx) = mpsc::channel(100);

        match &mut self.transport {
            Transport::Pipe {
                stdout,
                pending_stdout,
                ids,
                ..
            } => {
                // The reader thread filters by the id of this generation.
                let ids = ids.clone();

                // Move stdout to a dedicated OS thread for blocking reads.
                let mut pipe_stdout = stdout.take().ok_or_else(|| {
                    InferenceError::BackendError("stdout not available (streaming in progress?)".to_string())
                })?;

                let (stdout_tx, stdout_rx) = tokio::sync::oneshot::channel();

                std::thread::spawn(move || {
                    loop {
                        let mut line = String::new();
                        match pipe_stdout.read_line(&mut line) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }

                        let response = match serde_json::from_str::<ResponseFrame>(&line) {
                            Ok(frame) => match ids.accept(frame) {
                                Some(response) => Ok(response),
                                None => continue,
                            },
                            Err(e) => Err(e),
                        };

                        match response {
                            Ok(DaemonResponse::Token { text, done }) => {
                                if tx.blocking_send(text).is_err() {
                                    break;
                                }
                                if done {
                                    break;
                                }
                            }
                            Ok(DaemonResponse::Complete { text }) => {
                                let _ = tx.blocking_send(text);
                                break;
                            }
                            Ok(DaemonResponse::Error { message }) => {
                                error!(error = %message, "generation error during streaming");
                                break;
                            }
                            Ok(DaemonResponse::Log { .. }) => continue,
                            _ => break,
                        }
                    }

                    let _ = stdout_tx.send(pipe_stdout);
                });

                *pending_stdout = Some(stdout_rx);
            }
            Transport::Socket { connection, manager } => {
                // Take the connection for the streaming task.
                // We'll reconnect after streaming completes.
                let conn = connection.take().ok_or_else(|| {
                    InferenceError::BackendError("socket connection not available (streaming in progress?)".to_string())
                })?;

                let manager_for_reconnect = manager.clone();

                // Spawn a task to read streaming tokens from the socket
                tokio::spawn(async move {
                    let mut conn = conn;
                    loop {
                        match conn.read_response().await {
                            Ok(DaemonResponse::Token { text, done }) => {
                                if tx.send(text).await.is_err() {
                                    break;
                                }
                                if done {
                                    break;
                                }
                            }
                            Ok(DaemonResponse::Complete { text }) => {
                                let _ = tx.send(text).await;
                                break;
                            }
                            Ok(DaemonResponse::Error { message }) => {
                                error!(error = %message, "generation error during streaming (socket)");
                                break;
                            }
                            Ok(DaemonResponse::Log { .. }) => continue,
                            Err(e) => {
                                error!(error = %e, "socket read error during streaming");
                                break;
                            }
                            _ => break,
                        }
                    }
                });

                // Drop the mutable borrow on self.transport, then reconnect.
                // The connection field is None now; reconnect and put it back.
                let mut new_conn = manager_for_reconnect.connect().await?;
                new_conn.wait_for_ready().await?;
                if let Transport::Socket { connection, .. } = &mut self.transport {
                    *connection = Some(new_conn);
                }
            }
        }

        Ok(rx)
    }

    fn is_ready(&self) -> bool {
        self.is_ready
    }

    async fn shutdown(&mut self) -> Result<()> {
        match &mut self.transport {
            Transport::Pipe { process, stdin, .. } => {
                info!("shutting down MLX Python daemon (pipe mode)");

                // Send shutdown command
                let cmd_json = serde_json::to_string(&DaemonCommand::Shutdown)
                    .map_err(|e| InferenceError::BackendError(format!("serialize failed: {e}")))?;
                let _ = writeln!(stdin, "{cmd_json}");
                let _ = stdin.flush();

                // Wait for graceful shutdown
                std::thread::sleep(std::time::Duration::from_millis(2000));

                // Kill if needed
                match process.try_wait() {
                    Ok(None) => {
                        warn!("daemon still running after 2s, killing");
                        let _ = process.kill();
                    }
                    _ => {
                        debug!("daemon exited gracefully");
                    }
                }

                let _ = process.wait();

                self.is_ready = false;
                self.current_persona_id = None;

                info!("MLX Python daemon stopped (pipe mode)");
                Ok(())
            }
            Transport::Socket { .. } => {
                // Socket mode: just close the connection. Don't kill the daemon.
                // The daemon manages its own lifecycle via idle timeout.
                info!("disconnecting from daemon (socket mode, daemon continues running)");
                self.is_ready = false;
                self.current_persona_id = None;
                Ok(())
            }
        }
    }
}

impl Drop for MLXPythonEngine {
    fn drop(&mut self) {
        match &mut self.transport {
            Transport::Pipe { process, stdin, .. } => {
                // Try to shutdown gracefully
                let cmd_json = serde_json::to_string(&DaemonCommand::Shutdown).ok();
                if let Some(json) = cmd_json {
                    let _ = writeln!(stdin, "{json}");
                    let _ = stdin.flush();
                }

                std::thread::sleep(std::time::Duration::from_millis(100));

                if let Ok(None) = process.try_wait() {
                    let _ = process.kill();
                }
            }
            Transport::Socket { .. } => {
                // Socket mode: do nothing on drop. Daemon keeps running.
            }
        }
    }
}

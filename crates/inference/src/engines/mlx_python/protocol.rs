//! JSON protocol types for communication with the MLX Python daemon.
//!
//! The daemon communicates via JSON lines over stdin/stdout or a Unix socket.
//!
//! Every command carries a request `id`. The daemon copies it onto every
//! frame it sends for that command, so the client matches replies by id, not
//! by arrival order. A frame for an abandoned request is discarded.

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::config::{ChatMessage, GenerationConfig};

/// Protocol version the daemon reports in its `ready` frame.
///
/// Version 2 added request ids. A daemon that reports a lower version runs an
/// old script and must be restarted.
pub const PROTOCOL_VERSION: u32 = 2;

/// Commands sent to the Python daemon.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum DaemonCommand {
    /// Load a persona's adapter.
    Load { persona_id: String, base_model: String },

    /// Generate a response from messages.
    ///
    /// With `stream` set, the daemon sends `Token` frames as text arrives,
    /// then one `Complete` frame. The `Complete` text is authoritative.
    Generate {
        messages: Vec<ChatMessage>,
        #[serde(flatten)]
        config: GenerationConfigForPython,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        stream: bool,
    },

    /// Stop a running generation (socket mode only).
    ///
    /// The frame id names the `Generate` to stop. `Cancel` gets no reply of
    /// its own: the daemon answers the stopped `Generate` with `Cancelled`.
    /// A cancel for a request that already finished has no effect.
    Cancel,

    /// Generate an embedding for a search query.
    EmbedQuery {
        /// The text to embed (will be prefixed with "search_query: ")
        text: String,
    },

    /// Rerank passages using cross-encoder model.
    Rerank {
        /// The search query
        query: String,
        /// Passages to rerank
        passages: Vec<String>,
    },

    /// Analyze a persona's conversation using the already-loaded LLM.
    AnalyzePersona {
        contact_id: String,
        contact_name: String,
        phase1_conversation_blocks: Vec<serde_json::Value>,
        phase2_conversation_blocks: Vec<serde_json::Value>,
        metadata: Option<serde_json::Value>,
        max_tokens_phase1: u32,
        max_tokens_phase2: u32,
    },

    /// Check if daemon is alive.
    Ping,

    /// Gracefully shutdown the daemon.
    Shutdown,
}

/// Generation config serialized for Python (snake_case).
#[derive(Debug, Clone, Serialize)]
pub struct GenerationConfigForPython {
    pub max_tokens: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: i32,
    pub repetition_penalty: f32,
    /// Context size for repetition penalty (how many tokens to look back).
    pub repetition_context_size: u32,
    /// Stop sequences to halt generation early.
    pub stop_sequences: Vec<String>,
    /// Whether to append default stop sequences (pleasantry detection).
    pub use_default_stops: bool,
    /// Whether to enable Qwen3.5 thinking mode (<think> blocks).
    pub enable_thinking: bool,
}

impl From<&GenerationConfig> for GenerationConfigForPython {
    fn from(config: &GenerationConfig) -> Self {
        Self {
            max_tokens: config.max_tokens,
            temperature: config.temperature,
            top_p: config.top_p,
            top_k: config.top_k,
            repetition_penalty: config.repetition_penalty,
            repetition_context_size: 50,
            stop_sequences: config.stop_sequences.clone(),
            use_default_stops: config.use_default_stops,
            enable_thinking: config.enable_thinking,
        }
    }
}

/// Responses received from the Python daemon.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DaemonResponse {
    /// Daemon is ready. Sent once per connection, without an id.
    Ready {
        /// Protocol version of the daemon script. 0 means an old script.
        #[serde(default)]
        protocol: u32,
    },

    /// Persona loaded successfully.
    Loaded { persona_id: String },

    /// A generated token (streaming).
    Token { text: String, done: bool },

    /// Generation complete (non-streaming).
    Complete { text: String },

    /// A `Cancel` command stopped the generation.
    Cancelled,

    /// Embedding generated successfully.
    Embedding {
        /// The embedding vector (768 dimensions for ModernBERT)
        vector: Vec<f32>,
        /// Dimensions of the embedding
        dims: usize,
    },

    /// Cross-encoder reranking scores.
    RerankResult {
        /// Relevance scores for each passage (same order as input)
        scores: Vec<f32>,
    },

    /// Analysis progress update (phase name).
    AnalysisProgress { phase: String },

    /// Phase 1 of analysis complete (quote extraction).
    AnalysisPhase1Complete {
        quotes_count: usize,
        topics_count: usize,
        insights_count: usize,
    },

    /// Analysis fully complete with result.
    AnalysisComplete { content: String, duration_secs: i64 },

    /// An error occurred.
    Error { message: String },

    /// Pong response to ping.
    Pong,

    /// Shutdown acknowledged.
    ShuttingDown,

    /// Log message from daemon (info, debug, etc.) - can be ignored.
    Log { level: String, message: String },
}

/// A command on the wire: the command fields plus its request id.
#[derive(Debug, Serialize)]
pub struct CommandFrame<'a> {
    pub id: u64,
    #[serde(flatten)]
    pub cmd: &'a DaemonCommand,
}

/// Encode `cmd` with request id `id` as one JSON line (no trailing newline).
pub fn encode_command(cmd: &DaemonCommand, id: u64) -> serde_json::Result<String> {
    serde_json::to_string(&CommandFrame { id, cmd })
}

/// A response on the wire: the response fields plus the id of its request.
#[derive(Debug, Deserialize)]
pub struct ResponseFrame {
    /// `None` for `ready` and for errors about lines the daemon could not parse.
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(flatten)]
    pub response: DaemonResponse,
}

/// Request ids for one daemon connection.
///
/// Each connection sends one command at a time and waits for its reply. Any
/// frame stamped with another id belongs to a request the client gave up on
/// (a timed-out read, a dropped streaming reader). The daemon still sends
/// those frames, so the client discards them.
#[derive(Debug, Default, Clone)]
pub struct RequestIds {
    last: u64,
    awaiting: Option<u64>,
}

impl RequestIds {
    /// Allocate the id for a new command and wait for replies to it.
    pub fn start(&mut self) -> u64 {
        self.last += 1;
        self.awaiting = Some(self.last);
        self.last
    }

    /// The id of the command whose reply this connection waits for.
    pub fn awaiting(&self) -> Option<u64> {
        self.awaiting
    }

    /// Return the response if it belongs to the current request.
    ///
    /// `Ready` and `Log` frames pass with any id. Every other frame must
    /// carry the awaited id, or it is discarded. Before the first command,
    /// frames without an id pass too.
    pub fn accept(&self, frame: ResponseFrame) -> Option<DaemonResponse> {
        match frame.response {
            DaemonResponse::Ready { .. } | DaemonResponse::Log { .. } => Some(frame.response),
            _ if frame.id == self.awaiting => Some(frame.response),
            response => {
                warn!(
                    frame_id = ?frame.id,
                    awaiting = ?self.awaiting,
                    response = ?response,
                    "discarding daemon reply for another request"
                );
                None
            }
        }
    }
}

/// Check a `ready` frame's protocol version.
pub fn check_protocol(protocol: u32) -> Result<(), crate::error::InferenceError> {
    if protocol == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(crate::error::InferenceError::ProtocolMismatch {
            daemon: protocol,
            client: PROTOCOL_VERSION,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_serialization() {
        let cmd = DaemonCommand::Load {
            persona_id: "alice".to_string(),
            base_model: "mlx-community/Qwen3.5-9B-8bit".to_string(),
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"cmd\":\"load\""));
        assert!(json.contains("\"persona_id\":\"alice\""));
    }

    #[test]
    fn test_analyze_persona_command_serialization() {
        let cmd = DaemonCommand::AnalyzePersona {
            contact_id: "alice".to_string(),
            contact_name: "Alice".to_string(),
            phase1_conversation_blocks: vec![serde_json::json!({"messages": []})],
            phase2_conversation_blocks: vec![serde_json::json!({"messages": []})],
            metadata: Some(serde_json::json!({"total_messages": 100})),
            max_tokens_phase1: 1200,
            max_tokens_phase2: 3200,
        };

        let json = serde_json::to_string(&cmd).unwrap();
        assert!(json.contains("\"cmd\":\"analyze_persona\""));
        assert!(json.contains("\"contact_id\":\"alice\""));
        assert!(json.contains("\"max_tokens_phase1\":1200"));
    }

    #[test]
    fn test_analysis_progress_deserialization() {
        let json = r#"{"type": "analysis_progress", "phase": "extracting_quotes"}"#;
        let resp: DaemonResponse = serde_json::from_str(json).unwrap();
        match resp {
            DaemonResponse::AnalysisProgress { phase } => {
                assert_eq!(phase, "extracting_quotes");
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_analysis_phase1_complete_deserialization() {
        let json = r#"{"type": "analysis_phase1_complete", "quotes_count": 5, "topics_count": 3, "insights_count": 4}"#;
        let resp: DaemonResponse = serde_json::from_str(json).unwrap();
        match resp {
            DaemonResponse::AnalysisPhase1Complete {
                quotes_count,
                topics_count,
                insights_count,
            } => {
                assert_eq!(quotes_count, 5);
                assert_eq!(topics_count, 3);
                assert_eq!(insights_count, 4);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_analysis_complete_deserialization() {
        let json =
            "{\"type\": \"analysis_complete\", \"content\": \"# Analysis\\nGreat person.\", \"duration_secs\": 45}";
        let resp: DaemonResponse = serde_json::from_str(json).unwrap();
        match resp {
            DaemonResponse::AnalysisComplete { content, duration_secs } => {
                assert_eq!(content, "# Analysis\nGreat person.");
                assert_eq!(duration_secs, 45);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn test_cancel_command_serialization() {
        let json = serde_json::to_string(&DaemonCommand::Cancel).unwrap();
        assert_eq!(json, r#"{"cmd":"cancel"}"#);
    }

    #[test]
    fn test_cancelled_response_deserialization() {
        let response: DaemonResponse = serde_json::from_str(r#"{"type": "cancelled"}"#).unwrap();
        assert!(matches!(response, DaemonResponse::Cancelled));
    }

    #[test]
    fn test_generate_stream_flag_serialization() {
        let config = GenerationConfigForPython::from(&GenerationConfig::default());
        let streaming = DaemonCommand::Generate {
            messages: vec![],
            config: config.clone(),
            stream: true,
        };
        let plain = DaemonCommand::Generate {
            messages: vec![],
            config,
            stream: false,
        };
        assert!(serde_json::to_string(&streaming).unwrap().contains("\"stream\":true"));
        assert!(!serde_json::to_string(&plain).unwrap().contains("stream"));
    }

    #[test]
    fn test_response_deserialization() {
        let json = r#"{"type": "token", "text": "Hello", "done": false}"#;
        let resp: DaemonResponse = serde_json::from_str(json).unwrap();

        match resp {
            DaemonResponse::Token { text, done } => {
                assert_eq!(text, "Hello");
                assert!(!done);
            }
            _ => panic!("unexpected response type"),
        }
    }

    #[test]
    fn encode_command_puts_the_id_next_to_the_command() {
        let json = encode_command(&DaemonCommand::Ping, 7).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value, serde_json::json!({"cmd": "ping", "id": 7}));

        let json = encode_command(&DaemonCommand::EmbedQuery { text: "hi".into() }, 8).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value, serde_json::json!({"cmd": "embed_query", "text": "hi", "id": 8}));
    }

    #[test]
    fn response_frame_reads_the_id_and_the_response() {
        let frame: ResponseFrame =
            serde_json::from_str(r#"{"type": "token", "text": "a", "done": false, "id": 3}"#).unwrap();
        assert_eq!(frame.id, Some(3));
        assert!(matches!(frame.response, DaemonResponse::Token { ref text, done: false } if text == "a"));

        let frame: ResponseFrame = serde_json::from_str(r#"{"type": "ready", "protocol": 2}"#).unwrap();
        assert_eq!(frame.id, None);
        assert!(matches!(frame.response, DaemonResponse::Ready { protocol: 2 }));

        let frame: ResponseFrame = serde_json::from_str(r#"{"type": "ready"}"#).unwrap();
        assert!(matches!(frame.response, DaemonResponse::Ready { protocol: 0 }));
    }

    fn frame(json: &str) -> ResponseFrame {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn request_ids_accept_only_the_awaited_request() {
        let mut ids = RequestIds::default();
        assert!(
            ids.accept(frame(r#"{"type": "error", "message": "x"}"#)).is_some(),
            "before any command, id-less frames pass"
        );

        assert_eq!(ids.start(), 1);
        assert_eq!(ids.start(), 2);
        assert!(ids.accept(frame(r#"{"type": "pong", "id": 2}"#)).is_some());
        assert!(ids.accept(frame(r#"{"type": "pong", "id": 1}"#)).is_none(), "stale id");
        assert!(ids.accept(frame(r#"{"type": "pong"}"#)).is_none(), "missing id");
        assert!(
            ids.accept(frame(r#"{"type": "log", "level": "info", "message": "m", "id": 1}"#))
                .is_some()
        );
        assert!(ids.accept(frame(r#"{"type": "ready", "protocol": 2}"#)).is_some());
    }

    #[test]
    fn check_protocol_rejects_other_versions() {
        assert!(check_protocol(PROTOCOL_VERSION).is_ok());
        assert!(check_protocol(0).is_err());
        assert!(check_protocol(PROTOCOL_VERSION + 1).is_err());
    }
}

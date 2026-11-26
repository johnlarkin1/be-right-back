//! Configuration types for inference.

use serde::{Deserialize, Serialize};

/// Configuration for text generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationConfig {
    /// Maximum number of tokens to generate.
    pub max_tokens: u32,

    /// Temperature for sampling (0.0 = deterministic, higher = more random).
    /// Range: 0.0 to 2.0, default: 0.7
    pub temperature: f32,

    /// Top-p (nucleus) sampling threshold.
    /// Only consider tokens with cumulative probability >= top_p.
    /// Range: 0.0 to 1.0, default: 0.9
    pub top_p: f32,

    /// Top-k sampling: only consider the top k most likely tokens.
    /// 0 = disabled, default: 40
    pub top_k: i32,

    /// Repetition penalty to discourage repeated tokens.
    /// 1.0 = no penalty, higher = more penalty.
    /// Range: 1.0 to 2.0, default: 1.1
    pub repetition_penalty: f32,

    /// Frequency penalty (penalize tokens based on frequency in generated text).
    /// Range: 0.0 to 2.0, default: 0.0
    pub frequency_penalty: f32,

    /// Presence penalty (penalize tokens that appear at all in generated text).
    /// Range: 0.0 to 2.0, default: 0.0
    pub presence_penalty: f32,

    /// Stop sequences - generation stops when any of these are produced.
    pub stop_sequences: Vec<String>,

    /// Random seed for reproducibility. None = random seed.
    pub seed: Option<u64>,

    /// Whether to use default stop sequences (pleasantry detection) in the Python daemon.
    /// Set to `false` for agent mode where the caller controls its own stops.
    #[serde(default = "default_use_default_stops")]
    pub use_default_stops: bool,

    /// Whether to enable Qwen3.5 thinking mode (<think> blocks).
    /// When enabled, the model does chain-of-thought reasoning before responding.
    #[serde(default)]
    pub enable_thinking: bool,
}

fn default_use_default_stops() -> bool {
    true
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            max_tokens: 256,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            repetition_penalty: 1.1,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            stop_sequences: vec![],
            seed: None,
            use_default_stops: true,
            enable_thinking: false,
        }
    }
}

impl GenerationConfig {
    /// Create a config optimized for chat/conversation.
    pub fn chat() -> Self {
        Self {
            max_tokens: 256,
            temperature: 0.8,
            top_p: 0.95,
            top_k: 40,
            repetition_penalty: 1.1,
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            stop_sequences: vec![],
            seed: None,
            use_default_stops: true,
            // Persona chat thinks by default today; preserve that under the new
            // daemon semantics where enable_thinking=false suppresses CoT.
            enable_thinking: true,
        }
    }

    /// Create a deterministic config (for testing).
    pub fn deterministic() -> Self {
        Self {
            max_tokens: 256,
            temperature: 0.0,
            top_p: 1.0,
            top_k: 1,
            repetition_penalty: 1.0,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            stop_sequences: vec![],
            seed: Some(42),
            use_default_stops: true,
            enable_thinking: false,
        }
    }

    /// Create a config optimized for agent/tool calling.
    ///
    /// Uses low temperature for reliable structured XML tool call output.
    /// Reduced max_tokens prevents endless generation.
    /// Stop sequences halt generation on pleasantries/loops.
    /// Default stops are disabled - the agent controls its own stop sequences.
    pub fn agent() -> Self {
        Self {
            max_tokens: 4096, // Thinking blocks can use 1-2k tokens alone; leave room for answer
            temperature: 0.6,
            top_p: 0.95,
            top_k: 20,
            repetition_penalty: 1.3, // Increased from 1.2 for better loop prevention
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            stop_sequences: vec![
                "Have a great day".to_string(),
                "You're welcome!".to_string(),
                "</tool_call>".to_string(), // Stop after Qwen3.5 XML tool call
            ],
            seed: None,
            use_default_stops: false,
            // Casper reasons before emitting tool calls; keep CoT on. (The daemon
            // now suppresses CoT only when this is false — e.g. the query planner.)
            enable_thinking: true,
        }
    }

    /// Set max tokens.
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Enable or disable Qwen3.5 thinking mode.
    pub fn with_enable_thinking(mut self, enable: bool) -> Self {
        self.enable_thinking = enable;
        self
    }
}

/// Chat message for conversation context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Role: "system", "user", or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
}

impl ChatMessage {
    /// Create a system message.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
        }
    }

    /// Create a user message.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
        }
    }

    /// Create an assistant message.
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
        }
    }

    /// Create a tool response message.
    ///
    /// Tool responses use the "tool" role which is handled specially by the inference daemon
    /// to wrap the content in `<tool_response>...</tool_response>` tags inside a user message.
    pub fn tool_response(content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: content.into(),
        }
    }
}

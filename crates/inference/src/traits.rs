//! Trait definitions for inference engines.

use tokio::sync::mpsc;

use crate::config::{ChatMessage, GenerationConfig};
use crate::error::Result;

/// Sentinel persona ID for loading base model without an adapter.
pub const BASE_MODEL_PERSONA_ID: &str = "__base__";

/// Async trait for inference engine backends.
///
/// The MLX Python subprocess backend implements this trait to provide
/// a unified async interface for text generation.
#[allow(async_fn_in_trait)]
pub trait AsyncInferenceEngineBackend: Send {
    /// Load a persona's adapter for inference (async).
    async fn load_persona(&mut self, persona_id: &str) -> Result<()>;

    /// Load only the base model without any persona adapter.
    ///
    /// This is used by agents that don't need a persona-specific model,
    /// such as the Casper agent which uses the base model for general tasks.
    async fn load_base_model(&mut self) -> Result<()> {
        self.load_persona(BASE_MODEL_PERSONA_ID).await
    }

    /// Get the currently loaded persona ID, if any.
    fn current_persona(&self) -> Option<&str>;

    /// Generate a response from chat messages (async, non-streaming).
    async fn generate(&mut self, messages: &[ChatMessage], config: &GenerationConfig) -> Result<String>;

    /// Generate a response with streaming output (async).
    async fn generate_streaming(
        &mut self,
        messages: &[ChatMessage],
        config: &GenerationConfig,
    ) -> Result<mpsc::Receiver<String>>;

    /// Check if the engine is ready for inference.
    fn is_ready(&self) -> bool;

    /// Shutdown the engine and release resources (async).
    async fn shutdown(&mut self) -> Result<()>;
}

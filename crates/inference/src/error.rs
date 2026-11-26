//! Error types for the inference crate.

use thiserror::Error;

/// Errors that can occur during inference operations.
#[derive(Debug, Error)]
pub enum InferenceError {
    /// Failed to load LoRA adapter.
    #[error("failed to load LoRA adapter: {0}")]
    AdapterLoadFailed(String),

    /// Failed during text generation.
    #[error("text generation failed: {0}")]
    GenerationFailed(String),

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Inference engine not initialized.
    #[error("inference engine not initialized - call load_model first")]
    NotInitialized,

    /// Chat template error.
    #[error("chat template error: {0}")]
    ChatTemplateError(String),

    /// Adapter was trained with an incompatible base model.
    #[error("adapter incompatible: {0}")]
    AdapterIncompatible(String),

    /// The caller cancelled the request.
    #[error("request cancelled")]
    Cancelled,

    /// The daemon runs a script with another protocol version.
    #[error("inference daemon speaks protocol {daemon}, this app needs {client}; restart the daemon")]
    ProtocolMismatch { daemon: u32, client: u32 },

    /// Backend error (from MLX Python daemon or other backend).
    #[error("inference backend error: {0}")]
    BackendError(String),
}

/// Result type alias for inference operations.
pub type Result<T> = std::result::Result<T, InferenceError>;

//! Inference crate for Be Right Back.
//!
//! This crate provides inference capabilities for running fine-tuned
//! LLM personas on Apple Silicon Macs via MLX Python subprocess.
//!
//! # Quick Start
//!
//! ```ignore
//! use inference::{UnifiedEngine, InferenceBackend, GenerationConfig, ChatMessage};
//!
//! // Create engine with the MLX Python backend
//! let mut engine = UnifiedEngine::new(InferenceBackend::default())?;
//!
//! // Load a persona
//! engine.load_persona("alice").await?;
//!
//! // Build chat messages
//! let messages = vec![
//!     ChatMessage::system("You are Alice, texting your friend."),
//!     ChatMessage::user("Hey! How's it going?"),
//! ];
//!
//! // Generate response
//! let response = engine.generate(&messages, &GenerationConfig::chat()).await?;
//! println!("Alice: {}", response);
//! ```
//!
//! # Architecture
//!
//! - [`backend`]: Backend selection enum
//! - [`engines`]: Engine implementations
//!   - [`engines::mlx_python`]: MLX via Python subprocess
//! - [`unified`]: Unified engine wrapper
//! - [`traits`]: Common traits for engine implementations
//! - [`config`]: Configuration types for generation and model loading
//! - [`error`]: Error types for inference operations

// Core modules
pub mod agent;
pub mod backend;
pub mod cancel;
pub mod config;
pub mod daemon_connection;
pub mod daemon_manager;
pub mod engines;
pub mod error;
pub mod prompts;
pub mod traits;
pub mod unified;

// Re-export main types at crate root for convenience
pub use backend::InferenceBackend;
pub use cancel::CancelToken;
pub use config::{ChatMessage, GenerationConfig};
pub use error::{InferenceError, Result};
pub use traits::AsyncInferenceEngineBackend;
pub use unified::UnifiedEngine;

// Re-export individual engines
pub use engines::mlx_python::MLXPythonEngine;

// Re-export daemon types
pub use daemon_connection::DaemonConnection;
pub use daemon_manager::{DaemonManager, DaemonRole};

// Re-export agent types
pub use agent::planning::{ExtractedPlan, merge_plans, parse_extracted, resolve_turn_plan};
pub use agent::{
    AgentConfig, AgentProgressEvent, AgentResponse, CasperAgent, MentionedContact, Tool, ToolCall, ToolRegistry,
    ToolResult,
};

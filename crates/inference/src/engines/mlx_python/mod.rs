//! MLX Python subprocess inference engine.
//!
//! This module provides inference using MLX via a long-running Python subprocess.
//! The subprocess keeps the model loaded in memory for fast subsequent requests.

mod engine;
pub mod protocol;

pub use engine::MLXPythonEngine;
pub use protocol::{DaemonCommand, DaemonResponse};

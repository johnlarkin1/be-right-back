//! Inference engine backends.
//!
//! This module contains the inference engine implementation:
//!
//! - [`mlx_python`]: MLX via Python subprocess (works with safetensors)

pub mod mlx_python;

// Re-export main engine types
pub use mlx_python::MLXPythonEngine;

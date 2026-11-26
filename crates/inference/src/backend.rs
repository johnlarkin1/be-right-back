//! Inference backend selection.
//!
//! Currently only MLXPython is available.

use serde::{Deserialize, Serialize};

/// Available inference backends.
///
/// Currently only `MLXPython` is shipped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceBackend {
    /// MLX inference via Python subprocess (default, shipped).
    /// Uses safetensors adapters directly - no GGUF conversion needed.
    #[default]
    MLXPython,
}

impl std::fmt::Display for InferenceBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MLXPython => write!(f, "mlx-python"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_backend() {
        assert_eq!(InferenceBackend::default(), InferenceBackend::MLXPython);
    }
}

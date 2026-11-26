//! Unified inference engine.
//!
//! This module provides a single interface for inference using the
//! MLX Python backend.

use tokio::sync::mpsc;
use tracing::info;

use crate::backend::InferenceBackend;
use crate::config::{ChatMessage, GenerationConfig};
use crate::engines::MLXPythonEngine;
use crate::error::{InferenceError, Result};
use crate::traits::AsyncInferenceEngineBackend;

/// Unified inference engine that wraps the MLX Python backend.
///
/// Provides a single async interface for inference.
pub struct UnifiedEngine {
    backend: InferenceBackend,
    inner: Option<MLXPythonEngine>,
}

impl UnifiedEngine {
    /// Create a new unified engine with the specified backend.
    pub fn new(backend: InferenceBackend) -> Result<Self> {
        info!(backend = %backend, "creating unified engine");

        match backend {
            InferenceBackend::MLXPython => {
                let engine = MLXPythonEngine::spawn()?;
                Ok(Self {
                    backend,
                    inner: Some(engine),
                })
            }
        }
    }

    /// Create a unified engine wrapping an already-created MLXPythonEngine.
    ///
    /// Used when the engine is created via socket mode (async connect) rather
    /// than via the synchronous `new()` constructor.
    pub fn from_engine(backend: InferenceBackend, engine: MLXPythonEngine) -> Self {
        Self {
            backend,
            inner: Some(engine),
        }
    }

    /// Load a persona for inference.
    pub async fn load_persona(&mut self, persona_id: &str) -> Result<()> {
        let engine = self.inner.as_mut().ok_or(InferenceError::NotInitialized)?;
        engine.load_persona(persona_id).await
    }

    /// Get the currently loaded persona ID.
    pub fn current_persona(&self) -> Option<&str> {
        self.inner.as_ref().and_then(|e| e.current_persona())
    }

    /// Generate a response (non-streaming).
    pub async fn generate(&mut self, messages: &[ChatMessage], config: &GenerationConfig) -> Result<String> {
        let engine = self.inner.as_mut().ok_or(InferenceError::NotInitialized)?;
        engine.generate(messages, config).await
    }

    /// Generate a response with streaming output.
    pub async fn generate_streaming(
        &mut self,
        messages: &[ChatMessage],
        config: &GenerationConfig,
    ) -> Result<mpsc::Receiver<String>> {
        let engine = self.inner.as_mut().ok_or(InferenceError::NotInitialized)?;
        engine.generate_streaming(messages, config).await
    }

    /// Check if the engine is ready for inference.
    pub fn is_ready(&self) -> bool {
        self.inner.as_ref().is_some_and(|e| e.is_ready())
    }

    /// Shutdown the engine.
    pub async fn shutdown(&mut self) -> Result<()> {
        info!(backend = %self.backend, "shutting down unified engine");

        if let Some(ref mut engine) = self.inner {
            engine.shutdown().await?;
        }
        self.inner = None;
        Ok(())
    }
}

impl Drop for UnifiedEngine {
    fn drop(&mut self) {
        // Engine handles its own cleanup in its Drop impl
        info!(backend = %self.backend, "unified engine dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_default() {
        assert_eq!(InferenceBackend::default(), InferenceBackend::MLXPython);
    }
}

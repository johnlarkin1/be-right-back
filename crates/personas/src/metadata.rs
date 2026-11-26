/// Persona metadata types and operations
use common::{BrbError, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Metadata for a trained persona
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaMetadata {
    /// Unique identifier (typically the contact ID)
    pub persona_id: String,

    /// Display name for the persona
    pub display_name: String,

    /// Base model used for training
    pub base_model: String,

    /// Training timestamp
    pub created_at: chrono::DateTime<chrono::Utc>,

    /// Training configuration
    pub training_config: TrainingConfig,

    /// Training metrics
    pub metrics: Option<TrainingMetrics>,
}

/// Training configuration used for a persona
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingConfig {
    pub lora_rank: usize,
    pub lora_alpha: f64,
    pub learning_rate: f64,
    pub max_steps: usize,
    pub batch_size: usize,
}

/// Training metrics from the fine-tuning process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingMetrics {
    pub final_loss: f64,
    pub training_duration_secs: u64,
    pub total_examples: usize,
}

impl PersonaMetadata {
    /// Load metadata from a JSON file
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path).map_err(BrbError::Io)?;

        serde_json::from_str(&content)
            .map_err(|e| BrbError::Serialization(format!("Failed to parse metadata from {}: {}", path.display(), e)))
    }

    /// Save metadata to a JSON file
    pub fn save(&self, path: &Path) -> Result<()> {
        let content = serde_json::to_string_pretty(self)?;

        std::fs::write(path, content).map_err(BrbError::Io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Helper to create a valid PersonaMetadata for testing
    fn sample_metadata() -> PersonaMetadata {
        PersonaMetadata {
            persona_id: "test_persona_123".to_string(),
            display_name: "Test User".to_string(),
            base_model: "mlx-community/Qwen3.5-9B-8bit".to_string(),
            created_at: chrono::Utc::now(),
            training_config: TrainingConfig {
                lora_rank: 8,
                lora_alpha: 16.0,
                learning_rate: 1e-4,
                max_steps: 100,
                batch_size: 4,
            },
            metrics: Some(TrainingMetrics {
                final_loss: 0.42,
                training_duration_secs: 300,
                total_examples: 500,
            }),
        }
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("metadata.json");

        let original = sample_metadata();
        original.save(&path).unwrap();

        let loaded = PersonaMetadata::load(&path).unwrap();

        assert_eq!(loaded.persona_id, original.persona_id);
        assert_eq!(loaded.display_name, original.display_name);
        assert_eq!(loaded.base_model, original.base_model);
        assert_eq!(loaded.training_config.lora_rank, original.training_config.lora_rank);
        assert_eq!(loaded.training_config.lora_alpha, original.training_config.lora_alpha);
        assert_eq!(
            loaded.training_config.learning_rate,
            original.training_config.learning_rate
        );
        assert_eq!(loaded.training_config.max_steps, original.training_config.max_steps);
        assert_eq!(loaded.training_config.batch_size, original.training_config.batch_size);

        let loaded_metrics = loaded.metrics.unwrap();
        let orig_metrics = original.metrics.unwrap();
        assert_eq!(loaded_metrics.final_loss, orig_metrics.final_loss);
        assert_eq!(
            loaded_metrics.training_duration_secs,
            orig_metrics.training_duration_secs
        );
        assert_eq!(loaded_metrics.total_examples, orig_metrics.total_examples);
    }

    #[test]
    fn test_save_and_load_without_metrics() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("metadata.json");

        let mut metadata = sample_metadata();
        metadata.metrics = None;
        metadata.save(&path).unwrap();

        let loaded = PersonaMetadata::load(&path).unwrap();
        assert!(loaded.metrics.is_none());
        assert_eq!(loaded.persona_id, metadata.persona_id);
    }

    #[test]
    fn test_load_nonexistent_file_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("does_not_exist.json");

        let result = PersonaMetadata::load(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_invalid_json_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, "not valid json {{{").unwrap();

        let result = PersonaMetadata::load(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_load_wrong_schema_returns_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("wrong_schema.json");
        std::fs::write(&path, r#"{"foo": "bar"}"#).unwrap();

        let result = PersonaMetadata::load(&path);
        assert!(result.is_err());
    }

    #[test]
    fn test_save_produces_valid_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("metadata.json");

        let metadata = sample_metadata();
        metadata.save(&path).unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();

        assert_eq!(parsed["persona_id"], "test_persona_123");
        assert_eq!(parsed["display_name"], "Test User");
        assert_eq!(parsed["training_config"]["lora_rank"], 8);
    }

    #[test]
    fn test_serialization_preserves_chrono_timestamp() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("metadata.json");

        let metadata = sample_metadata();
        let original_ts = metadata.created_at;
        metadata.save(&path).unwrap();

        let loaded = PersonaMetadata::load(&path).unwrap();
        assert_eq!(loaded.created_at, original_ts);
    }
}

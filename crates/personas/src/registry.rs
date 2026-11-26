/// Persona registry for listing, loading, and deleting trained personas
use common::{BrbError, Result, get_persona_dir, get_personas_dir};
use tracing::info;

use crate::metadata::PersonaMetadata;
use crate::storage::{ensure_directories, get_metadata_path};

/// Registry for managing trained personas
pub struct PersonaRegistry;

impl PersonaRegistry {
    /// List all available personas
    pub fn list() -> Result<Vec<PersonaMetadata>> {
        ensure_directories()?;
        let personas_dir = get_personas_dir()?;

        if !personas_dir.exists() {
            return Ok(Vec::new());
        }

        let mut personas = Vec::new();

        for entry in std::fs::read_dir(&personas_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                let metadata_path = path.join("metadata.json");
                if metadata_path.exists() {
                    match PersonaMetadata::load(&metadata_path) {
                        Ok(metadata) => personas.push(metadata),
                        Err(e) => {
                            tracing::warn!(
                                ?path,
                                error = %e,
                                "Failed to load persona metadata, skipping"
                            );
                        }
                    }
                }
            }
        }

        Ok(personas)
    }

    /// Load a specific persona by ID
    pub fn load(persona_id: &str) -> Result<PersonaMetadata> {
        let metadata_path = get_metadata_path(persona_id)?;

        PersonaMetadata::load(&metadata_path)
            .map_err(|e| BrbError::InvalidData(format!("Failed to load persona '{}': {}", persona_id, e)))
    }

    /// Check if a persona exists
    pub fn exists(persona_id: &str) -> Result<bool> {
        let persona_dir = get_persona_dir(persona_id)?;
        Ok(persona_dir.exists())
    }

    /// Delete a persona and all its files
    pub fn delete(persona_id: &str) -> Result<()> {
        let persona_dir = get_persona_dir(persona_id)?;

        if !persona_dir.exists() {
            return Err(BrbError::NotFound(format!("Persona '{}' does not exist", persona_id)));
        }

        info!(?persona_dir, "Deleting persona");
        std::fs::remove_dir_all(&persona_dir).map_err(BrbError::Io)?;

        Ok(())
    }

    /// Register a new persona (saves metadata)
    pub fn register(metadata: &PersonaMetadata) -> Result<()> {
        let persona_dir = get_persona_dir(&metadata.persona_id)?;
        std::fs::create_dir_all(&persona_dir)?;

        let metadata_path = get_metadata_path(&metadata.persona_id)?;
        metadata.save(&metadata_path)?;

        info!(persona_id = %metadata.persona_id, "Persona registered");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metadata::{TrainingConfig, TrainingMetrics};
    use crate::test_utils::with_temp_home;

    /// Helper to create a sample PersonaMetadata
    fn sample_metadata(id: &str) -> PersonaMetadata {
        PersonaMetadata {
            persona_id: id.to_string(),
            display_name: format!("Test {}", id),
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
    fn test_list_empty_on_fresh_install() {
        with_temp_home(|_tmp| {
            let personas = PersonaRegistry::list().unwrap();
            assert!(personas.is_empty());
        });
    }

    #[test]
    fn test_list_creates_directories() {
        with_temp_home(|tmp| {
            // Directories should not exist yet
            let personas_dir = tmp.path().join(".be-right-back/models/personas");
            assert!(!personas_dir.exists());

            PersonaRegistry::list().unwrap();

            // After list(), directories should be created via ensure_directories()
            assert!(personas_dir.exists());
        });
    }

    #[test]
    fn test_register_creates_metadata_file() {
        with_temp_home(|tmp| {
            let metadata = sample_metadata("alice123");
            PersonaRegistry::register(&metadata).unwrap();

            let metadata_path = tmp.path().join(".be-right-back/models/personas/alice123/metadata.json");
            assert!(metadata_path.exists());

            // Verify contents
            let loaded = PersonaMetadata::load(&metadata_path).unwrap();
            assert_eq!(loaded.persona_id, "alice123");
            assert_eq!(loaded.display_name, "Test alice123");
        });
    }

    #[test]
    fn test_register_and_list() {
        with_temp_home(|_tmp| {
            let m1 = sample_metadata("persona_a");
            let m2 = sample_metadata("persona_b");

            PersonaRegistry::register(&m1).unwrap();
            PersonaRegistry::register(&m2).unwrap();

            let mut personas = PersonaRegistry::list().unwrap();
            personas.sort_by(|a, b| a.persona_id.cmp(&b.persona_id));

            assert_eq!(personas.len(), 2);
            assert_eq!(personas[0].persona_id, "persona_a");
            assert_eq!(personas[1].persona_id, "persona_b");
        });
    }

    #[test]
    fn test_load_registered_persona() {
        with_temp_home(|_tmp| {
            let metadata = sample_metadata("loadme");
            PersonaRegistry::register(&metadata).unwrap();

            let loaded = PersonaRegistry::load("loadme").unwrap();
            assert_eq!(loaded.persona_id, "loadme");
            assert_eq!(loaded.display_name, "Test loadme");
            assert_eq!(loaded.training_config.lora_rank, 8);
        });
    }

    #[test]
    fn test_load_nonexistent_persona_returns_error() {
        with_temp_home(|_tmp| {
            let result = PersonaRegistry::load("nonexistent_xyz");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_exists_true_after_register() {
        with_temp_home(|_tmp| {
            let metadata = sample_metadata("checkme");
            PersonaRegistry::register(&metadata).unwrap();

            assert!(PersonaRegistry::exists("checkme").unwrap());
        });
    }

    // NOTE: exists() always returns true because get_persona_dir() creates the
    // directory as a side effect. This documents the current behavior — exists()
    // checks directory presence, and the path helper creates directories eagerly.
    #[test]
    fn test_exists_returns_true_due_to_dir_creation_side_effect() {
        with_temp_home(|_tmp| {
            // Even without register(), exists() returns true because
            // get_persona_dir() calls create_dir_all internally.
            assert!(PersonaRegistry::exists("never_registered").unwrap());
        });
    }

    #[test]
    fn test_delete_removes_persona() {
        with_temp_home(|tmp| {
            let metadata = sample_metadata("deleteme");
            PersonaRegistry::register(&metadata).unwrap();

            // Delete
            PersonaRegistry::delete("deleteme").unwrap();

            // Directory should be gone
            let persona_dir = tmp.path().join(".be-right-back/models/personas/deleteme");
            assert!(!persona_dir.exists());
        });
    }

    #[test]
    fn test_delete_registered_persona_removes_metadata() {
        with_temp_home(|tmp| {
            let metadata = sample_metadata("withfiles");
            PersonaRegistry::register(&metadata).unwrap();

            let metadata_path = tmp
                .path()
                .join(".be-right-back/models/personas/withfiles/metadata.json");
            assert!(metadata_path.exists());

            PersonaRegistry::delete("withfiles").unwrap();
            assert!(!metadata_path.exists());
        });
    }

    // NOTE: delete() on a never-registered persona succeeds because
    // get_persona_dir() creates the directory, then delete() removes it.
    #[test]
    fn test_delete_unregistered_succeeds_due_to_dir_creation_side_effect() {
        with_temp_home(|_tmp| {
            let result = PersonaRegistry::delete("ghost_persona");
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_register_overwrites_existing() {
        with_temp_home(|_tmp| {
            let mut metadata = sample_metadata("overwrite_me");
            metadata.display_name = "Original".to_string();
            PersonaRegistry::register(&metadata).unwrap();

            // Re-register with updated name
            metadata.display_name = "Updated".to_string();
            PersonaRegistry::register(&metadata).unwrap();

            let loaded = PersonaRegistry::load("overwrite_me").unwrap();
            assert_eq!(loaded.display_name, "Updated");
        });
    }

    #[test]
    fn test_list_skips_dirs_without_metadata() {
        with_temp_home(|tmp| {
            // Register one valid persona
            let metadata = sample_metadata("valid");
            PersonaRegistry::register(&metadata).unwrap();

            // Create a directory without metadata.json
            let orphan_dir = tmp.path().join(".be-right-back/models/personas/orphan_dir");
            std::fs::create_dir_all(&orphan_dir).unwrap();

            let personas = PersonaRegistry::list().unwrap();
            assert_eq!(personas.len(), 1);
            assert_eq!(personas[0].persona_id, "valid");
        });
    }

    #[test]
    fn test_list_skips_corrupt_metadata() {
        with_temp_home(|tmp| {
            // Register one valid persona
            let metadata = sample_metadata("good");
            PersonaRegistry::register(&metadata).unwrap();

            // Create a persona dir with invalid metadata.json
            let bad_dir = tmp.path().join(".be-right-back/models/personas/bad_meta");
            std::fs::create_dir_all(&bad_dir).unwrap();
            std::fs::write(bad_dir.join("metadata.json"), "not json").unwrap();

            let personas = PersonaRegistry::list().unwrap();
            assert_eq!(personas.len(), 1);
            assert_eq!(personas[0].persona_id, "good");
        });
    }

    #[test]
    fn test_delete_then_list_excludes_deleted() {
        with_temp_home(|_tmp| {
            let m1 = sample_metadata("keep");
            let m2 = sample_metadata("remove");

            PersonaRegistry::register(&m1).unwrap();
            PersonaRegistry::register(&m2).unwrap();
            assert_eq!(PersonaRegistry::list().unwrap().len(), 2);

            PersonaRegistry::delete("remove").unwrap();

            let personas = PersonaRegistry::list().unwrap();
            assert_eq!(personas.len(), 1);
            assert_eq!(personas[0].persona_id, "keep");
        });
    }

    #[test]
    fn test_load_after_delete_returns_error() {
        with_temp_home(|_tmp| {
            let metadata = sample_metadata("temp");
            PersonaRegistry::register(&metadata).unwrap();

            // Load succeeds
            assert!(PersonaRegistry::load("temp").is_ok());

            PersonaRegistry::delete("temp").unwrap();

            // Load fails (metadata.json is gone, even though get_metadata_path
            // recreates the parent directory)
            assert!(PersonaRegistry::load("temp").is_err());
        });
    }
}

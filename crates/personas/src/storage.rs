/// Storage management for persona models and metadata
///
/// Delegates path resolution to `common::paths` for consistency.
use common::Result;
use common::{get_base_models_dir, get_persona_dir, get_personas_dir};
use std::path::PathBuf;

/// Get the metadata file path for a specific persona
pub fn get_metadata_path(persona_id: &str) -> Result<PathBuf> {
    Ok(get_persona_dir(persona_id)?.join("metadata.json"))
}

/// Ensure all required directories exist
pub fn ensure_directories() -> Result<()> {
    get_base_models_dir()?;
    get_personas_dir()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::with_temp_home;

    #[test]
    fn test_get_personas_dir_creates_directory() {
        with_temp_home(|tmp| {
            let personas_dir = get_personas_dir().unwrap();
            assert!(personas_dir.exists());
            assert_eq!(personas_dir, tmp.path().join(".be-right-back/models/personas"));
        });
    }

    #[test]
    fn test_get_persona_dir_creates_directory() {
        with_temp_home(|tmp| {
            let persona_dir = get_persona_dir("test_user_42").unwrap();
            assert!(persona_dir.exists());
            assert_eq!(
                persona_dir,
                tmp.path().join(".be-right-back/models/personas/test_user_42")
            );
        });
    }

    #[test]
    fn test_get_metadata_path() {
        with_temp_home(|tmp| {
            let metadata_path = get_metadata_path("myuser").unwrap();
            assert_eq!(
                metadata_path,
                tmp.path().join(".be-right-back/models/personas/myuser/metadata.json")
            );
        });
    }

    #[test]
    fn test_ensure_directories_creates_all() {
        with_temp_home(|tmp| {
            let base_dir = tmp.path().join(".be-right-back/models/base");
            let personas_dir = tmp.path().join(".be-right-back/models/personas");

            assert!(!base_dir.exists());
            assert!(!personas_dir.exists());

            ensure_directories().unwrap();

            assert!(base_dir.exists());
            assert!(personas_dir.exists());
        });
    }

    #[test]
    fn test_ensure_directories_idempotent() {
        with_temp_home(|_tmp| {
            ensure_directories().unwrap();
            // Calling again should not error
            ensure_directories().unwrap();
        });
    }

    #[test]
    fn test_persona_dir_sanitizes_phone_number() {
        with_temp_home(|tmp| {
            // Phone number with '+' prefix should be sanitized
            let persona_dir = get_persona_dir("+15555550104").unwrap();
            assert_eq!(
                persona_dir,
                tmp.path().join(".be-right-back/models/personas/15555550104")
            );
        });
    }

    #[test]
    fn test_persona_dir_sanitizes_email() {
        with_temp_home(|tmp| {
            let persona_dir = get_persona_dir("alice@example.com").unwrap();
            assert_eq!(
                persona_dir,
                tmp.path().join(".be-right-back/models/personas/alice_example_com")
            );
        });
    }
}

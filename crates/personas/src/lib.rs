/// Persona and model lifecycle management for Be Right Back
///
/// This crate handles:
/// - Persona metadata storage and retrieval
/// - Model registry (base models + LoRA adapters)
/// - Storage conventions in ~/.be-right-back/models/
/// - List/load/delete operations for trained personas
pub mod metadata;
pub mod registry;
pub mod storage;

// Re-export key functionality
pub use common::get_persona_dir;
pub use metadata::{PersonaMetadata, TrainingConfig, TrainingMetrics};
pub use registry::PersonaRegistry;

#[cfg(test)]
pub(crate) mod test_utils {
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// Global lock to serialize all tests that modify the HOME env var.
    /// This must be shared across ALL test modules in this crate.
    pub static HOME_LOCK: Mutex<()> = Mutex::new(());

    /// Run a closure with HOME pointing to a temp directory.
    /// Serialized via HOME_LOCK so tests across modules don't race.
    pub fn with_temp_home<F: FnOnce(&TempDir)>(f: F) {
        let _guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = TempDir::new().unwrap();
        let original_home = std::env::var("HOME").ok();

        unsafe {
            std::env::set_var("HOME", tmp.path());
        }

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&tmp)));

        match original_home {
            Some(h) => unsafe { std::env::set_var("HOME", h) },
            None => unsafe { std::env::remove_var("HOME") },
        }

        if let Err(e) = result {
            std::panic::resume_unwind(e);
        }
    }
}

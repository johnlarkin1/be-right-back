//! Application state management for the Tauri desktop app.
//!
//! This module provides shared state for the inference engine and other
//! long-lived resources.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use common::effective_model;
use inference::{
    AsyncInferenceEngineBackend, CancelToken, DaemonManager, DaemonRole, InferenceBackend, MLXPythonEngine,
    UnifiedEngine,
};
use ingestion::MetadataDb;
use tokio::sync::{Mutex, RwLock};
use tracing::info;

use crate::commands::types::ContactWithStatus;

/// State for tracking active ingestion
pub struct IngestionState {
    /// Flag to signal cancellation
    pub cancel_requested: AtomicBool,
    /// Whether ingestion is currently running
    pub is_running: AtomicBool,
}

impl Default for IngestionState {
    fn default() -> Self {
        Self {
            cancel_requested: AtomicBool::new(false),
            is_running: AtomicBool::new(false),
        }
    }
}

/// State for cancelling an active persona training run.
///
/// `train_persona` attaches the trainer process here. `cancel_training` sets
/// the flag and kills the process. Each side acts after it touches the shared
/// state, so a cancel that lands before the process starts still stops it.
#[derive(Default)]
pub struct TrainingState {
    cancel_requested: AtomicBool,
    child: std::sync::Mutex<Option<std::process::Child>>,
}

impl TrainingState {
    /// Start a new run: clear any earlier cancel request.
    pub fn begin(&self) {
        self.cancel_requested.store(false, Ordering::SeqCst);
    }

    /// Whether the current run should stop.
    pub fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    /// Hand the trainer process to the state so `request_cancel` can kill it.
    ///
    /// Kills it at once if a cancel came in before it started.
    pub fn attach(&self, child: std::process::Child) {
        let mut guard = self.child.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some(child);
        if self.is_cancel_requested() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }

    /// Take the trainer process back, to wait on it.
    pub fn detach(&self) -> Option<std::process::Child> {
        self.child.lock().unwrap_or_else(|p| p.into_inner()).take()
    }

    /// Ask the current run to stop, and kill the trainer if it is running.
    ///
    /// Returns true if a trainer process was running.
    pub fn request_cancel(&self) -> bool {
        self.cancel_requested.store(true, Ordering::SeqCst);
        let mut guard = self.child.lock().unwrap_or_else(|p| p.into_inner());
        match guard.as_mut() {
            Some(child) => {
                let _ = child.kill();
                true
            }
            None => false,
        }
    }
}

/// Cached contact list with AddressBook lookup maps for efficient retrieval.
///
/// Uses RwLock for read-heavy access patterns (many reads, rare writes).
#[derive(Default)]
pub struct ContactsCache {
    /// The snapshot directory this cache was built from
    pub snapshot_dir: Option<PathBuf>,
    /// Cached contacts (sorted by message_count descending)
    pub contacts: Vec<ContactWithStatus>,
    /// AddressBook phone lookup map (normalized E.164 -> display name)
    pub phone_lookup: HashMap<String, String>,
    /// AddressBook email lookup map (lowercase email -> display name)
    pub email_lookup: HashMap<String, String>,
}

impl ContactsCache {
    /// Check if the cache is valid for the given snapshot directory
    pub fn is_valid_for(&self, snapshot_dir: &PathBuf) -> bool {
        self.snapshot_dir.as_ref() == Some(snapshot_dir) && !self.contacts.is_empty()
    }

    /// Invalidate the cache (call when snapshot changes)
    pub fn invalidate(&mut self) {
        self.snapshot_dir = None;
        self.contacts.clear();
        self.phone_lookup.clear();
        self.email_lookup.clear();
        info!("Contacts cache invalidated");
    }
}

/// Cached ingestion metadata to avoid repeated database opens.
///
/// These values only change after ingestion completes, so caching is safe.
#[derive(Debug, Clone, Default)]
pub struct IngestionInfoCache {
    /// Whether cache has been populated
    pub is_populated: bool,
    /// Whether ingestion has completed (valid databases exist)
    pub is_complete: bool,
    /// Last ingestion timestamp
    pub last_ingestion_date: Option<String>,
    /// Duration of last ingestion in seconds
    pub last_ingestion_duration_secs: Option<i64>,
    /// Number of chunks in vector database
    pub chunk_count: i64,
}

impl IngestionInfoCache {
    /// Check if the cache is valid
    pub fn is_valid(&self) -> bool {
        self.is_populated
    }

    /// Invalidate the cache
    pub fn invalidate(&mut self) {
        self.is_populated = false;
        self.is_complete = false;
        self.last_ingestion_date = None;
        self.last_ingestion_duration_secs = None;
        self.chunk_count = 0;
        info!("Ingestion info cache invalidated");
    }
}

impl IngestionState {
    /// Request cancellation of the current ingestion
    pub fn request_cancel(&self) {
        self.cancel_requested.store(true, Ordering::SeqCst);
    }

    /// Check if cancellation was requested
    pub fn is_cancel_requested(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    /// Start a new ingestion (resets cancel flag)
    pub fn start(&self) {
        self.cancel_requested.store(false, Ordering::SeqCst);
        self.is_running.store(true, Ordering::SeqCst);
    }

    /// Mark ingestion as finished
    pub fn finish(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    /// Check if ingestion is running
    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }
}

/// Shared application state.
///
/// This state is managed by Tauri and accessible from all commands.
/// Uses `tokio::sync::Mutex` to allow holding locks across await points.
pub struct AppState {
    /// The inference engine (created lazily)
    pub engine: Arc<Mutex<Option<UnifiedEngine>>>,
    /// Persistent Casper agent engine (4-bit model for tool calling)
    pub casper_engine: Arc<Mutex<Option<MLXPythonEngine>>>,
    pub backend: InferenceBackend,
    /// Daemon manager for persona daemon (socket mode)
    pub persona_daemon: Arc<DaemonManager>,
    /// Daemon manager for agent daemon (socket mode)
    pub agent_daemon: Arc<DaemonManager>,
    /// Ingestion cancellation state
    pub ingestion: Arc<IngestionState>,
    /// Persona training cancellation state
    pub training: Arc<TrainingState>,
    /// Cancel token for the Casper run in progress, if any
    casper_cancel: std::sync::Mutex<Option<CancelToken>>,
    /// Cached contact list (uses RwLock for read-heavy access)
    pub contacts_cache: Arc<RwLock<ContactsCache>>,
    /// Cached ingestion metadata (uses RwLock for read-heavy access)
    pub ingestion_info_cache: Arc<RwLock<IngestionInfoCache>>,
    /// User's stored model preference (e.g., "4b:4bit"). None means auto.
    pub model_preference: std::sync::RwLock<Option<String>>,
}

/// Load the stored model preference from SQLite.
/// Returns None if the database doesn't exist yet or the preference is not set.
fn load_model_preference() -> Option<String> {
    let db = MetadataDb::open().ok()?;
    db.get_model_preference().ok().flatten()
}

impl AppState {
    /// Create new application state with the default backend.
    pub fn new() -> Self {
        Self::with_backend(InferenceBackend::default())
    }

    /// Create application state with a specific backend.
    pub fn with_backend(backend: InferenceBackend) -> Self {
        info!(backend = %backend, "creating app state");

        // Load stored model preference from SQLite
        let stored_pref = load_model_preference();
        if let Some(ref pref) = stored_pref {
            info!(preference = %pref, "loaded model preference from database");
        }

        // Resolve effective model ID from preference
        let effective = effective_model(stored_pref.as_deref());

        // Create daemon managers for socket-mode daemons.
        let persona_daemon =
            Arc::new(DaemonManager::new(DaemonRole::Persona).expect("failed to create persona daemon manager"));
        let agent_daemon =
            Arc::new(DaemonManager::new(DaemonRole::Agent).expect("failed to create agent daemon manager"));

        // Apply model override to both daemons if user has a preference
        if stored_pref.is_some() {
            info!(model = %effective, "applying model preference override to daemons");
            persona_daemon.set_base_model_override(Some(effective.to_string()));
            agent_daemon.set_base_model_override(Some(effective.to_string()));
        }

        Self {
            engine: Arc::new(Mutex::new(None)),
            casper_engine: Arc::new(Mutex::new(None)),
            backend,
            persona_daemon,
            agent_daemon,
            ingestion: Arc::new(IngestionState::default()),
            training: Arc::new(TrainingState::default()),
            casper_cancel: std::sync::Mutex::new(None),
            contacts_cache: Arc::new(RwLock::new(ContactsCache::default())),
            ingestion_info_cache: Arc::new(RwLock::new(IngestionInfoCache::default())),
            model_preference: std::sync::RwLock::new(stored_pref),
        }
    }

    /// Register a new Casper run and return its cancel token.
    ///
    /// A run that is still registered gets cancelled: only one run uses the
    /// Casper engine at a time, and the newest question wins.
    pub fn begin_casper_run(&self) -> CancelToken {
        let token = CancelToken::new();
        let mut guard = self.casper_cancel.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(previous) = guard.replace(token.clone()) {
            previous.cancel();
        }
        token
    }

    /// Unregister a finished Casper run. Leaves a newer run's token alone.
    pub fn end_casper_run(&self, token: &CancelToken) {
        let mut guard = self.casper_cancel.lock().unwrap_or_else(|p| p.into_inner());
        if guard.as_ref().is_some_and(|current| current.same_as(token)) {
            *guard = None;
        }
    }

    /// Cancel the Casper run in progress. Returns true if one was running.
    pub fn cancel_casper_run(&self) -> bool {
        let guard = self.casper_cancel.lock().unwrap_or_else(|p| p.into_inner());
        match guard.as_ref() {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// Get the current model preference string (e.g., "4b:4bit"), or None for auto.
    pub fn get_model_preference(&self) -> Option<String> {
        self.model_preference.read().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Update the model preference and propagate to daemon managers.
    ///
    /// Pass `None` to revert to auto-recommended. Does NOT restart daemons —
    /// the caller is responsible for calling `shutdown_all_daemons()` first.
    pub fn update_model_preference(&self, preference: Option<String>) {
        let effective = effective_model(preference.as_deref());
        let override_model = if preference.is_some() {
            Some(effective.to_string())
        } else {
            None
        };

        info!(
            preference = ?preference,
            effective_model = %effective,
            "updating model preference"
        );

        self.persona_daemon.set_base_model_override(override_model.clone());
        self.agent_daemon.set_base_model_override(override_model);

        let mut guard = self.model_preference.write().unwrap_or_else(|p| p.into_inner());
        *guard = preference;
    }

    /// Invalidate all caches (call after snapshot creation or ingestion)
    pub async fn invalidate_caches(&self) {
        {
            let mut cache = self.contacts_cache.write().await;
            cache.invalidate();
        }
        {
            let mut cache = self.ingestion_info_cache.write().await;
            cache.invalidate();
        }
    }

    /// Invalidate the contacts cache only
    pub async fn invalidate_contacts_cache(&self) {
        let mut cache = self.contacts_cache.write().await;
        cache.invalidate();
    }

    /// Get or create the inference engine (async version).
    ///
    /// The engine is created lazily on first access. Uses socket mode to connect
    /// to a long-lived persona daemon that survives app restarts. Uses the
    /// pre-configured daemon manager which respects model preference overrides.
    pub async fn get_or_create_engine(&self) -> Result<tokio::sync::MutexGuard<'_, Option<UnifiedEngine>>, String> {
        let mut guard = self.engine.lock().await;

        if guard.is_none() {
            info!(backend = %self.backend, "creating inference engine (socket mode)");

            // Try socket mode first using our daemon manager (which has model overrides)
            match MLXPythonEngine::connect_with_manager(Arc::clone(&self.persona_daemon)).await {
                Ok(engine) => {
                    let unified = UnifiedEngine::from_engine(self.backend, engine);
                    *guard = Some(unified);
                }
                Err(e) => {
                    info!(error = %e, "socket mode failed, falling back to pipe mode");
                    let engine =
                        UnifiedEngine::new(self.backend).map_err(|e| format!("failed to create engine: {e}"))?;
                    *guard = Some(engine);
                }
            }
        }

        Ok(guard)
    }

    /// Shutdown the engine if running.
    pub async fn shutdown_engine(&self) -> Result<(), String> {
        let mut guard = self.engine.lock().await;

        if let Some(ref mut engine) = *guard {
            engine.shutdown().await.map_err(|e| format!("{e}"))?;
        }

        *guard = None;
        Ok(())
    }

    /// Get or create the Casper agent engine.
    ///
    /// Uses socket mode to connect to a long-lived agent daemon. Uses the
    /// pre-configured daemon manager which respects model preference overrides.
    pub async fn get_or_create_casper_engine(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<MLXPythonEngine>>, String> {
        let mut guard = self.casper_engine.lock().await;
        if guard.is_none() {
            let model = self.agent_daemon.base_model();
            info!(model = %model, "creating Casper agent engine (socket mode)");

            // Try socket mode first using our daemon manager (which has model overrides)
            match MLXPythonEngine::connect_with_manager(Arc::clone(&self.agent_daemon)).await {
                Ok(engine) => {
                    *guard = Some(engine);
                }
                Err(e) => {
                    info!(error = %e, "socket mode failed, falling back to pipe mode");
                    let engine = MLXPythonEngine::spawn_for_agent()
                        .map_err(|e| format!("failed to create Casper engine: {e}"))?;
                    *guard = Some(engine);
                }
            }
        }
        Ok(guard)
    }

    /// Shutdown the Casper engine if running.
    ///
    /// In socket mode, this just closes the connection -- the daemon keeps running.
    pub async fn shutdown_casper_engine(&self) -> Result<(), String> {
        let mut guard = self.casper_engine.lock().await;
        if let Some(ref mut engine) = *guard {
            engine.shutdown().await.map_err(|e| format!("{e}"))?;
        }
        *guard = None;
        Ok(())
    }

    /// Explicitly shut down all daemon processes.
    ///
    /// Used for full cleanup (e.g., app exit). In normal operation, daemons
    /// auto-exit after 30 minutes idle.
    pub async fn shutdown_all_daemons(&self) -> Result<(), String> {
        info!("shutting down all daemon processes");

        // Shut down engines (closes connections)
        self.shutdown_engine().await?;
        self.shutdown_casper_engine().await?;

        // Kill the actual daemon processes
        self.persona_daemon.shutdown().await.map_err(|e| format!("{e}"))?;
        self.agent_daemon.shutdown().await.map_err(|e| format!("{e}"))?;

        Ok(())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sleeper() -> std::process::Child {
        std::process::Command::new("sleep").arg("30").spawn().unwrap()
    }

    #[test]
    fn training_cancel_kills_the_attached_process() {
        let state = TrainingState::default();
        state.begin();
        state.attach(sleeper());

        assert!(state.request_cancel());
        assert!(state.is_cancel_requested());

        let status = state.detach().unwrap().wait().unwrap();
        assert!(!status.success(), "killed process should not exit cleanly");
    }

    #[test]
    fn training_cancel_before_attach_kills_on_attach() {
        let state = TrainingState::default();
        state.begin();
        assert!(!state.request_cancel(), "nothing running yet");

        state.attach(sleeper());
        let status = state.detach().unwrap().wait().unwrap();
        assert!(!status.success());
    }

    #[test]
    fn training_begin_clears_an_old_cancel() {
        let state = TrainingState::default();
        state.request_cancel();
        state.begin();
        assert!(!state.is_cancel_requested());
    }

    #[test]
    fn casper_cancel_reaches_the_current_run() {
        let state = AppState::new();
        assert!(!state.cancel_casper_run(), "no run yet");

        let token = state.begin_casper_run();
        assert!(state.cancel_casper_run());
        assert!(token.is_cancelled());

        state.end_casper_run(&token);
        assert!(!state.cancel_casper_run());
    }

    #[test]
    fn casper_new_run_cancels_the_old_one() {
        let state = AppState::new();
        let first = state.begin_casper_run();
        let second = state.begin_casper_run();
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());

        // The old run finishing must not unregister the new one.
        state.end_casper_run(&first);
        assert!(state.cancel_casper_run());
        assert!(second.is_cancelled());
    }

    /// Helper to run async code in tests without `tokio::test` macro
    /// (desktop crate doesn't enable tokio `macros`/`rt` features).
    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    #[test]
    fn test_app_state_initializes_with_no_casper_engine() {
        block_on(async {
            let state = AppState::new();
            let guard = state.casper_engine.lock().await;
            assert!(guard.is_none());
        });
    }

    #[test]
    fn test_shutdown_casper_engine_noop_when_empty() {
        block_on(async {
            let state = AppState::new();
            // Should succeed without error when no engine exists
            let result = state.shutdown_casper_engine().await;
            assert!(result.is_ok());
            // Still None after shutdown
            let guard = state.casper_engine.lock().await;
            assert!(guard.is_none());
        });
    }

    #[test]
    fn test_app_state_both_engines_independent() {
        block_on(async {
            let state = AppState::new();
            // Both engines start as None
            assert!(state.engine.lock().await.is_none());
            assert!(state.casper_engine.lock().await.is_none());
            // Can lock both independently (no deadlock)
            let guard1 = state.engine.lock().await;
            drop(guard1);
            let guard2 = state.casper_engine.lock().await;
            drop(guard2);
        });
    }

    #[test]
    fn test_casper_engine_take_and_put_back_pattern() {
        block_on(async {
            let state = AppState::new();
            let mut guard = state.casper_engine.lock().await;

            // Simulate the take/put-back pattern used in casper commands
            assert!(guard.is_none());

            // Take on None returns None (engine not initialized)
            let taken = guard.take();
            assert!(taken.is_none());
            assert!(guard.is_none());
        });
    }

    #[test]
    fn test_casper_engine_try_lock_when_held() {
        block_on(async {
            let state = AppState::new();
            // Hold the lock (simulates Casper agent running)
            let _guard = state.casper_engine.lock().await;
            // try_lock should fail (returns Err)
            assert!(state.casper_engine.try_lock().is_err());
        });
    }

    #[test]
    fn test_shutdown_casper_and_persona_engines_independent() {
        block_on(async {
            let state = AppState::new();
            // Shutting down casper engine doesn't affect persona engine state
            state.shutdown_casper_engine().await.unwrap();
            assert!(state.engine.lock().await.is_none());
            assert!(state.casper_engine.lock().await.is_none());

            state.shutdown_engine().await.unwrap();
            assert!(state.engine.lock().await.is_none());
            assert!(state.casper_engine.lock().await.is_none());
        });
    }

    #[test]
    fn test_ingestion_state_cancel_flow() {
        let state = IngestionState::default();
        assert!(!state.is_running());
        assert!(!state.is_cancel_requested());

        state.start();
        assert!(state.is_running());
        assert!(!state.is_cancel_requested());

        state.request_cancel();
        assert!(state.is_cancel_requested());

        state.finish();
        assert!(!state.is_running());
    }

    #[test]
    fn test_cache_invalidation() {
        block_on(async {
            let state = AppState::new();

            // Populate ingestion info cache
            {
                let mut cache = state.ingestion_info_cache.write().await;
                cache.is_populated = true;
                cache.is_complete = true;
                cache.chunk_count = 100;
            }
            assert!(state.ingestion_info_cache.read().await.is_valid());

            // Invalidate all caches
            state.invalidate_caches().await;
            assert!(!state.ingestion_info_cache.read().await.is_valid());
        });
    }
}

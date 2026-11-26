//! System commands for initialization status and command center data.

use common::{
    cocoa_to_unix, detect_system_memory_gb, effective_model, format_bytes, get_tier_by_name, scripts, ModelPreference,
    PythonEnvironment, Quantization, MODEL_TIERS,
};
use personas::PersonaRegistry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::{debug, info, warn};

// Use the ingestion crate for database operations
use ingestion::{
    write_lock::{self, WriteLockBroker},
    AnalyticsSettings, ContactProgress, IngestionSettings, IngestionStage, IngestionStats as IngestionStatsRust,
    MetadataDb, StageProgress, StageStatus,
};

use crate::AppState;

/// Initialization stages
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
#[serde(rename_all = "snake_case")]
pub enum InitStage {
    Permissions,
    Snapshot,
    Ingestion,
    Model,
    Persona,
}

/// App initialization status
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct InitializationStatus {
    pub has_fda_permission: bool,
    pub has_snapshot: bool,
    pub snapshot_date: Option<String>,
    pub snapshot_message_count: i64,
    pub snapshot_contact_count: i64,
    pub has_sqlite_db: bool,
    pub has_vector_db: bool,
    pub has_base_model: bool,
    pub has_trained_persona: bool,
    pub current_stage: InitStage,
    pub is_fully_initialized: bool,
    // Storage info
    pub snapshot_size_bytes: i64,
    pub snapshot_size_display: String,
    pub embeddings_size_bytes: i64,
    pub embeddings_size_display: String,
    pub total_data_size_bytes: i64,
    pub total_data_size_display: String,
    // Ingestion info
    pub last_ingestion_date: Option<String>,
    pub last_ingestion_duration_secs: Option<i64>,
    pub chunk_count: i64,
}

/// Trained persona info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainedPersona {
    pub id: String,
    pub contact_id: String,
    pub contact_name: String,
    pub display_name: String,
    pub base_model: String,
    pub adapter_size_bytes: i64,
    pub adapter_size_display: String,
    pub trained_at: String,
    pub message_count: i64,
}

/// Ingestion result returned after running ingestion
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct IngestionResult {
    pub success: bool,
    pub sqlite_records: i64,
    pub vector_embeddings: i64,
    pub timestamp: String,
    pub error: Option<String>,
}

/// Ingestion progress event with 6 independent stages
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct IngestionProgressEvent {
    /// All 6 stages with their current progress
    pub stages: Vec<StageProgress>,
    /// Currently active stage. `None` only on the cancellation event, which
    /// carries no stages.
    pub current_stage: Option<IngestionStage>,
    /// Overall completion
    pub is_complete: bool,
    /// Error if any
    pub error: Option<String>,
    /// Live statistics
    pub stats: Option<IngestionStats>,
}

/// Live statistics during ingestion
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct IngestionStats {
    pub messages_processed: Option<i64>,
    pub total_messages: Option<i64>,
    pub contacts_processed: Option<i64>,
    pub total_contacts: Option<i64>,
    pub current_contact: Option<ContactProgress>,
    pub chunks_created: Option<i64>,
    pub chunks_embedded: Option<i64>,
    pub elapsed_secs: Option<u64>,
    pub estimated_remaining_secs: Option<u64>,
}

/// Get the app data directory
fn get_app_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".be-right-back")
}

/// Analytics progress event from Python (parsed from JSON stdout)
#[derive(Debug, Clone, Deserialize)]
struct AnalyticsProgressEvent {
    #[serde(rename = "type")]
    event_type: String,
    stage: String,
    percent: i32,
    message: String,
}

/// Runs the analytics pipeline with default settings.
/// Note: User-configured analytics settings (target_topics, UMAP params, etc.)
/// are only respected during standalone re-analysis via `run_analytics_only`.
/// Initial ingestion always uses Python's default analytics configuration.
///
/// This is a BLOCKING call that streams progress to the frontend.
/// Returns true on success, false on failure (non-fatal).
///
/// The `start_time` parameter is used to compute accurate elapsed time across all stages,
/// ensuring the UI timer continues to update during analytics.
async fn run_analytics_pipeline_blocking(
    app: &AppHandle,
    base_stats: &IngestionStatsRust,
    start_time: std::time::Instant,
) -> bool {
    // Helper to create stats with current elapsed time
    let stats_with_elapsed = |base: &IngestionStatsRust| -> IngestionStatsRust {
        IngestionStatsRust {
            elapsed_secs: start_time.elapsed().as_secs(),
            ..base.clone()
        }
    };

    let db_path = match common::get_brb_duckdb_db() {
        Ok(p) => p,
        Err(e) => {
            warn!(error = %e, "Failed to resolve DuckDB path, skipping analytics");
            return false;
        }
    };

    // Check if DuckDB exists
    if !db_path.exists() {
        warn!(?db_path, "DuckDB not found, skipping analytics");
        return false;
    }

    // Get Python environment
    let env = match PythonEnvironment::get() {
        Ok(env) => env,
        Err(e) => {
            warn!(error = %e, "Python environment not found, skipping analytics");
            let _ = emit_ingestion_progress(
                app,
                IngestionStage::Analyzing,
                100,
                "Analytics skipped (Python not found)",
                &stats_with_elapsed(base_stats),
                true,
                None,
            );
            return false;
        }
    };

    let python_path = &env.python_bin;
    let script_path = env.script(scripts::ANALYTICS);

    // Check if script exists
    if !script_path.exists() {
        warn!(?script_path, "Analytics script not found, skipping analytics");
        let _ = emit_ingestion_progress(
            app,
            IngestionStage::Analyzing,
            100,
            "Analytics skipped (script not found)",
            &stats_with_elapsed(base_stats),
            true,
            None,
        );
        return false;
    }

    info!(?script_path, "Running analytics pipeline (blocking)...");

    // Emit start of analytics stage
    let _ = emit_ingestion_progress(
        app,
        IngestionStage::Analyzing,
        0,
        "Starting analytics...",
        &stats_with_elapsed(base_stats),
        false,
        None,
    );

    // Spawn Python process with piped stdout. The script reads brb.duckdb
    // read-only and asks for the write lock over stdin/stdout before it writes
    // (see `ingestion::write_lock`).
    let mut child = match tokio::process::Command::new(python_path)
        .arg(&script_path)
        .arg("--db-path")
        .arg(&db_path)
        .env(write_lock::HANDSHAKE_ENV, "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        // Inherited, not piped: an undrained pipe blocks a chatty child once the
        // buffer fills. Inheriting keeps Python tracebacks in the app log.
        .stderr(std::process::Stdio::inherit())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            warn!(error = %e, "Failed to spawn analytics process");
            let _ = emit_ingestion_progress(
                app,
                IngestionStage::Analyzing,
                100,
                &format!("Analytics failed: {}", e),
                &stats_with_elapsed(base_stats),
                true,
                None,
            );
            return false;
        }
    };

    // Stream stdout for progress
    let mut stdin = child.stdin.take();
    let broker = std::sync::Arc::new(std::sync::Mutex::new(WriteLockBroker::new()));
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            // An acquire can wait for in-flight reads, so run it off the async runtime.
            let reply = if line.contains("\"write_lock\"") {
                let lock_broker = broker.clone();
                let request = line.clone();
                tokio::task::spawn_blocking(move || {
                    lock_broker
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .handle(&request)
                })
                .await
                .unwrap_or(None)
            } else {
                None
            };
            if let Some(reply) = reply {
                if let Some(stdin) = stdin.as_mut() {
                    let _ = stdin.write_all(format!("{reply}\n").as_bytes()).await;
                    let _ = stdin.flush().await;
                }
                continue;
            }

            // Try to parse as analytics progress JSON
            if let Ok(progress) = serde_json::from_str::<AnalyticsProgressEvent>(&line) {
                if progress.event_type == "analytics_progress" {
                    // Map sub-stage to user-friendly message
                    let display_message = match progress.stage.as_str() {
                        "loading" => format!("Loading data... {}%", progress.percent),
                        "pca" => format!("PCA reduction... {}%", progress.percent),
                        "clustering" => format!("Clustering... {}%", progress.percent),
                        "umap_2d" => format!("2D projection... {}%", progress.percent),
                        "umap_3d" => format!("3D projection... {}%", progress.percent),
                        "labeling" => format!("Generating labels... {}%", progress.percent),
                        "saving_clusters" => format!("Saving clusters... {}%", progress.percent),
                        "activity" => format!("Computing activity... {}%", progress.percent),
                        "words" => format!("Computing word frequencies... {}%", progress.percent),
                        "complete" => "Analytics complete".to_string(),
                        _ => progress.message.clone(),
                    };

                    // Calculate overall progress (map sub-stages to 0-100 for Analyzing stage)
                    let overall_percent = match progress.stage.as_str() {
                        "loading" => progress.percent / 10,              // 0-10%
                        "pca" => 10 + progress.percent / 10,             // 10-20%
                        "clustering" => 20 + progress.percent / 10,      // 20-30%
                        "umap_2d" => 30 + progress.percent / 5,          // 30-50%
                        "umap_3d" => 50 + progress.percent / 5,          // 50-70%
                        "labeling" => 70 + progress.percent / 10,        // 70-80%
                        "saving_clusters" => 80 + progress.percent / 20, // 80-85%
                        "activity" => 85 + progress.percent / 20,        // 85-90%
                        "words" => 90 + progress.percent / 10,           // 90-100%
                        "complete" => 100,
                        _ => progress.percent,
                    };

                    let _ = emit_ingestion_progress(
                        app,
                        IngestionStage::Analyzing,
                        overall_percent.min(99) as u8, // Don't emit 100% until confirmed success
                        &display_message,
                        &stats_with_elapsed(base_stats),
                        false,
                        None,
                    );
                }
            }
        }
    }

    // Wait for process to complete
    let status = match child.wait().await {
        Ok(status) => status,
        Err(e) => {
            warn!(error = %e, "Failed to wait for analytics process");
            let _ = emit_ingestion_progress(
                app,
                IngestionStage::Analyzing,
                100,
                "Analytics failed (process error)",
                &stats_with_elapsed(base_stats),
                true,
                None,
            );
            return false;
        }
    };
    // Releases a lock the child never released (a crash mid-write).
    drop(broker);
    drop(stdin);

    if status.success() {
        info!("Analytics pipeline completed successfully");

        // Record analytics completion in app_state
        // Note: We don't have a way to get cluster count from Python yet, so use 0
        if let Ok(metadata_db) = MetadataDb::open() {
            if let Err(e) = metadata_db.record_analytics_complete(0) {
                warn!(error = %e, "Failed to record analytics completion");
            }
        }

        let _ = emit_ingestion_progress(
            app,
            IngestionStage::Analyzing,
            100,
            "Analytics complete",
            &stats_with_elapsed(base_stats),
            true,
            None,
        );
        true
    } else {
        warn!(status = %status, "Analytics pipeline failed");
        let _ = emit_ingestion_progress(
            app,
            IngestionStage::Analyzing,
            100,
            "Analytics failed (non-fatal)",
            &stats_with_elapsed(base_stats),
            true,
            None,
        );
        false
    }
}

/// Check if Full Disk Access is available by probing protected directories that are only
/// readable when FDA is granted.
///
/// Same approach as <https://github.com/inket/FullDiskAccess>, but `NotFound` is treated as
/// inconclusive rather than as a denial. A directory that does not exist tells us nothing about
/// permissions -- e.g. `~/Library/Safari` is absent on a Mac where Safari was never opened, and
/// reading that as "FDA denied" would strand the user on the permissions step forever.
///
/// Only an explicit success (granted) or `PermissionDenied` (denied) is decisive. If every probe
/// is inconclusive we report `false`, since proceeding without access fails later anyway -- but
/// the probe list leads with `~/Library/Messages`, the directory the app actually needs, which
/// exists on any Mac that has ever run Messages.
fn check_fda_permission() -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    let probes = [
        "Library/Messages",
        "Library/Safari",
        "Library/Containers/com.apple.stocks",
        "Library/Application Support/com.apple.TCC",
    ];

    // `map` keeps this lazy, so probing stops at the first decisive answer.
    let outcomes = probes
        .into_iter()
        .map(|probe| classify_probe(std::fs::read_dir(home.join(probe)).map(|_| ())));

    resolve_fda_probes(outcomes).unwrap_or_else(|| {
        debug!("all FDA probes inconclusive; reporting not-granted");
        false
    })
}

/// What a single directory probe tells us about Full Disk Access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProbeOutcome {
    /// The directory was readable — access is granted.
    Granted,
    /// The OS refused — access is denied.
    Denied,
    /// The probe says nothing either way (most often the directory does not exist).
    Inconclusive,
}

/// Classify one probe. Only success and `PermissionDenied` are decisive.
fn classify_probe(result: std::io::Result<()>) -> ProbeOutcome {
    match result {
        Ok(()) => ProbeOutcome::Granted,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => ProbeOutcome::Denied,
        Err(_) => ProbeOutcome::Inconclusive,
    }
}

/// Reduce probe outcomes to a verdict, stopping at the first decisive one.
///
/// `None` means every probe was inconclusive — distinct from `Some(false)` (actively denied).
fn resolve_fda_probes(outcomes: impl IntoIterator<Item = ProbeOutcome>) -> Option<bool> {
    for outcome in outcomes {
        match outcome {
            ProbeOutcome::Granted => return Some(true),
            ProbeOutcome::Denied => return Some(false),
            ProbeOutcome::Inconclusive => continue,
        }
    }
    None
}

/// Open macOS System Settings to the Full Disk Access pane.
///
/// The app needs macOS 14+, so it always uses the Ventura-and-later pane identifier.
/// `open`'s exit status validates the *scheme*, not the pane: an unknown pane under the
/// registered `x-apple.systempreferences:` scheme still exits 0 and lands on the default pane.
///
/// Each attempt still waits on `open` and checks its status: `spawn()` alone only reports
/// whether the process launched, so a bad scheme would look like success.
#[tauri::command]
pub fn open_fda_settings() -> Result<(), String> {
    info!("Opening FDA settings");

    #[cfg(target_os = "macos")]
    {
        let pane = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles";

        // Plain System Settings remains a fallback for the case the status check can catch:
        // the URL scheme itself being unavailable.
        let targets = [pane, "/System/Applications/System Settings.app"];

        let mut last_error = String::new();
        for target in targets {
            match std::process::Command::new("open").arg(target).status() {
                Ok(status) if status.success() => {
                    debug!(target, "opened settings");
                    return Ok(());
                }
                Ok(status) => {
                    last_error = format!("`open {target}` exited with {status}");
                    warn!(target, %status, "settings URL rejected, trying fallback");
                }
                Err(e) => {
                    last_error = format!("failed to run `open {target}`: {e}");
                    warn!(target, error = %e, "could not launch `open`, trying fallback");
                }
            }
        }

        Err(format!(
            "Could not open the Full Disk Access pane. Open System Settings > Privacy & Security \
             > Full Disk Access manually. Last error: {last_error}"
        ))
    }

    #[cfg(not(target_os = "macos"))]
    Ok(())
}

/// Check if a snapshot exists and get its info
/// Get the path to the latest snapshot directory (if any)
fn get_latest_snapshot_path() -> Option<PathBuf> {
    let raw_dir = get_app_dir().join("data/raw");

    if !raw_dir.exists() {
        return None;
    }

    let entries: Vec<_> = std::fs::read_dir(&raw_dir).ok()?.filter_map(|e| e.ok()).collect();

    entries
        .iter()
        .filter(|e| e.path().is_dir())
        .max_by_key(|e| e.file_name())
        .map(|e| e.path())
}

fn get_snapshot_info() -> (bool, Option<String>, i64, i64) {
    // Try to get snapshot info from SQLite database (source of truth)
    if let Ok(db) = MetadataDb::open() {
        if let Ok(app_state) = db.get_app_state() {
            if app_state.curr_ingestion_id.is_some() {
                return (
                    true,
                    app_state.snapshot_time,
                    app_state.snapshot_message_count.unwrap_or(0),
                    app_state.snapshot_contact_count.unwrap_or(0),
                );
            }
        }
    }

    // Fallback: check if snapshot directory exists with chat_snapshot.db
    if let Some(snapshot_dir) = get_latest_snapshot_path() {
        let chat_db = snapshot_dir.join("chat_snapshot.db");
        if chat_db.exists() {
            return (true, None, 0, 0);
        }
    }

    (false, None, 0, 0)
}

/// Check if ingestion has been completed (valid databases exist)
fn check_ingestion_complete() -> bool {
    ingestion::is_ingestion_complete()
}

/// Check if a base model is downloaded
fn check_base_model() -> bool {
    let models_dir = get_app_dir().join("models/base");
    if models_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            return entries.count() > 0;
        }
    }
    false
}

/// List trained personas using the canonical PersonaRegistry
fn list_trained_personas() -> Vec<TrainedPersona> {
    let personas = personas::PersonaRegistry::list().unwrap_or_default();
    personas
        .iter()
        .filter_map(|m| {
            let persona_dir = personas::get_persona_dir(&m.persona_id).ok()?;
            let adapter_size = get_dir_size(&persona_dir.join("adapter"));
            Some(TrainedPersona {
                id: m.persona_id.clone(),
                contact_id: m.persona_id.clone(),
                contact_name: m.display_name.clone(),
                display_name: m.display_name.clone(),
                base_model: m.base_model.clone(),
                adapter_size_bytes: adapter_size,
                adapter_size_display: format_bytes(adapter_size as u64),
                trained_at: m.created_at.to_rfc3339(),
                message_count: m.metrics.as_ref().map(|m| m.total_examples as i64).unwrap_or(0),
            })
        })
        .collect()
}

/// Get directory size in bytes
fn get_dir_size(path: &PathBuf) -> i64 {
    let mut size: i64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                size += std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
            } else if path.is_dir() {
                size += get_dir_size(&path);
            }
        }
    }
    size
}

/// Get ingestion metadata (last run timestamp, duration, chunk count)
fn get_ingestion_info() -> (Option<String>, Option<i64>, i64) {
    // Get last ingestion metadata from SQLite
    let (last_date, duration) = match ingestion::get_latest_ingestion() {
        Ok(Some(meta)) => (Some(meta.snapshot_time), Some(meta.ingestion_duration_secs)),
        _ => (None, None),
    };

    // Get chunk count from DuckDB (read-only - no HNSW recreation or extension requirements)
    let chunk_count = match ingestion::VectorDb::open_readonly() {
        Ok(db) => match db.get_chunk_count() {
            Ok(count) => count,
            Err(e) => {
                warn!("Failed to count chunks in DuckDB: {}", e);
                0
            }
        },
        Err(e) => {
            warn!("Failed to open vector DB for chunk count: {}", e);
            0
        }
    };

    (last_date, duration, chunk_count)
}

/// Mutable state for tracking 6-stage ingestion progress
struct IngestionProgressTracker {
    stages: [StageProgress; 6],
    current_stage_index: usize,
}

impl Default for IngestionProgressTracker {
    fn default() -> Self {
        Self {
            stages: IngestionStage::all().map(StageProgress::new),
            current_stage_index: 0,
        }
    }
}

impl IngestionProgressTracker {
    /// Update the tracker with a new progress event using the 6-stage system
    fn update(&mut self, stage: IngestionStage, percent: u8, message: &str) {
        let stage_idx = stage.index();
        self.current_stage_index = stage_idx;

        // Mark all previous stages as completed
        for prior in self.stages.iter_mut().take(stage_idx) {
            prior.status = StageStatus::Completed;
            prior.percent = 100;
        }

        // Update current stage
        self.stages[stage_idx].percent = percent;
        self.stages[stage_idx].message = message.to_string();
        self.stages[stage_idx].status = if percent >= 100 {
            StageStatus::Completed
        } else {
            StageStatus::InProgress
        };
    }

    /// Get the currently active stage
    fn current_stage(&self) -> IngestionStage {
        self.stages[self.current_stage_index].stage
    }

    /// Mark all stages as completed
    fn mark_complete(&mut self) {
        for stage in &mut self.stages {
            stage.status = StageStatus::Completed;
            stage.percent = 100;
        }
    }
}

// Thread-local tracker for ingestion progress
thread_local! {
    static INGESTION_TRACKER: std::cell::RefCell<IngestionProgressTracker> =
        std::cell::RefCell::new(IngestionProgressTracker::default());
}

fn emit_ingestion_progress(
    app: &AppHandle,
    stage: IngestionStage,
    percent: u8,
    message: &str,
    stats: &IngestionStatsRust,
    is_complete: bool,
    error: Option<String>,
) -> Result<(), String> {
    // Update tracker and build event
    let event = INGESTION_TRACKER.with(|tracker| {
        let mut tracker = tracker.borrow_mut();
        tracker.update(stage, percent, message);

        if is_complete {
            tracker.mark_complete();
        }

        let stats_event = IngestionStats {
            messages_processed: Some(stats.messages_processed),
            total_messages: Some(stats.total_messages),
            contacts_processed: Some(stats.contacts_processed),
            total_contacts: Some(stats.total_contacts),
            current_contact: stats.current_contact.clone(),
            chunks_created: Some(stats.chunks_created),
            chunks_embedded: Some(stats.chunks_embedded),
            elapsed_secs: Some(stats.elapsed_secs),
            estimated_remaining_secs: stats.estimated_remaining_secs,
        };

        IngestionProgressEvent {
            stages: tracker.stages.clone().to_vec(),
            current_stage: Some(tracker.current_stage()),
            is_complete,
            error: error.clone(),
            stats: Some(stats_event),
        }
    });

    // Reset tracker if complete or error
    if is_complete || error.is_some() {
        INGESTION_TRACKER.with(|tracker| {
            *tracker.borrow_mut() = IngestionProgressTracker::default();
        });
    }

    app.emit("ingestion-progress", event).map_err(|e| e.to_string())
}

/// Get initialization status
///
/// Uses caching for expensive database queries (ingestion metadata, chunk count).
#[tauri::command]
pub async fn get_initialization_status(
    state: tauri::State<'_, crate::AppState>,
) -> Result<InitializationStatus, String> {
    info!("Getting initialization status");

    let has_fda = check_fda_permission();
    let (has_snapshot, snapshot_date, msg_count, contact_count) = get_snapshot_info();
    let has_model = check_base_model();
    let personas = list_trained_personas();
    let has_persona = !personas.is_empty();

    // Get cached ingestion info or populate cache
    let (ingestion_complete, last_ingestion_date, last_ingestion_duration_secs, chunk_count) = {
        let cache = state.ingestion_info_cache.read().await;
        if cache.is_valid() {
            debug!("Using cached ingestion info");
            (
                cache.is_complete,
                cache.last_ingestion_date.clone(),
                cache.last_ingestion_duration_secs,
                cache.chunk_count,
            )
        } else {
            drop(cache); // Release read lock before acquiring write lock

            info!("Building ingestion info cache");
            let is_complete = check_ingestion_complete();
            let (date, duration, chunks) = get_ingestion_info();

            // Update cache
            let mut cache = state.ingestion_info_cache.write().await;
            cache.is_populated = true;
            cache.is_complete = is_complete;
            cache.last_ingestion_date = date.clone();
            cache.last_ingestion_duration_secs = duration;
            cache.chunk_count = chunks;
            info!("Ingestion info cache updated");

            (is_complete, date, duration, chunks)
        }
    };

    // Determine current stage
    let current_stage = if !has_fda {
        InitStage::Permissions
    } else if !has_snapshot {
        InitStage::Snapshot
    } else if !ingestion_complete {
        InitStage::Ingestion
    } else if !has_model {
        InitStage::Model
    } else {
        InitStage::Persona
    };

    let is_fully_initialized = has_fda && has_snapshot && ingestion_complete;

    // Calculate storage sizes (these are fast filesystem operations, no caching needed)
    let app_dir = get_app_dir();
    let db_dir = app_dir.join("data/db");
    let data_dir = app_dir.join("data");

    let snapshot_size_bytes = get_latest_snapshot_path().map(|p| get_dir_size(&p)).unwrap_or(0);
    let embeddings_size_bytes = get_dir_size(&db_dir);
    let total_data_size_bytes = get_dir_size(&data_dir);

    Ok(InitializationStatus {
        has_fda_permission: has_fda,
        has_snapshot,
        snapshot_date,
        snapshot_message_count: msg_count,
        snapshot_contact_count: contact_count,
        has_sqlite_db: ingestion_complete,
        has_vector_db: ingestion_complete,
        has_base_model: has_model,
        has_trained_persona: has_persona,
        current_stage,
        is_fully_initialized,
        // Storage info
        snapshot_size_bytes,
        snapshot_size_display: format_bytes(snapshot_size_bytes as u64),
        embeddings_size_bytes,
        embeddings_size_display: format_bytes(embeddings_size_bytes as u64),
        total_data_size_bytes,
        total_data_size_display: format_bytes(total_data_size_bytes as u64),
        // Ingestion info
        last_ingestion_date,
        last_ingestion_duration_secs,
        chunk_count,
    })
}

/// Run ingestion pipeline (creates databases from the latest snapshot)
/// Emits `ingestion-progress` events to track progress across 5 stages.
/// Supports cancellation via the cancel_ingestion command.
#[tauri::command]
pub async fn run_ingestion(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<IngestionResult, String> {
    info!("Running ingestion");

    // Track overall start time for elapsed time calculations across all stages including analytics
    let overall_start_time = std::time::Instant::now();

    // Mark ingestion as started (resets cancel flag)
    let ingestion_state = state.ingestion.clone();
    ingestion_state.start();

    // Emits `system-resources` until this function returns, including the analytics phase
    let _resource_sampler = super::resources::ResourceSampler::start(app.clone());

    let db_dir = get_app_dir().join("data/db");
    std::fs::create_dir_all(&db_dir).map_err(|e| {
        ingestion_state.finish();
        format!("Failed to create database directory: {}", e)
    })?;

    // Ensure Python environment exists before entering blocking ingestion.
    // Fast no-op when venv already exists and deps are current.
    PythonEnvironment::ensure(&app).await.map_err(|e| {
        ingestion_state.finish();
        format!("Failed to setup Python environment: {}", e)
    })?;

    let config = ingestion::IngestionConfig { create_snapshot: true };

    // Clone state for the cancel check closure
    let cancel_state = ingestion_state.clone();
    let is_cancelled = move || cancel_state.is_cancel_requested();

    // Run blocking ingestion on a separate thread to avoid blocking the async runtime
    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        ingestion::run_ingestion_cancellable(
            config,
            move |stage, percent, message, stats| {
                // Never set is_complete here - analytics still needs to run after saving
                // is_complete will be set after analytics pipeline finishes
                let _ = emit_ingestion_progress(&app_clone, stage, percent, message, &stats, false, None);
            },
            is_cancelled,
        )
    })
    .await;

    // Mark ingestion as finished
    ingestion_state.finish();

    // Handle the result
    match result {
        Ok(Ok(ingestion_result)) => {
            info!(
                message_count = ingestion_result.message_count,
                contact_count = ingestion_result.contact_count,
                duration_secs = ingestion_result.duration_secs,
                "Ingestion completed successfully"
            );

            // Build base stats for analytics progress events (elapsed_secs will be computed dynamically)
            let analytics_stats = IngestionStatsRust {
                messages_processed: ingestion_result.message_count,
                total_messages: ingestion_result.message_count,
                contacts_processed: ingestion_result.contact_count,
                total_contacts: ingestion_result.contact_count,
                current_contact: None,
                chunks_created: ingestion_result.chunk_count,
                chunks_embedded: ingestion_result.chunk_count,
                elapsed_secs: 0, // Will be computed dynamically from overall_start_time
                estimated_remaining_secs: None,
            };

            // Run analytics pipeline (Leiden + UMAP clustering for Insights page)
            // This is BLOCKING - runs before returning result to ensure Insights page has data
            let analytics_success = run_analytics_pipeline_blocking(&app, &analytics_stats, overall_start_time).await;

            if !analytics_success {
                info!("Analytics pipeline failed or was skipped, but ingestion core succeeded");
            }

            // Invalidate all caches since data changed
            state.invalidate_caches().await;

            Ok(IngestionResult {
                success: true,
                sqlite_records: ingestion_result.message_count,
                vector_embeddings: ingestion_result.chunk_count,
                timestamp: ingestion_result.timestamp,
                error: None,
            })
        }
        Ok(Err(common::BrbError::Cancelled(msg))) => {
            info!("Ingestion was cancelled: {}", msg);

            // Clean up partial DuckDB files after cancellation
            let duckdb_path = common::get_brb_duckdb_db().map_err(|e| format!("Failed to resolve DuckDB path: {e}"))?;
            for ext in &["", "-wal", "-shm"] {
                let path = if ext.is_empty() {
                    duckdb_path.clone()
                } else {
                    duckdb_path.with_extension(format!("duckdb{}", ext))
                };
                if path.exists() {
                    info!(?path, "Removing partial file after cancellation");
                    let _ = std::fs::remove_file(&path);
                }
            }

            Err(msg)
        }
        Ok(Err(e)) => {
            info!("Ingestion failed: {}", e);
            Err(format!("Ingestion failed: {}", e))
        }
        Err(e) => {
            info!("Task join error: {}", e);
            Err(format!("Task join error: {}", e))
        }
    }
}

/// Cancel the current ingestion process.
///
/// This sets a cancellation flag that is checked by the running ingestion task.
/// The ingestion task will kill the Python subprocess and clean up partial files
/// when it detects the cancellation request.
#[tauri::command]
pub async fn cancel_ingestion(state: tauri::State<'_, crate::AppState>, app: AppHandle) -> Result<(), String> {
    info!("Cancelling ingestion");

    // Check if ingestion is actually running
    if !state.ingestion.is_running() {
        info!("No ingestion running, nothing to cancel");
        return Ok(());
    }

    // Set the cancel flag - the running task will detect this and stop
    state.ingestion.request_cancel();

    // Emit a cancelled event to the frontend for immediate UI feedback
    let _ = app.emit(
        "ingestion-progress",
        IngestionProgressEvent {
            stages: vec![],
            current_stage: None,
            is_complete: false,
            error: Some("Ingestion cancelled by user".to_string()),
            stats: None,
        },
    );

    // Note: File cleanup happens in run_ingestion after the Python process is killed
    // and the task exits. This ensures we don't try to delete files that are still in use.

    Ok(())
}

// =============================================================================
// Ingestion Settings Commands
// =============================================================================

use crate::commands::types::MessageDateRange;

/// Convert a pair of Apple Cocoa timestamps to ISO `YYYY-MM-DD` dates.
fn cocoa_range_to_iso(earliest_ts: i64, latest_ts: i64) -> MessageDateRange {
    let earliest_date = chrono::DateTime::from_timestamp(cocoa_to_unix(earliest_ts), 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "2000-01-01".to_string());

    let latest_date = chrono::DateTime::from_timestamp(cocoa_to_unix(latest_ts), 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    MessageDateRange {
        earliest_date,
        latest_date,
    }
}

/// Get the date range of the user's messages.
///
/// Prefers the **live** Messages database. The user is configuring a new
/// ingestion, which takes a fresh snapshot, so the bounds must cover messages
/// that arrived since the last ingestion.
///
/// Falls back to the last ingestion's range (ingestion_meta, then the newest
/// snapshot) when the live database is missing or Full Disk Access is denied.
#[tauri::command]
pub async fn get_message_date_range() -> Result<MessageDateRange, String> {
    match messages_db::db::snapshot::live_message_date_range() {
        Ok(Some((earliest_ts, latest_ts))) => {
            let range = cocoa_range_to_iso(earliest_ts, latest_ts);
            info!(
                earliest_date = %range.earliest_date,
                latest_date = %range.latest_date,
                "Got message date range from the live Messages database"
            );
            return Ok(range);
        }
        Ok(None) => info!("Live Messages database has no dated messages, falling back to last ingestion"),
        Err(e) => warn!(error = %e, "Cannot read the live Messages database, falling back to last ingestion"),
    }

    // Fallback 1: the last ingestion's range (O(1) lookup). These dates cover the
    // last snapshot only, so they lag the live database.
    if let Ok(metadata_db) = MetadataDb::open() {
        if let Ok(app_state) = metadata_db.get_app_state() {
            if let (Some(earliest), Some(latest)) = (app_state.earliest_message_date, app_state.latest_message_date) {
                info!(
                    earliest_date = %earliest,
                    latest_date = %latest,
                    "Got message date range from ingestion metadata (last snapshot)"
                );
                return Ok(MessageDateRange {
                    earliest_date: earliest,
                    latest_date: latest,
                });
            }
        }
    }

    // Fallback 2: Query the newest snapshot directly (for existing users before
    // the date range was stored in metadata)
    info!("Falling back to snapshot query for date range (metadata dates not available)");

    let snapshot_dir =
        get_latest_snapshot_path().ok_or_else(|| "No snapshot found. Please run ingestion first.".to_string())?;

    let chat_db = snapshot_dir.join("chat_snapshot.db");
    if !chat_db.exists() {
        return Err("Snapshot database not found".to_string());
    }

    // Open the snapshot database using messages_db crate's function
    let conn = messages_db::db::snapshot::open_chat_snapshot(&snapshot_dir)
        .map_err(|e| format!("Failed to open snapshot: {}", e))?;

    // Query for MIN and MAX dates from the message table
    // Dates are stored as Apple Cocoa timestamps (seconds or nanoseconds since 2001-01-01)
    // Note: Older messages may have NULL text but content in attributedBody
    let (earliest_ts, latest_ts): (i64, i64) = conn
        .query_row(
            "SELECT MIN(date), MAX(date) FROM message WHERE (text IS NOT NULL OR attributedBody IS NOT NULL) AND date > 0",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Failed to query date range: {}", e))?;

    let range = cocoa_range_to_iso(earliest_ts, latest_ts);
    info!(
        earliest_date = %range.earliest_date,
        latest_date = %range.latest_date,
        "Got message date range (snapshot fallback query)"
    );

    Ok(range)
}

/// Freshness comparison between the ingested index and the live Messages DB.
#[derive(Debug, serde::Serialize)]
pub struct IngestionFreshness {
    /// Latest message date currently in the index (YYYY-MM-DD), if ingested.
    pub indexed_latest_date: Option<String>,
    /// Latest message date available in the live Messages database (YYYY-MM-DD).
    pub live_latest_date: Option<String>,
    /// True when the live DB has messages newer than what's indexed.
    pub is_stale: bool,
    /// Approximate number of days the index is behind (0 when fresh or unknown).
    pub days_behind: i64,
}

/// Compare the latest *indexed* message date against the latest message in the
/// **live** Messages database, so the UI can prompt the user to re-ingest when
/// the index has fallen behind (the cause of Casper answering from stale data).
///
/// Read-only: queries the live DB with `immutable=1` and never writes.
#[tauri::command]
pub async fn check_ingestion_freshness() -> Result<IngestionFreshness, String> {
    // Latest indexed date (O(1) from ingestion metadata).
    let indexed_latest_date = MetadataDb::open()
        .ok()
        .and_then(|db| db.get_app_state().ok())
        .and_then(|s| s.latest_message_date);

    // Latest available date from the live Messages DB.
    let live_ts = messages_db::db::snapshot::latest_live_message_date()
        .map_err(|e| format!("Failed to read live Messages database: {e}"))?;
    let live_latest_date = live_ts.and_then(|ts| {
        chrono::DateTime::from_timestamp(cocoa_to_unix(ts), 0).map(|dt| dt.format("%Y-%m-%d").to_string())
    });

    // Compare the two YYYY-MM-DD dates. Stale only when we can prove the live DB
    // is meaningfully newer; missing data on either side is treated as "not stale"
    // (a never-ingested user is handled by the separate init-status flow).
    // We require the index to be more than two weeks behind before prompting a
    // re-ingest, so a few new messages don't nag the user constantly.
    const STALE_THRESHOLD_DAYS: i64 = 14;
    let (is_stale, days_behind) = match (&indexed_latest_date, &live_latest_date) {
        (Some(indexed), Some(live)) if live.as_str() > indexed.as_str() => {
            let days = match (
                chrono::NaiveDate::parse_from_str(indexed, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(live, "%Y-%m-%d"),
            ) {
                (Ok(i), Ok(l)) => (l - i).num_days().max(0),
                _ => 0,
            };
            (days > STALE_THRESHOLD_DAYS, days)
        }
        _ => (false, 0),
    };

    info!(
        ?indexed_latest_date,
        ?live_latest_date,
        is_stale,
        days_behind,
        "Checked ingestion freshness"
    );

    Ok(IngestionFreshness {
        indexed_latest_date,
        live_latest_date,
        is_stale,
        days_behind,
    })
}

/// Save user ingestion settings to database.
///
/// These settings are persisted and restored when the settings modal is opened.
#[tauri::command]
pub async fn save_ingestion_settings(settings: IngestionSettings) -> Result<(), String> {
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open database: {}", e))?;

    metadata_db
        .save_ingestion_settings(&settings)
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    info!("Saved ingestion settings");
    Ok(())
}

/// Get saved user ingestion settings from database.
///
/// Returns the previously saved settings, or None if no settings have been saved.
#[tauri::command]
pub async fn get_ingestion_settings() -> Result<Option<IngestionSettings>, String> {
    // Check if the database exists first
    let db_path = common::get_brb_sqlite_db().map_err(|e| format!("Failed to resolve brb.db path: {}", e))?;
    if !db_path.exists() {
        return Ok(None);
    }

    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open database: {}", e))?;

    metadata_db
        .get_ingestion_settings()
        .map_err(|e| format!("Failed to get settings: {}", e))
}

/// Run only the analytics pipeline (Leiden + UMAP clustering) on existing embeddings.
///
/// This is used for re-embedding without running the full ingestion pipeline.
/// Skips stages 1-5 (snapshot, parsing, chunking, embedding, saving) and only runs stage 6 (analyzing).
#[tauri::command]
pub async fn run_analytics_only(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
    settings: Option<AnalyticsSettings>,
) -> Result<(), String> {
    // Check if ingestion is already running
    if state.ingestion.is_running() {
        return Err("Ingestion is already running".to_string());
    }

    // Set running flag (start resets cancel flag and sets running)
    state.ingestion.start();

    let _resource_sampler = super::resources::ResourceSampler::start(app.clone());

    let duckdb_path = common::get_brb_duckdb_db().map_err(|e| format!("Failed to resolve DuckDB path: {e}"))?;

    // Check that embeddings exist
    if !duckdb_path.exists() {
        state.ingestion.finish();
        return Err("No embeddings found. Please run full ingestion first.".to_string());
    }

    // Ensure Python environment exists before running analytics
    PythonEnvironment::ensure(&app).await.map_err(|e| {
        state.ingestion.finish();
        format!("Failed to setup Python environment: {}", e)
    })?;

    // Build analytics settings for Python
    let settings = settings.unwrap_or_default();

    // Emit initial progress
    let _ = app.emit(
        "ingestion-progress",
        IngestionProgressEvent {
            stages: vec![StageProgress {
                stage: IngestionStage::Analyzing,
                percent: 0,
                status: StageStatus::InProgress,
                message: "Starting analytics pipeline...".to_string(),
            }],
            current_stage: Some(IngestionStage::Analyzing),
            is_complete: false,
            error: None,
            stats: None,
        },
    );

    // Run analytics in background
    let app_clone = app.clone();
    let state_clone = state.ingestion.clone();

    let result =
        tokio::task::spawn_blocking(move || run_analytics_pipeline_sync(&app_clone, &settings, &state_clone)).await;

    state.ingestion.finish();

    // Invalidate caches on success
    match result {
        Ok(Ok(())) => {
            {
                let mut cache = state.ingestion_info_cache.write().await;
                cache.is_populated = false;
            }

            let _ = app.emit(
                "ingestion-progress",
                IngestionProgressEvent {
                    stages: vec![StageProgress {
                        stage: IngestionStage::Analyzing,
                        percent: 100,
                        status: StageStatus::Completed,
                        message: "Analytics complete!".to_string(),
                    }],
                    current_stage: Some(IngestionStage::Analyzing),
                    is_complete: true,
                    error: None,
                    stats: None,
                },
            );

            info!("Analytics-only pipeline completed successfully");
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = app.emit(
                "ingestion-progress",
                IngestionProgressEvent {
                    stages: vec![],
                    current_stage: Some(IngestionStage::Analyzing),
                    is_complete: false,
                    error: Some(e.clone()),
                    stats: None,
                },
            );
            Err(e)
        }
        Err(e) => Err(format!("Task join error: {}", e)),
    }
}

/// Synchronous analytics pipeline runner (for spawn_blocking)
fn run_analytics_pipeline_sync(
    app: &AppHandle,
    settings: &AnalyticsSettings,
    state: &crate::state::IngestionState,
) -> Result<(), String> {
    use std::process::{Command, Stdio};

    // Get Python environment
    let env = PythonEnvironment::get().map_err(|e| format!("Python environment not found: {}", e))?;
    let python_path = &env.python_bin;
    let script_path = env.script(scripts::ANALYTICS);

    let duckdb_path = common::get_brb_duckdb_db().map_err(|e| format!("Failed to resolve DuckDB path: {e}"))?;

    // Build command with settings
    let mut cmd = Command::new(python_path);
    cmd.arg(&script_path)
        .arg("--db-path")
        .arg(&duckdb_path)
        // The script reads brb.duckdb read-only and asks for the write lock over
        // stdin/stdout before it writes (see `ingestion::write_lock`).
        .env(write_lock::HANDSHAKE_ENV, "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // Inherited, not piped: an undrained pipe blocks a chatty child once the
        // buffer fills. Inheriting keeps Python tracebacks in the app log.
        .stderr(Stdio::inherit());

    // Add settings as CLI arguments
    if let Some(target_topics) = settings.target_topics {
        if target_topics >= 1 {
            cmd.arg("--target-topics").arg(target_topics.to_string());
        }
        // If 0, skip: Python uses its default topic count
    }
    if let Some(pca_dims) = settings.pca_dims {
        cmd.arg("--pca-dims").arg(pca_dims.to_string());
    }
    if let Some(n_neighbors) = settings.umap_n_neighbors {
        cmd.arg("--umap-n-neighbors").arg(n_neighbors.to_string());
    }
    if let Some(min_dist) = settings.umap_min_dist {
        cmd.arg("--umap-min-dist").arg(min_dist.to_string());
    }
    if let Some(spread) = settings.umap_spread {
        cmd.arg("--umap-spread").arg(spread.to_string());
    }
    if let Some(random_state) = settings.random_state {
        cmd.arg("--random-state").arg(random_state.to_string());
    }

    info!("Starting analytics pipeline with settings: {:?}", settings);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn analytics: {}", e))?;

    // Read stdout for progress updates
    let mut stdin = child.stdin.take();
    let mut broker = WriteLockBroker::new();
    if let Some(stdout) = child.stdout.take() {
        let reader = std::io::BufReader::new(stdout);
        for line in std::io::BufRead::lines(reader) {
            // Check for cancellation
            if state.is_cancel_requested() {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Analytics cancelled by user".to_string());
            }

            if let Ok(line) = line {
                if let Some(reply) = broker.handle(&line) {
                    if let Some(stdin) = stdin.as_mut() {
                        use std::io::Write;
                        let _ = writeln!(stdin, "{reply}");
                        let _ = stdin.flush();
                    }
                    continue;
                }

                // Parse JSON progress events
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                    if event.get("type").and_then(|t| t.as_str()) == Some("analytics_progress") {
                        let stage = event.get("stage").and_then(|s| s.as_str()).unwrap_or("analyzing");
                        let percent = event.get("percent").and_then(|p| p.as_i64()).unwrap_or(0).clamp(0, 100) as u8;
                        let message = event.get("message").and_then(|m| m.as_str()).unwrap_or("");

                        let _ = app.emit(
                            "ingestion-progress",
                            IngestionProgressEvent {
                                stages: vec![StageProgress {
                                    stage: IngestionStage::Analyzing,
                                    percent,
                                    status: StageStatus::InProgress,
                                    message: format!("{}: {}", stage, message),
                                }],
                                current_stage: Some(IngestionStage::Analyzing),
                                is_complete: false,
                                error: None,
                                stats: None,
                            },
                        );
                    }
                }
            }
        }
    }

    // Wait for completion
    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for analytics: {}", e))?;
    // Releases a lock the child never released (a crash mid-write), before the
    // read-only cluster count below.
    drop(broker);
    drop(stdin);

    if status.success() {
        // Record analytics completion in metadata
        let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;

        // Get cluster count from DuckDB (read-only: a pure query must never take the
        // read-write path that enables experimental HNSW persistence, or it can race
        // the startup burst of read-only connections and abort DuckDB).
        let cluster_count = ingestion::VectorDb::open_readonly()
            .ok()
            .and_then(|db| db.get_cluster_count().ok())
            .unwrap_or(0);

        metadata_db
            .record_analytics_complete(cluster_count)
            .map_err(|e| format!("Failed to record analytics: {}", e))?;

        Ok(())
    } else {
        Err("Analytics pipeline failed".to_string())
    }
}

/// Get the effective base model for this machine (respects user preference).
#[tauri::command]
pub fn get_recommended_base_model(state: tauri::State<'_, AppState>) -> String {
    let pref = state.get_model_preference();
    effective_model(pref.as_deref()).to_string()
}

// =============================================================================
// Model Picker Commands
// =============================================================================

/// Info about a model tier for the picker UI.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ModelTierInfo {
    pub tier_name: String,
    pub display_name: String,
    pub model_id: String,
    pub min_memory_gb: u64,
    pub model_size_gb: f32,
    pub is_available: bool,
    pub is_recommended: bool,
    pub is_selected: bool,
    pub speed_label: String,
    pub quality_label: String,
    pub quantization: String,
    pub system_memory_gb: u64,
}

/// Result from changing the model preference.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ModelChangeResult {
    pub success: bool,
    pub new_model_id: String,
    pub new_tier_name: String,
    pub new_quantization: String,
    pub incompatible_personas: Vec<IncompatiblePersona>,
}

/// A persona that's incompatible with a model change.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct IncompatiblePersona {
    pub persona_id: String,
    pub display_name: String,
    pub trained_with_model: String,
}

/// Get all available model tiers with availability/selection status.
#[tauri::command]
pub fn get_available_models(state: tauri::State<'_, AppState>) -> Result<Vec<ModelTierInfo>, String> {
    let mem_gb = detect_system_memory_gb();
    let available = mem_gb.saturating_sub(5);
    let recommended = common::model_tiers::recommend_model_tier();
    let pref = state.get_model_preference();
    let parsed_pref = pref.as_deref().and_then(ModelPreference::parse);

    // Determine which tier is currently selected
    let selected_tier_name = parsed_pref.as_ref().map(|p| p.tier_name.as_str());
    let selected_quant = parsed_pref.as_ref().map(|p| p.quantization).unwrap_or(Quantization::Q4);

    let tiers = MODEL_TIERS
        .iter()
        .map(|tier| {
            let is_selected = selected_tier_name.is_some_and(|name| name == tier.name);
            let quant = if is_selected { selected_quant } else { Quantization::Q4 };

            ModelTierInfo {
                tier_name: tier.name.to_string(),
                display_name: tier.display_name.to_string(),
                model_id: tier.model_for_quantization(quant).to_string(),
                min_memory_gb: tier.min_memory_gb,
                model_size_gb: tier.size_for_quantization(quant),
                is_available: available >= tier.min_memory_gb,
                is_recommended: tier.name == recommended.name,
                is_selected: if selected_tier_name.is_some() {
                    is_selected
                } else {
                    // No preference set — recommended is "selected"
                    tier.name == recommended.name
                },
                speed_label: tier.speed_label().to_string(),
                quality_label: tier.quality_label().to_string(),
                quantization: quant.as_str().to_string(),
                system_memory_gb: mem_gb,
            }
        })
        .collect();

    Ok(tiers)
}

/// Check which personas would be incompatible with a given model tier.
#[tauri::command]
pub fn check_model_compatibility(
    tier_name: String,
    quantization: Option<String>,
) -> Result<Vec<IncompatiblePersona>, String> {
    let tier = get_tier_by_name(&tier_name).ok_or_else(|| format!("Unknown tier: {tier_name}"))?;
    let quant = quantization
        .as_deref()
        .and_then(Quantization::parse)
        .unwrap_or(Quantization::Q4);
    let new_model_id = tier.model_for_quantization(quant);

    find_incompatible_personas(new_model_id)
}

/// Set the user's model preference. Shuts down running daemons so they
/// restart with the new model on next use.
#[tauri::command]
pub async fn set_model_preference(
    state: tauri::State<'_, AppState>,
    tier_name: String,
    quantization: Option<String>,
) -> Result<ModelChangeResult, String> {
    let tier = get_tier_by_name(&tier_name).ok_or_else(|| format!("Unknown tier: {tier_name}"))?;

    let quant = quantization
        .as_deref()
        .and_then(Quantization::parse)
        .unwrap_or(Quantization::Q4);

    // Validate VRAM ceiling (accounts for quantization size)
    let mem_gb = detect_system_memory_gb();
    let available = mem_gb.saturating_sub(5);
    if !tier.fits_in_memory(available, quant) {
        return Err(format!(
            "Insufficient memory for {} {} (need {:.1}GB, have {}GB available)",
            tier.display_name,
            quant.display_label(),
            tier.size_for_quantization(quant),
            available
        ));
    }

    let pref = ModelPreference {
        tier_name: tier_name.clone(),
        quantization: quant,
    };
    let pref_str = pref.to_stored_string();
    let new_model_id = tier.model_for_quantization(quant);

    info!(preference = %pref_str, model = %new_model_id, "setting model preference");

    // Shut down running daemons first so failure doesn't leave divergent state
    state.shutdown_all_daemons().await?;

    // Persist to SQLite
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {e}"))?;
    db.save_model_preference(&pref_str)
        .map_err(|e| format!("Failed to save preference: {e}"))?;

    // Update in-memory state and daemon managers
    state.update_model_preference(Some(pref_str));

    // Find incompatible personas
    let incompatible = find_incompatible_personas(new_model_id).unwrap_or_default();

    Ok(ModelChangeResult {
        success: true,
        new_model_id: new_model_id.to_string(),
        new_tier_name: tier_name,
        new_quantization: quant.as_str().to_string(),
        incompatible_personas: incompatible,
    })
}

/// Reset model preference to auto-recommended.
#[tauri::command]
pub async fn reset_model_preference(state: tauri::State<'_, AppState>) -> Result<ModelChangeResult, String> {
    info!("resetting model preference to auto");

    // Shut down running daemons first
    state.shutdown_all_daemons().await?;

    // Clear from SQLite
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {e}"))?;
    db.clear_model_preference()
        .map_err(|e| format!("Failed to clear preference: {e}"))?;

    // Update in-memory state
    state.update_model_preference(None);

    let recommended = common::model_tiers::recommend_model_tier();
    let new_model_id = recommended.model_4bit;

    let incompatible = find_incompatible_personas(new_model_id).unwrap_or_default();

    Ok(ModelChangeResult {
        success: true,
        new_model_id: new_model_id.to_string(),
        new_tier_name: recommended.name.to_string(),
        new_quantization: Quantization::Q4.as_str().to_string(),
        incompatible_personas: incompatible,
    })
}

/// Find personas that are incompatible with a given model ID.
fn find_incompatible_personas(new_model_id: &str) -> Result<Vec<IncompatiblePersona>, String> {
    let personas = PersonaRegistry::list().map_err(|e| format!("Failed to list personas: {e}"))?;

    let mut incompatible = Vec::new();
    for persona in &personas {
        if !common::models_compatible(&persona.base_model, new_model_id) {
            incompatible.push(IncompatiblePersona {
                persona_id: persona.persona_id.clone(),
                display_name: persona.display_name.clone(),
                trained_with_model: persona.base_model.clone(),
            });
        }
    }

    Ok(incompatible)
}

// normalize_model_name and models_compatible are in common::model_tiers

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};
    use ProbeOutcome::{Denied, Granted, Inconclusive};

    #[test]
    fn readable_directory_means_granted() {
        assert_eq!(classify_probe(Ok(())), Granted);
    }

    #[test]
    fn permission_denied_means_denied() {
        let err = Error::new(ErrorKind::PermissionDenied, "operation not permitted");
        assert_eq!(classify_probe(Err(err)), Denied);
    }

    /// The bug this replaced: a missing directory was read as a denial. `~/Library/Safari` does
    /// not exist on a Mac where Safari was never opened, which would strand the user on the
    /// permissions step forever.
    #[test]
    fn missing_directory_is_inconclusive_not_denied() {
        let err = Error::new(ErrorKind::NotFound, "no such file or directory");
        assert_eq!(classify_probe(Err(err)), Inconclusive);
    }

    #[test]
    fn other_io_errors_are_inconclusive() {
        let err = Error::new(ErrorKind::Interrupted, "interrupted");
        assert_eq!(classify_probe(Err(err)), Inconclusive);
    }

    #[test]
    fn first_decisive_outcome_wins() {
        assert_eq!(resolve_fda_probes([Inconclusive, Granted, Denied]), Some(true));
        assert_eq!(resolve_fda_probes([Inconclusive, Denied, Granted]), Some(false));
    }

    /// Distinct from `Some(false)`: nothing was learned, so the caller logs and reports
    /// not-granted rather than claiming the OS refused.
    #[test]
    fn all_inconclusive_yields_none() {
        assert_eq!(resolve_fda_probes([Inconclusive, Inconclusive]), None);
        assert_eq!(resolve_fda_probes([]), None);
    }

    /// Probing must stop at the first decisive answer -- later probes are not even evaluated.
    #[test]
    fn evaluation_is_lazy_after_a_decision() {
        let mut evaluated = 0;
        let outcomes = [Granted, Denied, Denied].into_iter().inspect(|_| {
            evaluated += 1;
        });
        assert_eq!(resolve_fda_probes(outcomes), Some(true));
        assert_eq!(evaluated, 1, "probing continued past a decisive outcome");
    }
}

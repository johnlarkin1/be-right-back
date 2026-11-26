//! Ingestion pipeline for Be Right Back.
//!
//! This crate handles the ingestion process that transforms iMessage snapshots
//! into the app's working databases:
//! - `brb.db` (SQLite): Metadata about ingestion runs
//! - `brb.duckdb` (DuckDB): Vector embeddings for RAG
//!
//! The pipeline orchestrates:
//! 1. Snapshot creation from iMessage database (Rust)
//! 2. SQLite metadata recording (Rust)
//! 3. Embedding generation via Python/MLX subprocess
//!    - Message chunking with sliding windows
//!    - Embedding generation using mlx-embeddings (Apple Silicon GPU)
//!    - DuckDB vector database population
//!    - HNSW index creation (no longer queried; semantic search scans exactly)
//!
//! # Usage
//!
//! ```rust,ignore
//! use ingestion::{run_ingestion, IngestionConfig, IngestionStage, IngestionStats};
//!
//! // Run with progress callback (5-stage system)
//! let result = run_ingestion(IngestionConfig::default(), |stage, percent, message, stats| {
//!     println!("Stage: {:?}, Progress: {}%", stage, percent);
//! })?;
//!
//! println!("Ingested {} messages from {} contacts", result.message_count, result.contact_count);
//! ```

pub mod context_builder;
mod embedding_matrix;
mod metadata;
mod progress;
mod python;
pub mod queries;
pub mod query_planner;
mod rerank;
mod search;
pub mod stats;
pub mod tapbacks;
mod vectordb;
pub mod write_lock;

pub use context_builder::{PersonaContext, format_persona_context};
/// Re-export `duckdb::Connection` so consumers of `VectorDb::connection()` can name the type
/// without adding `duckdb` as a direct dependency.
pub use duckdb::Connection as DuckDbConnection;
pub use metadata::{
    AnalyticsSettings, AppState, CasperStoredMessage, CasperThread, ConversationAnalysis, IngestionMetadata,
    IngestionSettings, MetadataDb, StoredContact,
};
pub use progress::{ContactProgress, IngestionStage, IngestionStats, StageProgress, StageStatus};
pub use python::{EmbeddingResult, embed_query, run_python_embeddings, run_python_embeddings_cancellable};
pub use query_planner::{
    SearchPlan, SortDirection, apply_recency_boost, apply_recency_boost_with_now, expand_search_queries, plan_search,
    plan_search_with_now, temporal_hint,
};
pub use rerank::{RerankScore, rerank_candidates};
pub use search::{ContactDiversity, HybridSearchBreakdown, SearchOptions, SearchResult};
pub use stats::ContactStats;
pub use vectordb::{ChunkData, ChunkMessage, EMBEDDING_DIMS, MessageChunk, VectorDb, WriteLease, acquire_write_lease};

use common::{BrbError, Result, cocoa_to_unix};
use messages_db::db::{
    queries::{ContactQueryOptions, build_email_lookup, build_phone_lookup, list_contacts, normalize_phone_number},
    snapshot,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use tracing::{info, warn};

/// Query the date range of messages in a snapshot.
///
/// Returns (earliest_date, latest_date) in ISO format YYYY-MM-DD, or None if no messages found.
fn query_message_date_range(snapshot_dir: &Path) -> Result<(Option<String>, Option<String>)> {
    let conn = snapshot::open_chat_snapshot(snapshot_dir)?;

    // Query MIN and MAX dates from the message table
    // Note: Older messages may have NULL text but content in attributedBody
    let result: std::result::Result<(i64, i64), _> = conn.query_row(
        "SELECT MIN(date), MAX(date) FROM message WHERE (text IS NOT NULL OR attributedBody IS NOT NULL) AND date > 0",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    match result {
        Ok((earliest_ts, latest_ts)) => {
            let earliest_unix = cocoa_to_unix(earliest_ts);
            let latest_unix = cocoa_to_unix(latest_ts);

            let earliest_date =
                chrono::DateTime::from_timestamp(earliest_unix, 0).map(|dt| dt.format("%Y-%m-%d").to_string());
            let latest_date =
                chrono::DateTime::from_timestamp(latest_unix, 0).map(|dt| dt.format("%Y-%m-%d").to_string());

            info!(
                ?earliest_date,
                ?latest_date,
                earliest_ts,
                latest_ts,
                "Computed message date range from snapshot"
            );

            Ok((earliest_date, latest_date))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            info!("No messages found in snapshot for date range");
            Ok((None, None))
        }
        Err(e) => Err(BrbError::DatabaseSqliteError(e)),
    }
}

#[derive(Debug, Clone)]
pub struct IngestionConfig {
    pub create_snapshot: bool,
}

impl Default for IngestionConfig {
    fn default() -> Self {
        Self { create_snapshot: true }
    }
}

/// Result of an ingestion run
#[derive(Debug, Clone)]
pub struct IngestionResult {
    pub snapshot_dir: PathBuf,
    pub message_count: i64,
    pub contact_count: i64,
    pub chunk_count: i64,
    pub duration_secs: u64,
    pub timestamp: String,
}

/// Run the full ingestion pipeline.
///
/// This function:
/// 1. Creates a new snapshot of the iMessage database (or uses existing)
/// 2. Counts messages and contacts from the snapshot
/// 3. Creates/updates the metadata SQLite database
/// 4. Calls Python subprocess to generate embeddings and populate DuckDB
///
/// # Arguments
///
/// * `config` - Configuration for the ingestion
/// * `progress_callback` - Called with progress updates during ingestion (stage, percent, message, stats)
///
/// # Returns
///
/// An `IngestionResult` with statistics about what was ingested.
pub fn run_ingestion<F>(config: IngestionConfig, progress_callback: F) -> Result<IngestionResult>
where
    F: FnMut(IngestionStage, u8, &str, IngestionStats),
{
    // Delegate to cancellable version with a no-op cancel check
    run_ingestion_cancellable(config, progress_callback, || false)
}

/// Run the full ingestion pipeline with cancellation support.
///
/// Similar to `run_ingestion`, but accepts a cancellation check callback.
/// The `is_cancelled` closure is checked at key points during ingestion.
/// If cancellation is requested, the function returns `BrbError::Cancelled`.
///
/// # Arguments
///
/// * `config` - Configuration for the ingestion
/// * `progress_callback` - Called with progress updates during ingestion
/// * `is_cancelled` - Closure that returns true if cancellation is requested
///
/// # Returns
///
/// An `IngestionResult` with statistics, or `BrbError::Cancelled` if cancelled.
pub fn run_ingestion_cancellable<F, C>(
    config: IngestionConfig,
    mut progress_callback: F,
    is_cancelled: C,
) -> Result<IngestionResult>
where
    F: FnMut(IngestionStage, u8, &str, IngestionStats),
    C: Fn() -> bool,
{
    // Check cancellation at start
    if is_cancelled() {
        return Err(BrbError::Cancelled("Ingestion cancelled before start".to_string()));
    }

    let start_time = std::time::Instant::now();

    // Stage 1: Snapshot - Create snapshot and initialize databases
    progress_callback(
        IngestionStage::Snapshot,
        10,
        "Creating database snapshot...",
        IngestionStats::default(),
    );

    // Check cancellation before snapshot
    if is_cancelled() {
        return Err(BrbError::Cancelled("Ingestion cancelled during snapshot".to_string()));
    }

    let snapshot_dir = if config.create_snapshot {
        snapshot::create_snapshot()?
    } else {
        snapshot::get_or_create_snapshot()?
    };

    info!(?snapshot_dir, "Snapshot created/found");
    progress_callback(
        IngestionStage::Snapshot,
        30,
        "Counting messages...",
        IngestionStats::default(),
    );

    // Check cancellation before counting
    if is_cancelled() {
        return Err(BrbError::Cancelled("Ingestion cancelled during counting".to_string()));
    }

    let contacts = list_contacts(&snapshot_dir, ContactQueryOptions::default())?;
    let contact_count = contacts.len() as i64;
    let message_count: i64 = contacts.iter().map(|c| c.message_count as i64).sum();

    info!(contact_count, message_count, "Counted messages from snapshot");
    progress_callback(
        IngestionStage::Snapshot,
        50,
        "Creating metadata database...",
        IngestionStats {
            total_messages: message_count,
            total_contacts: contact_count,
            ..Default::default()
        },
    );

    // Compute message date range from snapshot (for O(1) lookup later)
    let (earliest_date, latest_date) = query_message_date_range(&snapshot_dir).unwrap_or((None, None));

    info!("Opening metadata database");
    let duration_secs = start_time.elapsed().as_secs();
    let metadata_db = MetadataDb::open()?;

    // The user's saved date range and min-messages filter. Missing or unreadable
    // settings mean "ingest everything", which is what the pipeline did before.
    let ingestion_settings = metadata_db.get_ingestion_settings().unwrap_or_else(|e| {
        warn!(error = ?e, "Failed to read ingestion settings, ingesting without filters");
        None
    });
    info!(?ingestion_settings, "Loaded ingestion settings");

    // Record ingestion in ingestion_meta and set curr_ingestion_id in app_state
    info!("Recording ingestion metadata");
    let ingestion_id = metadata_db.record_ingestion(
        &snapshot_dir,
        message_count,
        contact_count,
        duration_secs,
        earliest_date,
        latest_date,
    )?;
    info!("Metadata recorded successfully");

    // Pre-compute contact statistics on a background thread. The stats read and
    // decode every message, which is CPU work; the Python embedding that follows
    // is GPU work. Running them side by side takes the stats off the critical
    // path. The result is joined and written after the Python run.
    let stats_job = StatsJob::spawn(snapshot_dir.clone());

    // Pre-compute display names from AddressBook and store in contacts table
    // This moves the expensive phone normalization from app startup to ingestion time
    progress_callback(
        IngestionStage::Snapshot,
        70,
        "Resolving contact display names...",
        IngestionStats {
            total_messages: message_count,
            total_contacts: contact_count,
            ..Default::default()
        },
    );

    // Check cancellation before display name resolution
    if is_cancelled() {
        return Err(BrbError::Cancelled(
            "Ingestion cancelled during display name resolution".to_string(),
        ));
    }

    // Build AddressBook lookup maps (phone -> name, email -> name)
    let (phone_map, email_map) = match snapshot::open_addressbook_snapshot(&snapshot_dir) {
        Ok(addressbook_conn) => {
            let phone = build_phone_lookup(&addressbook_conn).unwrap_or_default();
            let email = build_email_lookup(&addressbook_conn).unwrap_or_default();
            info!(
                phone_entries = phone.len(),
                email_entries = email.len(),
                "Built AddressBook lookup maps"
            );
            (phone, email)
        }
        Err(e) => {
            warn!(error = ?e, "AddressBook not available, contacts will have no display names");
            (Default::default(), Default::default())
        }
    };

    // Resolve display names for all contacts (expensive: ~10s for 400+ contacts)
    // This is now a one-time cost during ingestion instead of on every app startup
    let stored_contacts: Vec<StoredContact> = contacts
        .iter()
        .map(|contact| {
            let contact_id = &contact.id;
            let is_phone = contact_id.contains(char::is_numeric);

            let (normalized_id, display_name) = if is_phone {
                let normalized = normalize_phone_number(contact_id);
                let name = normalized.as_ref().and_then(|n| phone_map.get(n).cloned());
                (normalized, name)
            } else {
                let name = email_map.get(&contact_id.to_lowercase()).cloned();
                (None, name)
            };

            StoredContact {
                contact_id: contact_id.clone(),
                normalized_id,
                display_name,
                message_count: contact.message_count as i64,
                earliest_message: contact.earliest_message.map(|d| d.format("%Y-%m-%d").to_string()),
                latest_message: contact.latest_message.map(|d| d.format("%Y-%m-%d").to_string()),
            }
        })
        .collect();

    // Write contacts to SQLite for O(1) lookup on app startup
    if let Err(e) = metadata_db.write_contacts(&stored_contacts, ingestion_id) {
        warn!("Failed to write contacts: {}", e);
    } else {
        let resolved_count = stored_contacts.iter().filter(|c| c.display_name.is_some()).count();
        info!(
            total = stored_contacts.len(),
            resolved = resolved_count,
            "Stored contacts with pre-resolved display names"
        );
    }

    progress_callback(
        IngestionStage::Snapshot,
        97,
        "Initializing vector database...",
        IngestionStats {
            total_messages: message_count,
            total_contacts: contact_count,
            ..Default::default()
        },
    );

    // Check cancellation before DuckDB init
    if is_cancelled() {
        return Err(BrbError::Cancelled(
            "Ingestion cancelled during initialization".to_string(),
        ));
    }

    let output_db = common::get_brb_duckdb_db()?;
    info!(?output_db, "Initializing DuckDB vector database");

    // Ingestion rewrites brb.duckdb from here until the Python run ends. Hold the
    // write lease for all of it: it closes the app's read-only connection, and
    // read queries return `Busy` instead of reopening it and blocking the Python
    // writer. The lease drops when this function returns.
    let _write_lease = vectordb::acquire_write_lease()?;
    {
        let vector_db = VectorDb::open()?;
        vector_db.initialize()?;
        info!("DuckDB schema initialized");
    }

    progress_callback(
        IngestionStage::Snapshot,
        100,
        "Snapshot complete",
        IngestionStats {
            total_messages: message_count,
            total_contacts: contact_count,
            ..Default::default()
        },
    );

    // Find the snapshot's chat.db
    let snapshot_db = snapshot_dir.join("chat_snapshot.db");
    if !snapshot_db.exists() {
        return Err(BrbError::NotFound(format!(
            "Snapshot database not found: {:?}",
            snapshot_db
        )));
    }

    let addressbook_db = snapshot_dir.join("addressbook_snapshot.db");
    info!(
        ?snapshot_db,
        ?addressbook_db,
        ?output_db,
        "Running Python embedding pipeline"
    );

    // Use the cancellable version for Python embeddings
    let embedding_result = python::run_python_embeddings_cancellable(
        &snapshot_db,
        &addressbook_db,
        &output_db,
        ingestion_id,
        ingestion_settings.as_ref(),
        |stage, percent, message, stats| {
            progress_callback(stage, percent, message, stats);
        },
        &is_cancelled,
    )?;

    info!(
        message_count = embedding_result.message_count,
        contact_count = embedding_result.contact_count,
        chunk_count = embedding_result.chunk_count,
        elapsed_secs = embedding_result.elapsed_secs,
        embedding_model = %embedding_result.embedding_model,
        "Python embedding pipeline complete"
    );

    // Counts of what was actually ingested. The snapshot-wide numbers recorded
    // before the Python run are an upper bound: they predate the user's date and
    // min-messages filters, and predate dropping reactions and empty messages.
    let ingested_message_count = embedding_result.message_count;
    let ingested_contact_count = embedding_result.contact_count;

    // The stats thread usually finished long ago. Write its result now, before
    // the run is marked complete.
    stats_job.finish(&metadata_db, ingestion_id);

    // Update embedding metadata in SQLite now that we have the results
    if let Err(e) = metadata_db.update_embedding_metadata(
        ingestion_id,
        &embedding_result.embedding_model,
        embedding_result.embedding_dims,
        embedding_result.elapsed_secs as i64,
        embedding_result.chunk_window_size,
        embedding_result.chunk_stride,
        ingested_message_count,
        ingested_contact_count,
    ) {
        tracing::warn!("Failed to update embedding metadata: {}", e);
    }

    // Final completion callback
    let timestamp = chrono::Utc::now().to_rfc3339();
    let final_elapsed = start_time.elapsed().as_secs();
    progress_callback(
        IngestionStage::Saving,
        100,
        "Ingestion complete!",
        IngestionStats {
            messages_processed: ingested_message_count,
            total_messages: ingested_message_count,
            contacts_processed: ingested_contact_count,
            total_contacts: ingested_contact_count,
            chunks_created: embedding_result.chunk_count,
            chunks_embedded: embedding_result.chunk_count,
            elapsed_secs: final_elapsed,
            estimated_remaining_secs: Some(0),
            ..Default::default()
        },
    );

    // Record successful ingestion completion in app_state
    // This is the key step that marks ingestion as complete - only happens on success
    if let Err(e) = metadata_db.record_ingestion_complete(embedding_result.chunk_count) {
        tracing::warn!("Failed to record ingestion complete: {}", e);
    }

    info!(
        snapshot_message_count = message_count,
        snapshot_contact_count = contact_count,
        ingested_message_count,
        ingested_contact_count,
        chunk_count = embedding_result.chunk_count,
        duration_secs = final_elapsed,
        "Ingestion completed successfully"
    );

    Ok(IngestionResult {
        snapshot_dir,
        message_count: ingested_message_count,
        contact_count: ingested_contact_count,
        chunk_count: embedding_result.chunk_count,
        duration_secs: final_elapsed,
        timestamp,
    })
}

/// Contact stats computed on a background thread while the Python embedding runs.
///
/// Dropping the job without calling `finish` (an error or a cancel) sets the
/// stop flag, so the thread exits at the next contact instead of running on.
struct StatsJob {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<StatsJobOutput>>,
}

/// What the stats thread returns. Tapbacks fail on their own, so a bad
/// Tapback read never costs the contact stats.
struct StatsJobOutput {
    stats: Result<stats::AllContactStats>,
    tapbacks: Result<Vec<messages_db::db::tapbacks::Tapback>>,
}

impl StatsJob {
    fn spawn(snapshot_dir: PathBuf) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = std::thread::Builder::new().name("contact-stats".into()).spawn(move || {
            let started = std::time::Instant::now();
            let stats = stats::compute_all_stats(&snapshot_dir, || thread_stop.load(Ordering::Relaxed));
            let tapbacks = if thread_stop.load(Ordering::Relaxed) {
                Err(BrbError::Cancelled("Tapbacks cancelled".to_string()))
            } else {
                messages_db::db::snapshot::open_chat_snapshot(&snapshot_dir)
                    .and_then(|conn| messages_db::db::tapbacks::list_tapbacks(&conn))
            };
            info!(
                elapsed_secs = started.elapsed().as_secs(),
                "Contact stats thread finished"
            );
            StatsJobOutput { stats, tapbacks }
        });
        let handle = match handle {
            Ok(h) => Some(h),
            Err(e) => {
                warn!(error = ?e, "Failed to start contact stats thread, skipping stats");
                None
            }
        };
        Self { stop, handle }
    }

    /// Wait for the stats and write them to `brb.db`. Failures are logged, not
    /// returned: stats are a convenience, and ingestion has already succeeded.
    fn finish(mut self, metadata_db: &MetadataDb, ingestion_id: i64) {
        let Some(handle) = self.handle.take() else {
            return;
        };
        let output = match handle.join() {
            Ok(output) => output,
            Err(_) => {
                warn!("Contact stats thread panicked");
                return;
            }
        };

        match output.tapbacks {
            Ok(tapbacks) => {
                if let Err(e) = metadata_db.write_tapbacks(&tapbacks, ingestion_id) {
                    warn!("Failed to write tapbacks: {}", e);
                }
            }
            Err(e) => warn!("Failed to read tapbacks: {}", e),
        }

        let all = match output.stats {
            Ok(all) => all,
            Err(e) => {
                warn!("Failed to compute contact stats: {}", e);
                return;
            }
        };

        match metadata_db.write_contact_stats(&all.contacts, ingestion_id) {
            Ok(()) => info!("Wrote stats for {} contacts", all.contacts.len()),
            Err(e) => warn!("Failed to write contact stats: {}", e),
        }
        match metadata_db.write_contact_stats(&[all.you], ingestion_id) {
            Ok(()) => info!("Wrote 'You' stats successfully"),
            Err(e) => warn!("Failed to write 'You' stats: {}", e),
        }
    }
}

impl Drop for StatsJob {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Get the latest ingestion metadata from the database
pub fn get_latest_ingestion() -> Result<Option<IngestionMetadata>> {
    let db = MetadataDb::open()?;
    db.get_latest()
}

/// Check if ingestion has been completed successfully.
///
/// This checks the app_state table in brb.db for a recorded ingestion completion,
/// rather than just checking if files exist. This ensures we don't falsely report
/// completion when ingestion was interrupted (e.g., DuckDB schema created but
/// embeddings never generated).
pub fn is_ingestion_complete() -> bool {
    // Try to open database and check app_state
    match MetadataDb::open() {
        Ok(db) => db.has_completed_ingestion(),
        Err(_) => false,
    }
}

/// Get the full application state from the database.
pub fn get_app_state() -> Result<AppState> {
    let db = MetadataDb::open()?;
    db.get_app_state()
}

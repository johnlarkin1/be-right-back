//! SQLite metadata database (brb.db) management.

use crate::queries;
use crate::stats::ContactStats;
use common::{BrbError, Result};
use messages_db::db::tapbacks::Tapback;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::{debug, info};

// =============================================================================
// Ingestion Settings Types
// =============================================================================

/// Settings for the analytics pipeline (Leiden topics + UMAP projection)
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct AnalyticsSettings {
    /// Number of topic clusters (default: 15)
    pub target_topics: Option<u32>,
    /// PCA dimensions before clustering and UMAP (default: 50)
    pub pca_dims: Option<u32>,
    /// UMAP n_neighbors (default: 20)
    pub umap_n_neighbors: Option<u32>,
    /// UMAP min_dist (default: 0.25)
    pub umap_min_dist: Option<f64>,
    /// UMAP spread (default: 1.5)
    pub umap_spread: Option<f64>,
    /// Random state seed for reproducibility (default: 42)
    pub random_state: Option<u32>,
}

/// Settings for configuring the ingestion pipeline
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct IngestionSettings {
    /// Start date filter (ISO format YYYY-MM-DD), null for earliest
    pub start_date: Option<String>,
    /// End date filter (ISO format YYYY-MM-DD), null for latest
    pub end_date: Option<String>,
    /// Minimum messages per contact to include, null if disabled
    pub min_messages_per_contact: Option<u32>,
    /// Analytics pipeline settings
    pub analytics: Option<AnalyticsSettings>,
}

// =============================================================================
// Conversation Analysis Types
// =============================================================================

/// Cached LLM personality/conversation analysis for a contact
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationAnalysis {
    /// Contact identifier (phone number or email)
    pub contact_id: String,
    /// Full markdown analysis from LLM
    pub analysis_markdown: String,
    /// Model used for analysis (e.g., "mlx-community/Qwen3.5-9B-4bit")
    pub model_id: String,
    /// How long the analysis took in seconds
    pub generation_duration_secs: Option<i64>,
    /// When the analysis was created (ISO timestamp)
    pub created_at: String,
}

// =============================================================================
// Stored Contact Types
// =============================================================================

/// Contact with pre-resolved display name (stored during ingestion)
///
/// This struct represents a contact as stored in brb.db, with display names
/// already resolved from AddressBook. Loading contacts from this table avoids
/// expensive phone normalization on every app startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredContact {
    /// Original handle ID from Messages DB (e.g., "+15551234567", "user@email.com")
    pub contact_id: String,
    /// Normalized phone number for matching (e.g., "+15551234567"), None for emails
    pub normalized_id: Option<String>,
    /// Display name resolved from AddressBook (e.g., "John Smith"), None if not found
    pub display_name: Option<String>,
    /// Total message count from Messages DB
    pub message_count: i64,
    /// Earliest message date (ISO format YYYY-MM-DD)
    pub earliest_message: Option<String>,
    /// Latest message date (ISO format YYYY-MM-DD)
    pub latest_message: Option<String>,
}

// =============================================================================
// Casper Thread Types
// =============================================================================

/// A saved Casper conversation thread (header info).
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct CasperThread {
    /// Database row ID
    pub id: i64,
    /// Thread title (derived from the first question, user-renamable)
    pub title: String,
    /// When the thread was created (ISO timestamp)
    pub created_at: String,
    /// When the thread was last appended to (ISO timestamp)
    pub updated_at: String,
}

/// A single stored Casper message (one row of casper_messages).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CasperStoredMessage {
    /// Database row ID
    pub id: i64,
    /// "user" or "assistant"
    pub role: String,
    /// Message text (markdown for assistant turns)
    pub content: String,
    /// Assistant `<think>` block content, if any
    pub thinking: Option<String>,
    /// Whether thinking mode was enabled when this message was generated
    pub thinking_enabled: bool,
    /// Raw JSON string of the tool calls array (frontend `CasperToolCall[]`), or None
    pub tool_calls: Option<String>,
    /// When the message was stored (ISO timestamp)
    pub created_at: String,
}

/// SQLite schema loaded from sql/sqlite_schema.sql at compile time
const SQLITE_SCHEMA: &str = include_str!("../sql/sqlite_schema.sql");

/// Metadata about a single ingestion run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestionMetadata {
    /// Database row ID
    pub id: i64,
    /// Path to the snapshot directory
    pub snapshot_dir: String,
    /// Timestamp of the ingestion
    pub snapshot_time: String,
    /// Duration of the ingestion in seconds
    pub ingestion_duration_secs: i64,
    /// Number of messages ingested
    pub message_count: i64,
    /// Number of contacts ingested
    pub contact_count: i64,
    // Embedding metadata (populated after embedding step completes)
    /// Embedding model used for vector search (e.g., "mlx-community/nomicai-modernbert-embed-base-8bit")
    pub embedding_model: Option<String>,
    /// Embedding vector dimensions (e.g., 768)
    pub embedding_dims: Option<i64>,
    /// Duration of embedding step in seconds
    pub embedding_duration_secs: Option<i64>,
    /// Messages per chunk (e.g., 5)
    pub chunk_window_size: Option<i64>,
    /// Stride between chunks (e.g., 3)
    pub chunk_stride: Option<i64>,
}

/// Application lifecycle state (single row, source of truth for app state)
/// Note: snapshot_dir, message_count, contact_count, and ingestion_duration_secs
/// are derived from the linked ingestion_meta record via curr_ingestion_id.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppState {
    // Permission tracking
    /// When FDA (Full Disk Access) was first detected as granted
    pub fda_first_granted_at: Option<String>,
    /// Last time we verified FDA access
    pub fda_last_checked_at: Option<String>,

    // Current ingestion (FK to ingestion_meta)
    /// ID of the current ingestion run (links to ingestion_meta)
    pub curr_ingestion_id: Option<i64>,

    // Derived from ingestion_meta via curr_ingestion_id (not stored in app_state)
    /// Path to latest snapshot (from ingestion_meta.snapshot_dir)
    pub snapshot_dir: Option<String>,
    /// When the snapshot was created (from ingestion_meta.snapshot_time)
    pub snapshot_time: Option<String>,
    /// Message count from latest snapshot (from ingestion_meta.message_count)
    pub snapshot_message_count: Option<i64>,
    /// Contact count from latest snapshot (from ingestion_meta.contact_count)
    pub snapshot_contact_count: Option<i64>,
    /// Duration of ingestion in seconds (from ingestion_meta.ingestion_duration_secs)
    pub ingestion_duration_secs: Option<i64>,
    /// Earliest message date in snapshot (ISO format YYYY-MM-DD)
    pub earliest_message_date: Option<String>,
    /// Latest message date in snapshot (ISO format YYYY-MM-DD)
    pub latest_message_date: Option<String>,

    // Ingestion tracking (only set on SUCCESSFUL completion)
    /// When ingestion finished successfully
    pub ingestion_completed_at: Option<String>,
    /// Actual chunks created (from DuckDB, not in ingestion_meta)
    pub ingestion_chunk_count: Option<i64>,

    // Analytics tracking (Leiden + UMAP clustering)
    /// When analytics pipeline finished
    pub analytics_completed_at: Option<String>,
    /// Number of clusters created
    pub analytics_cluster_count: Option<i64>,

    // Base model tracking
    /// Model ID, e.g., "qwen3-4b"
    pub base_model_id: Option<String>,
    /// When model download started
    pub base_model_download_started_at: Option<String>,
    /// When model download completed
    pub base_model_download_completed_at: Option<String>,
    /// Size of downloaded model in bytes
    pub base_model_size_bytes: Option<i64>,

    // Onboarding UI state
    /// When user finished Casper guide
    pub onboarding_completed_at: Option<String>,
    /// Current step: welcome|privacy|permissions|snapshot|ingestion|complete
    pub onboarding_current_step: Option<String>,
    /// Is Casper minimized
    pub casper_minimized: bool,

    // Timestamps
    /// When the app state row was created
    pub created_at: String,
    /// When the app state was last updated
    pub updated_at: String,
}

/// Handle to the metadata SQLite database (brb.db)
pub struct MetadataDb {
    conn: Connection,
}

/// Map a row from `SELECT_LATEST_INGESTION` (11 columns).
fn row_to_ingestion_metadata(row: &rusqlite::Row) -> rusqlite::Result<IngestionMetadata> {
    Ok(IngestionMetadata {
        id: row.get(0)?,
        snapshot_dir: row.get(1)?,
        snapshot_time: row.get(2)?,
        ingestion_duration_secs: row.get(3)?,
        message_count: row.get(4)?,
        contact_count: row.get(5)?,
        embedding_model: row.get(6)?,
        embedding_dims: row.get(7)?,
        embedding_duration_secs: row.get(8)?,
        chunk_window_size: row.get(9)?,
        chunk_stride: row.get(10)?,
    })
}

/// Map a row from `SELECT_CONTACT_STATS` / `SELECT_ALL_CONTACT_STATS` (same 11 columns).
fn row_to_contact_stats(row: &rusqlite::Row) -> rusqlite::Result<ContactStats> {
    let top_emojis_json: Option<String> = row.get(9)?;
    let top_emojis: Vec<String> = top_emojis_json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Ok(ContactStats {
        contact_id: row.get(0)?,
        contact_name: row.get(1)?,
        message_count: row.get(2)?,
        messages_from_me: row.get(3)?,
        messages_from_them: row.get(4)?,
        date_range_start: row.get(5)?,
        date_range_end: row.get(6)?,
        avg_message_length: row.get(7)?,
        emoji_rate: row.get(8)?,
        top_emojis,
        avg_response_time_secs: row.get(10)?,
    })
}

/// Map a row from `SELECT_ALL_CONTACTS` (6 columns).
fn row_to_stored_contact(row: &rusqlite::Row) -> rusqlite::Result<StoredContact> {
    Ok(StoredContact {
        contact_id: row.get(0)?,
        normalized_id: row.get(1)?,
        display_name: row.get(2)?,
        message_count: row.get(3)?,
        earliest_message: row.get(4)?,
        latest_message: row.get(5)?,
    })
}

impl MetadataDb {
    /// Open or create the metadata database at the canonical location
    /// (`~/.be-right-back/data/db/brb.db`).
    ///
    /// The path comes from [`common::get_brb_sqlite_db`] — the single source of
    /// truth — so callers can never point this at the wrong directory.
    pub fn open() -> Result<Self> {
        let db_path = common::get_brb_sqlite_db()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(BrbError::Io)?;
        }

        let conn = Connection::open(&db_path)?;

        let db = Self { conn };
        db.initialize_schema()?;

        info!(?db_path, "Opened metadata database");
        Ok(db)
    }

    /// Initialize the database schema from sql/sqlite_schema.sql
    fn initialize_schema(&self) -> Result<()> {
        self.conn.execute_batch(SQLITE_SCHEMA)?;

        // Run migrations for existing databases (ignore errors if columns already exist)
        self.run_migrations();

        Ok(())
    }

    /// Run database migrations for schema updates.
    /// Each migration is run independently and errors are ignored if the change already exists.
    fn run_migrations(&self) {
        // Migration: Add date range columns to ingestion_meta (added in prompting-strategy update)
        let _ = self
            .conn
            .execute("ALTER TABLE ingestion_meta ADD COLUMN earliest_message_date TEXT", []);
        let _ = self
            .conn
            .execute("ALTER TABLE ingestion_meta ADD COLUMN latest_message_date TEXT", []);

        // Migration: Add dedicated model_preference column to app_state
        // (previously preference was stored in base_model_id, colliding with download tracking)
        let _ = self
            .conn
            .execute("ALTER TABLE app_state ADD COLUMN model_preference TEXT", []);

        debug!("Ran database migrations");
    }

    /// Record a new ingestion run and set it as the current ingestion in app_state
    ///
    /// # Arguments
    /// * `snapshot_dir` - Path to the snapshot directory
    /// * `message_count` - Total messages in the snapshot
    /// * `contact_count` - Total contacts in the snapshot
    /// * `duration_secs` - How long the ingestion took
    /// * `earliest_message_date` - Earliest message date (ISO format YYYY-MM-DD)
    /// * `latest_message_date` - Latest message date (ISO format YYYY-MM-DD)
    pub fn record_ingestion(
        &self,
        snapshot_dir: &Path,
        message_count: i64,
        contact_count: i64,
        duration_secs: u64,
        earliest_message_date: Option<String>,
        latest_message_date: Option<String>,
    ) -> Result<i64> {
        let timestamp = chrono::Utc::now().to_rfc3339();

        self.conn.execute(
            queries::INSERT_INGESTION_META,
            rusqlite::params![
                snapshot_dir.to_string_lossy().to_string(),
                timestamp,
                duration_secs as i64,
                message_count,
                contact_count,
                earliest_message_date,
                latest_message_date,
            ],
        )?;

        let id = self.conn.last_insert_rowid();

        // Update app_state to point to this ingestion
        self.conn
            .execute(queries::UPDATE_CURR_INGESTION_ID, rusqlite::params![id])?;

        info!(
            id,
            message_count,
            contact_count,
            ?earliest_message_date,
            ?latest_message_date,
            "Recorded ingestion metadata and set as current"
        );

        Ok(id)
    }

    /// Get the latest ingestion metadata
    pub fn get_latest(&self) -> Result<Option<IngestionMetadata>> {
        Ok(self
            .conn
            .query_row(queries::SELECT_LATEST_INGESTION, [], row_to_ingestion_metadata)
            .optional()?)
    }

    /// Update embedding metadata after embedding step completes.
    ///
    /// `message_count` and `contact_count` come from the Python pipeline, so they
    /// overwrite the whole-snapshot estimate recorded before the run with what was
    /// actually embedded after the user's ingestion filters applied.
    #[allow(clippy::too_many_arguments)]
    pub fn update_embedding_metadata(
        &self,
        ingestion_id: i64,
        embedding_model: &str,
        embedding_dims: i64,
        embedding_duration_secs: i64,
        chunk_window_size: i64,
        chunk_stride: i64,
        message_count: i64,
        contact_count: i64,
    ) -> Result<()> {
        self.conn.execute(
            queries::UPDATE_EMBEDDING_METADATA,
            rusqlite::params![
                embedding_model,
                embedding_dims,
                embedding_duration_secs,
                chunk_window_size,
                chunk_stride,
                message_count,
                contact_count,
                ingestion_id,
            ],
        )?;

        info!(
            ingestion_id,
            embedding_model,
            embedding_dims,
            embedding_duration_secs,
            chunk_window_size,
            chunk_stride,
            message_count,
            contact_count,
            "Updated embedding metadata"
        );
        Ok(())
    }

    // =========================================================================
    // App State Methods
    // =========================================================================

    /// Get the current application state (with ingestion_meta fields via LEFT JOIN)
    pub fn get_app_state(&self) -> Result<AppState> {
        let result = self.conn.query_row(queries::SELECT_APP_STATE, [], |row| {
            Ok(AppState {
                fda_first_granted_at: row.get(0)?,
                fda_last_checked_at: row.get(1)?,
                curr_ingestion_id: row.get(2)?,
                ingestion_completed_at: row.get(3)?,
                ingestion_chunk_count: row.get(4)?,
                analytics_completed_at: row.get(5)?,
                analytics_cluster_count: row.get(6)?,
                base_model_id: row.get(7)?,
                base_model_download_started_at: row.get(8)?,
                base_model_download_completed_at: row.get(9)?,
                base_model_size_bytes: row.get(10)?,
                onboarding_completed_at: row.get(11)?,
                onboarding_current_step: row.get(12)?,
                casper_minimized: row.get::<_, i64>(13)? != 0,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                // Derived from ingestion_meta
                snapshot_dir: row.get(16)?,
                snapshot_time: row.get(17)?,
                snapshot_message_count: row.get(18)?,
                snapshot_contact_count: row.get(19)?,
                ingestion_duration_secs: row.get(20)?,
                earliest_message_date: row.get(21)?,
                latest_message_date: row.get(22)?,
            })
        });

        match result {
            Ok(state) => Ok(state),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                // Should not happen since schema inserts default row, but handle gracefully
                Ok(AppState::default())
            }
            Err(e) => Err(e.into()),
        }
    }

    // -------------------------------------------------------------------------
    // Ingestion Tracking
    // -------------------------------------------------------------------------

    /// Record successful ingestion completion
    /// Note: duration_secs is stored in ingestion_meta, not app_state
    pub fn record_ingestion_complete(&self, chunk_count: i64) -> Result<()> {
        let timestamp = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            queries::UPDATE_INGESTION_COMPLETE,
            rusqlite::params![timestamp, chunk_count],
        )?;
        info!(chunk_count, "Recorded ingestion complete");
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Analytics Tracking
    // -------------------------------------------------------------------------

    /// Record successful analytics completion
    pub fn record_analytics_complete(&self, cluster_count: i64) -> Result<()> {
        let timestamp = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            queries::UPDATE_ANALYTICS_COMPLETE,
            rusqlite::params![timestamp, cluster_count],
        )?;
        info!(cluster_count, "Recorded analytics complete");
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Model Preference Methods
    // -------------------------------------------------------------------------

    /// Get the user's model preference string (e.g., "4b:4bit").
    ///
    /// Returns None if no preference is set (auto mode).
    pub fn get_model_preference(&self) -> Result<Option<String>> {
        let result: Option<String> = self
            .conn
            .query_row(queries::SELECT_MODEL_PREFERENCE, [], |row| row.get(0))
            .map_err(BrbError::from)?;
        Ok(result)
    }

    /// Save the user's model preference (e.g., "4b:4bit").
    ///
    /// Falls back to INSERT if the app_state row doesn't exist yet (fresh install).
    pub fn save_model_preference(&self, preference: &str) -> Result<()> {
        let rows = self
            .conn
            .execute(queries::UPDATE_MODEL_PREFERENCE, rusqlite::params![preference])?;
        if rows == 0 {
            self.conn.execute(
                "INSERT INTO app_state (id, model_preference) VALUES (1, ?1)",
                rusqlite::params![preference],
            )?;
        }
        Ok(())
    }

    /// Clear the user's model preference (revert to auto-recommended).
    pub fn clear_model_preference(&self) -> Result<()> {
        self.conn.execute(
            queries::UPDATE_MODEL_PREFERENCE,
            rusqlite::params![rusqlite::types::Null],
        )?;
        Ok(())
    }

    // -------------------------------------------------------------------------
    // Contact Stats Methods
    // -------------------------------------------------------------------------

    /// Write pre-computed contact statistics to SQLite.
    ///
    /// Uses INSERT OR REPLACE with composite primary key (contact_id, ingestion_id)
    /// to preserve historical stats across ingestion runs.
    pub fn write_contact_stats(&self, stats: &[ContactStats], ingestion_id: i64) -> Result<()> {
        let mut stmt = self.conn.prepare(queries::INSERT_CONTACT_STATS)?;

        for s in stats {
            let top_emojis_json = serde_json::to_string(&s.top_emojis)
                .map_err(|e| BrbError::Serialization(format!("failed to serialize top_emojis: {}", e)))?;

            stmt.execute(rusqlite::params![
                s.contact_id,
                ingestion_id,
                s.contact_name,
                s.message_count,
                s.messages_from_me,
                s.messages_from_them,
                s.date_range_start,
                s.date_range_end,
                s.avg_message_length,
                s.emoji_rate,
                top_emojis_json,
                s.avg_response_time_secs,
            ])?;
        }

        info!(
            "Wrote stats for {} contacts (ingestion_id={})",
            stats.len(),
            ingestion_id
        );
        Ok(())
    }

    /// Write Tapbacks for an ingestion run in one transaction.
    pub fn write_tapbacks(&self, tapbacks: &[Tapback], ingestion_id: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(queries::INSERT_TAPBACK)?;
            for t in tapbacks {
                stmt.execute(rusqlite::params![
                    ingestion_id,
                    t.message_rowid,
                    t.chat_id,
                    t.contact_id,
                    t.sender_id,
                    t.is_from_me,
                    t.kind.as_str(),
                    t.emoji,
                    t.target_rowid,
                    t.target_part,
                    t.target_is_balloon,
                    t.target_from_me,
                    t.target_sender_id,
                    t.reacted_at,
                ])?;
            }
        }
        tx.commit()?;
        info!(count = tapbacks.len(), ingestion_id, "Wrote tapbacks");
        Ok(())
    }

    /// Tapback totals and kind mix for the current ingestion. See [`crate::tapbacks::summary`].
    pub fn tapback_summary(
        &self,
        contact_id: Option<&str>,
        window: crate::tapbacks::TapbackWindow,
    ) -> Result<crate::tapbacks::TapbackSummary> {
        crate::tapbacks::summary(&self.conn, contact_id, window)
    }

    /// People ranked by Tapbacks exchanged with you. See [`crate::tapbacks::contacts`].
    pub fn tapback_contacts(
        &self,
        window: crate::tapbacks::TapbackWindow,
        limit: usize,
    ) -> Result<Vec<crate::tapbacks::TapbackContact>> {
        crate::tapbacks::contacts(&self.conn, window, limit)
    }

    /// Tapbacks per month and kind. See [`crate::tapbacks::monthly`].
    pub fn tapback_monthly(
        &self,
        window: crate::tapbacks::TapbackWindow,
    ) -> Result<Vec<crate::tapbacks::TapbackMonth>> {
        crate::tapbacks::monthly(&self.conn, window)
    }

    /// Emoji Tapbacks, most used first. See [`crate::tapbacks::top_emojis`].
    pub fn tapback_emojis(
        &self,
        window: crate::tapbacks::TapbackWindow,
        limit: usize,
    ) -> Result<Vec<crate::tapbacks::TapbackEmoji>> {
        crate::tapbacks::top_emojis(&self.conn, window, limit)
    }

    /// Your messages with the most Tapbacks, with text read from the current
    /// ingestion's snapshot. When the snapshot is gone, `text` stays `None`.
    pub fn tapback_most_reacted(
        &self,
        window: crate::tapbacks::TapbackWindow,
        limit: usize,
    ) -> Result<Vec<crate::tapbacks::ReactedMessage>> {
        let mut messages = crate::tapbacks::most_reacted(&self.conn, window, limit)?;
        let Some(dir) = crate::tapbacks::current_snapshot_dir(&self.conn)? else {
            return Ok(messages);
        };
        match messages_db::db::snapshot::open_chat_snapshot(Path::new(&dir)) {
            Ok(chat) => crate::tapbacks::fill_message_text(&chat, &mut messages)?,
            Err(e) => tracing::warn!(error = %e, "Snapshot missing; most-reacted messages have no text"),
        }
        Ok(messages)
    }

    /// Get pre-computed stats for a contact from the current ingestion run.
    ///
    /// Returns None if no stats exist for the contact in the current ingestion.
    pub fn get_contact_stats(&self, contact_id: &str) -> Result<Option<ContactStats>> {
        Ok(self
            .conn
            .query_row(
                queries::SELECT_CONTACT_STATS,
                rusqlite::params![contact_id],
                row_to_contact_stats,
            )
            .optional()?)
    }

    /// Get all pre-computed stats for the current ingestion run.
    ///
    /// Returns stats sorted by message_count descending.
    pub fn get_all_contact_stats(&self) -> Result<Vec<ContactStats>> {
        let mut stmt = self.conn.prepare(queries::SELECT_ALL_CONTACT_STATS)?;

        let rows = stmt.query_map([], row_to_contact_stats)?;

        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // -------------------------------------------------------------------------
    // Contacts Methods (Pre-resolved Display Names)
    // -------------------------------------------------------------------------

    /// Write contacts with pre-resolved display names to SQLite.
    ///
    /// This should be called during ingestion after resolving display names
    /// from AddressBook. Storing contacts here avoids expensive phone
    /// normalization on every app startup.
    pub fn write_contacts(&self, contacts: &[StoredContact], ingestion_id: i64) -> Result<()> {
        let mut stmt = self.conn.prepare(queries::INSERT_CONTACT)?;

        for contact in contacts {
            stmt.execute(rusqlite::params![
                ingestion_id,
                contact.contact_id,
                contact.normalized_id,
                contact.display_name,
                contact.message_count,
                contact.earliest_message,
                contact.latest_message,
            ])?;
        }

        info!(
            count = contacts.len(),
            ingestion_id, "Wrote contacts with pre-resolved display names"
        );
        Ok(())
    }

    /// Get all contacts for the current ingestion run.
    ///
    /// Returns contacts sorted by message_count descending.
    /// This is the fast path for app startup - no phone normalization needed.
    pub fn get_all_contacts(&self) -> Result<Vec<StoredContact>> {
        let mut stmt = self.conn.prepare(queries::SELECT_ALL_CONTACTS)?;

        let rows = stmt.query_map([], row_to_stored_contact)?;

        let results = rows.collect::<rusqlite::Result<Vec<_>>>()?;

        debug!(count = results.len(), "Loaded contacts from brb.db");
        Ok(results)
    }

    // -------------------------------------------------------------------------
    // Convenience Check Methods
    // -------------------------------------------------------------------------

    /// Check if ingestion has been successfully completed
    pub fn has_completed_ingestion(&self) -> bool {
        self.get_app_state()
            .map(|s| s.ingestion_completed_at.is_some())
            .unwrap_or(false)
    }

    // -------------------------------------------------------------------------
    // Ingestion Settings Methods
    // -------------------------------------------------------------------------

    /// Save user ingestion settings to SQLite.
    ///
    /// These settings are persisted and restored when the user opens the settings modal.
    pub fn save_ingestion_settings(&self, settings: &IngestionSettings) -> Result<()> {
        let analytics_json = settings
            .analytics
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| BrbError::Serialization(format!("failed to serialize analytics: {}", e)))?;

        self.conn.execute(
            queries::UPDATE_INGESTION_SETTINGS,
            rusqlite::params![
                settings.start_date,
                settings.end_date,
                settings.min_messages_per_contact,
                analytics_json,
            ],
        )?;

        debug!("Saved ingestion settings");
        Ok(())
    }

    /// Get saved user ingestion settings from SQLite.
    ///
    /// Returns None if no settings have been saved yet (uses defaults from schema).
    pub fn get_ingestion_settings(&self) -> Result<Option<IngestionSettings>> {
        let result = self.conn.query_row(queries::SELECT_INGESTION_SETTINGS, [], |row| {
            let analytics_json: Option<String> = row.get(3)?;
            let analytics = analytics_json.and_then(|s| serde_json::from_str(&s).ok());

            Ok(IngestionSettings {
                start_date: row.get(0)?,
                end_date: row.get(1)?,
                min_messages_per_contact: row.get(2)?,
                analytics,
            })
        });

        Ok(result.optional()?)
    }

    // -------------------------------------------------------------------------
    // Conversation Analysis Methods
    // -------------------------------------------------------------------------

    /// Get cached conversation analysis for a contact.
    ///
    /// Returns the most recent analysis for the contact from the current ingestion run,
    /// or None if no analysis exists.
    pub fn get_conversation_analysis(&self, contact_id: &str) -> Result<Option<ConversationAnalysis>> {
        let result = self.conn.query_row(
            queries::SELECT_CONVERSATION_ANALYSIS,
            rusqlite::params![contact_id],
            |row| {
                Ok(ConversationAnalysis {
                    contact_id: row.get(0)?,
                    analysis_markdown: row.get(1)?,
                    model_id: row.get(2)?,
                    generation_duration_secs: row.get(3)?,
                    created_at: row.get(4)?,
                })
            },
        );

        Ok(result.optional()?)
    }

    /// Save conversation analysis for a contact.
    ///
    /// Uses INSERT OR REPLACE to update existing analysis for the same
    /// contact/ingestion combination.
    pub fn save_conversation_analysis(&self, analysis: &ConversationAnalysis, ingestion_id: i64) -> Result<()> {
        self.conn.execute(
            queries::INSERT_CONVERSATION_ANALYSIS,
            rusqlite::params![
                analysis.contact_id,
                ingestion_id,
                analysis.analysis_markdown,
                analysis.model_id,
                analysis.generation_duration_secs,
                analysis.created_at,
            ],
        )?;

        info!(
            contact_id = %analysis.contact_id,
            model_id = %analysis.model_id,
            "Saved conversation analysis"
        );
        Ok(())
    }

    // =========================================================================
    // Casper Thread Persistence
    // =========================================================================

    /// Create a new Casper conversation thread, returning its row id.
    pub fn create_casper_thread(&self, title: &str) -> Result<i64> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn
            .execute(queries::INSERT_CASPER_THREAD, rusqlite::params![title, now])?;
        let id = self.conn.last_insert_rowid();
        info!(id, title = %title, "Created Casper thread");
        Ok(id)
    }

    /// List all Casper threads, most recently updated first.
    pub fn list_casper_threads(&self) -> Result<Vec<CasperThread>> {
        let mut stmt = self.conn.prepare(queries::SELECT_CASPER_THREADS)?;
        let rows = stmt.query_map([], |row| {
            Ok(CasperThread {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Append a message to a thread and bump the thread's `updated_at`.
    ///
    /// Returns the new message's row id. `tool_calls_json` is the raw JSON
    /// string of the frontend tool-call array (stored opaquely).
    pub fn append_casper_message(
        &self,
        thread_id: i64,
        role: &str,
        content: &str,
        thinking: Option<&str>,
        thinking_enabled: bool,
        tool_calls_json: Option<&str>,
    ) -> Result<i64> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            queries::INSERT_CASPER_MESSAGE,
            rusqlite::params![
                thread_id,
                role,
                content,
                thinking,
                thinking_enabled as i64,
                tool_calls_json,
                now,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        self.conn
            .execute(queries::TOUCH_CASPER_THREAD, rusqlite::params![thread_id, now])?;
        Ok(id)
    }

    /// Load all messages for a thread in chronological order.
    pub fn load_casper_messages(&self, thread_id: i64) -> Result<Vec<CasperStoredMessage>> {
        let mut stmt = self.conn.prepare(queries::SELECT_CASPER_MESSAGES)?;
        let rows = stmt.query_map(rusqlite::params![thread_id], |row| {
            let thinking_enabled: i64 = row.get(4)?;
            Ok(CasperStoredMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                thinking: row.get(3)?,
                thinking_enabled: thinking_enabled != 0,
                tool_calls: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Rename a Casper thread.
    pub fn rename_casper_thread(&self, thread_id: i64, title: &str) -> Result<()> {
        self.conn
            .execute(queries::RENAME_CASPER_THREAD, rusqlite::params![thread_id, title])?;
        Ok(())
    }

    /// Delete a Casper thread and all of its messages.
    ///
    /// Messages are deleted explicitly rather than relying on `ON DELETE
    /// CASCADE`, since `PRAGMA foreign_keys` is not enabled on this connection.
    pub fn delete_casper_thread(&self, thread_id: i64) -> Result<()> {
        self.conn
            .execute(queries::DELETE_CASPER_THREAD_MESSAGES, rusqlite::params![thread_id])?;
        self.conn
            .execute(queries::DELETE_CASPER_THREAD, rusqlite::params![thread_id])?;
        info!(thread_id, "Deleted Casper thread");
        Ok(())
    }
}

#[cfg(test)]
impl MetadataDb {
    /// An in-memory brb.db with the full schema, for tests.
    pub(crate) fn open_in_memory() -> Result<Self> {
        let db = Self {
            conn: Connection::open_in_memory()?,
        };
        db.initialize_schema()?;
        Ok(db)
    }
}

#[cfg(test)]
mod tapback_tests {
    use super::*;
    use messages_db::db::tapbacks::TapbackKind;

    #[test]
    fn writes_tapbacks() {
        let db = MetadataDb::open_in_memory().unwrap();
        db.conn
            .execute(
                "INSERT INTO ingestion_meta (id, snapshot_dir, snapshot_time, ingestion_duration_secs, message_count, contact_count)
                 VALUES (1, 'snap', 't', 0, 0, 0)",
                [],
            )
            .unwrap();
        let tapback = Tapback {
            message_rowid: 7,
            chat_id: 1,
            contact_id: Some("+1555".into()),
            sender_id: None,
            is_from_me: true,
            kind: TapbackKind::Emoji,
            emoji: Some("\u{1f602}".into()),
            target_rowid: Some(3),
            target_part: 0,
            target_is_balloon: false,
            target_from_me: Some(false),
            target_sender_id: Some("+1555".into()),
            reacted_at: 1_700_000_000,
        };
        db.write_tapbacks(&[tapback.clone(), tapback], 1).unwrap();

        let (count, kind, emoji): (i64, String, String) = db
            .conn
            .query_row("SELECT COUNT(*), MAX(kind), MAX(emoji) FROM tapbacks", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(count, 1, "rewriting the same Tapback replaces it");
        assert_eq!(kind, "emoji");
        assert_eq!(emoji, "\u{1f602}");
    }
}

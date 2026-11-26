//! Progress tracking for ingestion pipeline.
//!
//! The ingestion pipeline has 6 distinct stages, each with independent 0-100% progress:
//! 1. Snapshot - Creating database snapshot (Rust)
//! 2. Parsing - Counting messages from snapshot (Rust)
//! 3. Chunking - Creating message chunks (Python)
//! 4. Embedding - Generating embeddings (Python)
//! 5. Saving - Writing to DuckDB + indexing (Python)
//! 6. Analyzing - Leiden + UMAP clustering for Insights page (Python)

use serde::{Deserialize, Serialize};

/// The 6 distinct ingestion stages with independent 0-100% progress
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
#[serde(rename_all = "snake_case")]
pub enum IngestionStage {
    /// Stage 1: Creating a snapshot of the iMessage database
    Snapshot,
    /// Stage 2: Parsing/counting messages from the snapshot
    Parsing,
    /// Stage 3: Creating message chunks
    Chunking,
    /// Stage 4: Generating embeddings
    Embedding,
    /// Stage 5: Writing to DuckDB and creating HNSW index
    Saving,
    /// Stage 6: Leiden + UMAP analytics for Insights page
    Analyzing,
}

impl IngestionStage {
    /// Get all stages in order
    pub fn all() -> [IngestionStage; 6] {
        [
            Self::Snapshot,
            Self::Parsing,
            Self::Chunking,
            Self::Embedding,
            Self::Saving,
            Self::Analyzing,
        ]
    }

    /// Get the index of this stage (0-5)
    pub fn index(&self) -> usize {
        match self {
            Self::Snapshot => 0,
            Self::Parsing => 1,
            Self::Chunking => 2,
            Self::Embedding => 3,
            Self::Saving => 4,
            Self::Analyzing => 5,
        }
    }
}

/// Status of a single stage
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
#[serde(rename_all = "snake_case")]
pub enum StageStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
}

/// Progress for a single stage (0-100% independent)
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct StageProgress {
    pub stage: IngestionStage,
    /// Progress 0-100 for THIS stage only
    pub percent: u8,
    pub status: StageStatus,
    pub message: String,
}

impl StageProgress {
    pub fn new(stage: IngestionStage) -> Self {
        Self {
            stage,
            percent: 0,
            status: StageStatus::Pending,
            message: String::new(),
        }
    }
}

/// Current contact being processed
#[derive(Debug, Clone, Serialize, Deserialize, Default, ts_rs::TS)]
#[ts(export, export_to = "ingestion.ts")]
pub struct ContactProgress {
    pub contact_id: String,
    pub contact_name: String,
    pub messages_in_contact: i64,
    pub chunks_for_contact: i64,
}

/// Statistics during ingestion
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IngestionStats {
    /// Messages processed so far
    pub messages_processed: i64,
    /// Total messages to process
    pub total_messages: i64,
    /// Contacts processed so far
    pub contacts_processed: i64,
    /// Total contacts to process
    pub total_contacts: i64,
    /// Current contact being processed (if any)
    pub current_contact: Option<ContactProgress>,
    /// Chunks created so far
    pub chunks_created: i64,
    /// Chunks embedded so far
    pub chunks_embedded: i64,
    /// Elapsed time in seconds
    pub elapsed_secs: u64,
    /// Estimated remaining time in seconds (if available)
    pub estimated_remaining_secs: Option<u64>,
}

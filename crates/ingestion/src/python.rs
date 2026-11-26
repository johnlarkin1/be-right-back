//! Python subprocess integration for embedding generation.
//!
//! This module handles spawning and communicating with the Python embedding script.
//! Progress is reported via JSON lines from stdout, with human-readable logs to stderr.

use common::{BrbError, PythonEnvironment, Result, scripts};
use serde::Deserialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use tracing::{debug, error, info, warn};

use crate::metadata::IngestionSettings;
use crate::progress::{ContactProgress, IngestionStage, IngestionStats};

/// Messages from Python subprocess (JSON lines)
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PythonMessage {
    /// Stage progress format (5 independent stages)
    StageProgress {
        stage: String,
        percent: u8,
        message: String,
        #[serde(default)]
        stats: PythonStats,
        #[serde(default)]
        current_contact: Option<PythonContactProgress>,
    },
    /// Final result from the script
    Result {
        success: bool,
        data: serde_json::Value,
        #[serde(default)]
        error: Option<String>,
    },
    /// Log message
    Log { level: String, message: String },
}

/// Statistics from Python subprocess
#[derive(Debug, Default, Deserialize)]
pub struct PythonStats {
    #[serde(default)]
    pub items_processed: i64,
    #[serde(default)]
    pub total_items: i64,
    #[serde(default)]
    pub elapsed_secs: f64,
    #[serde(default)]
    pub estimated_remaining_secs: Option<f64>,
    #[serde(default)]
    pub chunks_created: i64,
    #[serde(default)]
    pub chunks_embedded: i64,
    #[serde(default)]
    pub contacts_processed: i64,
    #[serde(default)]
    pub total_contacts: i64,
}

/// Contact progress from Python subprocess
#[derive(Debug, Default, Deserialize)]
pub struct PythonContactProgress {
    #[serde(default)]
    pub contact_id: String,
    #[serde(default)]
    pub contact_name: String,
    #[serde(default)]
    pub messages_in_contact: i64,
    #[serde(default)]
    pub chunks_for_contact: i64,
}

impl From<PythonContactProgress> for ContactProgress {
    fn from(p: PythonContactProgress) -> Self {
        Self {
            contact_id: p.contact_id,
            contact_name: p.contact_name,
            messages_in_contact: p.messages_in_contact,
            chunks_for_contact: p.chunks_for_contact,
        }
    }
}

/// Result from the embedding script
#[derive(Debug, Deserialize)]
pub struct EmbeddingResult {
    pub message_count: i64,
    pub contact_count: i64,
    pub chunk_count: i64,
    pub embedding_dims: i64,
    pub elapsed_secs: f64,
    pub output_db: String,
    /// Embedding model used (e.g., "mlx-community/nomicai-modernbert-embed-base-8bit")
    pub embedding_model: String,
    /// Messages per chunk
    pub chunk_window_size: i64,
    /// Stride between chunks
    pub chunk_stride: i64,
}

/// Map Python stage string to Rust IngestionStage
fn map_python_stage(stage: &str) -> IngestionStage {
    match stage {
        "parsing" => IngestionStage::Parsing,
        "chunking" => IngestionStage::Chunking,
        "embedding" => IngestionStage::Embedding,
        "saving" => IngestionStage::Saving,
        _ => IngestionStage::Embedding, // fallback
    }
}

/// Build the `embed.py` arguments for the user's stored ingestion filters.
///
/// A `None` field means "no filter" and emits no argument, so an unfiltered run
/// spawns exactly the command it did before these settings were wired in.
fn filter_args(settings: Option<&IngestionSettings>) -> Vec<String> {
    let Some(settings) = settings else {
        return Vec::new();
    };
    let mut args = Vec::new();
    if let Some(start) = settings.start_date.as_deref().filter(|s| !s.is_empty()) {
        args.push("--start-date".to_string());
        args.push(start.to_string());
    }
    if let Some(end) = settings.end_date.as_deref().filter(|s| !s.is_empty()) {
        args.push("--end-date".to_string());
        args.push(end.to_string());
    }
    // 0 is how the UI stores "the min-messages toggle is off"; treat it as absent.
    if let Some(min) = settings.min_messages_per_contact.filter(|m| *m > 0) {
        args.push("--min-messages-per-contact".to_string());
        args.push(min.to_string());
    }
    args
}

/// Convert Python stats to Rust IngestionStats
fn convert_stats(stats: &PythonStats, current_contact: Option<PythonContactProgress>) -> IngestionStats {
    IngestionStats {
        messages_processed: stats.items_processed,
        total_messages: stats.total_items,
        contacts_processed: stats.contacts_processed,
        total_contacts: stats.total_contacts,
        current_contact: current_contact.map(|c| c.into()),
        chunks_created: stats.chunks_created,
        chunks_embedded: stats.chunks_embedded,
        elapsed_secs: stats.elapsed_secs as u64,
        estimated_remaining_secs: stats.estimated_remaining_secs.map(|s| s as u64),
    }
}

/// Run the Python embedding script with progress callbacks (5-stage format)
pub fn run_python_embeddings<F>(
    snapshot_db: &Path,
    addressbook_db: &Path,
    output_db: &Path,
    ingestion_id: i64,
    settings: Option<&IngestionSettings>,
    progress_callback: F,
) -> Result<EmbeddingResult>
where
    F: FnMut(IngestionStage, u8, &str, IngestionStats),
{
    // Delegate to cancellable version with a no-op cancel check
    run_python_embeddings_cancellable(
        snapshot_db,
        addressbook_db,
        output_db,
        ingestion_id,
        settings,
        progress_callback,
        || false,
    )
}

/// Run the Python embedding script with progress callbacks and cancellation support
///
/// The `is_cancelled` closure is checked before processing each line from stdout.
/// If cancellation is requested, the Python process is killed and `BrbError::Cancelled` is returned.
pub fn run_python_embeddings_cancellable<F, C>(
    snapshot_db: &Path,
    addressbook_db: &Path,
    output_db: &Path,
    ingestion_id: i64,
    settings: Option<&IngestionSettings>,
    mut progress_callback: F,
    is_cancelled: C,
) -> Result<EmbeddingResult>
where
    F: FnMut(IngestionStage, u8, &str, IngestionStats),
    C: Fn() -> bool,
{
    let env = PythonEnvironment::get()?;
    let python = &env.python_bin;
    let script = env.script(scripts::EMBED);

    // Check cancellation before starting
    if is_cancelled() {
        return Err(BrbError::Cancelled("Ingestion cancelled before start".to_string()));
    }

    let filters = filter_args(settings);

    info!(
        ?python,
        ?script,
        ?addressbook_db,
        ingestion_id,
        ?filters,
        "Starting Python embedding process (cancellable)"
    );

    let mut child = Command::new(python)
        .arg(&script)
        .arg("--snapshot-db")
        .arg(snapshot_db)
        .arg("--addressbook-db")
        .arg(addressbook_db)
        .arg("--output-db")
        .arg(output_db)
        .arg("--ingestion-id")
        .arg(ingestion_id.to_string())
        .args(&filters)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| BrbError::PythonError(format!("Failed to spawn Python: {}", e)))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| BrbError::PythonError("Failed to capture stdout".to_string()))?;

    let stderr = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(|r| r.ok()) {
                debug!(target: "python_embed", "{}", line);
            }
        }
    });

    let reader = BufReader::new(stdout);
    let mut final_result: Option<EmbeddingResult> = None;
    let mut error_message: Option<String> = None;

    for line in reader.lines() {
        // Check cancellation before processing each line
        if is_cancelled() {
            info!("Ingestion cancelled, killing Python process");
            let _ = child.kill();
            let _ = child.wait(); // Reap the zombie process
            let _ = stderr_thread.join();
            return Err(BrbError::Cancelled("Ingestion cancelled by user".to_string()));
        }

        let line = line.map_err(|e| BrbError::PythonError(format!("Failed to read stdout: {}", e)))?;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<PythonMessage>(&line) {
            Ok(PythonMessage::StageProgress {
                stage,
                percent,
                message,
                stats,
                current_contact,
            }) => {
                let ingestion_stage = map_python_stage(&stage);
                let ingestion_stats = convert_stats(&stats, current_contact);
                progress_callback(ingestion_stage, percent, &message, ingestion_stats);
            }
            Ok(PythonMessage::Result { success, data, error }) => {
                if success {
                    final_result = serde_json::from_value(data).ok();
                } else {
                    error_message = error;
                }
            }
            Ok(PythonMessage::Log { level, message }) => match level.as_str() {
                "info" => info!(target: "python_embed", "{}", message),
                "warn" => warn!(target: "python_embed", "{}", message),
                "error" => error!(target: "python_embed", "{}", message),
                _ => debug!(target: "python_embed", "{}", message),
            },
            Err(_) => {
                // Not JSON, might be a raw log line
                debug!(target: "python_embed", "Non-JSON output: {}", line);
            }
        }
    }

    let _ = stderr_thread.join();
    let status = child
        .wait()
        .map_err(|e| BrbError::PythonError(format!("Failed to wait for Python process: {}", e)))?;

    if !status.success() {
        let error = error_message.unwrap_or_else(|| format!("Python process exited with code: {:?}", status.code()));
        return Err(BrbError::PythonError(error));
    }

    final_result.ok_or_else(|| {
        BrbError::PythonError(error_message.unwrap_or_else(|| "No result from Python script".to_string()))
    })
}

/// Response from the embed_query.py script
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum EmbedQueryResponse {
    /// Successful embedding
    Embedding { vector: Vec<f32>, dims: usize },
    /// Error during embedding
    Error { message: String },
}

/// Embed a single query string using the Python embed_query.py script.
///
/// Spawns a one-shot Python subprocess that loads the ModernBERT embedding model,
/// embeds the query with the "search_query: " prefix, and returns a 768-dim vector.
///
/// This is a blocking call (~2-5s on first run due to model loading).
/// For repeated embeddings, prefer using the inference daemon's embed_query command
/// via `MLXPythonEngine::embed_query()`.
///
/// # Arguments
/// * `query` - The search query text to embed
///
/// # Returns
/// A 768-dimensional embedding vector
pub fn embed_query(query: &str) -> Result<Vec<f32>> {
    let env = PythonEnvironment::get()?;
    let python = &env.python_bin;
    let script = env.script(scripts::EMBED_QUERY);

    info!(
        ?python,
        ?script,
        query_len = query.len(),
        "Embedding query via Python subprocess"
    );

    let mut child = Command::new(python)
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| BrbError::PythonError(format!("Failed to spawn embed_query.py: {}", e)))?;

    // Write query text to stdin
    {
        use std::io::Write;
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| BrbError::PythonError("Failed to open stdin".to_string()))?;
        writeln!(stdin, "{}", query)
            .map_err(|e| BrbError::PythonError(format!("Failed to write query to stdin: {}", e)))?;
    }
    // Drop stdin to signal EOF
    drop(child.stdin.take());

    // Read stderr in background thread
    let stderr = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(|r| r.ok()) {
                debug!(target: "python_embed_query", "{}", line);
            }
        }
    });

    // Read stdout for JSON response
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| BrbError::PythonError("Failed to capture stdout".to_string()))?;
    let reader = BufReader::new(stdout);
    let mut result: Option<Vec<f32>> = None;
    let mut error_msg: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|e| BrbError::PythonError(format!("Failed to read stdout: {}", e)))?;
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<EmbedQueryResponse>(&line) {
            Ok(EmbedQueryResponse::Embedding { vector, dims }) => {
                info!(dims, "Query embedding generated successfully");
                result = Some(vector);
            }
            Ok(EmbedQueryResponse::Error { message }) => {
                error!(error = %message, "embed_query.py returned error");
                error_msg = Some(message);
            }
            Err(_) => {
                debug!(target: "python_embed_query", "Non-JSON output: {}", line);
            }
        }
    }

    let _ = stderr_thread.join();
    let status = child
        .wait()
        .map_err(|e| BrbError::PythonError(format!("Failed to wait for embed_query.py: {}", e)))?;

    if !status.success() && result.is_none() {
        let error = error_msg.unwrap_or_else(|| format!("embed_query.py exited with code: {:?}", status.code()));
        return Err(BrbError::PythonError(error));
    }

    result.ok_or_else(|| {
        BrbError::PythonError(error_msg.unwrap_or_else(|| "No embedding returned from embed_query.py".to_string()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(start: Option<&str>, end: Option<&str>, min: Option<u32>) -> IngestionSettings {
        IngestionSettings {
            start_date: start.map(String::from),
            end_date: end.map(String::from),
            min_messages_per_contact: min,
            analytics: None,
        }
    }

    #[test]
    fn no_settings_means_no_filter_args() {
        assert!(filter_args(None).is_empty());
        assert!(filter_args(Some(&settings(None, None, None))).is_empty());
    }

    #[test]
    fn all_three_settings_become_args() {
        assert_eq!(
            filter_args(Some(&settings(Some("2024-01-01"), Some("2024-12-31"), Some(50)))),
            vec![
                "--start-date",
                "2024-01-01",
                "--end-date",
                "2024-12-31",
                "--min-messages-per-contact",
                "50",
            ]
        );
    }

    #[test]
    fn empty_dates_and_zero_minimum_are_treated_as_absent() {
        assert!(filter_args(Some(&settings(Some(""), Some(""), Some(0)))).is_empty());
    }

    #[test]
    fn each_setting_is_independent() {
        assert_eq!(
            filter_args(Some(&settings(Some("2024-01-01"), None, None))),
            vec!["--start-date", "2024-01-01"]
        );
        assert_eq!(
            filter_args(Some(&settings(None, None, Some(1)))),
            vec!["--min-messages-per-contact", "1"]
        );
    }
}

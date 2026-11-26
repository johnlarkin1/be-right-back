/// Path helpers for ~/.be-right-back directory structure
use crate::{BrbError, Result};
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use tracing::info;

// Directory structure constants
pub const APP_DATA_DIR: &str = ".be-right-back";
pub const RAW_DATA_DIR: &str = "data/raw";
pub const PROCESSED_DATA_DIR: &str = "data/processed";
pub const STATS_DATA_DIR: &str = "data/stats";
pub const DB_DATA_DIR: &str = "data/db";
pub const BASE_MODELS_DIR: &str = "models/base";
pub const PERSONAS_DIR: &str = "models/personas";
pub const RUN_DIR: &str = "run";

// Database filenames (live in DB_DATA_DIR)
pub const BRB_SQLITE_DB_FILENAME: &str = "brb.db";
pub const BRB_DUCKDB_FILENAME: &str = "brb.duckdb";

pub fn get_brb_dir() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| BrbError::NotFound("Home directory not found".to_string()))?;
    Ok(home.join(APP_DATA_DIR))
}

/// Get the log directory (~/.be-right-back/logs)
///
/// The desktop app is launched from Finder, where stdout goes nowhere, so this is the only
/// place a user can retrieve diagnostics from.
pub fn get_log_dir() -> Result<PathBuf> {
    let log_dir = get_brb_dir()?.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    Ok(log_dir)
}

/// Get the database directory (~/.be-right-back/data/db)
/// Contains brb.db (SQLite metadata) and brb.duckdb (vector embeddings)
pub fn get_db_dir() -> Result<PathBuf> {
    let db_dir = get_brb_dir()?.join(DB_DATA_DIR);
    std::fs::create_dir_all(&db_dir)?;
    Ok(db_dir)
}

/// Get the path to the SQLite metadata database (~/.be-right-back/data/db/brb.db).
///
/// This is the single source of truth for the brb.db location — always use it
/// rather than joining "brb.db" onto a directory yourself. A stray
/// `get_brb_dir().join("brb.db")` (app root instead of the db dir) once pointed
/// at a nonexistent path that `rusqlite::Connection::open` silently created as an
/// empty file, making every contact-name lookup miss. Centralizing the path here
/// keeps that from happening again.
pub fn get_brb_sqlite_db() -> Result<PathBuf> {
    Ok(get_db_dir()?.join(BRB_SQLITE_DB_FILENAME))
}

/// Get the path to the DuckDB vector database (~/.be-right-back/data/db/brb.duckdb).
///
/// Single source of truth for the brb.duckdb location — see [`get_brb_sqlite_db`]
/// for why we centralize these paths rather than hand-joining the filename.
pub fn get_brb_duckdb_db() -> Result<PathBuf> {
    Ok(get_db_dir()?.join(BRB_DUCKDB_FILENAME))
}

pub fn get_processed_data_dir() -> Result<PathBuf> {
    let processed_dir = get_brb_dir()?.join(PROCESSED_DATA_DIR);
    std::fs::create_dir_all(&processed_dir)?;
    Ok(processed_dir)
}

pub fn get_raw_data_dir() -> Result<PathBuf> {
    let raw_dir = get_brb_dir()?.join(RAW_DATA_DIR);
    std::fs::create_dir_all(&raw_dir)?;
    Ok(raw_dir)
}

pub fn get_stats_data_dir() -> Result<PathBuf> {
    let stats_dir = get_brb_dir()?.join(STATS_DATA_DIR);
    std::fs::create_dir_all(&stats_dir)?;
    Ok(stats_dir)
}

/// Get the directory for a specific contact's stats.
pub fn get_stats_contact_dir(contact_id: &str) -> Result<PathBuf> {
    let sanitized = sanitize_contact_id_for_filename(contact_id);
    let contact_stats_dir = get_stats_data_dir()?.join(&sanitized);
    std::fs::create_dir_all(&contact_stats_dir)?;
    Ok(contact_stats_dir)
}

/// Get the directory for base models.
pub fn get_base_models_dir() -> Result<PathBuf> {
    let models_dir = get_brb_dir()?.join(BASE_MODELS_DIR);
    std::fs::create_dir_all(&models_dir)?;
    Ok(models_dir)
}

/// Get the directory containing all trained personas.
pub fn get_personas_dir() -> Result<PathBuf> {
    let personas_dir = get_brb_dir()?.join(PERSONAS_DIR);
    std::fs::create_dir_all(&personas_dir)?;
    Ok(personas_dir)
}

/// Get the directory for a specific persona.
pub fn get_persona_dir(contact_id: &str) -> Result<PathBuf> {
    let sanitized = sanitize_contact_id_for_filename(contact_id);
    let persona_dir = get_personas_dir()?.join(&sanitized);
    std::fs::create_dir_all(&persona_dir)?;
    Ok(persona_dir)
}

/// Generate a safe filename from a contact ID
/// For phone numbers: strips leading '+' and keeps digits
/// For emails: replaces '@' and '.' with underscores
pub fn sanitize_contact_id_for_filename(contact_id: &str) -> String {
    // Strip leading '+' for phone numbers
    let normalized = contact_id.strip_prefix('+').unwrap_or(contact_id);

    // Replace special characters with underscores
    normalized
        .chars()
        .map(|c| match c {
            '@' | '.' => '_',
            c if c.is_alphanumeric() => c,
            _ => '_',
        })
        .collect()
}

/// Get the daemon run directory (~/.be-right-back/run/)
///
/// Contains socket files and PID files for long-running daemon processes.
pub fn get_daemon_run_dir() -> Result<PathBuf> {
    let run_dir = get_brb_dir()?.join(RUN_DIR);
    std::fs::create_dir_all(&run_dir)?;
    Ok(run_dir)
}

/// Get the Unix domain socket path for a daemon role.
///
/// Returns `~/.be-right-back/run/daemon-{role}.sock`
pub fn get_daemon_socket_path(role: &str) -> Result<PathBuf> {
    Ok(get_daemon_run_dir()?.join(format!("daemon-{role}.sock")))
}

/// Get the PID file path for a daemon role.
///
/// Returns `~/.be-right-back/run/daemon-{role}.pid`
pub fn get_daemon_pid_path(role: &str) -> Result<PathBuf> {
    Ok(get_daemon_run_dir()?.join(format!("daemon-{role}.pid")))
}

/// Get the stderr log path for a daemon role.
///
/// Returns `~/.be-right-back/run/daemon-{role}.log`
pub fn get_daemon_log_path(role: &str) -> Result<PathBuf> {
    Ok(get_daemon_run_dir()?.join(format!("daemon-{role}.log")))
}

/// Write any serializable data structure to a JSON file with pretty formatting
pub fn write_json_file<T: serde::Serialize>(path: &PathBuf, data: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(data)?;
    let mut file = File::create(path)?;
    file.write_all(json.as_bytes())?;
    file.flush()?;

    info!(?path, "Wrote JSON file");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_contact_id() {
        assert_eq!(sanitize_contact_id_for_filename("+1234567890"), "1234567890");
        assert_eq!(sanitize_contact_id_for_filename("+15555550104"), "15555550104");
        assert_eq!(
            sanitize_contact_id_for_filename("alice@example.com"),
            "alice_example_com"
        );
    }
}

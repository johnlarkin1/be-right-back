/// Database snapshot functionality for safe iMessage data extraction
use common::{
    ADDRESSBOOK_DB_PATH, ADDRESSBOOK_SNAPSHOT_FILENAME, BrbError, CHAT_SNAPSHOT_FILENAME, MAX_SNAPSHOTS,
    MESSAGES_DB_PATH, Result, get_raw_data_dir,
};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

/// Create a snapshot of the Messages database and AddressBook
///
/// This creates a timestamped directory in ~/.be-right-back/data/raw/ containing:
/// - chat_snapshot.db (and associated WAL/SHM files)
/// - addressbook_snapshot.db (if available)
///
/// Working with snapshots is safer than directly querying live databases.
///
/// Returns the path to the snapshot directory.
pub fn create_snapshot() -> Result<PathBuf> {
    let snapshot_dir = get_snapshot_path()?;

    info!(?snapshot_dir, "Creating snapshot directory");
    fs::create_dir_all(&snapshot_dir)?;

    copy_messages_snapshot(&snapshot_dir)?;
    if let Err(e) = copy_addressbook_snapshot(&snapshot_dir) {
        warn!(error = ?e, "Failed to copy AddressBook snapshot, continuing without it");
    }

    info!("Snapshot created successfully");

    // TODO:@larkin - probably should remove this, but worried about application taking too much space after a while
    cleanup_old_snapshots()?;
    Ok(snapshot_dir)
}

/// Copy the Messages database to the snapshot directory
fn copy_messages_snapshot(snapshot_dir: &Path) -> Result<()> {
    let source = get_messages_db_path()?;
    let snapshot_path = snapshot_dir.join(CHAT_SNAPSHOT_FILENAME);

    info!(?source, ?snapshot_path, "Copying Messages database");
    fs::copy(&source, &snapshot_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            BrbError::PermissionDenied(
                "Cannot access Messages database. Please grant Full Disk Access:\n\
                 System Settings > Privacy & Security > Full Disk Access\n\
                 Add your terminal application (Terminal.app, iTerm, etc.) to the list."
                    .to_string(),
            )
        } else {
            BrbError::Io(e)
        }
    })?;

    // copy the wal file if it exists
    let wal_source = source.with_extension("db-wal");
    if wal_source.exists() {
        let wal_dest = snapshot_path.with_extension("db-wal");
        let _ = fs::copy(&wal_source, &wal_dest); // errors are ok
    }

    // copy the shm file if it exists
    let shm_source = source.with_extension("db-shm");
    if shm_source.exists() {
        let shm_dest = snapshot_path.with_extension("db-shm");
        let _ = fs::copy(&shm_source, &shm_dest); // errors are ok
    }

    Ok(())
}

/// Get the path to the Messages database
fn get_messages_db_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| BrbError::NotFound("Home directory not found".to_string()))?;

    Ok(home.join(MESSAGES_DB_PATH))
}

/// Open the **live** Messages database (not a snapshot) read-only.
///
/// `immutable=1` reads without taking a lock, so this never contends with
/// Messages.app. Only use it for small, read-only queries.
fn open_live_messages_db() -> Result<rusqlite::Connection> {
    let source = get_messages_db_path()?;
    if !source.exists() {
        return Err(BrbError::NotFound(format!(
            "Messages database not found at {}",
            source.display()
        )));
    }

    let uri = format!("file:{}?immutable=1", source.to_string_lossy());
    rusqlite::Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| {
        BrbError::PermissionDenied(format!(
            "Cannot open the Messages database ({e}). Grant Full Disk Access in \
             System Settings > Privacy & Security > Full Disk Access."
        ))
    })
}

/// Query the `(earliest, latest)` message timestamps from an open chat database.
///
/// Filters on `date > 0` only. Messages with no text still carry a date, and
/// `MIN`/`MAX` over the indexed `date` column stays cheap on a large live DB.
///
/// Returns `None` when the database has no dated messages.
fn query_message_date_range(conn: &rusqlite::Connection) -> Result<Option<(i64, i64)>> {
    conn.query_row("SELECT MIN(date), MAX(date) FROM message WHERE date > 0", [], |row| {
        Ok(row.get::<_, Option<i64>>(0)?.zip(row.get::<_, Option<i64>>(1)?))
    })
    .map_err(BrbError::DatabaseSqliteError)
}

/// Query the message date range directly from the **live** Messages database.
///
/// Returns the raw Apple/Cocoa-epoch `(earliest, latest)` timestamps, or `None`
/// when the database has no dated messages.
pub fn live_message_date_range() -> Result<Option<(i64, i64)>> {
    query_message_date_range(&open_live_messages_db()?)
}

/// Query the latest message timestamp from the **live** Messages database, to
/// detect whether the ingested index is stale.
///
/// Returns the raw Apple/Cocoa-epoch timestamp, or `None` when the database has
/// no dated messages.
pub fn latest_live_message_date() -> Result<Option<i64>> {
    Ok(live_message_date_range()?.map(|(_, latest)| latest))
}

/// Get the path where we'll store the snapshot directory
fn get_snapshot_path() -> Result<PathBuf> {
    let raw_dir = get_raw_data_dir()?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    Ok(raw_dir.join(timestamp.to_string()))
}

/// Find the AddressBook database file with the highest version number
fn find_addressbook_file() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| BrbError::NotFound("Home directory not found".to_string()))?;

    let addressbook_dir = home.join(ADDRESSBOOK_DB_PATH);
    if !addressbook_dir.exists() {
        return Err(BrbError::NotFound("AddressBook directory not found".to_string()));
    }

    let mut candidates: Vec<(PathBuf, i32, std::time::SystemTime)> = Vec::new();
    for entry in fs::read_dir(&addressbook_dir)? {
        let entry = entry?;
        let path = entry.path();

        if let Some(filename) = path.file_name().and_then(|n| n.to_str())
            && filename.starts_with("AddressBook-v")
            && filename.ends_with(".abcddb")
        {
            let version_str = filename.trim_start_matches("AddressBook-v").trim_end_matches(".abcddb");
            if let Ok(version) = version_str.parse::<i32>() {
                let metadata = fs::metadata(&path)?;
                let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);

                debug!(path = ?path, version, "Found AddressBook file");
                candidates.push((path, version, modified));
            }
        }
    }

    if candidates.is_empty() {
        return Err(BrbError::NotFound("No AddressBook database files found".to_string()));
    }

    // names have the timestamp so sorting by version and then by modification time will give us the latest version
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2)));

    let selected = &candidates[0];
    info!(path = ?selected.0, version = selected.1, "Selected AddressBook file");

    Ok(selected.0.clone())
}

/// Copy the AddressBook database to the snapshot directory
fn copy_addressbook_snapshot(snapshot_dir: &Path) -> Result<()> {
    let source = find_addressbook_file()?;
    let snapshot_path = snapshot_dir.join(ADDRESSBOOK_SNAPSHOT_FILENAME);

    info!(?source, ?snapshot_path, "Copying AddressBook database");

    fs::copy(&source, &snapshot_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            BrbError::PermissionDenied(
                "Cannot access AddressBook database. Please grant Full Disk Access:\n\
                 System Settings > Privacy & Security > Full Disk Access\n\
                 Add your terminal application (Terminal.app, iTerm, etc.) to the list."
                    .to_string(),
            )
        } else {
            BrbError::Io(e)
        }
    })?;

    // copy the wal file if it exists
    let wal_source = source.with_extension("abcddb-wal");
    if wal_source.exists() {
        let wal_dest = snapshot_path.with_extension("db-wal");
        let _ = fs::copy(&wal_source, &wal_dest);
    }

    // copy the shm file if it exists
    let shm_source = source.with_extension("abcddb-shm");
    if shm_source.exists() {
        let shm_dest = snapshot_path.with_extension("db-shm");
        let _ = fs::copy(&shm_source, &shm_dest);
    }

    Ok(())
}

/// Get all snapshot directories sorted by timestamp (newest first)
fn get_all_snapshots() -> Result<Vec<PathBuf>> {
    let raw_dir = get_raw_data_dir()?;

    let mut snapshots: Vec<PathBuf> = fs::read_dir(&raw_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| {
                        // Check if it matches timestamp pattern (8 digits, underscore, 6 digits)
                        n.len() == 15
                            && n.chars().take(8).all(|c| c.is_ascii_digit())
                            && n.chars().nth(8) == Some('_')
                            && n.chars().skip(9).all(|c| c.is_ascii_digit())
                    })
                    .unwrap_or(false)
        })
        .collect();

    // dir name is timestamp so fine to sort by name in descending order
    snapshots.sort_by(|a, b| b.cmp(a));
    Ok(snapshots)
}

pub fn get_latest_snapshot() -> Result<Option<PathBuf>> {
    let snapshots = get_all_snapshots()?;
    Ok(snapshots.first().cloned())
}

pub fn get_or_create_snapshot() -> Result<PathBuf> {
    match get_latest_snapshot()? {
        Some(path) => Ok(path),
        None => create_snapshot(),
    }
}

fn cleanup_old_snapshots() -> Result<()> {
    let snapshots = get_all_snapshots()?;
    if snapshots.len() > MAX_SNAPSHOTS {
        let to_delete = &snapshots[MAX_SNAPSHOTS..];
        for snapshot_dir in to_delete {
            info!(?snapshot_dir, "Removing old snapshot directory");

            if let Err(e) = fs::remove_dir_all(snapshot_dir) {
                warn!(?snapshot_dir, error = ?e, "Failed to remove old snapshot directory");
            }
        }
    }

    Ok(())
}

/// Open the Messages database snapshot
///
/// Accepts either a snapshot directory path or a direct path to chat_snapshot.db
pub fn open_chat_snapshot(snapshot_path: &Path) -> Result<rusqlite::Connection> {
    let db_path = if snapshot_path.is_dir() {
        snapshot_path.join(CHAT_SNAPSHOT_FILENAME)
    } else {
        snapshot_path.to_path_buf()
    };

    if !db_path.exists() {
        return Err(BrbError::NotFound(format!(
            "Messages snapshot not found: {:?}",
            db_path
        )));
    }

    Ok(rusqlite::Connection::open(&db_path)?)
}

/// Open the AddressBook database snapshot
///
/// Accepts a snapshot directory path
pub fn open_addressbook_snapshot(snapshot_dir: &Path) -> Result<rusqlite::Connection> {
    let db_path = snapshot_dir.join(ADDRESSBOOK_SNAPSHOT_FILENAME);
    if !db_path.exists() {
        return Err(BrbError::NotFound(format!(
            "AddressBook snapshot not found: {:?}",
            db_path
        )));
    }

    Ok(rusqlite::Connection::open(&db_path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_snapshot_path() {
        let path = get_snapshot_path().unwrap();
        let path_str = path.to_str().unwrap();

        // Should be a directory path with timestamp pattern
        assert!(path_str.contains("data/raw/"));

        // Check timestamp pattern (YYYYMMDD_HHMMSS)
        let dir_name = path.file_name().unwrap().to_str().unwrap();
        assert_eq!(dir_name.len(), 15); // YYYYMMDD_HHMMSS = 15 chars
        assert!(dir_name.chars().take(8).all(|c| c.is_ascii_digit()));
        assert_eq!(dir_name.chars().nth(8), Some('_'));
        assert!(dir_name.chars().skip(9).all(|c| c.is_ascii_digit()));
    }

    /// In-memory stand-in for the live `message` table.
    fn message_table(dates: &[i64]) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE message (date INTEGER, text TEXT, attributedBody BLOB)",
            [],
        )
        .unwrap();
        for date in dates {
            conn.execute("INSERT INTO message (date) VALUES (?1)", [date]).unwrap();
        }
        conn
    }

    #[test]
    fn test_query_message_date_range_ignores_undated_rows() {
        // Mixed seconds and nanosecond timestamps, plus the date = 0 rows Apple
        // writes for some system messages.
        let conn = message_table(&[0, 700_000_000, 0, 780_000_000_000_000_000]);

        let (earliest, latest) = query_message_date_range(&conn).unwrap().unwrap();
        assert_eq!(earliest, 700_000_000);
        assert_eq!(latest, 780_000_000_000_000_000);

        // Rows with no text still count: they carry a real date.
        assert_eq!(
            common::cocoa_to_unix(earliest),
            700_000_000 + common::COCOA_TO_UNIX_OFFSET
        );
        assert_eq!(
            common::cocoa_to_unix(latest),
            780_000_000 + common::COCOA_TO_UNIX_OFFSET
        );
    }

    #[test]
    fn test_query_message_date_range_empty() {
        assert!(query_message_date_range(&message_table(&[])).unwrap().is_none());
        assert!(query_message_date_range(&message_table(&[0])).unwrap().is_none());
    }
}

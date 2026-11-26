//! SQLite storage for room doc state: one encoded v1 update per room.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, params};

/// The table definitions, kept in `apps/collab/schema.sql`. Compiled into the binary.
const SCHEMA: &str = include_str!("../schema.sql");

pub struct Store(Mutex<Connection>);

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn load(&self, room: &str) -> Result<Option<Vec<u8>>> {
        let conn = self.0.lock().unwrap();
        let state = conn
            .query_row("SELECT state FROM rooms WHERE name = ?1", [room], |r| r.get(0))
            .optional()?;
        Ok(state)
    }

    /// Rows in the `rooms` table.
    pub fn count(&self) -> Result<usize> {
        let conn = self.0.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM rooms", [], |r| r.get(0))?;
        Ok(n as usize)
    }

    /// Deletes `game-<id>` rows not saved within `ttl`. Returns how many it deleted.
    pub fn prune(&self, ttl: Duration) -> Result<usize> {
        let cutoff = unix_now()? - ttl.as_secs() as i64;
        let conn = self.0.lock().unwrap();
        Ok(conn.execute(
            "DELETE FROM rooms WHERE name LIKE 'game-%' AND updated_at < ?1",
            params![cutoff],
        )?)
    }

    pub fn save(&self, room: &str, state: &[u8]) -> Result<()> {
        let now = unix_now()?;
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO rooms (name, state, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
            params![room, state, now],
        )?;
        Ok(())
    }
}

fn unix_now() -> Result<i64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64)
}

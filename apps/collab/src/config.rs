//! Runtime settings, read from `COLLAB_*` environment variables.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use anyhow::{Context, Result};

/// Origins allowed when `COLLAB_ALLOWED_ORIGINS` is unset.
pub const DEFAULT_ORIGINS: &str = "https://berightback.xyz,https://www.berightback.xyz,http://localhost:3000,https://be-right-back-*-johnlarkin1s-projects.vercel.app";

#[derive(Debug, Clone)]
pub struct Config {
    pub addr: SocketAddr,
    pub db_path: PathBuf,
    pub allowed_origins: Vec<String>,
    pub disabled: bool,
    pub max_message_bytes: usize,
    pub rate_per_sec: f64,
    pub rate_burst: f64,
    pub max_sockets_per_room: usize,
    pub max_sockets: usize,
    pub max_rooms: usize,
    pub ping_interval: Duration,
    pub idle_timeout: Duration,
    pub persist_debounce: Duration,
    /// Longest a dirty room waits for a save while edits keep arriving.
    pub persist_max_wait: Duration,
    pub room_grace: Duration,
    /// Largest doc a saved room may hold. An edit past it closes the socket.
    pub max_doc_bytes: usize,
    /// Most rows in the `rooms` table. Past it, new saved rooms get 503.
    pub max_stored_rooms: usize,
    /// The server deletes `game-<id>` rows not saved for this long.
    pub stored_room_ttl: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            addr: SocketAddr::from(([0, 0, 0, 0], 8787)),
            db_path: PathBuf::from("./collab.db"),
            allowed_origins: split_list(DEFAULT_ORIGINS),
            disabled: false,
            max_message_bytes: 64 * 1024,
            rate_per_sec: 30.0,
            rate_burst: 60.0,
            max_sockets_per_room: 100,
            max_sockets: 1000,
            max_rooms: 200,
            ping_interval: Duration::from_secs(20),
            idle_timeout: Duration::from_secs(60),
            persist_debounce: Duration::from_secs(2),
            persist_max_wait: Duration::from_secs(10),
            room_grace: Duration::from_secs(30),
            max_doc_bytes: 1024 * 1024,
            max_stored_rooms: 500,
            stored_room_ttl: Duration::from_secs(30 * 24 * 60 * 60),
        }
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let d = Self::default();
        Ok(Self {
            addr: var("COLLAB_ADDR", d.addr)?,
            db_path: var("COLLAB_DB_PATH", d.db_path)?,
            allowed_origins: env::var("COLLAB_ALLOWED_ORIGINS")
                .map(|v| split_list(&v))
                .unwrap_or(d.allowed_origins),
            disabled: env::var("COLLAB_DISABLED").is_ok_and(|v| v == "1" || v == "true"),
            max_message_bytes: var("COLLAB_MAX_MESSAGE_BYTES", d.max_message_bytes)?,
            rate_per_sec: var("COLLAB_RATE_PER_SEC", d.rate_per_sec)?,
            rate_burst: var("COLLAB_RATE_BURST", d.rate_burst)?,
            max_sockets_per_room: var("COLLAB_MAX_SOCKETS_PER_ROOM", d.max_sockets_per_room)?,
            max_sockets: var("COLLAB_MAX_SOCKETS", d.max_sockets)?,
            max_rooms: var("COLLAB_MAX_ROOMS", d.max_rooms)?,
            ping_interval: secs("COLLAB_PING_SECS", d.ping_interval)?,
            idle_timeout: secs("COLLAB_IDLE_SECS", d.idle_timeout)?,
            persist_debounce: Duration::from_millis(var(
                "COLLAB_PERSIST_DEBOUNCE_MS",
                d.persist_debounce.as_millis() as u64,
            )?),
            persist_max_wait: secs("COLLAB_PERSIST_MAX_WAIT_SECS", d.persist_max_wait)?,
            room_grace: secs("COLLAB_ROOM_GRACE_SECS", d.room_grace)?,
            max_doc_bytes: var("COLLAB_MAX_DOC_BYTES", d.max_doc_bytes)?,
            max_stored_rooms: var("COLLAB_MAX_STORED_ROOMS", d.max_stored_rooms)?,
            stored_room_ttl: Duration::from_secs(
                var("COLLAB_STORED_ROOM_TTL_DAYS", d.stored_room_ttl.as_secs() / 86_400)? * 86_400,
            ),
        })
    }

    /// Checks an `Origin` header against the allow list.
    ///
    /// A pattern is an exact origin, `*` (any origin), or an origin with one `*`.
    /// The `*` matches one or more of `[a-z0-9-]`, so it never spans a dot or a slash.
    pub fn origin_allowed(&self, origin: &str) -> bool {
        self.allowed_origins.iter().any(|p| pattern_matches(p, origin))
    }
}

fn pattern_matches(pattern: &str, origin: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let Some((prefix, suffix)) = pattern.split_once('*') else {
        return pattern == origin;
    };
    if origin.len() <= prefix.len() + suffix.len() || !origin.starts_with(prefix) || !origin.ends_with(suffix) {
        return false;
    }
    origin[prefix.len()..origin.len() - suffix.len()]
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn split_list(v: &str) -> Vec<String> {
    v.split(',')
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn var<T: FromStr>(name: &str, default: T) -> Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(name) {
        Ok(v) => v.parse().with_context(|| format!("invalid {name}={v}")),
        Err(_) => Ok(default),
    }
}

fn secs(name: &str, default: Duration) -> Result<Duration> {
    Ok(Duration::from_secs(var(name, default.as_secs())?))
}

#[cfg(test)]
mod tests {
    use super::pattern_matches;

    #[test]
    fn wildcard_stays_inside_one_label() {
        let p = "https://be-right-back-*-johnlarkin1s-projects.vercel.app";
        assert!(pattern_matches(
            p,
            "https://be-right-back-git-claude-project-t-0a97fb-johnlarkin1s-projects.vercel.app"
        ));
        // Anyone can name a Vercel project be-right-back-<x>. The team suffix keeps them out.
        assert!(!pattern_matches(p, "https://be-right-back-evil.vercel.app"));
        assert!(!pattern_matches(
            p,
            "https://be-right-back--johnlarkin1s-projects.vercel.app"
        ));
        assert!(!pattern_matches(
            p,
            "https://be-right-back-x.evil.com/-johnlarkin1s-projects.vercel.app"
        ));
        assert!(!pattern_matches(
            p,
            "https://be-right-back-a.b-johnlarkin1s-projects.vercel.app"
        ));
        assert!(!pattern_matches(
            p,
            "http://be-right-back-a-johnlarkin1s-projects.vercel.app"
        ));
        assert!(pattern_matches("http://localhost:3000", "http://localhost:3000"));
        assert!(!pattern_matches("http://localhost:3000", "http://localhost:30000"));
    }
}

//! Write-lock handshake between the app and a Python child that writes brb.duckdb.
//!
//! The app keeps a read-only connection to brb.duckdb open, and DuckDB refuses a
//! writer while any reader holds the file. A Python child that writes only at the
//! end of a long job (analytics) asks the app for the lock around that write:
//!
//! ```text
//! Python stdout: {"type": "write_lock", "action": "acquire"}
//! Rust stdin:    ok                  (or "error: <reason>")
//! ...Python opens read-write, writes, closes...
//! Python stdout: {"type": "write_lock", "action": "release"}
//! Rust stdin:    ok
//! ```
//!
//! The app reads brb.duckdb normally for the rest of the job. Rust sets
//! [`HANDSHAKE_ENV`] on the child; without it, Python skips the handshake.

use crate::vectordb::{WriteLease, acquire_write_lease};
use serde::Deserialize;
use tracing::{info, warn};

/// Environment variable that tells a Python child to use the handshake.
pub const HANDSHAKE_ENV: &str = "BRB_WRITE_LOCK_HANDSHAKE";

#[derive(Deserialize)]
struct Request {
    #[serde(rename = "type")]
    kind: String,
    action: String,
}

/// Grants write-lock requests from one Python child.
///
/// Drop the broker when the child exits. Dropping it releases a lease the child
/// never released, for example after a crash.
#[derive(Default)]
pub struct WriteLockBroker {
    lease: Option<WriteLease>,
}

impl WriteLockBroker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Handle one stdout line from the child.
    ///
    /// Returns the reply line to write to the child's stdin when `line` is a
    /// write-lock request, or `None` for any other line. An acquire can block for
    /// up to 30 s while in-flight reads finish.
    pub fn handle(&mut self, line: &str) -> Option<String> {
        let request: Request = serde_json::from_str(line).ok()?;
        if request.kind != "write_lock" {
            return None;
        }
        let reply = match request.action.as_str() {
            "acquire" if self.lease.is_some() => "ok".to_string(),
            "acquire" => match acquire_write_lease() {
                Ok(lease) => {
                    info!("Granted brb.duckdb write lock to Python child");
                    self.lease = Some(lease);
                    "ok".to_string()
                }
                Err(e) => {
                    warn!(error = %e, "Could not grant brb.duckdb write lock");
                    format!("error: {e}")
                }
            },
            "release" => {
                if self.lease.take().is_some() {
                    info!("Python child released brb.duckdb write lock");
                }
                "ok".to_string()
            }
            other => format!("error: unknown write_lock action {other:?}"),
        };
        Some(reply)
    }

    /// Whether the child holds the lock now.
    pub fn is_held(&self) -> bool {
        self.lease.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_other_lines() {
        let mut broker = WriteLockBroker::new();
        assert_eq!(broker.handle("not json"), None);
        assert_eq!(broker.handle(r#"{"type":"log","level":"info","message":"x"}"#), None);
        assert!(!broker.is_held());
    }

    #[test]
    fn rejects_unknown_action() {
        let mut broker = WriteLockBroker::new();
        let reply = broker.handle(r#"{"type":"write_lock","action":"steal"}"#);
        assert!(reply.unwrap().starts_with("error:"));
        assert!(!broker.is_held());
    }

    #[test]
    fn release_without_acquire_is_ok() {
        let mut broker = WriteLockBroker::new();
        assert_eq!(
            broker.handle(r#"{"type":"write_lock","action":"release"}"#).as_deref(),
            Some("ok")
        );
    }
}

//! Cross-encoder reranking via Python subprocess.
//!
//! Calls the `rerank.py` script to score (query, chunk) pairs using a
//! cross-encoder model. This provides more precise relevance ranking than
//! bi-encoder cosine similarity at the cost of higher latency.
//!
//! The reranker uses `cross-encoder/ms-marco-MiniLM-L-6-v2` (22M params),
//! which typically scores 30 candidates in ~50-150ms on Apple Silicon.
//!
//! # Graceful Degradation
//!
//! If reranking fails for any reason (Python unavailable, model download
//! failure, subprocess error), the function returns the original scores
//! unchanged. This ensures search always returns results.

use common::{PythonEnvironment, scripts};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tracing::{debug, warn};

/// Maximum time to wait for the reranker subprocess before killing it.
///
/// This subprocess path is now only the **cold-start fallback** (the agent and desktop
/// search rerank via the warm inference daemon; this runs only when the daemon is
/// unavailable, plus the CLI). A cold start has to load the cross-encoder before it can
/// score, which we measured at ~5-7s — the old 5s cap killed it mid-load, paying the
/// cost and discarding the result. 30s lets a cold start finish while still preventing
/// an indefinite hang. The warm daemon path uses its own 60s socket read timeout.
const RERANK_TIMEOUT: Duration = Duration::from_secs(30);

/// Input format for the rerank.py script.
#[derive(Debug, Serialize)]
struct RerankRequest {
    query: String,
    candidates: Vec<RerankCandidate>,
}

/// A single candidate for reranking.
#[derive(Debug, Serialize)]
struct RerankCandidate {
    chunk_id: i64,
    text: String,
}

/// Output format from the rerank.py script.
#[derive(Debug, Deserialize)]
struct RerankResponse {
    #[serde(default)]
    scores: Vec<RerankScore>,
    #[serde(default)]
    error: Option<String>,
}

/// A scored candidate from the reranker.
#[derive(Debug, Deserialize)]
pub struct RerankScore {
    pub chunk_id: i64,
    pub score: f32,
}

/// A persistent cross-encoder rerank daemon: one long-lived Python process with
/// the model resident, exchanging newline-delimited JSON over stdin/stdout. A
/// background thread drains stdout into a channel so the caller can wait with a
/// timeout instead of blocking forever on a wedged process.
struct RerankDaemon {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<String>,
}

impl RerankDaemon {
    fn spawn() -> Option<Self> {
        let env = match PythonEnvironment::get() {
            Ok(env) => env,
            Err(e) => {
                warn!(error = %e, "Python environment unavailable, skipping reranking");
                return None;
            }
        };
        let script = env.script(scripts::RERANK);
        if !script.exists() {
            warn!(script = %script.display(), "Rerank script not found, skipping reranking");
            return None;
        }

        let mut child = match Command::new(&env.python_bin)
            .arg(&script)
            .arg("--daemon")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                warn!(error = %e, "Failed to spawn rerank daemon");
                return None;
            }
        };

        let stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;

        // Drain stdout on a background thread so reads can time out cleanly.
        let (tx, responses) = channel::<String>();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        debug!("Spawned cross-encoder rerank daemon");
        Some(RerankDaemon {
            child,
            stdin,
            responses,
        })
    }
}

impl Drop for RerankDaemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Process-wide rerank daemon, lazily spawned on first use and respawned if its
/// pipe breaks. The `Mutex` serializes requests (one request -> one response).
fn daemon_cell() -> &'static Mutex<Option<RerankDaemon>> {
    static CELL: OnceLock<Mutex<Option<RerankDaemon>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

/// Rerank search candidates using a cross-encoder model.
///
/// Sends the query + candidate texts to a persistent Python daemon (model kept
/// resident across calls) and reads back relevance scores. The first call to a
/// freshly spawned daemon pays the cold model-load cost; subsequent calls are
/// warm (~50-150ms).
///
/// # Returns
/// A list of `RerankScore`. If reranking fails for any reason (Python
/// unavailable, daemon crash, timeout), returns `None` so the caller falls back
/// to the original ordering. Best-effort: errors are logged, never propagated.
pub fn rerank_candidates(query: &str, candidates: &[(i64, String)]) -> Option<Vec<RerankScore>> {
    if candidates.is_empty() {
        return Some(vec![]);
    }

    debug!(
        query = query,
        candidates = candidates.len(),
        "Starting cross-encoder reranking via daemon"
    );

    let request = RerankRequest {
        query: query.to_string(),
        candidates: candidates
            .iter()
            .map(|(id, text)| RerankCandidate {
                chunk_id: *id,
                text: text.clone(),
            })
            .collect(),
    };
    let mut request_json = match serde_json::to_string(&request) {
        Ok(json) => json,
        Err(e) => {
            warn!(error = %e, "Failed to serialize rerank request");
            return None;
        }
    };
    request_json.push('\n'); // newline-delimited protocol

    let mut guard = match daemon_cell().lock() {
        Ok(guard) => guard,
        Err(e) => {
            warn!(error = %e, "Rerank daemon mutex poisoned");
            return None;
        }
    };

    // Up to two attempts: if the resident daemon's pipe is broken (process died),
    // drop it and respawn once before giving up.
    for attempt in 0..2 {
        if guard.is_none() {
            *guard = RerankDaemon::spawn();
        }
        let daemon = guard.as_mut()?;

        if let Err(e) = daemon
            .stdin
            .write_all(request_json.as_bytes())
            .and_then(|()| daemon.stdin.flush())
        {
            warn!(error = %e, attempt, "Rerank daemon write failed; respawning");
            *guard = None;
            continue;
        }

        match daemon.responses.recv_timeout(RERANK_TIMEOUT) {
            Ok(line) => {
                let response: RerankResponse = match serde_json::from_str(&line) {
                    Ok(resp) => resp,
                    Err(e) => {
                        warn!(error = %e, line = %line, "Failed to parse rerank response");
                        return None;
                    }
                };
                if let Some(error) = response.error {
                    warn!(error = %error, "Rerank daemon returned error");
                    return None;
                }
                debug!(scores = response.scores.len(), "Cross-encoder reranking complete");
                return Some(response.scores);
            }
            Err(RecvTimeoutError::Timeout) => {
                warn!("Rerank daemon timed out after {:?}, killing", RERANK_TIMEOUT);
                *guard = None; // Drop kills the wedged process.
                return None;
            }
            Err(RecvTimeoutError::Disconnected) => {
                warn!(attempt, "Rerank daemon stdout closed; respawning");
                *guard = None;
                continue;
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rerank_request_serialization() {
        let request = RerankRequest {
            query: "test query".to_string(),
            candidates: vec![
                RerankCandidate {
                    chunk_id: 1,
                    text: "passage one".to_string(),
                },
                RerankCandidate {
                    chunk_id: 2,
                    text: "passage two".to_string(),
                },
            ],
        };

        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("test query"));
        assert!(json.contains("passage one"));
        assert!(json.contains("chunk_id"));
    }

    #[test]
    fn test_rerank_response_deserialization() {
        let json = r#"{"scores": [{"chunk_id": 1, "score": 0.95}, {"chunk_id": 2, "score": 0.12}]}"#;
        let response: RerankResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.scores.len(), 2);
        assert_eq!(response.scores[0].chunk_id, 1);
        assert!((response.scores[0].score - 0.95).abs() < 0.01);
    }

    #[test]
    fn test_rerank_response_with_error() {
        let json = r#"{"error": "model not found", "scores": []}"#;
        let response: RerankResponse = serde_json::from_str(json).unwrap();
        assert!(response.error.is_some());
        assert_eq!(response.error.unwrap(), "model not found");
    }

    #[test]
    fn test_rerank_empty_candidates() {
        let result = rerank_candidates("test", &[]);
        assert!(result.is_some());
        assert!(result.unwrap().is_empty());
    }
}

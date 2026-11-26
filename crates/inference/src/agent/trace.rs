//! Optional, opt-in turn tracing for Casper.
//!
//! When the `CASPER_TRACE_DIR` environment variable is set, every completed agent
//! turn is written there as a JSON file: the question, the resolved date plan, and
//! each tool call with its (cleaned) arguments and full result payload — including
//! the retrieved message snippets — plus the final answer. This is how we capture
//! real, faithfully-shaped traces for the website's `agent-loop` playground and for
//! debugging the live loop.
//!
//! It is OFF by default and a complete no-op when the env var is unset. It writes
//! raw, unredacted message content to disk, so it is strictly a local/dev tool —
//! never wire it into production telemetry.
//!
//! ```sh
//! CASPER_TRACE_DIR=~/.be-right-back/traces npm run tauri dev
//! ```

use std::path::PathBuf;

use ingestion::SearchPlan;
use serde::Serialize;
use serde_json::{Map, Value, json};
use tracing::{info, warn};

use super::AgentResponse;
use super::tools::ToolCallRecord;

/// Directory to write traces to, or `None` if tracing is disabled.
pub fn trace_dir() -> Option<PathBuf> {
    std::env::var_os("CASPER_TRACE_DIR").map(PathBuf::from)
}

/// One ordered event in a turn's loop transcript.
///
/// The flat `tool_calls` list in [`AgentResponse`] can't show *how* the loop got
/// to its answer — it drops per-iteration thinking, the interleaving of calls and
/// results, and every anti-loop guard that fired. These events reconstruct the
/// exact path the loop took, which is what the website's `agent-loop` playground
/// replays. Recorded only when `CASPER_TRACE_DIR` is set (see [`trace_dir`]).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TraceEvent {
    /// The model's `<think>` content for an iteration (empty thinking is skipped).
    Think { iteration: usize, text: String },
    /// A tool call the model emitted (arguments already cleaned of `_`-prefixed plumbing).
    ToolCall {
        iteration: usize,
        tool_name: String,
        arguments: Value,
    },
    /// The result of executing that tool call.
    ToolResponse {
        iteration: usize,
        tool_name: String,
        success: bool,
        duration_ms: u64,
        data: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// An anti-loop guard fired. `reason` is a stable slug
    /// (`duplicate_tool_call` | `narrated_intent` | `empty_response` | `repetitive_text`);
    /// `detail` is human-readable text explaining what tripped it.
    Guard {
        iteration: usize,
        reason: String,
        detail: String,
    },
    /// An answer the model produced. `outcome` is one of:
    /// `final` (clean terminal answer), `forced` (guard forced it from existing
    /// results), `synthesis` (synthesized from tool results / max-iterations pass),
    /// or `narrated` (a narrated-intent "answer" that the loop rejected and nudged past).
    Answer {
        iteration: usize,
        outcome: String,
        text: String,
    },
}

/// Drop agent-injected `_`-prefixed args (e.g. `_embedding`, `_min_date`,
/// `_result_count`) so the recorded call shows what the *model* emitted, not our
/// internal plumbing. Keeps the trace small (the embedding alone is 768 floats)
/// and honest about what the model actually produced.
pub(crate) fn clean_args(args: &Value) -> Value {
    match args {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(k, _)| !k.starts_with('_'))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<Map<String, Value>>(),
        ),
        other => other.clone(),
    }
}

/// A short, filesystem-safe slug from the first few words of the question.
fn slug(question: &str) -> String {
    let words: Vec<String> = question
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .take(6)
        .map(|s| s.to_string())
        .collect();
    if words.is_empty() {
        "turn".to_string()
    } else {
        words.join("-")
    }
}

/// Write one completed turn to `CASPER_TRACE_DIR` as pretty JSON. No-op when the
/// env var is unset; logs and swallows any I/O error (tracing must never break a
/// user's chat).
///
/// `events` is the ordered loop transcript (think → tool_call → tool_response →
/// guard → answer). It is empty when tracing is disabled, in which case only the
/// flat summary fields are meaningful.
pub fn write_turn(question: &str, plan: &SearchPlan, response: &AgentResponse, events: &[TraceEvent]) {
    let Some(dir) = trace_dir() else {
        return;
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        warn!(error = %e, dir = %dir.display(), "CASPER_TRACE_DIR set but trace dir is not writable; skipping");
        return;
    }

    let tool_calls: Vec<Value> = response
        .tool_calls
        .iter()
        .map(|r: &ToolCallRecord| {
            json!({
                "tool_name": r.tool_name,
                "arguments": clean_args(&r.arguments),
                "success": r.result.success,
                "duration_ms": r.duration_ms,
                "data": r.result.data,
                "error": r.result.error,
            })
        })
        .collect();

    let doc = json!({
        "question": question,
        "plan": {
            "min_date": plan.min_date.map(|d| d.format("%Y-%m-%d").to_string()),
            "max_date": plan.max_date.map(|d| d.format("%Y-%m-%d").to_string()),
            "prefer_recent": plan.prefer_recent,
            "is_aggregation": plan.is_aggregation,
            "result_count": plan.result_count,
        },
        "iterations": response.iterations,
        "duration_ms": response.duration_ms,
        "thinking": response.thinking,
        "answer": response.answer,
        "tool_calls": tool_calls,
        "events": events,
    });

    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("{stamp}-{}.json", slug(question)));
    match serde_json::to_string_pretty(&doc) {
        Ok(s) => {
            if let Err(e) = std::fs::write(&path, s) {
                warn!(error = %e, path = %path.display(), "failed to write Casper turn trace");
            } else {
                info!(path = %path.display(), tool_calls = response.tool_calls.len(), "wrote Casper turn trace");
            }
        }
        Err(e) => warn!(error = %e, "failed to serialize Casper turn trace"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `agent-loop` playground converter parses these exact tags and field
    /// names. Lock them so a rename here can't silently break the website demo.
    #[test]
    fn events_serialize_with_stable_tags_and_fields() {
        let events = vec![
            TraceEvent::Think {
                iteration: 1,
                text: "let me search".into(),
            },
            TraceEvent::ToolCall {
                iteration: 1,
                tool_name: "search_messages".into(),
                arguments: json!({ "query": "cabin trip", "contact_id": "Sarah" }),
            },
            TraceEvent::ToolResponse {
                iteration: 1,
                tool_name: "search_messages".into(),
                success: true,
                duration_ms: 42,
                data: json!({ "results": [], "count": 0 }),
                error: None,
            },
            TraceEvent::Guard {
                iteration: 2,
                reason: "narrated_intent".into(),
                detail: "described its plan".into(),
            },
            TraceEvent::Answer {
                iteration: 3,
                outcome: "final".into(),
                text: "done".into(),
            },
        ];

        let v = serde_json::to_value(&events).expect("serialize");
        let arr = v.as_array().unwrap();
        assert_eq!(arr[0]["kind"], "think");
        assert_eq!(arr[1]["kind"], "tool_call");
        assert_eq!(arr[1]["tool_name"], "search_messages");
        assert_eq!(arr[1]["arguments"]["contact_id"], "Sarah");
        assert_eq!(arr[2]["kind"], "tool_response");
        assert_eq!(arr[2]["success"], true);
        assert_eq!(arr[3]["kind"], "guard");
        assert_eq!(arr[3]["reason"], "narrated_intent");
        assert_eq!(arr[4]["kind"], "answer");
        assert_eq!(arr[4]["outcome"], "final");
        // `error: None` must be omitted, not serialized as null.
        assert!(arr[2].get("error").is_none());
    }

    /// `clean_args` strips agent-injected `_`-prefixed plumbing but keeps the
    /// arguments the model actually emitted.
    #[test]
    fn clean_args_drops_underscore_prefixed() {
        let cleaned = clean_args(&json!({
            "query": "cabin trip",
            "_embedding": [0.1, 0.2],
            "_min_date": "2025-01-01",
        }));
        assert_eq!(cleaned, json!({ "query": "cabin trip" }));
    }
}

//! Get topic clusters tool for Casper agent.

use duckdb::params_from_iter;
use serde_json::Value;
use tracing::{debug, warn};

use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::VectorDb;
use ingestion::queries::{build_cluster_examples_query, build_cluster_summary_query};

/// Maximum clusters returned in one call. The live corpus has tens of clusters,
/// so this is generous; the cap exists so a bad `limit` from the model can't turn
/// into an unbounded scan or a payload that eats the context window.
const MAX_CLUSTERS: i64 = 50;

/// How many of the top clusters get example previews attached. Each one costs an
/// extra DuckDB round-trip, so the count is bounded independently of `limit`.
const CLUSTERS_WITH_EXAMPLES: usize = 5;

/// Example previews fetched per cluster.
const EXAMPLES_PER_CLUSTER: usize = 2;

/// Tool for retrieving conversation topic clusters from Leiden analysis.
///
/// Returns the main conversation topics with labels, message counts,
/// date ranges, and example messages. Topics are derived from the
/// Leiden + UMAP clustering pipeline run during ingestion.
pub struct GetTopicClustersTool;

impl Tool for GetTopicClustersTool {
    fn name(&self) -> &'static str {
        "get_topic_clusters"
    }

    fn description(&self) -> &'static str {
        "Get the main conversation topics from your messages, optionally filtered by contact. Returns topic clusters with labels, message counts, and example messages."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "Optional: filter to a specific contact. Must be a phone number or email, not a display name. Call list_contacts first if you need the ID."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of topic clusters to return (default: 10)"
                }
            }
        })
    }

    fn execute(&self, args: Value) -> Result<ToolResult> {
        let raw_contact_id = args.get("contact_id").and_then(|v| v.as_str());
        let resolved_contact_id = raw_contact_id.map(super::resolve_contact_id);
        let contact_id = resolved_contact_id.as_deref();

        // Clamp at the trust boundary: this value comes from model-generated JSON.
        // Unclamped, `-1` wraps through `as usize` to u64::MAX and DuckDB rejects the
        // LIMIT, while `0` silently succeeds with zero rows and reads as "no topics".
        let limit = args
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(10)
            .clamp(1, MAX_CLUSTERS) as usize;

        debug!(
            contact_id = ?contact_id,
            limit = limit,
            "Executing get_topic_clusters"
        );

        // Open DuckDB (read-only) at the canonical path.
        let db = match VectorDb::open_readonly() {
            Ok(db) => db,
            Err(e) => {
                warn!(error = %e, "get_topic_clusters: failed to open vector database");
                return Ok(ToolResult::error(format!("Failed to open vector database: {}", e)));
            }
        };

        let conn = db.connection();
        let (cluster_sql, params) = build_cluster_summary_query(contact_id, limit);

        let mut stmt = match conn.prepare(&cluster_sql) {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "get_topic_clusters: cluster query preparation failed");
                return Ok(ToolResult::error(describe_cluster_failure(&e)));
            }
        };

        let rows = match stmt.query_map(params_from_iter(params.iter()), |row| {
            Ok((
                row.get::<_, i32>(0)?,    // cluster_id
                row.get::<_, String>(1)?, // cluster_label
                row.get::<_, i64>(2)?,    // chunk_count
                row.get::<_, String>(3)?, // earliest
                row.get::<_, String>(4)?, // latest
            ))
        }) {
            Ok(r) => r,
            Err(e) => {
                warn!(error = %e, "get_topic_clusters: cluster query failed");
                return Ok(ToolResult::error(describe_cluster_failure(&e)));
            }
        };

        // Don't silently swallow per-row decode errors. A blanket `flatten()` here
        // would turn a total decode failure into an authoritative "you have no topics".
        let mut clusters: Vec<(i32, String, i64, String, String)> = Vec::new();
        let mut row_errors = 0usize;
        for row in rows {
            match row {
                Ok(r) => clusters.push(r),
                Err(e) => {
                    row_errors += 1;
                    if row_errors == 1 {
                        warn!(error = %e, "get_topic_clusters: failed to decode a cluster row");
                    }
                }
            }
        }

        if clusters.is_empty() {
            if row_errors > 0 {
                return Ok(ToolResult::error(format!(
                    "Could not read topic clusters: all {} rows failed to decode.",
                    row_errors
                )));
            }
            return Ok(ToolResult::success(serde_json::json!({
                "clusters": [],
                "count": 0,
                "note": empty_note(contact_id),
            })));
        }

        let mut clusters_json: Vec<Value> = Vec::new();
        let mut examples_unavailable = false;

        for (i, (cluster_id, label, count, earliest, latest)) in clusters.iter().enumerate() {
            let examples = if i < CLUSTERS_WITH_EXAMPLES {
                match fetch_cluster_examples(conn, *cluster_id, contact_id) {
                    Some(e) => e,
                    None => {
                        examples_unavailable = true;
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };

            clusters_json.push(serde_json::json!({
                "label": label,
                "message_count": count,
                "date_range": {
                    "earliest": earliest,
                    "latest": latest
                },
                "example_messages": examples
            }));
        }

        let count = clusters_json.len();
        let mut payload = serde_json::json!({
            "clusters": clusters_json,
            "count": count
        });

        // Absence of examples must not be reportable as "there are no supporting
        // messages" — say the lookup failed instead.
        if examples_unavailable {
            payload["examples_unavailable"] = Value::Bool(true);
            payload["note"] = Value::String(
                "Example messages could not be loaded for some topics. The topic labels and \
                 counts are accurate; do not state that a topic has no messages."
                    .to_string(),
            );
        }

        Ok(ToolResult::success(payload))
    }
}

/// Describe a cluster-query failure without asserting a cause the error doesn't support.
///
/// Only a catalog error means clustering genuinely never ran. Lock contention from a
/// concurrent ingestion, a partial `brb.duckdb`, or a future column rename all surface
/// here too — and re-ingestion (full embedding + Leiden + UMAP) is the most expensive
/// operation in the app, so prescribing it for a transient lock costs hours for nothing.
fn describe_cluster_failure(e: &duckdb::Error) -> String {
    let msg = e.to_string();
    if msg.contains("Catalog Error") {
        "Topic clustering has not been run yet — the cluster table doesn't exist. \
         Run ingestion to generate topics, or use search_messages to answer from raw messages."
            .to_string()
    } else {
        format!(
            "Could not read topic clusters: {}. Use search_messages to answer from raw messages instead.",
            msg
        )
    }
}

/// Note for a successful-but-empty result.
///
/// With a contact filter, the overwhelmingly likely cause is a `contact_id` that
/// matched nothing — `resolve_contact_id` falls back to the raw display name on a
/// miss, so "Riley" reaches a table keyed by phone/email and matches zero rows.
/// Telling the user to re-ingest for that produces a bit-identical result.
fn empty_note(contact_id: Option<&str>) -> String {
    match contact_id {
        Some(cid) => format!(
            "No topic clusters found for '{}'. Either that contact_id doesn't match any \
             clustered messages — call list_contacts to get exact IDs — or this contact's \
             messages were all classified as noise. Use search_messages to answer instead.",
            cid
        ),
        None => "No topic clusters found. Clustering runs as the last stage of ingestion; if \
                 ingestion has never completed, run it to generate topics. Use search_messages \
                 to answer from raw messages in the meantime."
            .to_string(),
    }
}

/// Fetch example message previews for a given cluster.
///
/// Returns `None` when the lookup itself failed, so the caller can distinguish
/// "this cluster has no examples" from "we couldn't read them".
fn fetch_cluster_examples(
    conn: &ingestion::DuckDbConnection,
    cluster_id: i32,
    contact_id: Option<&str>,
) -> Option<Vec<String>> {
    let (sql, params) = build_cluster_examples_query(cluster_id, contact_id, EXAMPLES_PER_CLUSTER);

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => {
            warn!(cluster_id, error = %e, "get_topic_clusters: example query preparation failed");
            return None;
        }
    };

    let rows = match stmt.query_map(params_from_iter(params.iter()), |row| row.get::<_, String>(0)) {
        Ok(r) => r,
        Err(e) => {
            warn!(cluster_id, error = %e, "get_topic_clusters: example query failed");
            return None;
        }
    };

    let mut previews = Vec::new();
    for row in rows {
        match row {
            Ok(p) => previews.push(p),
            Err(e) => {
                warn!(cluster_id, error = %e, "get_topic_clusters: failed to decode an example row");
                return None;
            }
        }
    }
    Some(previews)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = GetTopicClustersTool;
        assert_eq!(tool.name(), "get_topic_clusters");
        assert!(tool.description().contains("topic"));
        // No required parameters
        assert!(tool.parameters().get("required").is_none());
    }

    #[test]
    fn test_empty_note_does_not_prescribe_reingestion_for_a_contact_miss() {
        // A contact filter that matched nothing is almost always a bad contact_id,
        // not missing clustering — re-ingesting would produce an identical result.
        let scoped = empty_note(Some("Riley"));
        assert!(scoped.contains("list_contacts"));
        assert!(!scoped.to_lowercase().contains("run it to generate"));

        // Unscoped genuinely can mean ingestion never completed.
        let global = empty_note(None);
        assert!(global.contains("ingestion"));
    }

    #[test]
    fn test_only_catalog_errors_blame_missing_clustering() {
        let catalog = duckdb::Error::DuckDBFailure(
            duckdb::ffi::Error::new(1),
            Some("Catalog Error: Table with name chunk_projections does not exist!".to_string()),
        );
        assert!(describe_cluster_failure(&catalog).contains("has not been run yet"));

        // A lock held by a concurrent writer must not send the user into a multi-hour
        // re-ingestion for what is a transient failure.
        let locked = duckdb::Error::DuckDBFailure(
            duckdb::ffi::Error::new(1),
            Some("IO Error: Could not set lock on file brb.duckdb".to_string()),
        );
        let msg = describe_cluster_failure(&locked);
        assert!(!msg.contains("has not been run yet"));
        assert!(msg.contains("Could not read topic clusters"));
        assert!(msg.contains("lock"), "the real cause must survive into the message");
    }
}

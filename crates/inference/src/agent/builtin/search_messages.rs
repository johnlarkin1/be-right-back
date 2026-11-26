//! Search messages tool for Casper agent.
//!
//! This tool performs semantic search over message embeddings.

use std::collections::HashMap;
use std::path::PathBuf;

use chrono::{DateTime, NaiveDate, Utc};
use common::relative_time_with_now;
use serde_json::Value;
use tracing::{debug, warn};

use super::{is_phone_number, load_contact_names};
use crate::agent::tools::{Tool, ToolResult};
use crate::error::Result;
use ingestion::{
    SearchOptions, SearchResult, SortDirection, VectorDb, apply_recency_boost_with_now, plan_search_with_now,
};

/// A finished search, before it is rendered into tool JSON.
///
/// [`SearchMessagesTool::ranked`] produces this and [`Tool::execute`] formats it.
/// The split exists for the retrieval eval: the rendered JSON carries no
/// `message_id`s, so gold cannot be scored against it, and scoring a
/// *reassembled* copy of this pipeline would measure the copy rather than the
/// surface Casper actually searches through.
pub struct RankedSearch {
    /// The query as searched.
    pub query: String,
    /// Ranked results, already filtered and truncated exactly as they will be presented.
    pub results: Vec<SearchResult>,
    /// Display-name map used for filtering; reused by formatting so a search
    /// opens the contacts database once, not twice.
    pub contact_names: HashMap<String, String>,
    /// The instant this search resolved every clock against.
    pub now: DateTime<Utc>,
}

/// Tool for searching messages using semantic similarity.
///
/// This tool searches the vector database for messages similar to the query.
/// The agent is responsible for generating the query embedding and passing
/// it via the `_embedding` parameter.
pub struct SearchMessagesTool {
    /// Reference "now" for every time-dependent step of a search: the planner's
    /// date-window extraction, the RRF recency term, and the recency boost.
    ///
    /// `None` (the default, and what ships) means the wall clock. The retrieval
    /// eval pins it so a fixture with fixed timestamps keeps producing the same
    /// ranking tomorrow — three clocks read independently would otherwise drift
    /// apart mid-search and make temporal assertions meaningless.
    now: Option<DateTime<Utc>>,
    /// Vector database to search. `None` (the default, and what ships) means the
    /// canonical `brb.duckdb` via the shared read-only primary; the eval harness
    /// points this at a fixture corpus.
    db_path: Option<PathBuf>,
    /// Display-name overrides. `None` (the default, and what ships) reads the
    /// canonical `brb.db` contacts table.
    ///
    /// Pointing [`SearchMessagesTool::db_path`] at a fixture is not enough on its
    /// own: name resolution reads a *second*, separately-located database, so a
    /// fixture whose `contact_id` collides with a real one would silently take the
    /// real display name — and a machine with no `brb.db` at all resolves nothing,
    /// so CI and a dev laptop would disagree about the same fixture.
    contact_names: Option<HashMap<String, String>>,
}

impl SearchMessagesTool {
    /// Create a new search messages tool: real database, wall clock.
    pub fn new() -> Self {
        Self {
            now: None,
            db_path: None,
            contact_names: None,
        }
    }

    /// Resolve display names from an explicit map instead of the canonical `brb.db`.
    ///
    /// Evaluation-only. Pass this whenever [`SearchMessagesTool::with_db_path`] is
    /// set, so a fixture run touches no real user data.
    pub fn with_contact_names(mut self, names: HashMap<String, String>) -> Self {
        self.contact_names = Some(names);
        self
    }

    /// Pin the reference instant used for every time-dependent step of a search.
    ///
    /// Evaluation-only. Pass the same instant the fixture's timestamps were
    /// authored against.
    pub fn with_now(mut self, now: DateTime<Utc>) -> Self {
        self.now = Some(now);
        self
    }

    /// Search a fixture database instead of the canonical one.
    ///
    /// Evaluation-only.
    pub fn with_db_path(mut self, db_path: impl Into<PathBuf>) -> Self {
        self.db_path = Some(db_path.into());
        self
    }

    /// The instant this tool treats as "now".
    fn reference_now(&self) -> DateTime<Utc> {
        self.now.unwrap_or_else(Utc::now)
    }

    /// Open the database this tool searches, read-only.
    fn open_db(&self) -> common::Result<VectorDb> {
        match &self.db_path {
            Some(path) => VectorDb::open_readonly_at(path),
            None => VectorDb::open_readonly(),
        }
    }
}

impl Default for SearchMessagesTool {
    fn default() -> Self {
        Self::new()
    }
}

impl Tool for SearchMessagesTool {
    fn name(&self) -> &'static str {
        "search_messages"
    }

    fn description(&self) -> &'static str {
        "Search messages by topic. Use a SHORT, focused query (2-5 words); to cover multiple ideas, call this tool several times with separate short queries rather than one long query."
    }

    fn parameters(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Short, focused search query, 2-5 words (e.g., 'birthday party', 'vacation plans'). Do NOT pile up synonyms; issue separate searches for separate ideas. For 'last/latest/first' questions, search the TOPIC only (e.g. 'restaurant'), not the word 'last'."
                },
                "contact_id": {
                    "type": "string",
                    "description": "Optional: filter to a specific contact. Use the id value from the [CONTEXT] block (e.g., +15551234567) or from list_contacts results. Do NOT use display names."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results (default: 10)"
                },
                "min_date": {
                    "type": "string",
                    "description": "Only include results on/after this date (ISO format: YYYY-MM-DD). Use only when the user named a time range; for 'last/latest' questions leave this empty and rely on recency ranking."
                },
                "max_date": {
                    "type": "string",
                    "description": "Only include results on/before this date (ISO format: YYYY-MM-DD)"
                }
            },
            "required": ["query"]
        })
    }

    fn execute(&self, args: Value) -> Result<ToolResult> {
        let ranked = match self.ranked(&args) {
            Ok(r) => r,
            Err(e) => return Ok(ToolResult::error(e)),
        };

        let results_json: Vec<Value> = ranked
            .results
            .iter()
            .filter_map(|r| format_result(r, "hybrid", &ranked.contact_names, ranked.now))
            .collect();

        if results_json.is_empty() {
            return Ok(ToolResult::success(serde_json::json!({
                "query": ranked.query,
                "results": [],
                "count": 0,
                "note": "No matching messages found. Try a different query or broader search terms."
            })));
        }

        let count = results_json.len();
        Ok(ToolResult::success(serde_json::json!({
            "query": ranked.query,
            "results": results_json,
            "count": count
        })))
    }
}

impl SearchMessagesTool {
    /// Run a search and return the ranked results, filtered and truncated exactly
    /// as [`Tool::execute`] will present them.
    ///
    /// Errors come back as plain strings so the caller chooses how to surface
    /// them: the tool wraps them in a [`ToolResult`], the eval harness fails loudly.
    pub fn ranked(&self, args: &Value) -> std::result::Result<RankedSearch, String> {
        let query = args.get("query").and_then(|v| v.as_str()).ok_or("query is required")?;

        // One clock for the whole search: the planner's date windows, the RRF
        // recency term, and the recency boost all resolve against this instant.
        let now = self.reference_now();

        // Run query planner for temporal extraction and result count hints
        let plan = plan_search_with_now(query, now);

        // Superlative precedence: per-turn plan (`_superlative`, injected by the
        // agent from the original question) > this tool's own regex plan.
        let superlative = parse_superlative(args.get("_superlative")).or(plan.superlative);

        // Resolve contact_id: the LLM may pass a display name (e.g., "Riley Chen 🐙")
        // but the database needs the actual contact_id (phone number/email).
        //
        // Guard first: small quantized models sometimes dump their reasoning into this
        // parameter (observed: a 400-char "+Riley's contact id here if known, otherwise
        // leave empty… Wait no, the tool filters. Let me just list all contacts" string).
        // A real contact reference is a short name / phone / email, so ignore anything
        // that's clearly prose and search across all contacts instead of filtering on garbage.
        // Prefer the agent-injected `_contact_id` (set when the user tagged
        // exactly one contact with "@"; see CasperAgent::inject_embeddings) over
        // the model's own `contact_id`. The injected value reflects an explicit
        // user choice and is already a real contact_id, so it wins over a value
        // the model may have hallucinated; resolution downstream is a safe
        // passthrough.
        let raw_contact_id = pick_contact_id_arg(args);
        let resolved_contact_id = raw_contact_id.as_deref().map(super::resolve_contact_id);
        let contact_id = resolved_contact_id.as_deref();
        // Result count precedence: model's explicit `limit` > per-turn plan
        // (`_result_count`, injected by the agent) > this tool's own regex plan.
        let limit = args
            .get("limit")
            .and_then(|v| v.as_i64())
            .map(|l| l as usize)
            .or_else(|| args.get("_result_count").and_then(|v| v.as_u64()).map(|l| l as usize))
            .unwrap_or(plan.result_count);

        // Date filter precedence: model's explicit (parseable) date > per-turn
        // plan (`_min_date`/`_max_date`, injected by the agent) > this tool's own
        // regex plan. An unparseable model date (e.g. "2026-04-31") falls through
        // to the turn plan instead of silently dropping the filter.
        let min_date = resolve_date(args.get("min_date"), args.get("_min_date"), plan.min_date);
        let max_date = resolve_date(args.get("max_date"), args.get("_max_date"), plan.max_date);

        // Repair a degenerate window: the model sometimes echoes the turn-plan's
        // START as BOTH min and max (collapsing "the past month" to a single day)
        // or inverts the bounds. When the turn plan spans a real range, defer to
        // it; otherwise a degenerate window would silently narrow the search to
        // ~one day. The turn-plan window is the injected `_min_date`/`_max_date`
        // (falling back to this tool's own regex plan).
        let turn_min = resolve_date(None, args.get("_min_date"), plan.min_date);
        let turn_max = resolve_date(None, args.get("_max_date"), plan.max_date);
        let (min_date, max_date) = reconcile_window(min_date, max_date, turn_min, turn_max);

        // Embeddings injected by the agent. Prefer `_embeddings` (multi-vector RRF
        // fusion over focused sub-queries); fall back to single `_embedding`.
        let embeddings: Vec<Vec<f32>> = match args.get("_embeddings") {
            Some(Value::Array(arr)) => {
                let mut out = Vec::with_capacity(arr.len());
                for v in arr {
                    out.push(parse_f32_vec(v).map_err(|e| format!("Invalid embedding: {}", e))?);
                }
                out
            }
            Some(_) => return Err("_embeddings must be an array of float arrays".into()),
            None => match args.get("_embedding") {
                Some(v @ Value::Array(_)) => {
                    vec![parse_f32_vec(v).map_err(|e| format!("Invalid embedding: {}", e))?]
                }
                Some(_) => return Err("_embedding must be an array of floats".into()),
                // No embedding provided - shouldn't happen if agent is working correctly
                None => return Err("Internal error: search_messages requires embedding from agent".into()),
            },
        };
        if embeddings.iter().all(|e| e.is_empty()) {
            return Err("Internal error: search_messages requires embedding from agent".into());
        }

        debug!(
            query = query,
            contact_id = ?contact_id,
            limit = limit,
            min_date = ?min_date,
            max_date = ?max_date,
            embeddings = embeddings.len(),
            superlative = ?superlative,
            "Executing search_messages"
        );

        // Open READ-ONLY: a search is a pure read. The read-write `open()` runs
        // ensure_hnsw_index()/ensure_fts_index() DDL on every call and takes a write
        // lock — which, racing the read-only connections the desktop fires in the
        // background (insights, init-status polling), binds `message_chunks`' index
        // list mid-DDL and aborts DuckDB (`table_index_list.cpp` unbound_count == 0).
        // Read-only avoids the writer entirely; DuckDB allows many concurrent readers.
        let db = self
            .open_db()
            .map_err(|e| format!("Failed to open vector database: {}", e))?;

        // Over-fetch to account for phone-number contacts being filtered out
        let fetch_limit = limit + 5;

        // Use hybrid search: combines semantic (cosine similarity) + BM25 (full-text)
        // with Reciprocal Rank Fusion for optimal result merging.
        // Enable embeddings so MMR deduplication produces diverse results.
        //
        // NOTE: deliberately NOT calling `.with_rerank()` here. That would cold-spawn a
        // cross-encoder subprocess per search (~5s, re-loading the model each time). The
        // agent loop already reranks these results via the *warm* inference daemon in
        // `CasperAgent::rerank_search_results()` (see agent/mod.rs), which overwrites the
        // ordering anyway — so a subprocess rerank here is pure wasted latency.
        let mut options = SearchOptions::new()
            .with_limit(fetch_limit)
            .with_min_similarity(0.25)
            .with_query_text(query)
            .with_date_range(min_date, max_date)
            .with_embeddings()
            .with_superlative(superlative)
            .with_now(now);

        if let Some(cid) = contact_id {
            options = options.with_contact(cid);
        }

        let mut search_results = db
            .hybrid_search_multi(&embeddings, options)
            .map_err(|e| format!("Search failed: {}", e))?;

        // Apply recency boost if the per-turn plan (`_prefer_recent`, injected by
        // the agent) or this tool's own regex plan detected recency intent.
        //
        // Skip it entirely for superlative queries: `hybrid_search_multi` already
        // hard-sorted by recency, and re-applying the soft boost here would
        // re-sort by decayed similarity (and is the wrong direction for "oldest").
        if superlative.is_none() {
            let prefer_recent = args
                .get("_prefer_recent")
                .and_then(|v| v.as_bool())
                .unwrap_or(plan.prefer_recent);
            apply_recency_boost_with_now(&mut search_results, prefer_recent, now);
        }

        // Pre-load contact names to avoid repeated DB opens
        let contact_names = match &self.contact_names {
            Some(names) => names.clone(),
            None => load_contact_names(),
        };

        // Drop results whose contact never resolved to a real display name. This is
        // the same predicate `format_result` applies when it returns None, hoisted
        // here so the ranked list and the formatted list stay 1:1.
        search_results.retain(|r| {
            !is_phone_number(&resolve_contact_name(
                &r.contact_id,
                r.contact_name.as_deref(),
                &contact_names,
            ))
        });

        // Truncate to requested limit (results are already ranked by RRF score)
        search_results.truncate(limit);

        Ok(RankedSearch {
            query: query.to_string(),
            results: search_results,
            contact_names,
            now,
        })
    }
}

/// Parse the agent-injected `_superlative` hint into a sort direction.
fn parse_superlative(v: Option<&Value>) -> Option<SortDirection> {
    match v.and_then(|v| v.as_str()) {
        Some("newest") => Some(SortDirection::Newest),
        Some("oldest") => Some(SortDirection::Oldest),
        _ => None,
    }
}

/// Parse a JSON array of numbers into a `Vec<f32>` (one embedding vector).
fn parse_f32_vec(v: &Value) -> std::result::Result<Vec<f32>, String> {
    match v {
        Value::Array(arr) => arr
            .iter()
            .map(|x| {
                x.as_f64()
                    .map(|f| f as f32)
                    .ok_or_else(|| "invalid embedding value".to_string())
            })
            .collect(),
        _ => Err("embedding must be an array of floats".to_string()),
    }
}

/// Format a search result as JSON, returning None if the contact is a phone number.
fn format_result(
    r: &ingestion::SearchResult,
    match_type: &str,
    contact_names: &HashMap<String, String>,
    now: DateTime<Utc>,
) -> Option<Value> {
    let resolved_name = resolve_contact_name(&r.contact_id, r.contact_name.as_deref(), contact_names);
    if is_phone_number(&resolved_name) {
        return None;
    }
    let conversation = strip_reaction_lines(&r.chunk_data.formatted);
    Some(serde_json::json!({
        "contact_id": r.contact_id,
        "contact_name": resolved_name,
        "conversation": conversation,
        "date": r.start_timestamp.format("%Y-%m-%d").to_string(),
        "relative_time": relative_time_with_now(r.end_timestamp, now),
        "similarity": format!("{:.2}", r.similarity),
        "match_type": match_type
    }))
}

/// Whether a `contact_id` argument plausibly refers to a contact (a short name,
/// phone number, or email) rather than leaked model reasoning.
///
/// Small quantized models occasionally emit a paragraph of chain-of-thought into
/// this field. Real references are short and single-line; prose is long and/or
/// multi-line with many words. This is a heuristic gate, not strict validation —
/// when in doubt we let it through and rely on name resolution.
fn is_plausible_contact_ref(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty() && id.chars().count() <= 64 && !id.contains(['\n', '\r']) && id.split_whitespace().count() <= 6
}

/// Pick the contact filter from tool args.
///
/// Precedence: the agent-injected `_contact_id` (set only when the user tagged
/// exactly one contact with "@") is an authoritative, real id that reflects an
/// explicit user choice, so it wins over the model's own `contact_id`, which a
/// small model may hallucinate. When no contact was tagged, the model's
/// `contact_id` is used. Each candidate is gated by `is_plausible_contact_ref`
/// so leaked model reasoning doesn't become a filter, and a missing/null/empty
/// value is simply skipped (treated as "no filter from this source"). Returns
/// an owned `String` to decouple from the args lifetime.
fn pick_contact_id_arg(args: &Value) -> Option<String> {
    let injected = args.get("_contact_id").and_then(|v| v.as_str());
    let model = args.get("contact_id").and_then(|v| v.as_str());
    [injected, model].into_iter().flatten().find_map(|id| {
        if is_plausible_contact_ref(id) {
            return Some(id.to_string());
        }
        warn!(
            contact_id_preview = %id.trim().chars().take(60).collect::<String>(),
            "Ignoring implausible contact_id (looks like leaked reasoning); searching all contacts"
        );
        None
    })
}

/// Check if a line is an iMessage tapback reaction (e.g. `Liked "hey what's up"`).
fn is_reaction_line(line: &str) -> bool {
    let trimmed = line.trim();
    let prefixes = ["Liked", "Loved", "Disliked", "Laughed at", "Emphasized", "Questioned"];
    for prefix in &prefixes {
        if trimmed.starts_with(prefix) || trimmed.starts_with(&format!("You {}", prefix.to_lowercase())) {
            // Must contain a quoted portion (straight or curly quotes)
            if trimmed.contains('"') || trimmed.contains('\u{201c}') {
                return true;
            }
        }
    }
    false
}

/// Remove iMessage reaction lines from a chunk of conversation text.
fn strip_reaction_lines(text: &str) -> String {
    text.lines()
        .filter(|line| !is_reaction_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Parse a date string in YYYY-MM-DD format to DateTime<Utc>
fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
}

/// Resolve a date filter with precedence: the model's explicit (parseable) value
/// first, then the agent-injected per-turn plan value, then the regex-plan
/// fallback. A present-but-unparseable explicit value (e.g. "2026-04-31") is
/// ignored rather than allowed to suppress the turn plan — otherwise a single bad
/// date from the model would silently widen the search to the entire history.
fn resolve_date(
    explicit: Option<&Value>,
    injected: Option<&Value>,
    plan: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    explicit
        .and_then(|v| v.as_str())
        .and_then(parse_date)
        .or_else(|| injected.and_then(|v| v.as_str()).and_then(parse_date))
        .or(plan)
}

/// Repair a degenerate model-supplied date window using the turn plan.
///
/// The agent injects the turn-plan window as `_min_date`/`_max_date`, but the
/// model's own explicit dates take precedence in [`resolve_date`]. Small models
/// sometimes emit a broken window — inverted bounds (`min > max`) or a range
/// collapsed to a single instant (`min == max`, from echoing the plan's start as
/// both bounds). In those cases defer to the turn plan when it provides a genuine
/// (strictly wider) range; otherwise leave the model's window alone, so a
/// legitimate single-day query (which also has a single-day turn plan) is
/// untouched. A half-open window (only one bound set) is never altered.
fn reconcile_window(
    min: Option<DateTime<Utc>>,
    max: Option<DateTime<Utc>>,
    turn_min: Option<DateTime<Utc>>,
    turn_max: Option<DateTime<Utc>>,
) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    let (Some(mn), Some(mx)) = (min, max) else {
        return (min, max);
    };
    // A proper range (min < max) is left as-is.
    if mn < mx {
        return (min, max);
    }
    // Degenerate (collapsed or inverted): prefer a real turn-plan range.
    if let (Some(tn), Some(tx)) = (turn_min, turn_max)
        && tn < tx
    {
        return (Some(tn), Some(tx));
    }
    // No usable plan: at least un-invert so the filter isn't impossible.
    if mn > mx {
        return (Some(mx), Some(mn));
    }
    (min, max)
}

/// Resolve a contact name, falling back to a pre-loaded cache if needed.
///
/// If the stored contact_name looks like a phone number, look up
/// the display name from the pre-loaded contact names map.
fn resolve_contact_name(
    contact_id: &str,
    contact_name: Option<&str>,
    contact_names: &HashMap<String, String>,
) -> String {
    // If contact_name exists and doesn't look like a phone number, use it
    if let Some(name) = contact_name {
        let is_phone_like = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_digit() || c == '+' || c == '-' || c == ' ' || c == '(')
            || name.starts_with('+');

        if !is_phone_like && !name.is_empty() {
            return name.to_string();
        }
    }

    // Fallback: lookup from pre-loaded contact names cache
    if let Some(name) = contact_names.get(contact_id) {
        return name.clone();
    }

    // Final fallback: use original contact_name or contact_id
    contact_name
        .map(|s| s.to_string())
        .unwrap_or_else(|| contact_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_metadata() {
        let tool = SearchMessagesTool::new();
        assert_eq!(tool.name(), "search_messages");
        assert!(tool.description().contains("Search"));
        assert!(
            tool.parameters()["required"]
                .as_array()
                .unwrap()
                .contains(&Value::String("query".to_string()))
        );
    }

    #[test]
    fn test_missing_embedding() {
        let tool = SearchMessagesTool::new();
        let args = serde_json::json!({"query": "test"});
        let result = tool.execute(args).unwrap();
        assert!(!result.success);
        assert!(result.error.unwrap().contains("embedding"));
    }

    #[test]
    fn test_parse_date_valid() {
        let date = parse_date("2023-06-15");
        assert!(date.is_some());
        let dt = date.unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2023-06-15");
    }

    #[test]
    fn test_parse_date_invalid() {
        assert!(parse_date("invalid").is_none());
        assert!(parse_date("2023/06/15").is_none());
        assert!(parse_date("").is_none());
        // Calendar-invalid day: April has 30 days. This is the exact value an
        // agent model emitted in the wild, which used to drop the date filter.
        assert!(parse_date("2026-04-31").is_none());
    }

    fn day(s: &str) -> DateTime<Utc> {
        parse_date(s).unwrap()
    }

    #[test]
    fn test_resolve_date_explicit_valid_wins() {
        let explicit = Value::String("2025-01-15".to_string());
        let injected = Value::String("2026-03-02".to_string());
        let got = resolve_date(Some(&explicit), Some(&injected), Some(day("2024-01-01")));
        assert_eq!(got, parse_date("2025-01-15"));
    }

    #[test]
    fn test_resolve_date_invalid_explicit_falls_back_to_turn_plan() {
        // The bug: a present-but-unparseable model date must NOT suppress the
        // injected turn-plan date (previously it fell through to None → all history).
        let explicit = Value::String("2026-04-31".to_string());
        let injected = Value::String("2026-03-02".to_string());
        let got = resolve_date(Some(&explicit), Some(&injected), None);
        assert_eq!(got, parse_date("2026-03-02"));
    }

    #[test]
    fn test_resolve_date_missing_explicit_uses_turn_plan() {
        let injected = Value::String("2026-03-02".to_string());
        let got = resolve_date(None, Some(&injected), Some(day("2024-01-01")));
        assert_eq!(got, parse_date("2026-03-02"));
    }

    #[test]
    fn test_resolve_date_falls_back_to_regex_plan_when_nothing_injected() {
        let got = resolve_date(None, None, Some(day("2024-01-01")));
        assert_eq!(got, parse_date("2024-01-01"));
    }

    #[test]
    fn test_resolve_date_all_none() {
        assert!(resolve_date(None, None, None).is_none());
    }

    #[test]
    fn test_reconcile_window_proper_range_untouched() {
        let (mn, mx) = reconcile_window(
            Some(day("2026-05-14")),
            Some(day("2026-06-14")),
            Some(day("2026-01-01")),
            Some(day("2026-12-31")),
        );
        assert_eq!(mn, Some(day("2026-05-14")));
        assert_eq!(mx, Some(day("2026-06-14")));
    }

    #[test]
    fn test_reconcile_window_collapsed_uses_turn_plan() {
        // The exact wild failure: model echoed the plan's start as both bounds,
        // collapsing "the past month" to a single day. Defer to the turn plan.
        let (mn, mx) = reconcile_window(
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
            Some(day("2026-06-14")),
        );
        assert_eq!(mn, Some(day("2026-05-14")));
        assert_eq!(mx, Some(day("2026-06-14")));
    }

    #[test]
    fn test_reconcile_window_inverted_uses_turn_plan() {
        let (mn, mx) = reconcile_window(
            Some(day("2026-06-14")),
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
            Some(day("2026-06-14")),
        );
        assert_eq!(mn, Some(day("2026-05-14")));
        assert_eq!(mx, Some(day("2026-06-14")));
    }

    #[test]
    fn test_reconcile_window_inverted_no_plan_swaps() {
        let (mn, mx) = reconcile_window(Some(day("2026-06-14")), Some(day("2026-05-14")), None, None);
        assert_eq!(mn, Some(day("2026-05-14")));
        assert_eq!(mx, Some(day("2026-06-14")));
    }

    #[test]
    fn test_reconcile_window_legit_single_day_preserved() {
        // A real single-day query (plan is also that single day) must NOT be widened.
        let (mn, mx) = reconcile_window(
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
            Some(day("2026-05-14")),
        );
        assert_eq!(mn, Some(day("2026-05-14")));
        assert_eq!(mx, Some(day("2026-05-14")));
    }

    #[test]
    fn test_reconcile_window_half_open_untouched() {
        let (mn, mx) = reconcile_window(
            None,
            Some(day("2026-05-14")),
            Some(day("2026-01-01")),
            Some(day("2026-12-31")),
        );
        assert_eq!(mn, None);
        assert_eq!(mx, Some(day("2026-05-14")));
    }

    #[test]
    fn test_resolve_contact_name_with_name() {
        let cache = HashMap::new();
        // Normal name should be returned as-is
        let result = resolve_contact_name("+15551234567", Some("John Smith"), &cache);
        assert_eq!(result, "John Smith");
    }

    #[test]
    fn test_resolve_contact_name_phone_number() {
        let cache = HashMap::new();
        // Phone number should fall back (no cache entry, so returns the phone number)
        let result = resolve_contact_name("+15551234567", Some("+15551234567"), &cache);
        assert_eq!(result, "+15551234567");
    }

    #[test]
    fn test_resolve_contact_name_none() {
        let cache = HashMap::new();
        // No name should return contact_id
        let result = resolve_contact_name("test-contact", None, &cache);
        assert_eq!(result, "test-contact");
    }

    #[test]
    fn test_resolve_contact_name_from_cache() {
        let mut cache = HashMap::new();
        cache.insert("+15551234567".to_string(), "Cached Name".to_string());
        // Phone number with cache should resolve from cache
        let result = resolve_contact_name("+15551234567", Some("+15551234567"), &cache);
        assert_eq!(result, "Cached Name");
    }

    #[test]
    fn test_tool_has_date_parameters() {
        let tool = SearchMessagesTool::new();
        let params = tool.parameters();
        let props = params["properties"].as_object().unwrap();

        // Results are sorted by recency by default, date params are optional filters
        assert!(props.contains_key("min_date"));
        assert!(props.contains_key("max_date"));
    }

    #[test]
    fn test_is_phone_number() {
        assert!(is_phone_number("+15551234567"));
        assert!(is_phone_number("555-123-4567"));
        assert!(is_phone_number("(555) 123-4567"));
        assert!(!is_phone_number("John Smith"));
        assert!(!is_phone_number("Alice"));
        assert!(!is_phone_number(""));
    }

    #[test]
    fn test_is_reaction_line() {
        assert!(is_reaction_line(r#"Liked "hey what's up""#));
        assert!(is_reaction_line(r#"Loved "sounds good""#));
        assert!(is_reaction_line(r#"Laughed at "lmao""#));
        assert!(is_reaction_line(r#"Emphasized "important stuff""#));
        assert!(is_reaction_line(r#"Questioned "really?""#));
        assert!(is_reaction_line(r#"Disliked "no way""#));
        assert!(is_reaction_line(r#"You liked "hey""#));
        assert!(is_reaction_line(r#"You loved "ok cool""#));
        // Curly quotes
        assert!(is_reaction_line("Liked \u{201c}hey\u{201d}"));
        // Not reactions
        assert!(!is_reaction_line("I liked the movie"));
        assert!(!is_reaction_line("Hey what's up"));
        assert!(!is_reaction_line("Loved it!"));
        assert!(!is_reaction_line(""));
    }

    #[test]
    fn test_strip_reaction_lines() {
        let text = "Alice: hey what's up\nLiked \"hey what's up\"\nBob: not much";
        let stripped = strip_reaction_lines(text);
        assert_eq!(stripped, "Alice: hey what's up\nBob: not much");
    }

    #[test]
    fn test_is_plausible_contact_ref() {
        // Real references pass.
        assert!(is_plausible_contact_ref("Riley Chen 🐙"));
        assert!(is_plausible_contact_ref("+15555550142"));
        assert!(is_plausible_contact_ref("mom@example.com"));
        assert!(is_plausible_contact_ref("Mom"));

        // Leaked reasoning is rejected.
        assert!(!is_plausible_contact_ref(""));
        assert!(!is_plausible_contact_ref(
            "+Riley's contact id here if known, otherwise leave empty for search across \
             all contacts but it will be filtered by name in result? Wait no, the tool filters."
        ));
        assert!(!is_plausible_contact_ref("Let me\nlist all\ncontacts first")); // multi-line
        assert!(!is_plausible_contact_ref(
            "I need to find Riley's contact id first or search without a filter"
        )); // too many words
    }

    #[test]
    fn test_pick_contact_id_prefers_injected() {
        // The agent-injected _contact_id (a real, user-tagged id) wins over the
        // model's own contact_id, which may be hallucinated.
        let args = serde_json::json!({
            "contact_id": "+15551112222",
            "_contact_id": "+15555550144",
        });
        assert_eq!(pick_contact_id_arg(&args).as_deref(), Some("+15555550144"));
    }

    #[test]
    fn test_pick_contact_id_uses_model_when_not_tagged() {
        // When the user tagged nothing (no _contact_id), the model's contact_id is used.
        let args = serde_json::json!({ "contact_id": "+15551112222" });
        assert_eq!(pick_contact_id_arg(&args).as_deref(), Some("+15551112222"));
    }

    #[test]
    fn test_pick_contact_id_none_when_absent() {
        let args = serde_json::json!({ "query": "vacation" });
        assert_eq!(pick_contact_id_arg(&args), None);
    }

    #[test]
    fn test_pick_contact_id_null_model_falls_back_to_injected() {
        // A null/empty model contact_id is treated as "no filter from this source",
        // so the injected user tag still applies.
        let args = serde_json::json!({
            "contact_id": serde_json::Value::Null,
            "_contact_id": "+15555550144",
        });
        assert_eq!(pick_contact_id_arg(&args).as_deref(), Some("+15555550144"));

        let args = serde_json::json!({ "contact_id": "", "_contact_id": "+15555550144" });
        assert_eq!(pick_contact_id_arg(&args).as_deref(), Some("+15555550144"));
    }

    #[test]
    fn test_pick_contact_id_injected_wins_over_garbage_explicit() {
        // Leaked reasoning in the model's contact_id is rejected, but the injected
        // user tag is authoritative and still applies.
        let args = serde_json::json!({
            "contact_id": "I need to find Riley's contact id first or search without a filter",
            "_contact_id": "+15555550144",
        });
        assert_eq!(pick_contact_id_arg(&args).as_deref(), Some("+15555550144"));
    }

    #[test]
    fn test_pick_contact_id_rejects_implausible_untagged() {
        // With no user tag, leaked reasoning in contact_id means "no filter".
        let args = serde_json::json!({
            "contact_id": "I need to find Riley's contact id first or search without a filter",
        });
        assert_eq!(pick_contact_id_arg(&args), None);
    }
}

//! Database query strings for ingestion pipeline.
//!
//! This module centralizes all SQL queries used by the ingestion crate,
//! including both SQLite (brb.db) and DuckDB (brb.duckdb) queries.

use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::sync::LazyLock;

/// Common English stopwords to filter from BM25 queries.
/// These add noise to full-text search without improving retrieval quality.
pub static STOPWORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "shall", "can", "need", "dare", "ought", "used", "to", "of", "in",
        "for", "on", "with", "at", "by", "from", "as", "into", "about", "like", "through", "after", "over", "between",
        "out", "against", "during", "without", "before", "under", "around", "among", "last", "place", "thing", "stuff",
        "it", "this", "that", "my", "your", "our", "what", "where", "when", "who", "how", "which", "i", "me", "you",
        "we", "they", "he", "she",
    ])
});

/// Strip stopwords from a query string, preserving non-stopword tokens.
/// If ALL tokens are stopwords, returns the original query unchanged (fallback).
fn strip_stopwords(query: &str) -> String {
    let tokens: Vec<&str> = query.split_whitespace().collect();
    let filtered: Vec<&str> = tokens
        .iter()
        .filter(|t| !STOPWORDS.contains(t.to_lowercase().as_str()))
        .copied()
        .collect();

    if filtered.is_empty() {
        // All tokens were stopwords — use original query as fallback
        query.to_string()
    } else {
        filtered.join(" ")
    }
}

// =============================================================================
// SQLite Queries (brb.db - Metadata Database)
// =============================================================================

/// Insert a new ingestion run record
pub const INSERT_INGESTION_META: &str = r#"
    INSERT INTO ingestion_meta (
        snapshot_dir, snapshot_time, ingestion_duration_secs,
        message_count, contact_count,
        earliest_message_date, latest_message_date
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
"#;

/// Update app_state to point to current ingestion
pub const UPDATE_CURR_INGESTION_ID: &str = r#"
    UPDATE app_state SET curr_ingestion_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1
"#;

/// Get the latest ingestion metadata
pub const SELECT_LATEST_INGESTION: &str = r#"
    SELECT id, snapshot_dir, snapshot_time, ingestion_duration_secs, message_count, contact_count,
           embedding_model, embedding_dims, embedding_duration_secs, chunk_window_size, chunk_stride
    FROM ingestion_meta ORDER BY id DESC LIMIT 1
"#;

/// Update embedding metadata after embedding step completes
pub const UPDATE_EMBEDDING_METADATA: &str = r#"
    UPDATE ingestion_meta SET
        embedding_model = ?1,
        embedding_dims = ?2,
        embedding_duration_secs = ?3,
        chunk_window_size = ?4,
        chunk_stride = ?5,
        message_count = ?6,
        contact_count = ?7
    WHERE id = ?8
"#;

/// Get the current application state with ingestion_meta fields via LEFT JOIN
pub const SELECT_APP_STATE: &str = r#"
    SELECT
        a.fda_first_granted_at,
        a.fda_last_checked_at,
        a.curr_ingestion_id,
        a.ingestion_completed_at,
        a.ingestion_chunk_count,
        a.analytics_completed_at,
        a.analytics_cluster_count,
        a.base_model_id,
        a.base_model_download_started_at,
        a.base_model_download_completed_at,
        a.base_model_size_bytes,
        a.onboarding_completed_at,
        a.onboarding_current_step,
        a.casper_minimized,
        a.created_at,
        a.updated_at,
        i.snapshot_dir,
        i.snapshot_time,
        i.message_count,
        i.contact_count,
        i.ingestion_duration_secs,
        i.earliest_message_date,
        i.latest_message_date
    FROM app_state a
    LEFT JOIN ingestion_meta i ON a.curr_ingestion_id = i.id
    WHERE a.id = 1
"#;

/// Record successful ingestion completion
pub const UPDATE_INGESTION_COMPLETE: &str = r#"
    UPDATE app_state SET
        ingestion_completed_at = ?1,
        ingestion_chunk_count = ?2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
"#;

/// Record successful analytics completion
pub const UPDATE_ANALYTICS_COMPLETE: &str = r#"
    UPDATE app_state SET
        analytics_completed_at = ?1,
        analytics_cluster_count = ?2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
"#;

/// Get the user's model preference (tier:quantization string, e.g., "4b:4bit")
pub const SELECT_MODEL_PREFERENCE: &str = r#"
    SELECT model_preference FROM app_state WHERE id = 1
"#;

/// Save the user's model preference
pub const UPDATE_MODEL_PREFERENCE: &str = r#"
    UPDATE app_state SET
        model_preference = ?1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
"#;

// =============================================================================
// Tapback Queries (brb.db)
// =============================================================================

/// Insert one Tapback for an ingestion run.
pub const INSERT_TAPBACK: &str = r#"
    INSERT OR REPLACE INTO tapbacks (
        ingestion_id, message_rowid, chat_id, contact_id, sender_id, is_from_me,
        kind, emoji, target_rowid, target_part, target_is_balloon, target_from_me,
        target_sender_id, reacted_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
"#;

// =============================================================================
// Contact Stats Queries (brb.db - Pre-computed Statistics)
// =============================================================================

/// Insert or update contact statistics for a given ingestion run.
/// Uses composite primary key (contact_id, ingestion_id) to preserve history.
pub const INSERT_CONTACT_STATS: &str = r#"
    INSERT OR REPLACE INTO contact_stats (
        contact_id, ingestion_id, contact_name, message_count, messages_from_me,
        messages_from_them, date_range_start, date_range_end,
        avg_message_length, emoji_rate, top_emojis, avg_response_time_secs
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
"#;

/// Get contact stats for a specific contact from the current ingestion run.
/// Joins with app_state to get stats for curr_ingestion_id.
pub const SELECT_CONTACT_STATS: &str = r#"
    SELECT
        cs.contact_id,
        cs.contact_name,
        cs.message_count,
        cs.messages_from_me,
        cs.messages_from_them,
        cs.date_range_start,
        cs.date_range_end,
        cs.avg_message_length,
        cs.emoji_rate,
        cs.top_emojis,
        cs.avg_response_time_secs
    FROM contact_stats cs
    JOIN app_state a ON cs.ingestion_id = a.curr_ingestion_id
    WHERE cs.contact_id = ?1 AND a.id = 1
"#;

/// Get all contact stats for the current ingestion run.
pub const SELECT_ALL_CONTACT_STATS: &str = r#"
    SELECT
        cs.contact_id,
        cs.contact_name,
        cs.message_count,
        cs.messages_from_me,
        cs.messages_from_them,
        cs.date_range_start,
        cs.date_range_end,
        cs.avg_message_length,
        cs.emoji_rate,
        cs.top_emojis,
        cs.avg_response_time_secs
    FROM contact_stats cs
    JOIN app_state a ON cs.ingestion_id = a.curr_ingestion_id
    WHERE a.id = 1
    ORDER BY cs.message_count DESC
"#;

// =============================================================================
// Contacts Queries (brb.db - Pre-computed Display Names)
// =============================================================================

/// Insert a contact with pre-resolved display name during ingestion.
/// Uses ON CONFLICT to handle re-ingestion without errors.
pub const INSERT_CONTACT: &str = r#"
    INSERT INTO contacts (
        ingestion_id, contact_id, normalized_id, display_name,
        message_count, earliest_message, latest_message
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(ingestion_id, contact_id) DO UPDATE SET
        normalized_id = excluded.normalized_id,
        display_name = excluded.display_name,
        message_count = excluded.message_count,
        earliest_message = excluded.earliest_message,
        latest_message = excluded.latest_message
"#;

/// Get all contacts for the current ingestion run.
/// Joins with app_state to get contacts for curr_ingestion_id.
pub const SELECT_ALL_CONTACTS: &str = r#"
    SELECT
        c.contact_id,
        c.normalized_id,
        c.display_name,
        c.message_count,
        c.earliest_message,
        c.latest_message
    FROM contacts c
    JOIN app_state a ON c.ingestion_id = a.curr_ingestion_id
    WHERE a.id = 1
    ORDER BY c.message_count DESC
"#;

// =============================================================================
// Ingestion Settings Queries (brb.db - User Preferences)
// =============================================================================

/// Get the current ingestion settings
pub const SELECT_INGESTION_SETTINGS: &str = r#"
    SELECT start_date, end_date, min_messages_per_contact, analytics_settings
    FROM ingestion_settings
    WHERE id = 1
"#;

/// Update ingestion settings (upsert pattern with single row)
pub const UPDATE_INGESTION_SETTINGS: &str = r#"
    UPDATE ingestion_settings SET
        start_date = ?1,
        end_date = ?2,
        min_messages_per_contact = ?3,
        analytics_settings = ?4,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
"#;

// =============================================================================
// Conversation Analysis Queries (brb.db - Cached LLM Analysis)
// =============================================================================

/// Insert or update conversation analysis for a contact.
/// Uses UNIQUE(contact_id, ingestion_id) to ensure one analysis per contact per ingestion.
pub const INSERT_CONVERSATION_ANALYSIS: &str = r#"
    INSERT OR REPLACE INTO conversation_analysis (
        contact_id, ingestion_id, analysis_markdown, model_id,
        generation_duration_secs, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
"#;

/// Get cached conversation analysis for a contact from the current ingestion.
/// Joins with app_state to get analysis for curr_ingestion_id.
pub const SELECT_CONVERSATION_ANALYSIS: &str = r#"
    SELECT
        ca.contact_id,
        ca.analysis_markdown,
        ca.model_id,
        ca.generation_duration_secs,
        ca.created_at
    FROM conversation_analysis ca
    JOIN app_state a ON ca.ingestion_id = a.curr_ingestion_id
    WHERE ca.contact_id = ?1 AND a.id = 1
"#;

// =============================================================================
// Casper Thread Queries (brb.db - Saved Casper conversations)
// =============================================================================

/// Insert a new Casper thread. `?2` is used for both created_at and updated_at.
pub const INSERT_CASPER_THREAD: &str = r#"
    INSERT INTO casper_threads (title, created_at, updated_at)
    VALUES (?1, ?2, ?2)
"#;

/// List all Casper threads, most recently updated first.
pub const SELECT_CASPER_THREADS: &str = r#"
    SELECT id, title, created_at, updated_at
    FROM casper_threads
    ORDER BY updated_at DESC
"#;

/// Insert a single message into a thread.
pub const INSERT_CASPER_MESSAGE: &str = r#"
    INSERT INTO casper_messages
        (thread_id, role, content, thinking, thinking_enabled, tool_calls, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
"#;

/// Bump a thread's updated_at timestamp (called after appending a message).
pub const TOUCH_CASPER_THREAD: &str = r#"
    UPDATE casper_threads SET updated_at = ?2 WHERE id = ?1
"#;

/// Load all messages for a thread in chronological order.
pub const SELECT_CASPER_MESSAGES: &str = r#"
    SELECT id, role, content, thinking, thinking_enabled, tool_calls, created_at
    FROM casper_messages
    WHERE thread_id = ?1
    ORDER BY created_at ASC, id ASC
"#;

/// Rename a thread.
pub const RENAME_CASPER_THREAD: &str = r#"
    UPDATE casper_threads SET title = ?2 WHERE id = ?1
"#;

/// Delete a thread's messages (call before deleting the thread row).
pub const DELETE_CASPER_THREAD_MESSAGES: &str = r#"
    DELETE FROM casper_messages WHERE thread_id = ?1
"#;

/// Delete a thread row.
pub const DELETE_CASPER_THREAD: &str = r#"
    DELETE FROM casper_threads WHERE id = ?1
"#;

// =============================================================================
// DuckDB Queries (brb.duckdb - Vector Database)
// =============================================================================

/// Drop the legacy HNSW index (no longer created; semantic search scans exactly)
pub const DROP_HNSW_INDEX: &str = "DROP INDEX IF EXISTS idx_chunks_hnsw";

/// Create FTS index for BM25 full-text search on formatted_text
pub const CREATE_FTS_INDEX: &str = "PRAGMA create_fts_index('message_chunks', 'chunk_id', 'formatted_text', stemmer='english', stopwords='english', overwrite=1)";

/// Check if the FTS index exists by probing the internal FTS table
/// Runs one BM25 score to check that the FTS index works.
///
/// The filter sits outside the subquery: DuckDB 2.0 rejects a WHERE clause
/// that names the alias of a side-effecting expression such as `match_bm25`.
pub const PROBE_FTS_INDEX: &str = "SELECT COUNT(*) FROM (\
     SELECT fts_main_message_chunks.match_bm25(chunk_id, 'test') AS score FROM message_chunks\
     ) WHERE score IS NOT NULL";

pub const CHECK_FTS_INDEX_EXISTS: &str =
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fts_main_message_chunks'";

/// Insert a message chunk
pub const INSERT_MESSAGE_CHUNK: &str = r#"
    INSERT INTO message_chunks (
        chunk_id, chunk_data, embedding, start_message_id, end_message_id,
        message_ids, contact_id, contact_name, start_timestamp, end_timestamp,
        message_count, total_chars, has_from_me, has_from_them, has_questions, ingestion_id,
        formatted_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"#;

/// Get total number of chunks in the database
pub const SELECT_CHUNK_COUNT: &str = "SELECT COUNT(*) FROM message_chunks";

/// Get the number of distinct clusters (excluding noise cluster -1)
pub const SELECT_CLUSTER_COUNT: &str = "SELECT COUNT(DISTINCT cluster_id) FROM chunk_projections WHERE cluster_id >= 0";

// =============================================================================
// Dynamic Query Builders
// =============================================================================

/// Fetch full rows for chunks the in-memory exact scan selected, scored with the
/// same cosine expression as [`build_search_query`] so similarities are comparable
/// across both paths. Ids and floats only, so interpolation is injection-safe.
pub fn build_chunks_by_id_query(query_embedding: &[f32], chunk_ids: &[i64], include_embedding: bool) -> String {
    let embedding_str = format!(
        "[{}]",
        query_embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    let ids = chunk_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", ");
    let embedding_col = if include_embedding {
        ",\n            embedding AS embedding_vec"
    } else {
        ""
    };

    format!(
        r#"
        SELECT
            {CHUNK_COLUMNS}
            array_cosine_similarity(embedding, {embedding_str}::FLOAT[768]) AS similarity{embedding_col}
        FROM message_chunks
        WHERE chunk_id IN ({ids})
        -- An all-zero embedding scores NaN, which DuckDB sorts above every number.
        ORDER BY isnan(similarity), similarity DESC, end_timestamp DESC
        "#
    )
}

/// The chunk columns every chunk-returning search query projects, in the order
/// `row_to_search_result` reads them.
const CHUNK_COLUMNS: &str = "chunk_id,
            contact_id,
            contact_name,
            chunk_data,
            message_ids::VARCHAR AS message_ids,
            start_timestamp,
            end_timestamp,";

/// Build the AND-clauses for the optional contact/date filters, appending bind
/// values to `params`. Placeholder indices are derived from `params.len()`, so
/// this composes with callers that already pushed binds of their own.
fn filter_clauses(
    contact_id: Option<&str>,
    min_date: Option<DateTime<Utc>>,
    max_date: Option<DateTime<Utc>>,
    params: &mut Vec<String>,
) -> (String, String, String) {
    let contact_filter = match contact_id {
        Some(id) => {
            params.push(id.to_string());
            format!("AND contact_id = ${}", params.len())
        }
        None => String::new(),
    };

    let min_date_filter = match min_date {
        Some(d) => {
            params.push(d.to_rfc3339());
            format!("AND end_timestamp >= ${}", params.len())
        }
        None => String::new(),
    };

    let max_date_filter = match max_date {
        Some(d) => {
            params.push(d.to_rfc3339());
            format!("AND start_timestamp <= ${}", params.len())
        }
        None => String::new(),
    };

    (contact_filter, min_date_filter, max_date_filter)
}

/// Build a vector similarity search query with optional filters.
///
/// Constructs a DuckDB query that:
/// - Computes cosine similarity between query embedding and stored embeddings
/// - Optionally filters by contact_id, min_date, and max_date
/// - Orders by similarity descending
/// - Limits results
///
/// # Safety (SQL interpolation)
///
/// The embedding vector is interpolated directly into the SQL string rather than
/// using bind parameters because DuckDB's `list_cosine_similarity()` does not
/// accept parameterized array literals. This is safe because `f32::to_string()`
/// can only produce digits, decimal points, minus signs, "NaN", "inf", or "-inf"
/// — none of which can cause SQL injection.
///
/// # Arguments
/// * `query_embedding` - The embedding vector to search against
/// * `limit` - Maximum number of results to return
/// * `contact_id` - Optional filter to a specific contact
/// * `min_date` - Optional filter for results after this date
/// * `max_date` - Optional filter for results before this date
///
/// # Returns
/// A fully-formed SQL query string ready for execution
pub fn build_search_query(
    query_embedding: &[f32],
    limit: usize,
    contact_id: Option<&str>,
    min_date: Option<DateTime<Utc>>,
    max_date: Option<DateTime<Utc>>,
    include_embedding: bool,
) -> (String, Vec<String>) {
    // Build the embedding array string for DuckDB (float-only, safe to interpolate)
    let embedding_str = format!(
        "[{}]",
        query_embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );

    // Build parameterized filter clauses
    let mut params: Vec<String> = Vec::new();

    let (contact_filter, min_date_filter, max_date_filter) =
        filter_clauses(contact_id, min_date, max_date, &mut params);

    let embedding_col = if include_embedding {
        // Native FLOAT[768] array — read directly into Vec<f32> in Rust (no VARCHAR
        // cast + string re-parse, which was the dominant cost of `.with_embeddings()`).
        ",\n            embedding AS embedding_vec"
    } else {
        ""
    };

    let sql = format!(
        r#"
        SELECT
            {CHUNK_COLUMNS}
            array_cosine_similarity(embedding, {embedding_str}::FLOAT[768]) AS similarity{embedding_col}
        FROM message_chunks
        WHERE 1=1
            {contact_filter}
            {min_date_filter}
            {max_date_filter}
        -- An all-zero embedding scores NaN, which DuckDB sorts above every number.
        ORDER BY isnan(similarity), similarity DESC, end_timestamp DESC
        LIMIT {limit}
        "#,
        embedding_str = embedding_str,
        contact_filter = contact_filter,
        min_date_filter = min_date_filter,
        max_date_filter = max_date_filter,
        embedding_col = embedding_col,
        limit = limit,
    );

    (sql, params)
}

/// Build a BM25 full-text search query using DuckDB's FTS extension.
///
/// Uses the FTS index created on `message_chunks.formatted_text` during ingestion.
/// Returns results ranked by BM25 relevance score.
///
/// # Safety (SQL interpolation)
///
/// The BM25 query text is interpolated into the `match_bm25()` call because DuckDB's
/// FTS extension does not support bind parameters inside `match_bm25()`. To prevent
/// SQL injection, single quotes in the query text are escaped by doubling them
/// (standard SQL escaping). The query is also pre-processed through `strip_stopwords()`
/// which removes common words before interpolation.
///
/// # Arguments
/// * `query_text` - The search query text
/// * `limit` - Maximum number of results to return
/// * `contact_id` - Optional filter to a specific contact
/// * `min_date` - Optional filter for results after this date
/// * `max_date` - Optional filter for results before this date
///
/// # Returns
/// A fully-formed SQL query string and parameter values
pub fn build_bm25_search_query(
    query_text: &str,
    limit: usize,
    contact_id: Option<&str>,
    min_date: Option<DateTime<Utc>>,
    max_date: Option<DateTime<Utc>>,
    include_embedding: bool,
) -> (String, Vec<String>) {
    let mut params: Vec<String> = Vec::new();

    // Strip stopwords from query text before BM25 search.
    // Common words like "the", "was", "what" add noise to full-text matching.
    let filtered_query = strip_stopwords(query_text);

    // Inline BM25 query text as a sanitized string literal.
    // DuckDB's FTS match_bm25() may not support positional bind parameters,
    // which would cause silent failure (caught by graceful fallback).
    let sanitized_query = filtered_query.replace('\'', "''");

    // Build parameterized optional filter clauses
    let (contact_filter, min_date_filter, max_date_filter) =
        filter_clauses(contact_id, min_date, max_date, &mut params);

    let embedding_col = if include_embedding {
        // Native FLOAT[768] array — read directly into Vec<f32> in Rust (no VARCHAR
        // cast + string re-parse, which was the dominant cost of `.with_embeddings()`).
        ",\n            embedding AS embedding_vec"
    } else {
        ""
    };

    let sql = format!(
        r#"
        SELECT
            {CHUNK_COLUMNS}
            fts_main_message_chunks.match_bm25(chunk_id, '{sanitized_query}') AS bm25_score{embedding_col}
        FROM message_chunks
        WHERE fts_main_message_chunks.match_bm25(chunk_id, '{sanitized_query}') IS NOT NULL
            {contact_filter}
            {min_date_filter}
            {max_date_filter}
        ORDER BY bm25_score DESC
        LIMIT {limit}
        "#,
        sanitized_query = sanitized_query,
        embedding_col = embedding_col,
        contact_filter = contact_filter,
        min_date_filter = min_date_filter,
        max_date_filter = max_date_filter,
        limit = limit,
    );

    (sql, params)
}

/// Build a keyword (ILIKE) search query with optional filters.
///
/// Finds message chunks containing ALL of the given keywords (AND'd together).
/// Returns the same columns as `build_search_query` but with `similarity = 0.0`.
/// Results are ordered by `end_timestamp DESC` (most recent first).
pub fn build_keyword_search_query(
    keywords: &[String],
    limit: usize,
    contact_id: Option<&str>,
    min_date: Option<DateTime<Utc>>,
    max_date: Option<DateTime<Utc>>,
    include_embedding: bool,
) -> (String, Vec<String>) {
    let mut params: Vec<String> = Vec::new();
    let mut param_idx = 1usize;

    // Build parameterized keyword ILIKE conditions (AND'd together)
    let keyword_conditions: Vec<String> = keywords
        .iter()
        .map(|kw| {
            let clause = format!("chunk_data::VARCHAR ILIKE ${param_idx}");
            params.push(format!("%{kw}%"));
            param_idx += 1;
            clause
        })
        .collect();

    let keyword_filter = if keyword_conditions.is_empty() {
        "1=0".to_string() // No keywords = no results
    } else {
        keyword_conditions.join(" AND ")
    };

    // Build parameterized optional filter clauses
    let (contact_filter, min_date_filter, max_date_filter) =
        filter_clauses(contact_id, min_date, max_date, &mut params);

    // MMR skips candidates without an embedding, so a keyword-only hit needs one
    // to be selectable at all.
    let embedding_col = if include_embedding {
        ",\n            embedding AS embedding_vec"
    } else {
        ""
    };

    let sql = format!(
        r#"
        SELECT
            {CHUNK_COLUMNS}
            0.0::FLOAT AS similarity{embedding_col}
        FROM message_chunks
        WHERE {keyword_filter}
            {contact_filter}
            {min_date_filter}
            {max_date_filter}
        ORDER BY end_timestamp DESC
        LIMIT {limit}
        "#,
        keyword_filter = keyword_filter,
        embedding_col = embedding_col,
        contact_filter = contact_filter,
        min_date_filter = min_date_filter,
        max_date_filter = max_date_filter,
        limit = limit,
    );

    (sql, params)
}

/// Build a topic-cluster summary query over `chunk_projections`.
///
/// Returns `(sql, params)` — bind `params` positionally with `params_from_iter`.
/// Rows decode as `(i32, String, i64, String, String)`.
///
/// Noise points are excluded with `cluster_id >= 0` (`-1` marks unclustered chunks),
/// matching [`SELECT_CLUSTER_COUNT`] and the Insights queries in src-tauri.
///
/// # Timezone
///
/// `chunk_date` is `TIMESTAMP WITH TIME ZONE`, so the bounds are CAST to VARCHAR
/// to render in the DuckDB session timezone. This is load-bearing, not cosmetic:
/// reading a TIMESTAMPTZ straight into a Rust `String` renders `.naive_utc()`, which
/// puts evening-heavy clusters on the *next* calendar day and silently disagrees
/// with the Insights UI over the same rows.
///
/// # Safety (SQL interpolation)
///
/// `limit` is a `usize`, so it cannot carry injection. `contact_id` is parameterized.
pub fn build_cluster_summary_query(contact_id: Option<&str>, limit: usize) -> (String, Vec<String>) {
    let mut params: Vec<String> = Vec::new();

    let contact_filter = if let Some(id) = contact_id {
        params.push(id.to_string());
        format!("AND contact_id = ${}", params.len())
    } else {
        String::new()
    };

    let sql = format!(
        r#"
        SELECT
            cluster_id,
            cluster_label,
            COUNT(*)                         AS chunk_count,
            CAST(MIN(chunk_date) AS VARCHAR) AS earliest,
            CAST(MAX(chunk_date) AS VARCHAR) AS latest
        FROM chunk_projections
        WHERE cluster_id >= 0
            {contact_filter}
        GROUP BY cluster_id, cluster_label
        ORDER BY chunk_count DESC
        LIMIT {limit}
        "#
    );

    (sql, params)
}

/// Build a query for example message previews from a single topic cluster.
///
/// Returns `(sql, params)` — bind `params` positionally with `params_from_iter`.
/// Rows decode as a single `String`: `[contact | local date] preview`. The
/// stored preview has no contact header, so the agent needs this prefix.
///
/// # Safety (SQL interpolation)
///
/// `cluster_id` is an `i32` and `limit` a `usize`, so neither can carry injection.
/// `contact_id` is parameterized.
pub fn build_cluster_examples_query(cluster_id: i32, contact_id: Option<&str>, limit: usize) -> (String, Vec<String>) {
    let mut params: Vec<String> = Vec::new();

    let contact_filter = if let Some(id) = contact_id {
        params.push(id.to_string());
        format!("AND contact_id = ${}", params.len())
    } else {
        String::new()
    };

    let sql = format!(
        r#"
        SELECT '[' || COALESCE(contact_name, contact_id) || ' | '
            || CAST(CAST(chunk_date AS DATE) AS VARCHAR) || '] ' || message_preview
        FROM chunk_projections
        WHERE cluster_id = {cluster_id}
            {contact_filter}
        ORDER BY chunk_date DESC
        LIMIT {limit}
        "#
    );

    (sql, params)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_brute_force_and_bm25_embedding_is_native_not_varchar() {
        let embedding = vec![0.1, 0.2, 0.3];
        let (bf, _) = build_search_query(&embedding, 10, None, None, None, true);
        assert!(bf.contains("embedding AS embedding_vec"));
        assert!(!bf.contains("embedding::VARCHAR"));
        let (bm25, _) = build_bm25_search_query("hello", 10, None, None, None, true);
        assert!(bm25.contains("embedding AS embedding_vec"));
        assert!(!bm25.contains("embedding::VARCHAR"));
    }

    #[test]
    fn test_keyword_query_fetches_embedding_only_when_asked() {
        let keywords = vec!["tahoe".to_string()];
        let (with, _) = build_keyword_search_query(&keywords, 10, None, None, None, true);
        assert!(with.contains("embedding AS embedding_vec"));
        let (without, _) = build_keyword_search_query(&keywords, 10, None, None, None, false);
        assert!(!without.contains("embedding"));
    }

    #[test]
    fn test_brute_force_query_uses_cosine_similarity() {
        let embedding = vec![0.1, 0.2];
        let (sql, _) = build_search_query(&embedding, 10, None, None, None, false);
        assert!(
            sql.contains("array_cosine_similarity"),
            "brute-force must use cosine similarity"
        );
        assert!(sql.contains("ORDER BY isnan(similarity), similarity DESC"));
    }

    #[test]
    fn test_cluster_summary_query_shape() {
        let (sql, params) = build_cluster_summary_query(None, 10);
        assert!(params.is_empty(), "no contact filter → no params");
        assert!(
            sql.contains("cluster_id >= 0"),
            "must exclude unclustered chunks via >= 0, matching every other cluster query"
        );
        assert!(!sql.contains("!= -1"));
        // Dates must be rendered by DuckDB in session-local time, not decoded as UTC.
        assert!(sql.contains("CAST(MIN(chunk_date) AS VARCHAR)"));
        assert!(sql.contains("CAST(MAX(chunk_date) AS VARCHAR)"));
        assert!(sql.contains("LIMIT 10"));
        // cluster_color is a frontend concern — it must not cost the model tokens.
        assert!(!sql.contains("cluster_color"));
    }

    #[test]
    fn test_search_query_filters_are_parameterized_in_order() {
        let min = DateTime::parse_from_rfc3339("2023-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let max = DateTime::parse_from_rfc3339("2023-12-31T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let (sql, params) = build_search_query(&[0.0, 1.0], 5, Some("+15551234567"), Some(min), Some(max), false);

        assert_eq!(
            params,
            vec!["+15551234567".to_string(), min.to_rfc3339(), max.to_rfc3339()]
        );
        assert!(sql.contains("AND contact_id = $1"));
        assert!(sql.contains("AND end_timestamp >= $2"));
        assert!(sql.contains("AND start_timestamp <= $3"));
        assert!(
            !sql.contains("+15551234567"),
            "contact_id must be bound, never interpolated"
        );

        // No filters => no clauses and no binds.
        let (sql, params) = build_search_query(&[0.0, 1.0], 5, None, None, None, false);
        assert!(params.is_empty());
        assert!(!sql.contains("contact_id = $"));
    }

    #[test]
    fn test_cluster_summary_query_contact_filter_is_parameterized() {
        let (sql, params) = build_cluster_summary_query(Some("+15551234567"), 5);
        assert_eq!(params, vec!["+15551234567".to_string()]);
        assert!(sql.contains("AND contact_id = $1"));
        assert!(
            !sql.contains("+15551234567"),
            "contact_id must be bound, never interpolated"
        );
    }

    #[test]
    fn test_cluster_examples_query_filters_cluster_and_contact() {
        let (sql, params) = build_cluster_examples_query(3, Some("a@b.com"), 2);
        assert_eq!(params, vec!["a@b.com".to_string()]);
        assert!(sql.contains("cluster_id = 3"));
        assert!(sql.contains("AND contact_id = $1"));
        assert!(sql.contains("LIMIT 2"));
        assert!(sql.contains("COALESCE(contact_name, contact_id)"));

        let (sql, params) = build_cluster_examples_query(7, None, 2);
        assert!(params.is_empty());
        assert!(!sql.contains("AND contact_id"));
    }

    /// End-to-end decode check against a real DuckDB using the production
    /// `chunk_projections` column types.
    ///
    /// The live table is empty, so this path had never executed against actual rows.
    /// It pins both halves of the timezone bug: `chunk_date` is TIMESTAMPTZ, and an
    /// evening-in-New-York instant lands on the *next* UTC day. The CAST must report
    /// the local day (what the Insights UI shows), not the UTC one.
    #[test]
    fn test_cluster_summary_decodes_and_reports_local_dates() {
        let conn = duckdb::Connection::open_in_memory().expect("in-memory duckdb");
        conn.execute_batch(
            "SET TimeZone='America/New_York';
             CREATE TABLE chunk_projections (
                 cluster_id      INTEGER,
                 cluster_label   VARCHAR,
                 cluster_color   VARCHAR,
                 contact_id      VARCHAR,
                 contact_name    VARCHAR,
                 message_preview VARCHAR,
                 chunk_date      TIMESTAMP WITH TIME ZONE
             );
             INSERT INTO chunk_projections VALUES
                 (0, 'Dinner plans', '#fff', '+1555', 'Sam',  'pizza tonight?', TIMESTAMPTZ '2024-06-02 00:30:00+00'),
                 (0, 'Dinner plans', '#fff', '+1555', 'Sam',  'sounds good',    TIMESTAMPTZ '2024-06-04 15:00:00+00'),
                 (1, 'Work',         '#000', '+1666', NULL,   'standup at 9',   TIMESTAMPTZ '2024-07-01 12:00:00+00'),
                 (-1, 'Noise',       '#ccc', '+1555', 'Sam',  'noise point',    TIMESTAMPTZ '2024-06-03 12:00:00+00');",
        )
        .expect("schema + fixtures");

        let (sql, params) = build_cluster_summary_query(None, 10);
        let mut stmt = conn.prepare(&sql).expect("prepare");
        let rows: Vec<(i32, String, i64, String, String)> = stmt
            .query_map(duckdb::params_from_iter(params.iter()), |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .expect("query")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("every row must decode — a silent flatten() here reports 'no topics'");

        // Noise cluster (-1) excluded; ordered by count desc.
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, 0);
        assert_eq!(rows[0].1, "Dinner plans");
        assert_eq!(rows[0].2, 2);
        // 2024-06-02 00:30 UTC is 2024-06-01 20:30 EDT — the local day, one day earlier.
        assert!(
            rows[0].3.starts_with("2024-06-01"),
            "earliest must render in session tz, got {}",
            rows[0].3
        );
        assert!(rows[0].4.starts_with("2024-06-04"), "latest was {}", rows[0].4);

        // Contact filter narrows to one cluster and binds correctly.
        let (sql, params) = build_cluster_summary_query(Some("+1666"), 10);
        let mut stmt = conn.prepare(&sql).expect("prepare filtered");
        let labels: Vec<String> = stmt
            .query_map(duckdb::params_from_iter(params.iter()), |row| row.get::<_, String>(1))
            .expect("query filtered")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("decode filtered");
        assert_eq!(labels, vec!["Work".to_string()]);

        // Examples query decodes and respects both filters.
        let (sql, params) = build_cluster_examples_query(0, Some("+1555"), 2);
        let mut stmt = conn.prepare(&sql).expect("prepare examples");
        let previews: Vec<String> = stmt
            .query_map(duckdb::params_from_iter(params.iter()), |row| row.get::<_, String>(0))
            .expect("query examples")
            .collect::<std::result::Result<Vec<_>, _>>()
            .expect("decode examples");
        // Each preview carries a `[contact | local date]` prefix for the agent.
        assert_eq!(
            previews,
            vec![
                "[Sam | 2024-06-04] sounds good".to_string(),
                "[Sam | 2024-06-01] pizza tonight?".to_string()
            ]
        );
    }
}

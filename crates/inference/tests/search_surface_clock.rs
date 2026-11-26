//! The agent search surface, driven end to end against a fixture corpus.
//!
//! This is the seam the retrieval eval is built on: `SearchMessagesTool` is what
//! Casper actually calls, so it is the surface worth gating on. Two things have to
//! be true before a gold set can mean anything against it — the tool must be
//! pointable at a fixture database, and every time-dependent step of a search must
//! resolve against a clock the harness supplies rather than the wall clock.
//!
//! These tests assert exactly that, and nothing about retrieval quality yet.

use chrono::{DateTime, Utc};
use inference::agent::Tool;
use inference::agent::builtin::SearchMessagesTool;
use ingestion::{ChunkData, ChunkMessage, EMBEDDING_DIMS, MessageChunk, SearchOptions, VectorDb};
use serde_json::{Value, json};

fn ts(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

/// One chunk, dated `day`, attributed to `contact`. Every chunk shares the same
/// embedding so semantic similarity is constant and the assertions below isolate
/// the time-dependent behavior.
fn chunk(chunk_id: i64, contact: &str, day: &str, text: &str) -> MessageChunk {
    let stamp = format!("{day} 12:00:00+00");
    MessageChunk {
        chunk_id,
        chunk_data: ChunkData {
            messages: vec![ChunkMessage {
                sender: contact.to_string(),
                text: text.to_string(),
                ts: format!("{day}T12:00:00Z"),
                message_id: 1000 + chunk_id,
            }],
            formatted: text.to_string(),
        },
        embedding: vec![0.05; EMBEDDING_DIMS],
        start_message_id: 1000 + chunk_id,
        end_message_id: 1000 + chunk_id,
        message_ids: vec![1000 + chunk_id],
        contact_id: contact.to_string(),
        contact_name: Some(contact.to_string()),
        start_timestamp: stamp.clone(),
        end_timestamp: stamp,
        message_count: 1,
        total_chars: text.len() as i32,
        has_from_me: true,
        has_from_them: true,
        has_questions: false,
        formatted_text: Some(text.to_string()),
    }
}

/// A two-chunk corpus four months apart, so a "last month" window selects exactly
/// one of them depending on when "now" is.
///
/// The FTS index is created explicitly and *after* the rows land. `VectorDb::open_at`
/// runs `ensure_fts_index()` on an empty table, which returns early, and nothing
/// creates it later — so without this call `bm25_search_raw` errors, the error is
/// swallowed as "BM25 search unavailable, using semantic only", and the fixture
/// silently exercises a semantic-only pipeline. `bm25_contributes_to_ranking` below
/// is what keeps that from regressing.
///
/// HNSW is deliberately *not* created: at this size DuckDB scans exactly, which is
/// tie-stable and makes ordering fully determined. ANN recall at scale is a
/// different test.
fn build_fixture(db_path: &std::path::Path) {
    let db = VectorDb::open_at(db_path).expect("open fixture db");
    db.initialize().expect("initialize schema");
    db.insert_chunks(
        &[
            chunk(
                1,
                "Sarah",
                "2026-01-15",
                "Sarah: dinner at the ramen place was incredible",
            ),
            chunk(2, "Alex", "2026-05-15", "Alex: dinner at the taco spot was incredible"),
        ],
        1,
    )
    .expect("insert fixture chunks");
    db.create_fts_index().expect("create FTS index");
}

fn search(db_path: &std::path::Path, query: &str, now: DateTime<Utc>) -> Value {
    let tool = SearchMessagesTool::new().with_db_path(db_path).with_now(now);
    let result = tool
        .execute(json!({
            "query": query,
            "_embedding": vec![0.05_f32; EMBEDDING_DIMS],
        }))
        .expect("tool executed");
    assert!(result.success, "tool returned an error: {:?}", result.error);
    result.data
}

fn contacts_returned(response: &Value) -> Vec<String> {
    response["results"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r["contact_name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The tool searches the fixture, not `~/.be-right-back/data/db/brb.duckdb`.
///
/// Without this the eval could never drive the real agent surface — it would be
/// stuck testing `hybrid_search` one layer below what actually ships.
#[test]
fn search_tool_reads_the_fixture_database() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("eval.duckdb");
    build_fixture(&db_path);

    let response = search(&db_path, "dinner", ts("2026-06-01T12:00:00Z"));
    let mut names = contacts_returned(&response);
    names.sort();

    assert_eq!(names, vec!["Alex", "Sarah"], "both fixture chunks should be found");
}

/// The whole point of the clock seam: the same query over the same corpus resolves
/// "last month" against the *supplied* instant.
///
/// If any of the three clocks in a search (planner window, RRF recency term,
/// recency boost) still read the wall clock, this flip cannot happen — the window
/// would land on the real current month and both cases would return nothing.
#[test]
fn temporal_window_follows_the_pinned_clock() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("eval.duckdb");
    build_fixture(&db_path);

    // February 2026: "last month" is January -> Sarah's ramen dinner.
    let in_february = search(&db_path, "dinner last month", ts("2026-02-09T14:00:00Z"));
    assert_eq!(
        contacts_returned(&in_february),
        vec!["Sarah"],
        "a February clock should select the January chunk"
    );

    // June 2026: "last month" is May -> Alex's taco dinner.
    let in_june = search(&db_path, "dinner last month", ts("2026-06-09T14:00:00Z"));
    assert_eq!(
        contacts_returned(&in_june),
        vec!["Alex"],
        "a June clock should select the May chunk"
    );
}

/// The BM25 ranker must actually produce a list, not silently return nothing.
///
/// This has to assert on the ranker directly. Scoring the *fused* output can't do
/// it: three rankers feed RRF, and the ILIKE `keyword_search` matches the same
/// distinctive terms BM25 would, so a lexically-correct final ordering is produced
/// with or without an FTS index. Only `breakdown.bm25` distinguishes them.
///
/// The trap this guards is real. `VectorDb::open_at` runs `ensure_fts_index()`
/// while the table is still empty, so it returns early; if nothing calls
/// `create_fts_index()` afterwards, `bm25_search_raw` errors, the error is
/// swallowed as "BM25 search unavailable, using semantic only", and the fixture
/// quietly gates a semantic-only pipeline. Every other test in this file passes
/// either way, and any future RRF or fusion assertion built on it would be vacuous.
#[test]
fn bm25_ranker_is_populated() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("eval.duckdb");
    build_fixture(&db_path);

    let db = VectorDb::open_readonly_at(&db_path).expect("open fixture read-only");
    let options = SearchOptions::new()
        .with_limit(10)
        .with_query_text("ramen dinner")
        .with_now(ts("2026-06-01T12:00:00Z"));

    let breakdown = db
        .hybrid_search_breakdown(&vec![0.05_f32; EMBEDDING_DIMS], options)
        .expect("breakdown search");

    assert!(
        !breakdown.bm25.is_empty(),
        "BM25 returned nothing — the FTS index is missing, so this fixture is semantic-only"
    );
    assert_eq!(
        breakdown.bm25[0].contact_id, "Sarah",
        "'ramen' occurs only in Sarah's chunk, so it must top the BM25 list"
    );
}

/// A pinned clock must give the same answer every run, or a committed baseline
/// would drift on its own and every diff would be noise.
#[test]
fn pinned_clock_searches_are_reproducible() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("eval.duckdb");
    build_fixture(&db_path);

    let now = ts("2026-06-09T14:00:00Z");
    let first = search(&db_path, "dinner", now);
    let second = search(&db_path, "dinner", now);

    assert_eq!(
        first, second,
        "identical clock and corpus must produce identical output"
    );
}

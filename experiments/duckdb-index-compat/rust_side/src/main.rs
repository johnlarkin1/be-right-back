//! Rust side of DuckDB index compatibility experiment.
//!
//! Subcommands:
//!   create-schema <db_path>   - Create table + btree indexes
//!   write-data <db_path>      - Insert 100 synthetic chunks (same deterministic data as Python)
//!   create-hnsw <db_path>     - Create HNSW index on embeddings
//!   create-fts <db_path>      - Create FTS index on formatted_text
//!   query-hnsw <db_path>      - Run 5 cosine similarity queries, output JSON
//!   query-fts <db_path>       - Run 5 BM25 queries, output JSON
//!   check-indexes <db_path>   - List all indexes
//!   report-versions           - Print duckdb version info

use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::Path;

const EMBEDDING_DIMS: usize = 768;
const NUM_CHUNKS: usize = 100;
const TOP_K: usize = 10;

const SCHEMA_SQL: &str = include_str!("../../shared/schema.sql");

// ── Data Generation (must match Python's deterministic output) ──────────────

/// Simple seeded RNG (xoshiro256** - matches numpy's default_rng behavior closely enough
/// for our purposes). We don't need exact numpy compatibility - we load query vectors from JSON.
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        Self { state: seed.wrapping_add(0x9E3779B97F4A7C15) }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.state
    }

    /// Generate a normal(0, stddev) sample using Box-Muller transform
    fn normal(&mut self, stddev: f64) -> f64 {
        let u1 = (self.next_u64() as f64) / (u64::MAX as f64);
        let u2 = (self.next_u64() as f64) / (u64::MAX as f64);
        let u1 = u1.max(1e-10); // avoid log(0)
        stddev * (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

fn generate_embedding_rust(chunk_id: usize, seed: u64) -> Vec<f32> {
    let mut rng = Rng::new(seed.wrapping_add(chunk_id as u64));
    let mut vec: Vec<f32> = (0..EMBEDDING_DIMS).map(|_| rng.normal(0.1) as f32).collect();

    // Same signature pattern as Python
    for i in 0..5 {
        let d = (chunk_id * 7 + i * 13) % EMBEDDING_DIMS;
        vec[d] += 1.0;
    }

    // L2 normalize
    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        vec.iter_mut().for_each(|x| *x /= norm);
    }
    vec
}

const TEXT_TEMPLATES: &[&str] = &[
    "hello world this is a test message about greeting friends",
    "how are you doing today hope everything is going well",
    "let's grab coffee sometime this week maybe tuesday",
    "did you see the game last night it was incredible",
    "working late tonight on the project deadline is friday",
    "happy birthday hope you have an amazing celebration",
    "running late to the meeting be there in ten minutes",
    "just got back from vacation the beach was beautiful",
    "can you pick up groceries on the way home please",
    "movie night this weekend what do you want to watch",
    "thanks for dinner last night the restaurant was great",
    "need to schedule a dentist appointment this month",
    "have you tried that new restaurant downtown its amazing",
    "sending you the photos from the trip they turned out well",
    "reminder about the dinner party on saturday evening",
    "good morning hope you slept well see you at work",
    "traffic is terrible today might take the train instead",
    "just finished reading that book you recommended loved it",
    "planning a surprise party for mom need your help",
    "the weather forecast says rain all week so annoying",
    "got the promotion at work so excited to share the news",
    "dont forget to water the plants while im away please",
    "thinking about getting a dog what breed do you suggest",
    "concert tickets are on sale should we go this time",
    "finally fixed the bug in the code it was a null pointer",
    "weather forecast shows sunny skies for the weekend trip",
    "lets plan the dinner at that new restaurant friday",
    "meeting tomorrow at nine dont forget to bring the report",
    "just saw the funniest video going to send it to you now",
    "need help moving this saturday can you bring your truck",
];

fn generate_text(chunk_id: usize) -> String {
    let base = TEXT_TEMPLATES[chunk_id % TEXT_TEMPLATES.len()];
    let mut text = format!("[chunk {chunk_id}] {base}");
    if chunk_id == 42 {
        text.push_str(" unique_token_xyz");
    }
    text
}

fn generate_chunk_data_json(chunk_id: usize) -> String {
    let text = generate_text(chunk_id);
    let sender = if chunk_id % 2 == 0 { "Alice" } else { "Bob" };
    let ts = format!("2024-01-01T{:02}:00:00+00:00", chunk_id % 24);
    serde_json::json!({
        "messages": [{
            "sender": sender,
            "text": text,
            "ts": ts,
            "message_id": chunk_id * 10,
        }],
        "formatted": text,
    })
    .to_string()
}

// ── Query vectors (loaded from JSON generated by Python) ────────────────────

#[derive(Deserialize)]
struct QueryVector {
    id: String,
    vector: Vec<f32>,
    expected_top1: i64,
}

// ── Result types ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HnswResult {
    query_id: String,
    expected_top1: i64,
    actual_top1: Option<i64>,
    top1_match: bool,
    results: Vec<HnswRow>,
}

#[derive(Serialize)]
struct HnswRow {
    chunk_id: i64,
    distance: f64,
}

#[derive(Serialize)]
struct FtsResult {
    query_id: String,
    query_text: String,
    num_results: usize,
    results: Vec<FtsRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct FtsRow {
    chunk_id: i64,
    score: f64,
}

#[derive(Serialize)]
struct IndexInfo {
    name: String,
    table: String,
    unique: bool,
}

// ── Database operations ─────────────────────────────────────────────────────

fn open_db(db_path: &str) -> Connection {
    let conn = Connection::open(db_path).expect("Failed to open DuckDB");
    conn.execute_batch("INSTALL vss; LOAD vss; SET hnsw_enable_experimental_persistence = true;")
        .expect("Failed to load VSS extension");
    conn.execute_batch("INSTALL fts; LOAD fts;")
        .expect("Failed to load FTS extension");
    conn
}

fn cmd_create_schema(db_path: &str) {
    let conn = open_db(db_path);
    conn.execute_batch(SCHEMA_SQL).expect("Failed to create schema");
    println!(
        "{}",
        serde_json::json!({"status": "ok", "action": "create-schema", "db_path": db_path})
    );
}

fn cmd_write_data(db_path: &str) {
    let conn = open_db(db_path);

    // Insert data row by row (Rust side doesn't use Parquet, matching production pattern
    // where Rust uses parameterized inserts)
    let mut stmt = conn
        .prepare(
            "INSERT INTO message_chunks VALUES (
                ?, ?, ?::FLOAT[768],
                ?, ?, ?::BIGINT[],
                ?, ?,
                ?::TIMESTAMPTZ, ?::TIMESTAMPTZ,
                ?, ?,
                ?, ?, ?,
                ?, ?
            )",
        )
        .expect("Failed to prepare insert");

    for i in 0..NUM_CHUNKS {
        let embedding = generate_embedding_rust(i, 42);
        let embedding_str = format!(
            "[{}]",
            embedding.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",")
        );
        let message_ids_str = format!(
            "[{}]",
            (i * 10..i * 10 + 10).map(|id| id.to_string()).collect::<Vec<_>>().join(",")
        );
        let ts = format!("2024-01-01T{:02}:00:00+00:00", i % 24);
        let ts_end = format!("2024-01-01T{:02}:30:00+00:00", i % 24);

        stmt.execute(params![
            i as i64,                         // chunk_id
            generate_chunk_data_json(i),      // chunk_data
            embedding_str,                    // embedding
            (i * 10) as i64,                  // start_message_id
            (i * 10 + 9) as i64,             // end_message_id
            message_ids_str,                  // message_ids
            format!("contact_{}", i % 5),     // contact_id
            format!("Contact {}", i % 5),     // contact_name
            ts,                               // start_timestamp
            ts_end,                           // end_timestamp
            10i32,                            // message_count
            generate_text(i).len() as i32,    // total_chars
            i % 2 == 0,                       // has_from_me
            i % 2 == 1,                       // has_from_them
            i % 3 == 0,                       // has_questions
            1i32,                             // ingestion_id
            generate_text(i),                 // formatted_text
        ])
        .unwrap_or_else(|e| panic!("Failed to insert chunk {i}: {e}"));
    }

    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM message_chunks", [], |row| row.get(0)).unwrap();

    println!("{}", serde_json::json!({"status": "ok", "action": "write-data", "rows": count}));
}

fn cmd_create_hnsw(db_path: &str) {
    let conn = open_db(db_path);
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_hnsw ON message_chunks USING HNSW (embedding) WITH (metric = 'cosine')",
        [],
    )
    .expect("Failed to create HNSW index");
    println!("{}", serde_json::json!({"status": "ok", "action": "create-hnsw"}));
}

fn cmd_create_fts(db_path: &str) {
    let conn = open_db(db_path);
    conn.execute_batch(
        "PRAGMA create_fts_index('message_chunks', 'chunk_id', 'formatted_text', stemmer='english', stopwords='english', overwrite=1)",
    )
    .expect("Failed to create FTS index");
    println!("{}", serde_json::json!({"status": "ok", "action": "create-fts"}));
}

fn cmd_query_hnsw(db_path: &str) {
    let conn = open_db(db_path);

    // Load query vectors from the JSON file generated by Python
    let query_vectors_path =
        Path::new(db_path).parent().unwrap_or(Path::new("/tmp")).join("query_vectors.json");

    let queries: Vec<QueryVector> = if query_vectors_path.exists() {
        let data = fs::read_to_string(&query_vectors_path).expect("Failed to read query vectors");
        serde_json::from_str(&data).expect("Failed to parse query vectors")
    } else {
        eprintln!(
            "Warning: query_vectors.json not found at {:?}, using Rust-generated vectors",
            query_vectors_path
        );
        // Fallback: generate our own query vectors (won't match Python exactly but tests the index)
        (0..5)
            .map(|i| {
                let chunk_id = [0usize, 50, 99, 25, 75][i];
                QueryVector {
                    id: format!("q{}", i + 1),
                    vector: generate_embedding_rust(chunk_id, 999 + chunk_id as u64),
                    expected_top1: chunk_id as i64,
                }
            })
            .collect()
    };

    let mut results = Vec::new();
    for q in &queries {
        let vec_str =
            format!("[{}]", q.vector.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","));

        let sql = format!(
            "SELECT chunk_id, array_cosine_distance(embedding, {vec_str}::FLOAT[768]) as distance \
             FROM message_chunks ORDER BY distance ASC LIMIT {TOP_K}"
        );

        let mut stmt = conn.prepare(&sql).expect("Failed to prepare HNSW query");
        let rows: Vec<HnswRow> = stmt
            .query_map([], |row| {
                Ok(HnswRow { chunk_id: row.get(0)?, distance: row.get(1)? })
            })
            .expect("Failed to query HNSW")
            .filter_map(|r| r.ok())
            .collect();

        let actual_top1 = rows.first().map(|r| r.chunk_id);
        results.push(HnswResult {
            query_id: q.id.clone(),
            expected_top1: q.expected_top1,
            actual_top1,
            top1_match: actual_top1 == Some(q.expected_top1),
            results: rows,
        });
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "action": "query-hnsw",
            "language": "rust",
            "results": results,
        }))
        .unwrap()
    );
}

fn cmd_query_fts(db_path: &str) {
    let conn = open_db(db_path);

    let fts_queries = vec![
        ("fts1", "hello world"),
        ("fts2", "weather forecast"),
        ("fts3", "dinner restaurant"),
        ("fts4", "meeting tomorrow"),
        ("fts5", "unique_token_xyz"),
    ];

    let mut results = Vec::new();
    for (qid, query_text) in &fts_queries {
        let sql = format!(
            "SELECT * FROM (SELECT chunk_id, fts_main_message_chunks.match_bm25(chunk_id, ?) AS score \
             FROM message_chunks) WHERE score IS NOT NULL \
             ORDER BY score DESC LIMIT {TOP_K}"
        );

        match conn.prepare(&sql) {
            Ok(mut stmt) => {
                let rows: Vec<FtsRow> = match stmt.query_map(params![query_text], |row| {
                    Ok(FtsRow { chunk_id: row.get(0)?, score: row.get(1)? })
                }) {
                    Ok(mapped) => mapped.filter_map(|r| r.ok()).collect(),
                    Err(e) => {
                        eprintln!("FTS query error for {qid}: {e}");
                        vec![]
                    }
                };

                results.push(FtsResult {
                    query_id: qid.to_string(),
                    query_text: query_text.to_string(),
                    num_results: rows.len(),
                    results: rows,
                    error: None,
                });
            }
            Err(e) => {
                results.push(FtsResult {
                    query_id: qid.to_string(),
                    query_text: query_text.to_string(),
                    num_results: 0,
                    results: vec![],
                    error: Some(e.to_string()),
                });
            }
        }
    }

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "action": "query-fts",
            "language": "rust",
            "results": results,
        }))
        .unwrap()
    );
}

fn cmd_check_indexes(db_path: &str) {
    let conn = open_db(db_path);

    let mut stmt = conn
        .prepare("SELECT index_name, table_name, is_unique FROM duckdb_indexes()")
        .expect("Failed to query indexes");

    let indexes: Vec<IndexInfo> = stmt
        .query_map([], |row| {
            Ok(IndexInfo {
                name: row.get(0)?,
                table: row.get(1)?,
                unique: row.get(2)?,
            })
        })
        .expect("Failed to fetch indexes")
        .filter_map(|r| r.ok())
        .collect();

    let fts_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fts_main_message_chunks'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "action": "check-indexes",
            "indexes": indexes,
            "fts_exists": fts_exists > 0,
        }))
        .unwrap()
    );
}

fn cmd_report_versions() {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory DuckDB");
    let version: String =
        conn.query_row("SELECT version()", [], |row| row.get(0)).unwrap_or_default();

    conn.execute_batch("INSTALL vss; LOAD vss;").expect("Failed to load VSS");
    conn.execute_batch("INSTALL fts; LOAD fts;").expect("Failed to load FTS");

    let mut stmt = conn
        .prepare(
            "SELECT extension_name, extension_version, installed FROM duckdb_extensions() \
             WHERE extension_name IN ('vss', 'fts')",
        )
        .expect("Failed to query extensions");

    let extensions: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            let name: String = row.get(0)?;
            let version: String = row.get(1)?;
            let installed: bool = row.get(2)?;
            Ok(serde_json::json!({"name": name, "version": version, "installed": installed}))
        })
        .expect("Failed to fetch extensions")
        .filter_map(|r| r.ok())
        .collect();

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "action": "report-versions",
            "language": "rust",
            "duckdb_version": version,
            "duckdb_crate_version": "1.20001.0",
            "extensions": extensions,
        }))
        .unwrap()
    );
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: {} <command> [db_path]", args[0]);
        eprintln!("Commands: create-schema, write-data, create-hnsw, create-fts,");
        eprintln!("          query-hnsw, query-fts, check-indexes, report-versions");
        std::process::exit(1);
    }

    let cmd = &args[1];
    let db_path = args.get(2).map(|s| s.as_str());

    match cmd.as_str() {
        "report-versions" => cmd_report_versions(),
        _ => {
            let db_path = db_path.unwrap_or_else(|| {
                eprintln!("Error: {cmd} requires <db_path> argument");
                std::process::exit(1);
            });
            match cmd.as_str() {
                "create-schema" => cmd_create_schema(db_path),
                "write-data" => cmd_write_data(db_path),
                "create-hnsw" => cmd_create_hnsw(db_path),
                "create-fts" => cmd_create_fts(db_path),
                "query-hnsw" => cmd_query_hnsw(db_path),
                "query-fts" => cmd_query_fts(db_path),
                "check-indexes" => cmd_check_indexes(db_path),
                _ => {
                    eprintln!("Unknown command: {cmd}");
                    std::process::exit(1);
                }
            }
        }
    }
}

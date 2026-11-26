//! Exact nearest-neighbour search over an in-memory copy of every chunk embedding.
//!
//! Replaces the DuckDB HNSW index for semantic candidate retrieval. On a 229k-chunk
//! production database that index returned ~24% of the true top-10 for
//! question-style queries. Most of the loss was stale entries from re-ingestion; a
//! clean index at DuckDB defaults still recalls only ~56% for questions (vs ~96%
//! for chunk-like queries), because the graph links chunks to chunks. At this scale
//! a flat scan is exact, ~700MB at 229k, and ~11ms single-threaded at 248k (M4 Max,
//! release).
//!
//! The matrix is cached per database file and reloaded when the chunk table
//! changes (row count, max chunk_id or max ingestion_id moved), so re-ingestion
//! needs no explicit invalidation hook.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Instant;

use common::{BrbError, Result};
use duckdb::Connection;
use duckdb::arrow::array::{Array, FixedSizeListArray, Float32Array, Int64Array};
use tracing::{debug, info};

use crate::vectordb::EMBEDDING_DIMS;

/// Identifies one state of `message_chunks`; any ingestion changes at least one field.
type Fingerprint = (i64, Option<i64>, Option<i64>);

pub(crate) struct EmbeddingMatrix {
    fingerprint: Fingerprint,
    ids: Vec<i64>,
    /// Row-major, `EMBEDDING_DIMS` floats per chunk, each row L2-normalized (or all
    /// zero), so a dot product with a normalized query is cosine similarity.
    data: Vec<f32>,
}

impl EmbeddingMatrix {
    /// The `k` most cosine-similar chunks to `query`, best first, as `(chunk_id, similarity)`.
    ///
    /// ponytail: single-threaded full scan, ~11ms at 248k chunks. Split rows across
    /// `std::thread::scope` workers if latency matters, or bring back an index once
    /// corpora reach the millions.
    pub(crate) fn top_k(&self, query: &[f32], k: usize) -> Vec<(i64, f32)> {
        if query.len() != EMBEDDING_DIMS || k == 0 || self.ids.is_empty() {
            return vec![];
        }
        let mut q = query.to_vec();
        normalize(&mut q);

        let mut scored: Vec<(f32, u32)> = self
            .data
            .as_chunks::<EMBEDDING_DIMS>()
            .0
            .iter()
            .enumerate()
            .map(|(row, v)| (dot(v, &q), row as u32))
            .collect();

        let by_score_desc = |a: &(f32, u32), b: &(f32, u32)| b.0.total_cmp(&a.0);
        if k < scored.len() {
            scored.select_nth_unstable_by(k, by_score_desc);
            scored.truncate(k);
        }
        scored.sort_unstable_by(by_score_desc);
        scored.into_iter().map(|(s, row)| (self.ids[row as usize], s)).collect()
    }

    #[cfg(test)]
    fn from_rows(rows: &[(i64, Vec<f32>)]) -> Self {
        let mut m = Self {
            fingerprint: (0, None, None),
            ids: vec![],
            data: vec![],
        };
        for (id, v) in rows {
            let mut v = v.clone();
            normalize(&mut v);
            m.ids.push(*id);
            m.data.extend_from_slice(&v);
        }
        m
    }
}

/// Sums into 16 independent lanes. Float addition is not associative, so LLVM
/// cannot vectorize a single in-order sum; this is ~7x faster on the full scan.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let ((a16, a_tail), (b16, b_tail)) = (a.as_chunks::<16>(), b.as_chunks::<16>());
    let tail: f32 = a_tail.iter().zip(b_tail).map(|(x, y)| x * y).sum();
    let mut acc = [0.0f32; 16];
    for (x, y) in a16.iter().zip(b16) {
        for i in 0..16 {
            acc[i] += x[i] * y[i];
        }
    }
    acc.iter().sum::<f32>() + tail
}

/// Scale to unit length; a zero vector stays zero (similarity 0 to everything).
fn normalize(v: &mut [f32]) {
    let norm = dot(v, v).sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
}

/// Drop every cached matrix. A search still holding an `Arc` keeps its copy until
/// it finishes; the next search reloads from the database.
///
/// Called before the Python pipelines open `brb.duckdb` for writing, so the ~700MB
/// copy is not resident next to the MLX model during ingestion or analytics.
pub(crate) fn evict_all() {
    let mut cache = cache().lock().unwrap_or_else(PoisonError::into_inner);
    if !cache.is_empty() {
        cache.clear();
        debug!("Evicted cached embedding matrices");
    }
}

fn cache() -> &'static Mutex<HashMap<PathBuf, Arc<EmbeddingMatrix>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<EmbeddingMatrix>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// The embedding matrix for the database `conn` is attached to, loading it on first
/// use and reloading it if the chunk table has changed since.
///
/// The lock is held across a load, so concurrent first searches wait for one load
/// rather than each paying for their own.
pub(crate) fn for_connection(conn: &Connection) -> Result<Arc<EmbeddingMatrix>> {
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM duckdb_databases() WHERE database_name = current_database()",
            [],
            |r| r.get(0),
        )
        .map_err(|e| BrbError::database("failed to resolve vector db path", e))?;
    let fingerprint: Fingerprint = conn
        .query_row(
            "SELECT count(*), max(chunk_id), max(ingestion_id) FROM message_chunks",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| BrbError::database("failed to fingerprint message_chunks", e))?;

    // In-memory databases have no path to key on; load fresh rather than risk
    // handing one database another's matrix.
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        return Ok(Arc::new(load(conn, fingerprint)?));
    };

    let mut cache = cache().lock().unwrap_or_else(PoisonError::into_inner);
    let key = PathBuf::from(path);
    if let Some(m) = cache.get(&key).filter(|m| m.fingerprint == fingerprint) {
        return Ok(Arc::clone(m));
    }

    let started = Instant::now();
    let matrix = Arc::new(load(conn, fingerprint)?);
    info!(
        chunks = matrix.ids.len(),
        mb = matrix.data.len() * 4 / 1_000_000,
        ms = started.elapsed().as_millis() as u64,
        "Loaded embedding matrix for exact vector search"
    );
    cache.insert(key, Arc::clone(&matrix));
    Ok(matrix)
}

fn load(conn: &Connection, fingerprint: Fingerprint) -> Result<EmbeddingMatrix> {
    let mut stmt = conn
        .prepare("SELECT chunk_id, embedding FROM message_chunks")
        .map_err(|e| BrbError::database("failed to prepare embedding load", e))?;
    let batches = stmt
        .query_arrow([])
        .map_err(|e| BrbError::database("failed to load embeddings", e))?;

    let capacity = fingerprint.0.max(0) as usize;
    let mut ids = Vec::with_capacity(capacity);
    let mut data = Vec::with_capacity(capacity * EMBEDDING_DIMS);
    let mut skipped = 0usize;
    for batch in batches {
        let chunk_ids = batch.column(0).as_any().downcast_ref::<Int64Array>();
        let embeddings = batch.column(1).as_any().downcast_ref::<FixedSizeListArray>();
        let (Some(chunk_ids), Some(embeddings)) = (chunk_ids, embeddings) else {
            return Err(BrbError::Serialization(
                "unexpected column types loading embeddings (want BIGINT, FLOAT[768])".into(),
            ));
        };
        for row in 0..batch.num_rows() {
            let values = embeddings.value(row);
            let floats = values.as_any().downcast_ref::<Float32Array>();
            match floats {
                // A NaN row would score NaN, which `total_cmp` ranks above every real score.
                Some(f)
                    if embeddings.is_valid(row)
                        && f.len() == EMBEDDING_DIMS
                        && f.values().iter().all(|x| x.is_finite()) =>
                {
                    let start = data.len();
                    data.extend_from_slice(f.values());
                    normalize(&mut data[start..]);
                    ids.push(chunk_ids.value(row));
                }
                _ => skipped += 1,
            }
        }
    }
    if skipped > 0 {
        debug!(skipped, "Skipped chunks with null, malformed or non-finite embeddings");
    }
    Ok(EmbeddingMatrix { fingerprint, ids, data })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(i: usize) -> Vec<f32> {
        let mut v = vec![0.0; EMBEDDING_DIMS];
        v[i] = 1.0;
        v
    }

    #[test]
    fn top_k_is_exact_and_ordered() {
        let mut near = unit(0);
        near[1] = 0.5; // cos to unit(0) ~0.894
        let m = EmbeddingMatrix::from_rows(&[
            (10, unit(1)),
            (20, near),
            (30, unit(0)),
            (40, vec![0.0; EMBEDDING_DIMS]),
        ]);

        // Unnormalized query: scoring must still be cosine.
        let mut q = unit(0);
        q[0] = 3.0;
        let top = m.top_k(&q, 2);

        assert_eq!(top.iter().map(|t| t.0).collect::<Vec<_>>(), vec![30, 20]);
        assert!((top[0].1 - 1.0).abs() < 1e-6);
        assert!((top[1].1 - 0.894_427).abs() < 1e-5);
    }

    #[test]
    fn top_k_larger_than_corpus_returns_everything() {
        let m = EmbeddingMatrix::from_rows(&[(1, unit(0)), (2, unit(1))]);
        assert_eq!(m.top_k(&unit(1), 10).len(), 2);
        assert!(
            m.top_k(&[1.0, 2.0], 10).is_empty(),
            "wrong-dimension query must not panic"
        );
    }

    #[test]
    fn dot_matches_in_order_sum_including_tail() {
        // 37 = two full 16-lanes plus a 5-element tail.
        let a: Vec<f32> = (0..37).map(|i| i as f32 * 0.5 - 4.0).collect();
        let b: Vec<f32> = (0..37).map(|i| 1.0 - i as f32 * 0.25).collect();
        let naive: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
        assert!((dot(&a, &b) - naive).abs() < 1e-3);
    }

    #[test]
    fn non_finite_rows_are_skipped_on_load() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE message_chunks (chunk_id BIGINT, embedding FLOAT[768], ingestion_id INTEGER);
             INSERT INTO message_chunks SELECT 1, list_transform(range(768), lambda i: CASE WHEN i = 0 THEN 1.0 ELSE 0.0 END)::FLOAT[768], 1;
             INSERT INTO message_chunks SELECT 2, list_transform(range(768), lambda i: 'nan'::FLOAT)::FLOAT[768], 1;",
        )
        .unwrap();

        let m = for_connection(&conn).unwrap();
        assert_eq!(m.top_k(&unit(5), 2), vec![(1, 0.0)], "NaN row must not rank first");
    }

    #[test]
    fn loads_from_duckdb_and_reloads_when_chunks_change() {
        // File-backed: in-memory databases bypass the cache this test is about.
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("chunks.duckdb")).unwrap();
        conn.execute_batch(
            "CREATE TABLE message_chunks (chunk_id BIGINT, embedding FLOAT[768], ingestion_id INTEGER);",
        )
        .unwrap();
        let insert = |id: i64, dim: usize, ingestion: i32| {
            conn.execute(
                &format!(
                    "INSERT INTO message_chunks SELECT {id}, list_transform(range(768), lambda i: CASE WHEN i = {dim} THEN 2.0 ELSE 0.0 END)::FLOAT[768], {ingestion}"
                ),
                [],
            )
            .unwrap();
        };
        insert(1, 0, 1);
        insert(2, 1, 1);

        let m = for_connection(&conn).unwrap();
        assert_eq!(m.top_k(&unit(1), 1), vec![(2, 1.0)]);

        // Re-ingestion: same row count, new ids -- the cached matrix must not be reused.
        conn.execute_batch("DELETE FROM message_chunks").unwrap();
        insert(3, 0, 2);
        insert(4, 1, 2);
        let m = for_connection(&conn).unwrap();
        assert_eq!(m.top_k(&unit(1), 1), vec![(4, 1.0)]);
    }

    #[test]
    fn evict_all_drops_the_cached_matrix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("evict.duckdb");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE message_chunks (chunk_id BIGINT, embedding FLOAT[768], ingestion_id INTEGER);
             INSERT INTO message_chunks SELECT 1, list_transform(range(768), lambda i: 1.0)::FLOAT[768], 1;",
        )
        .unwrap();
        for_connection(&conn).unwrap();
        let cached = |c: &HashMap<PathBuf, Arc<EmbeddingMatrix>>| c.keys().any(|k| k.ends_with("evict.duckdb"));
        assert!(cached(&cache().lock().unwrap()));

        evict_all();
        assert!(!cached(&cache().lock().unwrap()));
    }
}

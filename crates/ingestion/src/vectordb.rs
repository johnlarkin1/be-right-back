//! DuckDB vector database (brb.duckdb) management.
//!
//! This module manages the vector database used for RAG (Retrieval-Augmented Generation).
//! It stores message chunks with their embeddings for semantic search.

use crate::queries;
use common::{BrbError, Result};
use duckdb::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;
use tracing::{debug, info};

/// DuckDB schema loaded from sql/duckdb_schema.sql at compile time
const DUCKDB_SCHEMA: &str = include_str!("../sql/duckdb_schema.sql");

/// Embedding dimensions (768 for modernbert-embed-base)
pub const EMBEDDING_DIMS: usize = 768;

/// How this process holds brb.duckdb: the read-only primary, live read handles,
/// and live write leases.
///
/// DuckDB allows many readers or one writer across processes, not both. Every
/// read connection the app hands out is a `try_clone()` of one cached read-only
/// "primary", and each clone keeps the file's shared lock alive. So a writer
/// (Rust or a Python child) has to wait until the primary and every clone are
/// gone, and no read may reopen the primary while it writes.
///
/// The primary exists because opening a fresh connection per query (the desktop
/// fires ~10/second at startup) re-loads the vss+fts extensions and re-binds
/// persisted indexes every time. Under memory pressure that tripped DuckDB's
/// index-bind assertion (`table_index_list.cpp` `unbound_count == 0`).
struct DbAccess {
    primary: Option<Connection>,
    /// Live [`ReadHandle`]s. A writer waits for this to reach zero.
    readers: usize,
    /// Live [`WriteLease`]s. While above zero, `open_readonly()` refuses.
    writers: usize,
}

static ACCESS: OnceLock<(Mutex<DbAccess>, Condvar)> = OnceLock::new();

/// How long a writer waits for in-flight reads to finish.
const READER_DRAIN_TIMEOUT: Duration = Duration::from_secs(30);

fn access() -> &'static (Mutex<DbAccess>, Condvar) {
    ACCESS.get_or_init(|| {
        (
            Mutex::new(DbAccess {
                primary: None,
                readers: 0,
                writers: 0,
            }),
            Condvar::new(),
        )
    })
}

fn lock_access() -> MutexGuard<'static, DbAccess> {
    access().0.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Keeps one clone of the primary counted. Dropping it lets a waiting writer go.
struct ReadHandle(());

impl ReadHandle {
    /// Count a new reader. The caller holds the access lock.
    fn register(state: &mut DbAccess) -> Self {
        state.readers += 1;
        Self(())
    }
}

impl Drop for ReadHandle {
    fn drop(&mut self) {
        let mut state = lock_access();
        state.readers -= 1;
        drop(state);
        access().1.notify_all();
    }
}

/// Exclusive right to write brb.duckdb, from this process or a Python child.
///
/// While any lease lives, the read-only primary stays closed and
/// [`VectorDb::open_readonly`] returns [`BrbError::Busy`]. Leases nest: a
/// second lease in the same process does not wait. Dropping the last lease
/// lets the next read reopen the primary with fresh data.
#[must_use = "the write lock is released when the lease drops"]
pub struct WriteLease(());

impl Drop for WriteLease {
    fn drop(&mut self) {
        let mut state = lock_access();
        state.writers -= 1;
        drop(state);
        access().1.notify_all();
    }
}

/// Take the write lock on brb.duckdb for this process.
///
/// Closes the read-only primary, evicts the cached embedding matrix (~700MB),
/// and waits up to 30 s for in-flight reads to drop their connections. Once
/// this returns, no connection in this process holds the file, so a read-write
/// open here or in a Python child gets the exclusive lock.
pub fn acquire_write_lease() -> Result<WriteLease> {
    let mut state = lock_access();
    state.writers += 1;
    let lease = WriteLease(());

    if state.primary.take().is_some() {
        debug!("Closed shared read-only vector database connection for a writer");
    }
    crate::embedding_matrix::evict_all();

    let (state, _) = access()
        .1
        .wait_timeout_while(state, READER_DRAIN_TIMEOUT, |s| s.readers > 0)
        .unwrap_or_else(PoisonError::into_inner);
    let readers = state.readers;
    // Release the access lock before the lease can drop: its Drop takes the lock.
    drop(state);

    if readers > 0 {
        return Err(BrbError::Busy(format!(
            "{readers} read connection(s) to the vector database did not close within {}s",
            READER_DRAIN_TIMEOUT.as_secs()
        )));
    }
    Ok(lease)
}

/// Whether `db_path` is the canonical `brb.duckdb` that the read-only primary caches.
///
/// Used to decide if a read-write open has to evict the shared read-only
/// connection. Canonicalizes when both sides exist on disk so `..`/symlink
/// spellings of the same file still match; falls back to a plain comparison when
/// either side is absent (the canonical path is deterministic, and a fixture path
/// that doesn't resolve is by definition not the primary).
fn is_primary_db_path(db_path: &Path) -> bool {
    let Ok(canonical) = common::get_brb_duckdb_db() else {
        return false;
    };
    match (db_path.canonicalize(), canonical.canonicalize()) {
        (Ok(resolved), Ok(resolved_canonical)) => resolved == resolved_canonical,
        _ => db_path == canonical,
    }
}

/// Open a fresh read-only connection configured for queries, without warming.
///
/// Shared by the cached primary and by [`VectorDb::open_readonly_at`].
fn open_ro_connection(db_path: &Path) -> Result<Connection> {
    let config = duckdb::Config::default()
        .access_mode(duckdb::AccessMode::ReadOnly)
        .map_err(|e| BrbError::database("failed to configure read-only mode", e))?;

    let conn = Connection::open_with_flags(db_path, config)
        .map_err(|e| BrbError::database("failed to open vector db read-only", e))?;

    // Keep the DuckDB memory cap modest. On Apple Silicon CPU and GPU share one
    // unified memory pool, so DuckDB competes with the resident MLX model (~5-6GB).
    // The HNSW index lookup needs little memory, so 2GB is ample — raising it just
    // starves the model and risks the inference daemon being OOM-killed.
    let _ = conn.execute_batch("SET memory_limit='2GB'; SET threads=2;");

    // Enable the persisted HNSW index for fast (~10ms) vector search.
    //
    // Safe because connections to a given database are not opened per query. For
    // the app that means a *single* shared primary: the index loads from disk once,
    // here, and the `try_clone()`s handed out by `open_readonly` share it (the
    // setting is database-global, so clones inherit it). The abort we were chasing
    // came from the old open-per-query pattern, where ~10 fresh connections/second
    // each re-loaded and re-bound the persisted index, racing one another. For an
    // eval fixture (`open_readonly_at`) the connection is one-per-corpus and the
    // corpus is tiny, so there is likewise nothing to race.
    if let Err(e) = conn.execute_batch("INSTALL vss; LOAD vss; SET hnsw_enable_experimental_persistence = true;") {
        debug!("VSS extension not available in read-only mode: {}", e);
    }
    if let Err(e) = conn.execute_batch("INSTALL fts; LOAD fts;") {
        debug!("FTS extension not available in read-only mode: {}", e);
    }

    Ok(conn)
}

/// Open a fresh read-only connection configured for queries (the primary).
///
/// The caller holds the access lock; the background warm-up clone counts as a
/// reader so a writer waits for it.
fn open_ro_primary(db_path: &Path, state: &mut DbAccess) -> Result<Connection> {
    let conn = open_ro_connection(db_path)?;

    // Load the embedding matrix for exact vector search off the critical path: it
    // reads every embedding (~700MB at 229k chunks, a second or two), and this open
    // sits on the app's startup path. The first search waits on the same lock if it
    // arrives before the load finishes, so correctness is unaffected.
    //
    // The persisted HNSW index is deliberately no longer queried or warmed; see
    // `embedding_matrix` for why.
    match conn.try_clone() {
        Ok(warm_conn) => {
            let handle = ReadHandle::register(state);
            std::thread::spawn(move || {
                warm_embedding_matrix(&warm_conn);
                // Close the connection before releasing the reader count.
                drop(warm_conn);
                drop(handle);
            });
        }
        Err(e) => debug!(
            "Could not clone for background matrix load, loading on first search: {}",
            e
        ),
    }

    Ok(conn)
}

/// Best-effort: any failure just means the matrix loads on the first search.
fn warm_embedding_matrix(conn: &Connection) {
    if let Err(e) = crate::embedding_matrix::for_connection(conn) {
        debug!("Embedding matrix warm-up skipped (will load on first search): {}", e);
    }
}

pub struct VectorDb {
    // Field order matters: `conn` drops first, then the handle or lease that
    // tracks it.
    pub(crate) conn: Connection,
    _read: Option<ReadHandle>,
    _lease: Option<WriteLease>,
}

/// JSON structure stored in chunk_data column
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkData {
    pub messages: Vec<ChunkMessage>,
    pub formatted: String,
}

/// Individual message within a chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMessage {
    pub sender: String,
    pub text: String,
    pub ts: String, // ISO 8601 timestamp
    pub message_id: i64,
}

/// A message chunk ready to be inserted into the database
#[derive(Debug, Clone)]
pub struct MessageChunk {
    pub chunk_id: i64,
    pub chunk_data: ChunkData,
    pub embedding: Vec<f32>,
    pub start_message_id: i64,
    pub end_message_id: i64,
    pub message_ids: Vec<i64>,
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub start_timestamp: String,
    pub end_timestamp: String,
    pub message_count: i32,
    pub total_chars: i32,
    pub has_from_me: bool,
    pub has_from_them: bool,
    pub has_questions: bool,
    /// Extracted text for FTS indexing (BM25 search)
    pub formatted_text: Option<String>,
}

impl VectorDb {
    /// Open the vector database read-write at the canonical location
    /// (`~/.be-right-back/data/db/brb.duckdb`) for ingestion.
    ///
    /// The path comes from [`common::get_brb_duckdb_db`] — the single source of
    /// truth — so production callers can never point this at the wrong directory.
    /// Tests and the eval harness go through [`VectorDb::open_at`] instead.
    pub fn open() -> Result<Self> {
        let db_path = common::get_brb_duckdb_db()?;
        Self::open_at(&db_path)
    }

    /// Open the vector database read-write at an explicit path.
    ///
    /// This is the seam the retrieval-eval harness needs: it builds a small
    /// fixture corpus in a throwaway directory and drives the real search
    /// pipeline over it. Production code should call [`VectorDb::open`], which
    /// delegates here with the canonical path.
    ///
    /// Each call returns a fresh connection, so fixture databases never touch
    /// the process-global read-only primary and tests need no `--test-threads=1`.
    pub fn open_at(db_path: &Path) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(BrbError::Io)?;
        }

        // Take the write lease so this read-write open gets the exclusive file
        // lock (DuckDB allows many readers OR one writer, not both). The lease
        // lives as long as the returned VectorDb.
        //
        // Only for the file the primary holds: a fixture database at another path
        // shares no lock with it, and tests run in parallel against fixtures.
        let lease = if is_primary_db_path(db_path) {
            Some(acquire_write_lease()?)
        } else {
            None
        };

        let conn = Connection::open(db_path).map_err(|e| BrbError::database("failed to open vector db", e))?;

        // Limit DuckDB memory to prevent unbounded growth during ingestion.
        // Without this, DuckDB defaults to 80% of system RAM which can cause
        // memory pressure when MLX model inference is also running.
        conn.execute_batch("SET memory_limit='4GB'; SET threads=2;")
            .map_err(|e| BrbError::database("failed to configure DuckDB memory limits", e))?;

        // VSS must be loaded to drop a persisted HNSW index left by older versions.
        conn.execute_batch("INSTALL vss; LOAD vss; SET hnsw_enable_experimental_persistence = true;")
            .map_err(|e| BrbError::database("failed to load VSS extension", e))?;

        // Load FTS extension for BM25 full-text search (best-effort, search degrades gracefully)
        if let Err(e) = conn.execute_batch("INSTALL fts; LOAD fts;") {
            debug!("FTS extension not available (BM25 search disabled): {}", e);
        }

        // Drop the legacy HNSW index; semantic search scans exactly now (see
        // `embedding_matrix`). Doubles as the migration for existing databases.
        // Leaving it in place is not just dead weight: while it is persisted,
        // filtered reads on read-only connections fail DuckDB's index-binding
        // assertion (`table_index_list.cpp` unbound_count == 0) in debug builds.
        let db = Self {
            conn,
            _read: None,
            _lease: lease,
        };
        let _ = db.conn.execute(queries::DROP_HNSW_INDEX, []);
        db.ensure_fts_index();

        info!(?db_path, "Opened vector database");
        Ok(db)
    }

    /// Open the vector database in read-only mode.
    ///
    /// Returns a cheap clone of a shared, long-lived read-only "primary" connection
    /// (opened lazily on first use) rather than opening a brand-new connection each
    /// time. The clone shares the same underlying database instance, so the vss+fts
    /// extensions and the indexes are loaded/bound once, not per query. See
    /// [`DbAccess`] for why this matters. Returns [`BrbError::Busy`] while a
    /// [`WriteLease`] is live.
    ///
    /// Suitable for all query-only operations (Casper search, insights dashboard).
    pub fn open_readonly() -> Result<Self> {
        let db_path = common::get_brb_duckdb_db()?;
        if !db_path.exists() {
            return Err(BrbError::NotFound(format!(
                "Vector database not found at {:?} - run ingestion first",
                db_path
            )));
        }

        let mut state = lock_access();
        if state.writers > 0 {
            return Err(BrbError::Busy(
                "the vector database is being updated; try again when ingestion or analytics finishes".to_string(),
            ));
        }
        if state.primary.is_none() {
            let primary = open_ro_primary(&db_path, &mut state)?;
            state.primary = Some(primary);
            info!(?db_path, "Opened shared read-only vector database (primary)");
        }

        // Cheap connection sharing the primary's database (no extension reload).
        let conn = state
            .primary
            .as_ref()
            .expect("primary read-only connection just initialized")
            .try_clone()
            .map_err(|e| BrbError::database("failed to clone read-only connection", e))?;
        let handle = ReadHandle::register(&mut state);

        Ok(Self {
            conn,
            _read: Some(handle),
            _lease: None,
        })
    }

    /// Open the vector database read-only at an explicit path.
    ///
    /// The read-only counterpart to [`VectorDb::open_at`], and the seam that lets
    /// the eval harness drive the real query surfaces (which all open read-only)
    /// against a fixture corpus.
    ///
    /// Deliberately *not* routed through the shared primary: this returns a fresh,
    /// uncached connection and skips the background HNSW warm. A fixture corpus is
    /// small enough that warming buys nothing, and caching it would leak a
    /// connection to a throwaway file into a process-global slot the app expects to
    /// hold the real database.
    pub fn open_readonly_at(db_path: &Path) -> Result<Self> {
        if !db_path.exists() {
            return Err(BrbError::NotFound(format!(
                "Vector database not found at {:?}",
                db_path
            )));
        }
        Ok(Self {
            conn: open_ro_connection(db_path)?,
            _read: None,
            _lease: None,
        })
    }

    /// Get a reference to the underlying DuckDB connection for raw queries.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Initialize the VSS extension and create the RAG schema from sql/duckdb_schema.sql
    pub fn initialize(&self) -> Result<()> {
        // Execute the schema SQL (includes VSS extension loading and table creation)
        self.conn
            .execute_batch(DUCKDB_SCHEMA)
            .map_err(|e| BrbError::database("failed to initialize vector database schema", e))?;

        info!("Initialized vector database schema with VSS extension");
        Ok(())
    }

    /// Create the FTS index for BM25 full-text search on formatted_text.
    /// Should be called AFTER all data is loaded (FTS indexes require data to exist).
    /// Uses `overwrite=1` for idempotent re-creation.
    pub fn create_fts_index(&self) -> Result<()> {
        info!("Creating FTS index on message_chunks.formatted_text...");

        self.conn
            .execute_batch(queries::CREATE_FTS_INDEX)
            .map_err(|e| BrbError::database("failed to create FTS index", e))?;

        info!("FTS index created successfully");
        Ok(())
    }

    /// Ensure FTS index exists if data is present.
    /// Called on `VectorDb::open()` to handle databases created before FTS was added.
    /// This is a best-effort operation — if it fails, BM25 search degrades gracefully.
    fn ensure_fts_index(&self) {
        // Check if message_chunks table exists and has data
        let has_data: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'message_chunks'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if has_data == 0 {
            return; // No table yet, nothing to index
        }

        let chunk_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM message_chunks", [], |row| row.get(0))
            .unwrap_or(0);

        if chunk_count == 0 {
            return; // No data to index
        }

        // Check if FTS index already exists.
        // Note: information_schema.tables may not show FTS internal tables when the DB was
        // written by a different DuckDB binding (e.g., Python). As a fallback, probe
        // the FTS scoring function directly — if it returns results, the index works.
        let has_fts: i64 = self
            .conn
            .query_row(queries::CHECK_FTS_INDEX_EXISTS, [], |row| row.get(0))
            .unwrap_or(0);

        if has_fts > 0 {
            debug!("FTS index already exists");
            return;
        }

        // information_schema check failed — try a functional probe before recreating
        let fts_functional = self
            .conn
            .query_row(queries::PROBE_FTS_INDEX, [], |row| row.get::<_, i64>(0))
            .is_ok();

        if fts_functional {
            debug!("FTS index functional (not visible in information_schema, likely created by Python)");
            return;
        }

        // Data exists but no FTS index — create one
        info!("FTS index missing on existing data, creating...");
        match self.create_fts_index() {
            Ok(()) => info!("FTS index created successfully on existing data ({chunk_count} chunks)"),
            Err(e) => debug!("Failed to create FTS index (BM25 search will be unavailable): {}", e),
        }
    }

    /// Insert a batch of message chunks
    pub fn insert_chunks(&self, chunks: &[MessageChunk], ingestion_id: i64) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare(queries::INSERT_MESSAGE_CHUNK)
            .map_err(|e| BrbError::database("failed to prepare insert statement", e))?;

        for chunk in chunks {
            let chunk_data_json = serde_json::to_string(&chunk.chunk_data)
                .map_err(|e| BrbError::Serialization(format!("failed to serialize chunk_data: {}", e)))?;

            // Convert message_ids to DuckDB array format
            let message_ids_str = format!(
                "[{}]",
                chunk
                    .message_ids
                    .iter()
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );

            // Convert embedding to DuckDB array format
            let embedding_str = format!(
                "[{}]",
                chunk
                    .embedding
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );

            stmt.execute(params![
                chunk.chunk_id,
                chunk_data_json,
                embedding_str,
                chunk.start_message_id,
                chunk.end_message_id,
                message_ids_str,
                chunk.contact_id,
                chunk.contact_name,
                chunk.start_timestamp,
                chunk.end_timestamp,
                chunk.message_count,
                chunk.total_chars,
                chunk.has_from_me,
                chunk.has_from_them,
                chunk.has_questions,
                ingestion_id,
                chunk.formatted_text,
            ])
            .map_err(|e| BrbError::database(format!("failed to insert chunk {}", chunk.chunk_id), e))?;
        }

        debug!(count = chunks.len(), "Inserted message chunks");
        Ok(())
    }

    /// Get the total number of chunks in the database
    pub fn get_chunk_count(&self) -> Result<i64> {
        let count: i64 = self
            .conn
            .query_row(queries::SELECT_CHUNK_COUNT, [], |row| row.get(0))
            .map_err(|e| BrbError::database("failed to count chunks", e))?;
        Ok(count)
    }

    /// Get the number of distinct clusters (excluding noise cluster -1)
    pub fn get_cluster_count(&self) -> Result<i64> {
        let count: i64 = self
            .conn
            .query_row(queries::SELECT_CLUSTER_COUNT, [], |row| row.get(0))
            .map_err(|e| BrbError::database("failed to count clusters", e))?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_chunk(chunk_id: i64, contact_id: &str) -> MessageChunk {
        let text = format!("Me: chunk {chunk_id} for {contact_id}");
        MessageChunk {
            chunk_id,
            chunk_data: ChunkData {
                messages: vec![ChunkMessage {
                    sender: "Me".to_string(),
                    text: text.clone(),
                    ts: "2026-02-09T14:00:00Z".to_string(),
                    message_id: 1000 + chunk_id,
                }],
                formatted: text.clone(),
            },
            embedding: vec![0.1; EMBEDDING_DIMS],
            start_message_id: 1000 + chunk_id,
            end_message_id: 1000 + chunk_id,
            message_ids: vec![1000 + chunk_id],
            contact_id: contact_id.to_string(),
            contact_name: Some(contact_id.to_string()),
            start_timestamp: "2026-02-09 14:00:00+00".to_string(),
            end_timestamp: "2026-02-09 14:00:00+00".to_string(),
            message_count: 1,
            total_chars: text.len() as i32,
            has_from_me: true,
            has_from_them: false,
            has_questions: false,
            formatted_text: Some(text),
        }
    }

    /// The eval seam: a fixture corpus can be built and read back at an arbitrary
    /// path, with no dependency on `$HOME` or on ingestion having ever run.
    #[test]
    fn open_at_builds_a_usable_fixture_db() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("fixture").join("eval.duckdb");

        let db = VectorDb::open_at(&db_path).expect("open_at");
        db.initialize().expect("initialize");
        db.insert_chunks(&[sample_chunk(1, "sarah"), sample_chunk(2, "alex")], 1)
            .expect("insert_chunks");

        assert_eq!(db.get_chunk_count().expect("count"), 2);
        // open_at creates missing parent directories, like open() does.
        assert!(db_path.exists());
    }

    /// Each fixture open is an independent connection, so eval tests can run in
    /// parallel without `--test-threads=1`.
    #[test]
    fn open_at_connections_are_independent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let first = dir.path().join("a.duckdb");
        let second = dir.path().join("b.duckdb");

        let db_a = VectorDb::open_at(&first).expect("open a");
        db_a.initialize().expect("init a");
        db_a.insert_chunks(&[sample_chunk(1, "sarah")], 1).expect("insert a");

        let db_b = VectorDb::open_at(&second).expect("open b");
        db_b.initialize().expect("init b");

        assert_eq!(db_a.get_chunk_count().expect("count a"), 1);
        assert_eq!(db_b.get_chunk_count().expect("count b"), 0);
    }

    /// When `min_similarity` filters out every exact candidate, the SQL fallback
    /// must apply it too. The MMR path does not re-check the threshold.
    #[test]
    fn fallback_respects_min_similarity() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = VectorDb::open_at(&dir.path().join("eval.duckdb")).expect("open_at");
        db.initialize().expect("initialize");
        db.insert_chunks(&[sample_chunk(1, "sarah"), sample_chunk(2, "alex")], 1)
            .expect("insert_chunks");

        // Both chunks are the 0.1-vector: cosine ~0.036 to this query.
        let mut query = vec![0.0; EMBEDDING_DIMS];
        query[0] = 1.0;
        let options = crate::search::SearchOptions::new()
            .with_limit(5)
            .with_min_similarity(0.5)
            .with_embeddings();

        let results = db.hybrid_search(&query, options).expect("hybrid_search");
        assert!(results.is_empty(), "got {} rows below min_similarity", results.len());
    }

    /// A fixture path must not be mistaken for the canonical database, or every
    /// eval open would evict the app's shared read-only primary (and with it the
    /// loaded HNSW index) for a file it shares no lock with.
    #[test]
    fn fixture_paths_are_not_the_primary() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(!is_primary_db_path(&dir.path().join("eval.duckdb")));

        // The canonical path recognizes itself, spelled either way. Skipped when
        // the home directory is unavailable (get_brb_duckdb_db is the only source
        // of the canonical path, and without it there is nothing to compare to).
        if let Ok(canonical) = common::get_brb_duckdb_db() {
            assert!(is_primary_db_path(&canonical));
            let indirect = canonical.parent().unwrap().join(".").join("brb.duckdb");
            assert!(is_primary_db_path(&indirect));
        }
    }

    /// The only test that touches the process-wide access state, so its counts
    /// are exact. Covers leases, nesting, reader drain, and the Python broker.
    #[test]
    fn write_lease_blocks_reads_and_waits_for_readers() {
        let readers = |f: fn(&DbAccess) -> usize| f(&lock_access());

        // A live reader holds a writer back until it drops.
        let handle = ReadHandle::register(&mut lock_access());
        let dropper = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            drop(handle);
        });
        let started = std::time::Instant::now();
        let lease = acquire_write_lease().expect("lease after reader drops");
        assert!(started.elapsed() >= Duration::from_millis(150));
        dropper.join().unwrap();
        assert_eq!(readers(|s| s.readers), 0);
        assert_eq!(readers(|s| s.writers), 1);

        // Leases nest without waiting.
        let nested = acquire_write_lease().expect("nested lease");
        assert_eq!(readers(|s| s.writers), 2);
        drop(nested);
        drop(lease);
        assert_eq!(readers(|s| s.writers), 0);

        // The broker holds a lease from acquire to release.
        let mut broker = crate::write_lock::WriteLockBroker::new();
        let acquire = r#"{"type":"write_lock","action":"acquire"}"#;
        assert_eq!(broker.handle(acquire).as_deref(), Some("ok"));
        assert_eq!(broker.handle(acquire).as_deref(), Some("ok"));
        assert_eq!(readers(|s| s.writers), 1);
        assert_eq!(
            broker.handle(r#"{"type":"write_lock","action":"release"}"#).as_deref(),
            Some("ok")
        );
        assert_eq!(readers(|s| s.writers), 0);

        // Dropping the broker releases a lease the child never released.
        assert_eq!(broker.handle(acquire).as_deref(), Some("ok"));
        drop(broker);
        assert_eq!(readers(|s| s.writers), 0);
    }
}

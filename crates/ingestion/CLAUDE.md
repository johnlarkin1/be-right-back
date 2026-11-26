# ingestion

Orchestrates the full ingestion pipeline: iMessage snapshot -> SQLite metadata -> Python/MLX embeddings -> DuckDB vector database.

## Workspace Role

- **Depends on**: `common` (paths, errors, Python env), `messages-db` (snapshot creation, message queries)
- **Depended on by**: `cli`, `desktop` (src-tauri)

## Module Map

| Module | Responsibility |
|---|---|
| `lib.rs` | Pipeline orchestration (`run_ingestion`, `run_ingestion_cancellable`) |
| `metadata.rs` | SQLite `brb.db` CRUD: ingestion runs, settings, conversation analysis, stored contacts |
| `vectordb.rs` | DuckDB `brb.duckdb` schema, chunk operations, FTS index management |
| `embedding_matrix.rs` | Exact semantic search: every embedding cached in memory per DB file, full cosine scan |
| `python.rs` | Subprocess spawning + JSON stdout parsing for embedding pipeline + `embed_query()` |
| `search.rs` | Hybrid search (semantic + BM25), RRF merge, MMR dedup, contact diversity penalty |
| `query_planner.rs` | Temporal extraction (18 patterns), query cleaning, recency boost, aggregation detection (66 tests) |
| `rerank.rs` | Python subprocess bridge for cross-encoder reranking (`ms-marco-MiniLM-L-6-v2`) |
| `context_builder.rs` | Formats `SearchResult[]` into a persona-chat context block with a char budget |
| `progress.rs` | 6-stage progress tracking types |
| `queries.rs` | DuckDB SQL constants, BM25 stopwords, FTS index constants (pub module) |
| `stats.rs` | Per-contact and "You" stats in one pass over the snapshot (pub module). `lib.rs` runs it on a background thread during the Python embedding and writes the result before marking the run complete. The same thread reads Tapbacks (`messages_db::db::tapbacks`) for the `tapbacks` table |

## 6-Stage Pipeline

| # | Stage | Runner | Progress |
|---|---|---|---|
| 1 | `Snapshot` | Rust | Create/find iMessage DB snapshot |
| 2 | `Parsing` | Rust | Count messages from snapshot |
| 3 | `Chunking` | Python | Create message chunks (window=8, stride=8) |
| 4 | `Embedding` | Python | Generate 768-dim embeddings via MLX |
| 5 | `Saving` | Python | Write to DuckDB + create FTS index |
| 6 | `Analyzing` | Python | Topic clustering + UMAP projections for Insights |

Each stage reports independent 0-100% progress. Cancellation is closure-based: callers pass an `Arc<AtomicBool>` that's checked between stages.

## Python Integration Protocol

Python subprocess (`embed.py`) emits JSON lines on stdout, parsed as `PythonMessage` (tagged enum with `#[serde(tag = "type")]`):

```json
{"type": "stage_progress", "stage": "chunking", "percent": 50, "message": "...", "stats": {...}, "current_contact": {...}}
{"type": "result", "success": true, "data": {...}}
{"type": "log", "level": "info", "message": "..."}
```

The `stage` string is mapped to `IngestionStage` via string matching in `python.rs`.

## Why there is no HNSW index

Semantic search used DuckDB's HNSW index until it measured at **~24% recall@10 vs exact** on a 229k-chunk production DB. Main cause: Python truncated `message_chunks` without dropping the index, so every re-ingestion left dead entries (474k for 229k rows, `LIMIT 10` returning 3-5 rows). A clean index at DuckDB defaults (M=16, ef_search=64) still recalls only ~0.56 for question-style queries vs ~0.96 for chunk-as-query (hnswlib, 248k prod vectors), because the graph links chunks to chunks. Chunk overlap is **not** a cause: removing it did not raise recall. `embedding_matrix.rs` now scans an in-memory copy exactly (~700MB, ~11ms single-threaded at 248k in release; the ingestion crate builds at opt-level 3 in dev because unoptimized it takes ~1.6s).

The index is actively **dropped** (Rust `open()`, Python `finalize_ingestion()`), not just unused: while persisted, filtered reads on read-only connections fail DuckDB's `table_index_list.cpp` `unbound_count == 0` assertion in debug builds. (Reported, not reproduced: no repro script exists.)

FTS indexes are cross-compatible between Python and Rust at DuckDB 2.0.1: `experiments/duckdb-index-compat/` passed 18/18 on 2026-11-22 (it passed at 1.4.4 too). To check compatibility after a DuckDB bump, run `./experiments/duckdb-index-compat/run_all.sh` on a Mac (it downloads the vss and fts extensions).

**Critical requirement**: DuckDB version must be pinned identically on both sides. Today that is DuckDB 2.0.1: `= 1.20001.0` in Rust (the crate encodes 2.0.1 as `1.20001.0`) and `==2.0.1` in Python. Version mismatches cause extension crashes. A 1.x process also cannot open a file that 2.0 created.

## DuckDB 2.0 storage format

DuckDB 2.0 opens a 1.x file but keeps writing it in the old, larger format. Ingestion truncates tables and never recreates the file, so an old file stays old. No code migrates it (pre-GA). To get the 2.0 format, delete `~/.be-right-back/data/db/brb.duckdb` and re-ingest.

DuckDB 2.0 SQL rejects single-arrow lambdas (`x -> x + 1`). Write `lambda x: x + 1`.

## Search Pipeline

`VectorDb::hybrid_search()` combines semantic and full-text search:

1. **Query Planning** — `plan_search()` extracts temporal ranges, cleans query for embedding, detects aggregation
2. **Embedding** — `embed_query()` via Python subprocess (ModernBERT 768-dim)
3. **Semantic search** — Cosine similarity, over-fetches 3x limit
4. **BM25 search** — DuckDB FTS on `formatted_text` (stopword-filtered)
5. **RRF merge** — `score = Σ 1/(60 + rank_i)`, combines both rankings. Always multiplies in a recency prior `1/(1 + 0.01 * age_days)` unless a superlative is active
6. **Dedup + contact diversity** — **two mutually exclusive branches, selected by `include_embeddings`** (see below)
7. **Cross-encoder rerank** — Optional (`SearchOptions.rerank = true`), `ms-marco-MiniLM-L-6-v2`
8. **Recency boost** — `score *= e^(-0.03 * days_ago)` when `prefer_recent = true`

### Step 6 has two implementations, and only one of them ships

| `include_embeddings` | Path | Contact penalty |
|---|---|---|
| `false` | `deduplicate_chunks` (50% novelty) then `apply_contact_diversity_penalty` | `score *= 0.5^(n-2)`, from the **3rd** result |
| `true` | `mmr_rerank` (λ=0.7), which applies its **own inline** penalty | `score *= 0.5^(n-1)`, from the **2nd** result |

**Both shipped surfaces set `include_embeddings = true`** (the agent's `SearchMessagesTool` and the `brb search` CLI), so the penalty that actually runs in production is the MMR one — harsher, and one result earlier. `apply_contact_diversity_penalty` is reachable only via `VectorDb::search` and direct callers that leave embeddings off.

Note the MMR score `λ*sim − (1−λ)*max_sim` can be negative, so the penalty divides rather than multiplies on that branch (multiplying a negative by `0.5^k` would move it *toward* zero and promote the candidate it is meant to suppress).

`SearchOptions` builder supports: contact filter, date range, min similarity, limit, query text (for BM25), rerank toggle.

## Index Lifecycle

1. **On fresh ingestion:** Python creates the FTS index (and drops any legacy HNSW index) in `finalize_ingestion()`
2. **On read-write open:** `VectorDb::open()` drops any legacy HNSW index and calls `ensure_fts_index()` (safety net)
3. **On re-ingestion:** Python truncates `message_chunks`, then drops and rebuilds the FTS index in `finalize_ingestion()`

## Key Exported Types

```rust
// Progress
pub use IngestionStage, IngestionStats, StageProgress, StageStatus, ContactProgress;
// Metadata (brb.db)
pub use MetadataDb, AppState, IngestionMetadata, IngestionSettings, AnalyticsSettings, ConversationAnalysis, StoredContact;
// Vector DB
pub use VectorDb, ChunkData, ChunkMessage, EMBEDDING_DIMS; // EMBEDDING_DIMS = 768
// Search
pub use SearchResult, SearchOptions;
// Query Planning
pub use SearchPlan, plan_search, apply_recency_boost;
// Context Builder
pub use PersonaContext, format_persona_context;
// Reranking
pub use rerank_candidates;
// Python
pub use run_python_embeddings, run_python_embeddings_cancellable, embed_query, EmbeddingResult;
// Stats
pub use ContactStats;
```

## Gotchas

- **Database files**: `brb.db` (SQLite metadata) and `brb.duckdb` (DuckDB vectors), both in `~/.be-right-back/data/db/`
- **Two connection modes**:
  - `VectorDb::open()` — **read-write, ingestion only**. Loads VSS (needed to drop a legacy persisted HNSW index), drops it, and runs `ensure_fts_index()` (FTS auto-migration). On the canonical path it takes a `WriteLease` first (see below) and holds it as long as the `VectorDb` lives.
  - `VectorDb::open_readonly()` — **all query paths** (Casper search, insights). Returns a cheap `try_clone()` of a cached, long-lived read-only "primary" connection (opened once, vss+fts loaded once). The primary **loads the embedding matrix once** on a *background thread* via a cloned connection, not inline, because it reads every embedding (~2.7s at 229k chunks) and this open sits on the app's startup critical path. The matrix is cached per DB file and reloaded when `message_chunks` changes (count / max chunk_id / max ingestion_id), so re-ingestion needs no invalidation hook. A search arriving before the load finishes waits on the same lock. The crash came from the *old* open-per-query pattern: ~10 fresh connections/second each re-loading and re-binding the persisted index, racing under memory pressure (MLX model resident) → DuckDB debug assertion (`table_index_list.cpp` `unbound_count == 0`, compiled out of release). One shared loaded index removes the re-load/race. Read-only memory cap is kept modest (2GB) — on Apple Silicon DuckDB shares the unified memory pool with the resident MLX model, so a larger cap risks OOM-killing the inference daemon.
  - After re-ingestion, the primary is dropped (by the write lease) and lazily reopened on the next query, picking up fresh data/indexes.
- **Write lease**: DuckDB allows many readers or one writer across processes. Every read clone of the primary keeps the file's shared lock, so the app blocks any writer, including a Python child. `acquire_write_lease()` closes the primary, evicts the embedding matrix, and waits up to 30 s for live read handles to drop. While a lease lives, `open_readonly()` returns `BrbError::Busy` instead of reopening the primary. Leases nest. `run_ingestion_cancellable` holds one from the schema init to the end of the Python embedding run.
- **Write-lock handshake** (`write_lock.rs`): analytics reads for minutes and writes for seconds, so it takes the lease only around its writes. Rust sets `BRB_WRITE_LOCK_HANDSHAKE=1` and pipes stdin. Python prints `{"type": "write_lock", "action": "acquire"}`, and `WriteLockBroker` replies `ok` (or `error: ...`) on stdin. `release` works the same way. Dropping the broker after the child exits frees a lease a crashed child never released. Python side: `mlx/src/data/write_lock.py`.
- **Cocoa timestamps**: iMessage uses Apple epoch (2001-01-01); conversion uses `COCOA_TO_UNIX_OFFSET` from `common`
- **Ingestion filters**: `run_ingestion_cancellable` reads the `ingestion_settings` row and forwards `start_date`, `end_date` and `min_messages_per_contact` to `embed.py` as CLI arguments (`filter_args()` in `python.rs`). Python applies them in the contact-discovery SQL, so the min-message count is taken *after* the date filter. `NULL` (or an empty date, or a `0` minimum) means no filter. After the run, `update_embedding_metadata()` overwrites the pre-run whole-snapshot `message_count`/`contact_count` in `ingestion_meta` with what Python actually embedded.
- **Full rebuild strategy**: Each ingestion clears all chunks (and drops FTS index) and rebuilds from scratch
- **DuckDB version pinning**: Python and Rust DuckDB versions MUST match exactly. A mismatch causes extension crashes (not a Python-vs-Rust issue, purely version mismatch)
- **Cold start for embed_query**: Standalone script loads model on every call (~2-5s). Use daemon path for interactive UX

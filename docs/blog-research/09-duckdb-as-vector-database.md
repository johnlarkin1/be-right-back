# Research Report: DuckDB as a Local Vector Database

> Reference material for writing about using DuckDB for hybrid vector + full-text search
> Generated: 2026-04-03

---

## What You Built

DuckDB as both a vector database (HNSW via VSS extension) and a full-text search engine (FTS extension with BM25) in a single embedded file. Created by Python, queried by Rust, with empirically validated cross-language compatibility.

---

## Why DuckDB (Not Pinecone, Qdrant, ChromaDB, pgvector)

| Requirement | DuckDB | Pinecone/Qdrant | ChromaDB | pgvector |
|-------------|--------|-----------------|----------|----------|
| Local-first (no cloud) | Yes | No | Yes | Yes (needs Postgres) |
| Embedded (no server) | Yes | No | Client-server | No |
| HNSW vector search | Yes (VSS ext) | Yes | Yes | Yes |
| Full-text search (BM25) | Yes (FTS ext) | No | No | Yes (tsvector) |
| Single file database | Yes (.duckdb) | N/A | Persistent dir | N/A |
| Rust + Python bindings | Yes | Yes | Python only | Rust (via diesel/sqlx) |
| Bundleable in desktop app | Yes (crate) | No | No | No |

**Key advantage**: HNSW + FTS in the same embedded database. No external services, no server process, single `.duckdb` file.

---

## Database Schema

```sql
-- Vector embeddings table
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id INTEGER PRIMARY KEY,
    contact_id VARCHAR,
    formatted_text VARCHAR,         -- Human-readable message text
    message_ids INTEGER[],          -- Array of iMessage IDs in this chunk
    start_timestamp TIMESTAMP,
    end_timestamp TIMESTAMP,
    embedding FLOAT[768],           -- 768-dim ModernBERT embedding
    metadata JSON                   -- Additional chunk metadata
);

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS chunks_hnsw_idx ON chunks
    USING HNSW (embedding)
    WITH (metric = 'cosine');

-- FTS index for BM25 full-text search
PRAGMA create_fts_index('chunks', 'chunk_id', 'formatted_text',
    stemmer='porter', stopwords='english');
```

---

## Index Lifecycle

### Creation (Python, during ingestion)
1. `embedding.py` generates 768-dim vectors via ModernBERT
2. Inserts chunks into DuckDB with embeddings
3. Creates HNSW index on `embedding` column
4. Creates FTS index on `formatted_text` column
5. Both indexes created in `finalize_ingestion()`

### Verification (Rust, on app startup)
1. `VectorDb::open()` loads VSS extension with experimental persistence
2. Calls `ensure_hnsw_index()` — creates if missing (safety net)
3. Calls `ensure_fts_index()` — creates if missing (safety net)

### Rebuild (on re-ingestion)
1. `clear_chunks()` drops both indexes
2. Deletes all chunk data
3. Full re-ingestion from scratch (no incremental updates yet)

---

## The Version Pinning Discovery

### The Problem
DuckDB's VSS (Vector Similarity Search) extension is a compiled native binary. It's linked against a specific DuckDB version's internal ABI.

If Python creates an HNSW index with DuckDB 1.4.2, and Rust opens the same file with DuckDB 1.4.4, the VSS extension binary is different → ABI mismatch → crash or corrupted results.

### The Investigation
You built a dedicated experiment: `experiments/duckdb-index-compat/`

**Setup**: Create HNSW + FTS indexes in Python, query them from Rust (and vice versa)

**Finding at matched versions (1.4.4/1.4.4)**: 18/18 tests pass. Full compatibility.

**The wrong assumption**: Initially assumed Python-vs-Rust was the incompatibility. It wasn't — it was version mismatch. At the same version, Python and Rust DuckDB are fully interoperable.

### The Fix
```toml
# Cargo.toml
duckdb = { version = "= 1.4.4", features = ["bundled"] }
```
```toml
# pyproject.toml
duckdb = "==1.4.4"
```

Exact pins. Not `>=`, not `~=`. Exact.

---

## Query Patterns

### Semantic Search (HNSW)
```sql
SELECT chunk_id, contact_id, formatted_text, message_ids,
       start_timestamp, end_timestamp, embedding,
       array_cosine_similarity(embedding, ?::FLOAT[768]) AS similarity
FROM chunks
WHERE array_cosine_similarity(embedding, ?::FLOAT[768]) > ?  -- min_similarity
ORDER BY similarity DESC
LIMIT ?  -- over-fetches 3x for post-filtering
```

### BM25 Full-Text Search (FTS)
```sql
SELECT chunk_id, fts_main_chunks.match_bm25(chunk_id, ?) AS score
FROM chunks
WHERE score IS NOT NULL
ORDER BY score DESC
LIMIT ?
```

### Contact Stats
```sql
SELECT contact_id, COUNT(*) as chunk_count,
       MIN(start_timestamp) as first_message,
       MAX(end_timestamp) as last_message
FROM chunks
GROUP BY contact_id
```

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Embedding dimensions | 768 |
| HNSW metric | cosine |
| FTS stemmer | Porter |
| Database file | `~/.be-right-back/data/db/brb.duckdb` |
| DuckDB version (pinned) | 1.4.4 |
| VSS extension | Loaded on every open |
| FTS extension | Built-in |
| Cross-compat tests | 18/18 pass |

---

## DuckDB-Specific Gotchas

1. **VSS extension must be loaded explicitly**: `INSTALL vss; LOAD vss;` on every connection
2. **Experimental persistence required**: `SET hnsw_enable_experimental_persistence = true;`
3. **HNSW index not always used by query planner**: Must verify via `EXPLAIN` that index scan is used
4. **FTS index is a virtual table**: Uses `fts_main_chunks.match_bm25()` function, not WHERE clause
5. **Array type for embeddings**: `FLOAT[768]` — DuckDB's native array type, not a custom extension type
6. **No incremental index updates**: Adding new chunks requires rebuilding HNSW index (or accepting degraded quality)
7. **File locking**: DuckDB uses file-level locks — only one writer at a time

---

## Code Locations

| Component | File |
|-----------|------|
| VectorDb struct + operations | `crates/ingestion/src/vectordb.rs` (381 lines) |
| SQL query builders | `crates/ingestion/src/queries.rs` |
| Search orchestration | `crates/ingestion/src/search.rs` (1,184 lines) |
| Python embedding pipeline | `mlx/src/pipelines/embedding.py` (764 lines) |
| Cross-compat experiment | `experiments/duckdb-index-compat/` |

---

## Narrative Angles

1. **"DuckDB: the SQLite of analytics (and now vectors)"** — Most people know DuckDB for OLAP. Using it as a vector database is unusual but compelling for embedded/local-first apps.

2. **"One file, two indexes, zero servers"** — HNSW + FTS in a single `.duckdb` file. No Pinecone, no Qdrant, no Docker containers. Your vector database is a file you can `cp`.

3. **"The version pin that saved the project"** — The DuckDB version mismatch story. Python 1.4.2 + Rust 1.4.4 = silent corruption. The experiment that proved it. The fix: `==1.4.4` everywhere.

4. **"Cross-language DuckDB: the assumption that was wrong"** — You assumed Python-created indexes wouldn't work from Rust. Built an experiment to prove it. 18/18 tests passed. The real enemy was version mismatch, not language bindings.

5. **"The trade-offs of embedded vector search"** — No incremental index updates, file-level locking, must reload VSS on every open. What you gain (simplicity, no infrastructure) vs what you give up (scalability, real-time updates).

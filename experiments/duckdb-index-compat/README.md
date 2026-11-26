# DuckDB HNSW/FTS Index Compatibility Experiment

## Context

After the Qwen3.5 migration, we noticed HNSW and FTS indexes being recreated every time ingestion runs (~3 min for HNSW on 245K chunks). We fixed the unconditional recreation, but the underlying assumption — that Python-created HNSW indexes are binary-incompatible with Rust — has never been empirically validated. We need a definitive answer on cross-language compatibility before simplifying the production flow.

**Key facts:**
- DuckDB version: `2.0.1` pinned on both sides (Rust crate `= 1.20001.0`, Python `==2.0.1`). The original run used `1.4.4`.
- VSS extension: bundled with DuckDB, loaded dynamically (`INSTALL vss; LOAD vss;`)
- FTS extension: same (`INSTALL fts; LOAD fts;`)
- Embedding dims: `FLOAT[768]`
- HNSW metric: cosine
- HNSW persistence: `SET hnsw_enable_experimental_persistence = true`
- Schema SQL: `crates/ingestion/sql/duckdb_schema.sql`
- Python writes via Parquet bulk load (`COPY FROM`)
- Python creates FTS index, Rust creates HNSW index (current design)

## How to Run

```bash
# From this directory:
./run_all.sh

# Or from repo root:
./experiments/duckdb-index-compat/run_all.sh
```

**Prerequisites:**
- Rust toolchain (for building the Rust binary)
- Python 3.13+ with: `duckdb==2.0.1`, `numpy`, `pyarrow`
- The project's Python venv works: `source ~/.be-right-back/mlx-venv/bin/activate`

Results are written to `results/` as JSON files.

## Experiment Design

### Test Matrix

| # | Schema Creator | Data Writer | HNSW Creator | FTS Creator | HNSW Reader | FTS Reader |
|---|---------------|-------------|-------------|-------------|-------------|------------|
| 1 | Python | Python | Python | Python | Python | Python |
| 2 | Python | Python | Python | Python | **Rust** | **Rust** |
| 3 | Python | Python | **Rust** | **Rust** | Python | Python |
| 4 | Python | Python | **Rust** | **Rust** | **Rust** | **Rust** |
| 5 | **Rust** | Python | Python | Python | **Rust** | **Rust** |
| 6 | **Rust** | **Rust** | **Rust** | **Rust** | **Rust** | **Rust** |
| 7 | Python | Python | Python | Python | **Rust** | **Rust** |

The critical cross-language tests are **#2** (Python creates everything, Rust reads) and **#5** (Rust creates schema, Python writes data + indexes, Rust queries).

### What Each Test Validates

1. **HNSW query compatibility**: Can Rust query an HNSW index created by Python (and vice versa)?
2. **FTS query compatibility**: Can Rust query an FTS index created by Python (and vice versa)?
3. **Schema compatibility**: Can Python write to a schema created by Rust?
4. **Extension version alignment**: Do both sides load the same VSS/FTS extension versions?
5. **Persistence**: Do indexes survive connection close/reopen across languages?
6. **Query correctness**: Do search results match between Python-created and Rust-created indexes (same ordering, same distances)?

### Verification Criteria

For each test:
- Insert 100 synthetic chunks with known embeddings (deterministic, reproducible)
- Run 5 known queries with expected results
- Compare: top-K ordering, cosine distances (within epsilon), FTS BM25 scores
- Assert no crashes, no `assertion failed` errors, no silent corruption

## File Structure

```
experiments/duckdb-index-compat/
├── README.md                    # This file
├── run_all.sh                   # Orchestrates Python → Rust → comparison
├── python_side.py               # Python: create schema/data/indexes, query, dump results
├── rust_side/
│   ├── Cargo.toml               # duckdb = "= 1.20001.0" with bundled + features
│   └── src/main.rs              # Rust: create schema/data/indexes, query, dump results
├── shared/
│   ├── schema.sql               # Exact copy of production schema (message_chunks only)
│   ├── test_data.py             # Generate deterministic test embeddings + chunks
│   └── queries.json             # 5 test queries with expected results
└── results/                     # Output JSONs from each test run
```

### Python side (`python_side.py`)

Subcommands:
- `create-schema <db_path>` — create table + btree indexes
- `write-data <db_path>` — insert 100 synthetic chunks via Parquet bulk load (same method as production)
- `create-hnsw <db_path>` — create HNSW index on embeddings
- `create-fts <db_path>` — create FTS index on formatted_text
- `query-hnsw <db_path>` — run 5 cosine similarity queries, output JSON results
- `query-fts <db_path>` — run 5 BM25 queries, output JSON results
- `check-indexes <db_path>` — list all indexes with their types/sizes
- `report-versions` — print duckdb version, vss version, fts version

### Rust side (`rust_side/src/main.rs`)

Same subcommands, same interface. Uses `duckdb = "= 1.20001.0"` (DuckDB 2.0.1) with `bundled` feature (matching production).

### Orchestration (`run_all.sh`)

Runs all 7 test combinations, validates results, prints pass/fail summary with conclusion.

## Key Files Referenced from Production

- **Production schema**: `crates/ingestion/sql/duckdb_schema.sql`
- **Rust HNSW creation**: `crates/ingestion/src/vectordb.rs:261-270` (`create_hnsw_index`)
- **Rust FTS creation**: `crates/ingestion/src/vectordb.rs:149-158` (`create_fts_index`)
- **Rust queries**: `crates/ingestion/src/queries.rs` (SQL constants)
- **Python data write**: `mlx/src/data/storage.py:127-218` (`write_chunks_bulk_parquet`)
- **Python FTS creation**: `mlx/src/data/storage.py:305-318` (`finalize_ingestion`)
- **Python VSS loading**: `mlx/src/data/storage.py:32-36` (`ensure_vss_extension`)
- **DuckDB version pins**: `Cargo.toml` (`= 1.20001.0`), `mlx/pyproject.toml` (`==2.0.1`)

## Impact on Production

If **all tests pass**: We can simplify the flow — let either side create indexes freely, remove the "Rust-only HNSW" constraint, and eliminate the ensure/recreate logic.

If **HNSW cross-compat fails but FTS works**: Current design is correct (Rust-only HNSW), but we should document this with test evidence and ensure we never accidentally recreate.

If **both fail**: We have a deeper problem and need to investigate extension versioning or consider pinning VSS extension versions explicitly.

## Results

_Run `./run_all.sh` and check the output + `results/` directory._

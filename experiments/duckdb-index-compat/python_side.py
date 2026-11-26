#!/usr/bin/env python3
"""Python side of DuckDB index compatibility experiment.

Subcommands:
  create-schema <db_path>   - Create table + btree indexes
  write-data <db_path>      - Insert 100 synthetic chunks via Parquet bulk load
  create-hnsw <db_path>     - Create HNSW index on embeddings
  create-fts <db_path>      - Create FTS index on formatted_text
  query-hnsw <db_path>      - Run 5 cosine similarity queries, output JSON
  query-fts <db_path>       - Run 5 BM25 queries, output JSON
  check-indexes <db_path>   - List all indexes
  report-versions           - Print duckdb/vss/fts versions
"""

import json
import sys
import tempfile
from pathlib import Path

import duckdb
import numpy as np

# Add shared/ to path for test_data import
sys.path.insert(0, str(Path(__file__).parent / "shared"))
from test_data import (
    SEED,
    generate_all_chunks,
    generate_query_embedding,
    get_hnsw_query_vectors,
    write_parquet,
)

SCHEMA_SQL = (Path(__file__).parent / "shared" / "schema.sql").read_text()

TOP_K = 10


def open_db(db_path: str, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    """Open DuckDB with VSS extension loaded."""
    conn = duckdb.connect(db_path, read_only=read_only)
    conn.execute("INSTALL vss; LOAD vss;")
    conn.execute("SET hnsw_enable_experimental_persistence = true")
    conn.execute("INSTALL fts; LOAD fts;")
    return conn


def cmd_create_schema(db_path: str) -> None:
    conn = open_db(db_path)
    conn.execute(SCHEMA_SQL)
    conn.close()
    print(json.dumps({"status": "ok", "action": "create-schema", "db_path": db_path}))


def cmd_write_data(db_path: str) -> None:
    rng = np.random.default_rng(SEED)
    chunks = generate_all_chunks(rng)

    # Write to parquet then bulk load (same as production)
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
        parquet_path = f.name

    write_parquet(chunks, Path(parquet_path))

    conn = open_db(db_path)

    # Bulk load from parquet - cast timestamps since parquet has strings
    conn.execute(f"""
        INSERT INTO message_chunks
        SELECT
            chunk_id, chunk_data, embedding,
            start_message_id, end_message_id, message_ids,
            contact_id, contact_name,
            start_timestamp::TIMESTAMPTZ, end_timestamp::TIMESTAMPTZ,
            message_count, total_chars,
            has_from_me, has_from_them, has_questions,
            ingestion_id, formatted_text
        FROM read_parquet('{parquet_path}')
    """)

    count = conn.execute("SELECT COUNT(*) FROM message_chunks").fetchone()[0]
    conn.close()

    Path(parquet_path).unlink()
    print(json.dumps({"status": "ok", "action": "write-data", "rows": count}))


def cmd_create_hnsw(db_path: str) -> None:
    conn = open_db(db_path)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_hnsw "
        "ON message_chunks USING HNSW (embedding) WITH (metric = 'cosine')"
    )
    conn.close()
    print(json.dumps({"status": "ok", "action": "create-hnsw"}))


def cmd_create_fts(db_path: str) -> None:
    conn = open_db(db_path)
    conn.execute(
        "PRAGMA create_fts_index('message_chunks', 'chunk_id', 'formatted_text', "
        "stemmer='english', stopwords='english', overwrite=1)"
    )
    conn.close()
    print(json.dumps({"status": "ok", "action": "create-fts"}))


def cmd_query_hnsw(db_path: str) -> None:
    conn = open_db(db_path)
    queries = get_hnsw_query_vectors()
    results = []

    for q in queries:
        vec_str = "[" + ",".join(str(v) for v in q["vector"]) + "]"
        rows = conn.execute(
            f"""
            SELECT chunk_id,
                   array_cosine_distance(embedding, {vec_str}::FLOAT[768]) as distance
            FROM message_chunks
            ORDER BY distance ASC
            LIMIT {TOP_K}
            """,
        ).fetchall()

        results.append({
            "query_id": q["id"],
            "expected_top1": q["expected_top1"],
            "actual_top1": rows[0][0] if rows else None,
            "top1_match": rows[0][0] == q["expected_top1"] if rows else False,
            "results": [{"chunk_id": int(r[0]), "distance": float(r[1])} for r in rows],
        })

    conn.close()
    print(json.dumps({"action": "query-hnsw", "language": "python", "results": results}, indent=2))


def cmd_query_fts(db_path: str) -> None:
    conn = open_db(db_path)
    fts_queries = [
        ("fts1", "hello world"),
        ("fts2", "weather forecast"),
        ("fts3", "dinner restaurant"),
        ("fts4", "meeting tomorrow"),
        ("fts5", "unique_token_xyz"),
    ]
    results = []

    for qid, query_text in fts_queries:
        try:
            rows = conn.execute(
                f"""
                SELECT * FROM (
                    SELECT chunk_id, fts_main_message_chunks.match_bm25(chunk_id, ?) AS score
                    FROM message_chunks
                )
                WHERE score IS NOT NULL
                ORDER BY score DESC
                LIMIT {TOP_K}
                """,
                [query_text],
            ).fetchall()

            results.append({
                "query_id": qid,
                "query_text": query_text,
                "num_results": len(rows),
                "results": [{"chunk_id": int(r[0]), "score": float(r[1])} for r in rows],
            })
        except Exception as e:
            results.append({
                "query_id": qid,
                "query_text": query_text,
                "error": str(e),
            })

    conn.close()
    print(json.dumps({"action": "query-fts", "language": "python", "results": results}, indent=2))


def cmd_check_indexes(db_path: str) -> None:
    conn = open_db(db_path)

    # Check regular indexes
    indexes = conn.execute(
        "SELECT index_name, table_name, is_unique FROM duckdb_indexes()"
    ).fetchall()

    # Check FTS
    fts_exists = conn.execute(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fts_main_message_chunks'"
    ).fetchone()[0]

    conn.close()
    print(json.dumps({
        "action": "check-indexes",
        "indexes": [{"name": r[0], "table": r[1], "unique": r[2]} for r in indexes],
        "fts_exists": fts_exists > 0,
    }, indent=2))


def cmd_report_versions() -> None:
    conn = duckdb.connect(":memory:")
    duckdb_version = conn.execute("SELECT version()").fetchone()[0]

    # Get extension versions
    conn.execute("INSTALL vss; LOAD vss;")
    conn.execute("INSTALL fts; LOAD fts;")
    extensions = conn.execute(
        "SELECT extension_name, extension_version, installed FROM duckdb_extensions() "
        "WHERE extension_name IN ('vss', 'fts')"
    ).fetchall()

    conn.close()
    print(json.dumps({
        "action": "report-versions",
        "language": "python",
        "duckdb_version": duckdb_version,
        "python_duckdb_package": duckdb.__version__,
        "extensions": [
            {"name": r[0], "version": r[1], "installed": r[2]} for r in extensions
        ],
    }, indent=2))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]
    db_path = sys.argv[2] if len(sys.argv) > 2 else None

    commands = {
        "create-schema": lambda: cmd_create_schema(db_path),
        "write-data": lambda: cmd_write_data(db_path),
        "create-hnsw": lambda: cmd_create_hnsw(db_path),
        "create-fts": lambda: cmd_create_fts(db_path),
        "query-hnsw": lambda: cmd_query_hnsw(db_path),
        "query-fts": lambda: cmd_query_fts(db_path),
        "check-indexes": lambda: cmd_check_indexes(db_path),
        "report-versions": cmd_report_versions,
    }

    if cmd not in commands:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    if cmd != "report-versions" and not db_path:
        print(f"Error: {cmd} requires <db_path> argument", file=sys.stderr)
        sys.exit(1)

    try:
        commands[cmd]()
    except Exception as e:
        print(json.dumps({"status": "error", "action": cmd, "error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

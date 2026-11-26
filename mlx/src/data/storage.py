import itertools
import os
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16

from config.analytics import AnalyticsConfig
from constants import get_cluster_color
from progress.analytics import AnalyticsStage, emit_progress
from progress.base import log_info, log_warn
from progress.ingestion import IngestionStage, emit_stage_progress
from queries import duckdb as duckdb_queries
from utils.time import apple_timestamp_to_date, apple_timestamp_to_datetime


def configure_duckdb_memory(conn: duckdb.DuckDBPyConnection, memory_limit: str = "4GB") -> None:
    """Configure DuckDB memory limits to prevent unbounded memory growth.

    Without explicit limits, DuckDB defaults to 80% of system RAM which can cause
    memory pressure during ingestion when MLX model inference is also running.
    """
    conn.execute(f"SET memory_limit='{memory_limit}'")
    conn.execute("SET threads=2")
    # Force DuckDB to spill temp data to disk instead of holding in memory
    conn.execute("SET temp_directory='/tmp/brb_duckdb_tmp'")


def ensure_vss_extension(conn: duckdb.DuckDBPyConnection) -> None:
    """Install and load the VSS extension for vector operations."""
    conn.execute("INSTALL vss")
    conn.execute("LOAD vss")


def _aggregate_daily_messages(messages: list[dict]) -> list[tuple]:
    """Aggregate messages into (date, contact_id, is_from_me, count) rows."""
    daily_data: dict[tuple[str, str, bool], int] = {}

    for msg in messages:
        ts = msg.get("timestamp")
        contact_id = msg.get("contact_id")
        is_from_me = bool(msg.get("is_from_me"))

        if not contact_id:
            continue

        date_str = apple_timestamp_to_date(ts)
        if not date_str:
            continue

        key = (date_str, contact_id, is_from_me)
        daily_data[key] = daily_data.get(key, 0) + 1

    return [(d, c, i, cnt) for (d, c, i), cnt in daily_data.items()]


def compute_daily_messages_to_conn(
    conn: duckdb.DuckDBPyConnection,
    messages: list[dict],
) -> int:
    """Append daily message counts to an existing DuckDB connection.

    Used by the batched pipeline to accumulate daily message stats across
    contact batches.
    """
    rows = _aggregate_daily_messages(messages)
    if rows:
        dates, contact_ids, from_me, counts = zip(*rows)
        table = pa.table(
            {
                "date": pa.array(dates, type=pa.string()).cast(pa.date32()),
                "contact_id": pa.array(contact_ids, type=pa.string()),
                "is_from_me": pa.array(from_me, type=pa.bool_()),
                "message_count": pa.array(counts, type=pa.int32()),
            }
        )
        # executemany inserts one row at a time: 53.6 s for 52k rows vs 0.37 s here.
        insert_arrow(conn, table, "daily_messages")
    return len(rows)


def is_valid_embedding(embedding: np.ndarray | list | None, dims: int = 768) -> bool:
    if embedding is None:
        return False
    try:
        arr = np.asarray(embedding, dtype=np.float32)
    except (TypeError, ValueError):
        return False  # a None inside a list
    return arr.shape == (dims,) and bool(np.isfinite(arr).all())


_view_ids = itertools.count()


def insert_arrow(conn: duckdb.DuckDBPyConnection, table: pa.Table, target_table: str) -> int:
    """Insert a PyArrow table into DuckDB in memory, matching columns by name.

    DuckDB scans the registered Arrow table directly. There is no temp file
    and no Parquet encode.
    """
    view = f"_brb_arrow_{next(_view_ids)}"
    conn.register(view, table)
    try:
        conn.execute(f"INSERT INTO {target_table} BY NAME SELECT * FROM {view}")
    finally:
        conn.unregister(view)
    return table.num_rows


def _embedding_column(embeddings: list, dims: int = 768) -> pa.FixedSizeListArray:
    """Build a FLOAT[dims] column from one numpy matrix, not 768 Python floats per row."""
    matrix = np.ascontiguousarray(np.vstack(embeddings), dtype=np.float32)
    return pa.FixedSizeListArray.from_arrays(pa.array(matrix.ravel()), dims)


def write_chunks_bulk(
    conn: duckdb.DuckDBPyConnection,
    chunks: list[dict],
    run_id: int,
    chunk_id_offset: int = 0,
) -> int:
    if not chunks:
        return 0

    chunk_ids = []
    chunk_data_list = []
    embeddings = []
    start_message_ids = []
    end_message_ids = []
    message_ids_list = []
    contact_ids = []
    contact_names = []
    start_timestamps = []
    end_timestamps = []
    message_counts = []
    total_chars_list = []
    has_from_me_list = []
    has_from_them_list = []
    has_questions_list = []
    ingestion_ids = []

    formatted_text_list = []

    for i, chunk in enumerate(chunks):
        text = chunk["text"]
        start_id = chunk.get("start_message_id") or 0
        end_id = chunk.get("end_message_id") or 0

        # Build chunk_data with individual message metadata
        msg_metadata = chunk.get("messages", [])
        chunk_messages = []
        for m in msg_metadata:
            ts_val = m.get("ts")
            dt = apple_timestamp_to_datetime(ts_val) if ts_val else None
            ts_str = dt.isoformat() if dt else ""
            chunk_messages.append(
                {
                    "sender": m.get("sender", ""),
                    "text": m.get("text", ""),
                    "ts": ts_str,
                    "message_id": m.get("message_id", 0),
                }
            )

        chunk_ids.append(chunk_id_offset + i)
        chunk_data_list.append(json.dumps({"messages": chunk_messages, "formatted": text}))
        embeddings.append(chunk["embedding"])
        start_message_ids.append(start_id)
        end_message_ids.append(end_id)
        # The chunk's own message IDs. A start..end range would also cover
        # ROWIDs from other chats, because ROWIDs are global.
        message_ids_list.append([m["message_id"] for m in msg_metadata if m.get("message_id")])
        contact_ids.append(chunk.get("contact_id"))
        contact_names.append(chunk.get("contact_name") or chunk.get("contact_display"))
        start_timestamps.append(apple_timestamp_to_datetime(chunk.get("start_timestamp")))
        end_timestamps.append(apple_timestamp_to_datetime(chunk.get("end_timestamp")))
        message_counts.append(chunk.get("message_count") or 0)
        total_chars_list.append(len(text))
        has_from_me_list.append("Me:" in text)
        has_from_them_list.append(
            chunk.get("contact_display", "") in text if chunk.get("contact_display") else True
        )
        has_questions_list.append("?" in text)
        ingestion_ids.append(run_id)
        formatted_text_list.append(text)

    table = pa.table(
        {
            "chunk_id": pa.array(chunk_ids, type=pa.int64()),
            "chunk_data": pa.array(chunk_data_list, type=pa.string()),
            "embedding": _embedding_column(embeddings),
            "start_message_id": pa.array(start_message_ids, type=pa.int64()),
            "end_message_id": pa.array(end_message_ids, type=pa.int64()),
            "message_ids": pa.array(message_ids_list, type=pa.list_(pa.int64())),
            "contact_id": pa.array(contact_ids, type=pa.string()),
            "contact_name": pa.array(contact_names, type=pa.string()),
            "start_timestamp": pa.array(start_timestamps, type=pa.timestamp("us", tz="UTC")),
            "end_timestamp": pa.array(end_timestamps, type=pa.timestamp("us", tz="UTC")),
            "message_count": pa.array(message_counts, type=pa.int32()),
            "total_chars": pa.array(total_chars_list, type=pa.int32()),
            "has_from_me": pa.array(has_from_me_list, type=pa.bool_()),
            "has_from_them": pa.array(has_from_them_list, type=pa.bool_()),
            "has_questions": pa.array(has_questions_list, type=pa.bool_()),
            "ingestion_id": pa.array(ingestion_ids, type=pa.int32()),
            "formatted_text": pa.array(formatted_text_list, type=pa.string()),
        }
    )

    return insert_arrow(conn, table, "message_chunks")


def finalize_ingestion(output_db: Path, ingestion_id: int, total_chunks: int, total_contacts: int):
    """Finalize the ingestion.

    Note: Ingestion metadata is now stored in SQLite (brb.db) instead of DuckDB.
    Creates the FTS (BM25 keyword) index and drops any legacy HNSW index.
    Cross-language compatibility validated in experiments/duckdb-index-compat/.
    """
    conn = duckdb.connect(str(output_db))
    configure_duckdb_memory(conn)
    ensure_vss_extension(conn)

    # No HNSW index: Rust scans embeddings exactly in memory, and the index had
    # ~24% recall on question-style queries. Drop one left by older versions.
    try:
        conn.execute("SET hnsw_enable_experimental_persistence = true")
        conn.execute(duckdb_queries.DROP_HNSW_INDEX)
    except Exception as e:
        log_warn(f"Failed to drop legacy HNSW index (Rust drops it on next open): {e}")

    # Report chunks that ended up with an all-zero embedding: unreachable by
    # semantic search (cosine 0 to every query), findable only via BM25. One
    # production corpus carried 5,438 of these (2.4%) with nothing logged.
    try:
        row = conn.execute(duckdb_queries.COUNT_ZERO_EMBEDDINGS).fetchone()
        zero_count = row[0] if row else 0
        if zero_count:
            log_warn(
                f"{zero_count} of {total_chunks} chunks have all-zero embeddings and "
                "will not be found by semantic search"
            )
    except Exception as e:
        log_warn(f"Could not check for zero embeddings: {e}")

    # Create FTS index for BM25 keyword search
    log_info("Creating FTS index for BM25 search...")
    # The embedding model is freed by now, so the index build can use every core.
    conn.execute(f"SET threads={os.cpu_count() or 4}")
    try:
        conn.execute("INSTALL fts")
        conn.execute("LOAD fts")
        # Drop existing FTS index if present (from previous ingestion)
        try:
            conn.execute("PRAGMA drop_fts_index('message_chunks')")
        except duckdb.CatalogException:
            pass  # Index may not exist
        conn.execute(
            "PRAGMA create_fts_index('message_chunks', 'chunk_id', 'formatted_text', "
            "stemmer='english', stopwords='english')"
        )
        log_info("FTS index created successfully")
    except Exception as e:
        log_warn(f"Failed to create FTS index (BM25 search will be unavailable): {e}")

    emit_stage_progress(IngestionStage.SAVING, 90, "Database write complete")

    conn.close()
    log_info(f"Finalized ingestion {ingestion_id} with {total_chunks} chunks")


def write_clustering_results(
    db_path: Path,
    metadata: list[dict],
    coords_2d: np.ndarray,
    coords_3d: np.ndarray,
    cluster_labels: np.ndarray,
    cluster_names: dict[int, str],
    config: AnalyticsConfig,
    duration_secs: float,
) -> int:
    """Save clustering results to DuckDB with one in-memory Arrow insert."""

    emit_progress(AnalyticsStage.SAVING_CLUSTERS, 0, "Saving clustering results...")

    conn = duckdb.connect(str(db_path))
    configure_duckdb_memory(conn)

    n_clusters = len([c for c in set(cluster_labels) if c >= 0])
    noise_count = int((cluster_labels == -1).sum())

    conn.execute(
        duckdb_queries.INSERT_CLUSTERING_RUN,
        [
            datetime.now(UTC),
            datetime.now(UTC),
            len(metadata),
            config.pca_dims,
            config.umap_n_neighbors,
            config.umap_min_dist,
            n_clusters,
            noise_count,
            duration_secs,
        ],
    )

    result = conn.execute(duckdb_queries.SELECT_MAX_CLUSTERING_RUN_ID).fetchone()
    run_id: int = result[0] if result else 0

    conn.execute(duckdb_queries.DELETE_CHUNK_PROJECTIONS)

    emit_progress(AnalyticsStage.SAVING_CLUSTERS, 30, "Building projection data...")

    # Build arrays
    chunk_ids = []
    x_2d_list = []
    y_2d_list = []
    x_3d_list = []
    y_3d_list = []
    z_3d_list = []
    cluster_id_list = []
    cluster_label_list = []
    cluster_color_list = []
    contact_id_list = []
    contact_name_list = []
    message_preview_list = []
    chunk_date_list = []
    run_id_list = []

    for i, meta in enumerate(metadata):
        chunk_ids.append(meta["chunk_id"])
        x_2d_list.append(float(coords_2d[i, 0]))
        y_2d_list.append(float(coords_2d[i, 1]))
        x_3d_list.append(float(coords_3d[i, 0]))
        y_3d_list.append(float(coords_3d[i, 1]))
        z_3d_list.append(float(coords_3d[i, 2]))

        cid = int(cluster_labels[i])
        cluster_id_list.append(cid)
        cluster_label_list.append(cluster_names.get(cid, f"Topic {cid + 1}"))
        cluster_color_list.append(get_cluster_color(cid))

        contact_id_list.append(meta["contact_id"])
        contact_name_list.append(meta["contact_name"])
        message_preview_list.append(
            meta["message_preview"][:150] if meta["message_preview"] else ""
        )
        chunk_date_list.append(meta["chunk_date"])
        run_id_list.append(run_id)

    emit_progress(AnalyticsStage.SAVING_CLUSTERS, 60, "Writing to database...")

    table = pa.table(
        {
            "chunk_id": pa.array(chunk_ids, type=pa.int64()),
            "x_2d": pa.array(x_2d_list, type=pa.float64()),
            "y_2d": pa.array(y_2d_list, type=pa.float64()),
            "x_3d": pa.array(x_3d_list, type=pa.float64()),
            "y_3d": pa.array(y_3d_list, type=pa.float64()),
            "z_3d": pa.array(z_3d_list, type=pa.float64()),
            "cluster_id": pa.array(cluster_id_list, type=pa.int32()),
            "cluster_label": pa.array(cluster_label_list, type=pa.string()),
            "cluster_color": pa.array(cluster_color_list, type=pa.string()),
            "contact_id": pa.array(contact_id_list, type=pa.string()),
            "contact_name": pa.array(contact_name_list, type=pa.string()),
            "message_preview": pa.array(message_preview_list, type=pa.string()),
            "chunk_date": pa.array(chunk_date_list, type=pa.timestamp("us", tz="UTC")),
            "clustering_run_id": pa.array(run_id_list, type=pa.int32()),
        }
    )

    insert_arrow(conn, table, "chunk_projections")

    conn.close()

    emit_progress(AnalyticsStage.SAVING_CLUSTERS, 100, f"Saved {len(metadata):,} projections")

    log_info(
        f"Saved clustering results: {len(metadata):,} points, {n_clusters} clusters, run_id={run_id}"
    )
    return run_id

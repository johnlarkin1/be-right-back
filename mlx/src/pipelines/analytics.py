"""Analytics pipeline: clustering, UMAP projection, and LLM labeling."""

import time
from collections import Counter
from pathlib import Path

import duckdb
import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16

from config.analytics import AnalyticsConfig
from data.loaders import load_embeddings_from_duckdb
from data.storage import configure_duckdb_memory, write_clustering_results
from data.write_lock import write_lock
from ml.clustering import (
    remove_contact_offsets,
    run_leiden,
    run_pca,
    run_umap_2d,
    run_umap_3d,
)
from ml.labeling import generate_cluster_labels
from progress.analytics import AnalyticsStage, AnalyticsStats, emit_progress
from progress.base import emit_result, log_error, log_info
from queries import duckdb as duckdb_queries
from utils.chunk_text import chunk_body, extract_words, name_tokens


def compute_daily_activity(db_path: Path) -> int:
    emit_progress(AnalyticsStage.ACTIVITY, 0, "Computing daily activity metrics...")

    conn = duckdb.connect(str(db_path))
    configure_duckdb_memory(conn)
    conn.execute("BEGIN")
    conn.execute(duckdb_queries.DELETE_DAILY_ACTIVITY)
    conn.execute(duckdb_queries.INSERT_DAILY_ACTIVITY)
    conn.execute("COMMIT")

    result = conn.execute(duckdb_queries.SELECT_DAILY_ACTIVITY_COUNT).fetchone()
    count: int = result[0] if result else 0
    conn.close()

    emit_progress(
        AnalyticsStage.ACTIVITY, 100, f"Computed activity for {count:,} date-contact pairs"
    )
    log_info(f"Daily activity: {count:,} records")

    return count


def count_daily_words(db_path: Path) -> list[tuple[str, str, int]]:
    """Count daily word frequencies from message text, reading read-only.

    Counts only what was said: no contact header, no sender names, and no
    tokens of the chunk's own contact name. Returns the top 500 words per day
    as ``(date, word, count)`` rows.
    """
    emit_progress(AnalyticsStage.WORDS, 0, "Computing word frequencies...")

    conn = duckdb.connect(str(db_path), read_only=True)
    configure_duckdb_memory(conn)
    chunks = conn.execute(duckdb_queries.SELECT_CHUNK_TEXT_BY_DATE).fetchall()
    conn.close()

    emit_progress(AnalyticsStage.WORDS, 20, f"Processing {len(chunks):,} chunks...")

    daily_counts: dict[str, Counter] = {}
    tokens_of: dict[str, set[str]] = {}

    for i, (date, chunk_data_json, contact_name) in enumerate(chunks):
        date_str = str(date)

        try:
            chunk_data = json.loads(chunk_data_json) if chunk_data_json else {}
        except (json.JSONDecodeError, TypeError):
            chunk_data = {}

        text = chunk_body(chunk_data, contact_name or "")
        if not text:
            continue

        name = contact_name or ""
        if name not in tokens_of:
            tokens_of[name] = name_tokens([name])
        daily_counts.setdefault(date_str, Counter()).update(extract_words(text, tokens_of[name]))

        if (i + 1) % (len(chunks) // 10 + 1) == 0:
            pct = 20 + int((i + 1) / len(chunks) * 60)
            emit_progress(AnalyticsStage.WORDS, pct, f"Processed {i + 1:,}/{len(chunks):,} chunks")

    rows: list[tuple[str, str, int]] = []
    for date_str, word_counts in daily_counts.items():
        for word, count in word_counts.most_common(500):
            rows.append((date_str, word, count))

    log_info(f"Word counts: {len(rows):,} records across {len(daily_counts)} days")
    return rows


def write_daily_word_counts(db_path: Path, rows: list[tuple[str, str, int]]) -> int:
    """Replace daily_word_counts with ``rows`` in one transaction."""
    emit_progress(AnalyticsStage.WORDS, 80, "Writing word counts to database...")

    conn = duckdb.connect(str(db_path))
    configure_duckdb_memory(conn)
    conn.execute("BEGIN")
    conn.execute(duckdb_queries.DELETE_DAILY_WORD_COUNTS)
    if rows:
        # One executemany instead of N individual inserts.
        conn.executemany(
            "INSERT INTO daily_word_counts (date, word, count) VALUES (?, ?, ?)",
            rows,
        )
    conn.execute("COMMIT")
    conn.close()

    emit_progress(AnalyticsStage.WORDS, 100, f"Saved {len(rows):,} word counts")
    return len(rows)


def run_analytics(db_path: Path, config: AnalyticsConfig | None = None) -> dict:
    if config is None:
        config = AnalyticsConfig()

    start_time = time.perf_counter()
    log_info("=" * 60)
    log_info("Be Right Back Analytics Pipeline")
    log_info("=" * 60)

    # 1. Load embeddings
    embeddings, metadata = load_embeddings_from_duckdb(db_path)
    total_chunks = len(metadata)

    if total_chunks == 0:
        log_error("No chunks found in database")
        emit_result(False, error="No chunks found in database")
        return {}

    # 2. Remove per-contact offsets so clusters follow topic, not person
    contact_ids = [m["contact_id"] for m in metadata]
    embeddings = remove_contact_offsets(embeddings, contact_ids, config.contact_shrinkage)

    # 3. PCA reduction
    embeddings_50d = run_pca(embeddings, config)

    # 4. Topic clusters
    cluster_labels = run_leiden(embeddings_50d, config)

    # 5. UMAP projections for the Semantic Space view
    coords_2d = run_umap_2d(embeddings_50d, config)
    coords_3d = run_umap_3d(embeddings_50d, config)

    # 6. Generate cluster labels via LLM
    cluster_names = generate_cluster_labels(cluster_labels, metadata, embeddings_50d)

    # 7. Word frequencies, read-only like everything above
    word_rows = count_daily_words(db_path)

    # 8. Write all results. The app holds brb.duckdb open while this runs, so
    # take its write lock only for the writes, which take seconds.
    clustering_duration = time.perf_counter() - start_time
    with write_lock():
        run_id = write_clustering_results(
            db_path,
            metadata,
            coords_2d,
            coords_3d,
            cluster_labels,
            cluster_names,
            config,
            clustering_duration,
        )
        activity_count = compute_daily_activity(db_path)
        word_count = write_daily_word_counts(db_path, word_rows)

    # Done
    total_duration = time.perf_counter() - start_time
    n_clusters = len([c for c in set(cluster_labels) if c >= 0])
    noise_ratio = float((cluster_labels == -1).mean())

    emit_progress(
        AnalyticsStage.COMPLETE,
        100,
        "Analytics complete",
        AnalyticsStats(
            total_chunks=total_chunks,
            n_clusters=n_clusters,
            noise_ratio=noise_ratio,
            elapsed_secs=total_duration,
        ),
    )

    result_data = {
        "n_points": total_chunks,
        "n_clusters": n_clusters,
        "noise_ratio": noise_ratio,
        "clustering_run_id": run_id,
        "activity_records": activity_count,
        "word_records": word_count,
        "duration_secs": total_duration,
    }

    log_info("=" * 60)
    log_info(f"Analytics complete in {total_duration:.1f}s")
    log_info(f"  Points: {total_chunks:,}")
    log_info(f"  Clusters: {n_clusters}")
    log_info(f"  Noise: {noise_ratio:.1%}")
    log_info(f"  Activity records: {activity_count:,}")
    log_info(f"  Word records: {word_count:,}")
    log_info("=" * 60)

    emit_result(True, result_data)
    return result_data

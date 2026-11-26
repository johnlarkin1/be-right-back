"""DuckDB queries for vector database operations."""

from typing import Literal

ChunkTable = Literal["analytics_chunks", "message_chunks"]


def build_embeddings_query(table_name: ChunkTable = "analytics_chunks") -> str:
    return f"""
        SELECT
            chunk_id,
            embedding,
            contact_id,
            contact_name,
            chunk_data,
            end_timestamp
        FROM {table_name}
        ORDER BY chunk_id
    """


SELECT_CHUNK_COUNT = "SELECT COUNT(*) FROM {table_name}"


DELETE_DAILY_MESSAGES = "TRUNCATE TABLE daily_messages"

DELETE_DAILY_ACTIVITY = "TRUNCATE TABLE daily_activity"

INSERT_DAILY_ACTIVITY = """
    INSERT INTO daily_activity (date, contact_id, message_count, sent_count, received_count)
    SELECT
        DATE(end_timestamp) as date,
        contact_id,
        SUM(message_count) as message_count,
        SUM(CASE WHEN has_from_me THEN message_count ELSE 0 END) as sent_count,
        SUM(CASE WHEN has_from_them THEN message_count ELSE 0 END) as received_count
    FROM message_chunks
    WHERE end_timestamp IS NOT NULL
    GROUP BY DATE(end_timestamp), contact_id
"""

SELECT_DAILY_ACTIVITY_COUNT = "SELECT COUNT(*) FROM daily_activity"


DELETE_DAILY_WORD_COUNTS = "TRUNCATE TABLE daily_word_counts"

SELECT_CHUNK_TEXT_BY_DATE = """
    SELECT DATE(end_timestamp) as date, chunk_data, contact_name
    FROM message_chunks
    WHERE end_timestamp IS NOT NULL
"""

# Use TRUNCATE instead of DELETE to avoid DuckDB MVCC undo log overhead.
# DELETE on 250k rows with 768-dim embeddings creates ~750MB of undo entries;
# TRUNCATE skips row-by-row deletion and reclaims space immediately.
DELETE_MESSAGE_CHUNKS = "TRUNCATE TABLE message_chunks"
DELETE_CHUNK_PROJECTIONS = "TRUNCATE TABLE chunk_projections"


DROP_HNSW_INDEX = "DROP INDEX IF EXISTS idx_chunks_hnsw"

# An all-zero embedding is dead weight: cosine similarity to it is 0 for every
# query, so the chunk can never be found by semantic search. They appear when the
# model returns NaN and the pipeline falls back to zeros.
COUNT_ZERO_EMBEDDINGS = """
    SELECT COUNT(*) FROM message_chunks
    WHERE list_max(list_transform(embedding::FLOAT[], lambda x: abs(x))) = 0
"""

INSERT_CLUSTERING_RUN = """
    INSERT INTO clustering_runs (
        started_at, completed_at, input_chunks,
        pca_dims, umap_n_neighbors, umap_min_dist,
        n_clusters, noise_count, duration_secs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

SELECT_MAX_CLUSTERING_RUN_ID = "SELECT MAX(id) FROM clustering_runs"

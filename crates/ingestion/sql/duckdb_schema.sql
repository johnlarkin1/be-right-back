INSTALL vss;
LOAD vss;

-- see here: https://duckdb.org/docs/stable/core_extensions/vss#persistence
-- this makes sure that the index is persisted to disk
SET hnsw_enable_experimental_persistence = true;

-- message chunks table
CREATE TABLE IF NOT EXISTS message_chunks (
    chunk_id BIGINT PRIMARY KEY,

    -- json blob containing messages array and formatted text
    chunk_data JSON NOT NULL,

    -- embedding vector dimensions (most likely nomic-embed-text-v1.5)
    embedding FLOAT[768] NOT NULL, 

    start_message_id BIGINT NOT NULL,
    end_message_id BIGINT NOT NULL,
    message_ids BIGINT[] NOT NULL,

    contact_id VARCHAR NOT NULL,
    contact_name VARCHAR,

    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,

    message_count INTEGER NOT NULL,
    total_chars INTEGER NOT NULL,

    has_from_me BOOLEAN NOT NULL,
    has_from_them BOOLEAN NOT NULL,
    has_questions BOOLEAN NOT NULL,

    ingestion_id INTEGER NOT NULL,

    -- Extracted text for full-text search (BM25 via DuckDB FTS extension)
    formatted_text VARCHAR
);

-- Note: Ingestion metadata is now stored in SQLite (brb.db) in the ingestion_meta table.
-- The message_chunks.ingestion_id column references the SQLite ingestion_meta.id.

CREATE INDEX IF NOT EXISTS idx_chunks_contact_time
    ON message_chunks(contact_id, end_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chunks_timestamp
    ON message_chunks(end_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chunks_ingestion
    ON message_chunks(ingestion_id);

-- Additional index for date-filtered queries on chunks
CREATE INDEX IF NOT EXISTS idx_chunks_end_timestamp
    ON message_chunks(end_timestamp);

-- =============================================================================
-- Analytics Pipeline Tables (for Insights page)
-- =============================================================================

-- Sequence for clustering run IDs
CREATE SEQUENCE IF NOT EXISTS seq_clustering_runs_id START 1;

-- Tracks clustering pipeline runs (matches ingestion_runs pattern)
CREATE TABLE IF NOT EXISTS clustering_runs (
    id INTEGER PRIMARY KEY DEFAULT nextval('seq_clustering_runs_id'),
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,

    -- Input stats
    input_chunks INTEGER NOT NULL,

    -- Pipeline configuration
    pca_dims INTEGER NOT NULL DEFAULT 50,
    min_cluster_size INTEGER NOT NULL DEFAULT 100,
    min_samples INTEGER NOT NULL DEFAULT 10,
    umap_n_neighbors INTEGER NOT NULL DEFAULT 15,
    umap_min_dist DOUBLE NOT NULL DEFAULT 0.1,

    -- Results
    n_clusters INTEGER,
    noise_count INTEGER,
    duration_secs DOUBLE
);

-- =============================================================================
-- Analytics Chunks (non-overlapping, topic-aware for HDBSCAN clustering)
-- =============================================================================

-- Sequence for analytics run IDs
CREATE SEQUENCE IF NOT EXISTS seq_analytics_runs_id START 1;

-- Tracks analytics chunk generation runs (separate from ingestion runs)
CREATE TABLE IF NOT EXISTS analytics_runs (
    id INTEGER PRIMARY KEY DEFAULT nextval('seq_analytics_runs_id'),
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,

    -- Input stats
    input_messages INTEGER NOT NULL,

    -- Configuration
    window_size INTEGER NOT NULL DEFAULT 5,
    topic_threshold FLOAT NOT NULL DEFAULT 0.75,
    conversation_gap_hours FLOAT NOT NULL DEFAULT 4.0,

    -- Output stats
    total_chunks INTEGER,
    topic_boundaries INTEGER,           -- Chunks split due to topic change
    conversation_boundaries INTEGER,    -- Chunks split due to time gap
    window_limit_chunks INTEGER,        -- Chunks split due to max window size

    -- Embedding model info
    embedding_model VARCHAR NOT NULL,
    embedding_dims INTEGER NOT NULL DEFAULT 768,

    -- Timing
    duration_secs DOUBLE
);

-- Analytics chunks table (non-overlapping, topic-aware)
-- Used for HDBSCAN clustering instead of overlapping message_chunks
CREATE TABLE IF NOT EXISTS analytics_chunks (
    chunk_id BIGINT PRIMARY KEY,

    -- Content (same structure as message_chunks for compatibility)
    chunk_data JSON NOT NULL,
    embedding FLOAT[768] NOT NULL,

    -- Message range (non-overlapping, unlike message_chunks)
    start_message_id BIGINT NOT NULL,
    end_message_id BIGINT NOT NULL,
    message_ids BIGINT[] NOT NULL,

    -- Contact info
    contact_id VARCHAR NOT NULL,
    contact_name VARCHAR,

    -- Timestamps
    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,

    -- Chunk stats
    message_count INTEGER NOT NULL,
    total_chars INTEGER NOT NULL,

    -- Topic boundary metadata (analytics-specific)
    topic_boundary_score FLOAT,         -- Cosine similarity that triggered boundary (NULL if not topic change)
    boundary_type VARCHAR(20),          -- 'topic_change', 'conversation_gap', 'window_limit', 'end'

    -- Tracking
    analytics_run_id INTEGER NOT NULL,

    FOREIGN KEY (analytics_run_id) REFERENCES analytics_runs(id)
);

-- Indexes for analytics_chunks
CREATE INDEX IF NOT EXISTS idx_analytics_chunks_contact_time
    ON analytics_chunks(contact_id, end_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_chunks_run
    ON analytics_chunks(analytics_run_id);

CREATE INDEX IF NOT EXISTS idx_analytics_chunks_boundary
    ON analytics_chunks(boundary_type);

-- UMAP projections + clustering results for each chunk (single table)
-- Denormalized for fast frontend queries (avoids JOINs)
-- Note: Can reference either analytics_chunks or message_chunks (fallback)
CREATE TABLE IF NOT EXISTS chunk_projections (
    chunk_id BIGINT PRIMARY KEY,

    -- 2D UMAP coordinates
    x_2d DOUBLE NOT NULL,
    y_2d DOUBLE NOT NULL,

    -- 3D UMAP coordinates
    x_3d DOUBLE NOT NULL,
    y_3d DOUBLE NOT NULL,
    z_3d DOUBLE NOT NULL,

    -- Leiden clustering results
    cluster_id INTEGER NOT NULL,          -- -1 = noise
    cluster_label VARCHAR NOT NULL,       -- "Travel Plans", "Work Projects", etc.
    cluster_color VARCHAR NOT NULL,       -- "#00ff41"

    -- Denormalized for fast frontend queries (avoid JOINs)
    contact_id VARCHAR NOT NULL,
    contact_name VARCHAR,
    message_preview VARCHAR(150) NOT NULL,  -- First 150 chars of chunk
    chunk_date TIMESTAMPTZ NOT NULL,          -- end_timestamp from source chunks

    -- Tracking
    clustering_run_id INTEGER NOT NULL,

    -- Note: No FK on chunk_id since we support both analytics_chunks and message_chunks as sources
    FOREIGN KEY (clustering_run_id) REFERENCES clustering_runs(id)
);

-- Indexes for fast filtering on chunk_projections
CREATE INDEX IF NOT EXISTS idx_projections_cluster
    ON chunk_projections(cluster_id);

CREATE INDEX IF NOT EXISTS idx_projections_contact
    ON chunk_projections(contact_id);

CREATE INDEX IF NOT EXISTS idx_projections_run
    ON chunk_projections(clustering_run_id);

CREATE INDEX IF NOT EXISTS idx_projections_date
    ON chunk_projections(chunk_date);

-- Daily activity metrics (for heatmap + summary stats)
-- Supports date filtering for GitHub-style contribution graph
CREATE TABLE IF NOT EXISTS daily_activity (
    date DATE NOT NULL,
    contact_id VARCHAR NOT NULL,

    -- Message counts
    message_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,      -- messages FROM user
    received_count INTEGER NOT NULL DEFAULT 0,  -- messages FROM contact

    -- Response metrics (nullable if no responses that day)
    avg_response_time_secs DOUBLE,

    PRIMARY KEY (date, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_date
    ON daily_activity(date);

CREATE INDEX IF NOT EXISTS idx_daily_activity_contact
    ON daily_activity(contact_id);

-- Daily word frequencies (for content word cloud)
-- Aggregated across all contacts per day for efficiency
CREATE TABLE IF NOT EXISTS daily_word_counts (
    date DATE NOT NULL,
    word VARCHAR(50) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (date, word)
);

CREATE INDEX IF NOT EXISTS idx_daily_words_date
    ON daily_word_counts(date);

CREATE INDEX IF NOT EXISTS idx_daily_words_word
    ON daily_word_counts(word);

-- =============================================================================
-- Daily Messages Table (bypasses chunks for accurate sent/received tracking)
-- =============================================================================

-- Per-message daily metrics populated directly from raw messages at ingestion
-- This preserves the accurate is_from_me flag that gets lost in chunk booleans
CREATE TABLE IF NOT EXISTS daily_messages (
    date DATE NOT NULL,
    contact_id VARCHAR NOT NULL,
    is_from_me BOOLEAN NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, contact_id, is_from_me)
);

CREATE INDEX IF NOT EXISTS idx_daily_messages_date
    ON daily_messages(date);

CREATE INDEX IF NOT EXISTS idx_daily_messages_contact
    ON daily_messages(contact_id);

-- Minimal schema for compatibility testing (message_chunks table only)
-- Extracted from crates/ingestion/sql/duckdb_schema.sql

INSTALL vss;
LOAD vss;

SET hnsw_enable_experimental_persistence = true;

CREATE TABLE IF NOT EXISTS message_chunks (
    chunk_id BIGINT PRIMARY KEY,
    chunk_data JSON NOT NULL,
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
    formatted_text VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_chunks_contact_time
    ON message_chunks(contact_id, end_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chunks_timestamp
    ON message_chunks(end_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_chunks_ingestion
    ON message_chunks(ingestion_id);

CREATE INDEX IF NOT EXISTS idx_chunks_end_timestamp
    ON message_chunks(end_timestamp);

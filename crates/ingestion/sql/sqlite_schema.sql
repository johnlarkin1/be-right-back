-- sqlite schema for be-right-back application
-- this will hold application specific data, but not the original messages

-- Ingestion run history (one row per successful ingestion)
CREATE TABLE IF NOT EXISTS ingestion_meta (
    id INTEGER PRIMARY KEY,
    snapshot_dir TEXT NOT NULL,
    snapshot_time TEXT NOT NULL,
    ingestion_duration_secs INTEGER NOT NULL,
    message_count INTEGER NOT NULL,
    contact_count INTEGER NOT NULL,
    -- Embedding metadata (populated after embedding step completes)
    embedding_model TEXT,              -- e.g., "mlx-community/nomicai-modernbert-embed-base-8bit"
    embedding_dims INTEGER,            -- e.g., 768
    embedding_duration_secs INTEGER,   -- time taken for embedding step
    chunk_window_size INTEGER,         -- messages per chunk (e.g., 5)
    chunk_stride INTEGER,              -- stride between chunks (e.g., 3)
    -- Date range of the ingestion
    earliest_message_date TEXT,        -- ISO format YYYY-MM-DD (computed during snapshot)
    latest_message_date TEXT           -- ISO format YYYY-MM-DD (computed during snapshot)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_meta_id ON ingestion_meta(id DESC);

-- Application lifecycle state (single row, source of truth for app state)
CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Single row enforced

    -- Permission tracking
    fda_first_granted_at TEXT,              -- When FDA was first detected as granted
    fda_last_checked_at TEXT,               -- Last time we verified FDA access

    -- Current ingestion (FK to ingestion_meta for snapshot/count info)
    curr_ingestion_id INTEGER REFERENCES ingestion_meta(id),

    -- Ingestion tracking (only set on SUCCESSFUL completion)
    ingestion_completed_at TEXT,            -- When ingestion finished successfully
    ingestion_chunk_count INTEGER,          -- Actual chunks created (from DuckDB, not in ingestion_meta)

    -- Analytics tracking (Leiden + UMAP clustering)
    analytics_completed_at TEXT,            -- When analytics pipeline finished
    analytics_cluster_count INTEGER,        -- Number of clusters created

    -- Base model tracking
    base_model_id TEXT,                     -- e.g., "mlx-community/Qwen3.5-9B-4bit" (HF model ID for download tracking)
    base_model_download_started_at TEXT,
    base_model_download_completed_at TEXT,
    base_model_size_bytes INTEGER,

    -- User's model preference (tier:quantization, e.g., "4b:4bit")
    model_preference TEXT,

    -- Onboarding UI state (replaces localStorage)
    onboarding_completed_at TEXT,           -- When user finished Casper guide
    onboarding_current_step TEXT,           -- welcome|privacy|permissions|snapshot|ingestion|complete
    casper_minimized INTEGER DEFAULT 0,     -- Boolean: is Casper minimized

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Initialize with empty state (single row)
INSERT OR IGNORE INTO app_state (id) VALUES (1);

-- Pre-computed contact statistics (populated during ingestion)
-- Uses composite primary key to keep historical stats across ingestion runs
CREATE TABLE IF NOT EXISTS contact_stats (
    contact_id TEXT NOT NULL,
    ingestion_id INTEGER NOT NULL,

    contact_name TEXT,

    -- Message counts
    message_count INTEGER NOT NULL DEFAULT 0,
    messages_from_me INTEGER NOT NULL DEFAULT 0,
    messages_from_them INTEGER NOT NULL DEFAULT 0,

    -- Date range (ISO format: YYYY-MM-DD)
    date_range_start TEXT,
    date_range_end TEXT,

    -- Message style (computed from "their" messages only)
    avg_message_length REAL NOT NULL DEFAULT 0.0,
    emoji_rate REAL NOT NULL DEFAULT 0.0,
    top_emojis TEXT,  -- JSON array: ["😊", "😂", ...]

    -- Response time (their response to user messages, in seconds)
    avg_response_time_secs REAL,

    -- Composite primary key: one row per contact per ingestion run
    PRIMARY KEY (contact_id, ingestion_id),
    FOREIGN KEY (ingestion_id) REFERENCES ingestion_meta(id)
);

-- Index for fast lookup by current ingestion
CREATE INDEX IF NOT EXISTS idx_contact_stats_ingestion
    ON contact_stats(ingestion_id);

-- Index for looking up a specific contact's history
CREATE INDEX IF NOT EXISTS idx_contact_stats_contact
    ON contact_stats(contact_id);

-- Contacts table (pre-computed display names from AddressBook during ingestion)
-- This avoids expensive phone normalization on every app startup
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingestion_id INTEGER NOT NULL,
    contact_id TEXT NOT NULL,           -- Original handle ID (e.g., "+15551234567", "user@email.com")
    normalized_id TEXT,                 -- Normalized phone for matching (e.g., "+15551234567")
    display_name TEXT,                  -- Resolved from AddressBook (e.g., "John Smith")
    message_count INTEGER NOT NULL,
    earliest_message TEXT,              -- ISO format YYYY-MM-DD
    latest_message TEXT,                -- ISO format YYYY-MM-DD
    UNIQUE(ingestion_id, contact_id),
    FOREIGN KEY (ingestion_id) REFERENCES ingestion_meta(id)
);

-- Index for fast lookup by current ingestion
CREATE INDEX IF NOT EXISTS idx_contacts_ingestion ON contacts(ingestion_id);

-- Ingestion settings (single row, user preferences for ingestion)
CREATE TABLE IF NOT EXISTS ingestion_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Single row enforced

    -- Date range filters (ISO format: YYYY-MM-DD)
    start_date TEXT,                        -- Earliest messages to include, NULL for no limit
    end_date TEXT,                          -- Latest messages to include, NULL for no limit

    -- Contact filter
    min_messages_per_contact INTEGER,       -- Minimum messages required, NULL if disabled

    -- Analytics settings (JSON blob for flexibility)
    analytics_settings TEXT,                -- JSON: {pcaDims, minClusterSize, minSamples, ...}

    -- Timestamps
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Initialize with empty settings (single row)
INSERT OR IGNORE INTO ingestion_settings (id) VALUES (1);

-- Cached LLM personality/conversation analysis (one per contact per ingestion run)
CREATE TABLE IF NOT EXISTS conversation_analysis (
    id INTEGER PRIMARY KEY,
    contact_id TEXT NOT NULL,
    ingestion_id INTEGER NOT NULL,

    -- Analysis content (markdown from LLM)
    analysis_markdown TEXT NOT NULL,

    -- Model info
    model_id TEXT NOT NULL,                 -- e.g., "mlx-community/Qwen3-4B-8bit"
    generation_duration_secs INTEGER,       -- How long analysis took

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- One analysis per contact per ingestion (re-ingestion invalidates cache)
    UNIQUE(contact_id, ingestion_id),
    FOREIGN KEY (ingestion_id) REFERENCES ingestion_meta(id)
);

-- Index for fast lookup by contact
CREATE INDEX IF NOT EXISTS idx_conversation_analysis_contact
    ON conversation_analysis(contact_id);

-- =============================================================================
-- Casper conversation threads (ChatGPT-style saved Casper Q&A sessions)
-- =============================================================================

-- One row per saved Casper conversation thread
CREATE TABLE IF NOT EXISTS casper_threads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Threads are listed most-recently-updated first
CREATE INDEX IF NOT EXISTS idx_casper_threads_updated
    ON casper_threads(updated_at DESC);

-- One row per message within a Casper thread (user + assistant turns).
-- tool_calls / thinking capture the assembled UI state so a reopened thread
-- re-renders identically without re-running the agent.
CREATE TABLE IF NOT EXISTS casper_messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id        INTEGER NOT NULL,
    role             TEXT NOT NULL,            -- 'user' | 'assistant'
    content          TEXT NOT NULL,
    thinking         TEXT,                     -- assistant <think> block, nullable
    thinking_enabled INTEGER NOT NULL DEFAULT 0,
    tool_calls       TEXT,                     -- JSON array of CasperToolCall, nullable
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES casper_threads(id) ON DELETE CASCADE
);

-- Index for loading a thread's messages in order
CREATE INDEX IF NOT EXISTS idx_casper_messages_thread
    ON casper_messages(thread_id, created_at);

-- Tapbacks (iMessage reactions) from the snapshot, written during ingestion.
-- One row per Tapback still on a message: removals are netted out first.
-- No message text is stored. Read a target's text from the snapshot by target_rowid.
CREATE TABLE IF NOT EXISTS tapbacks (
    ingestion_id INTEGER NOT NULL,
    message_rowid INTEGER NOT NULL,     -- the Tapback row in chat.db
    chat_id INTEGER NOT NULL,           -- chat.db chat ROWID
    contact_id TEXT,                    -- 1:1 contact handle; NULL in a group chat
    sender_id TEXT,                     -- handle of who reacted; NULL when it is you
    is_from_me INTEGER NOT NULL,
    kind TEXT NOT NULL,                 -- love|like|dislike|laugh|emphasize|question|emoji|sticker
    emoji TEXT,                         -- for kind = emoji (macOS 15+)
    target_rowid INTEGER,               -- target message ROWID; NULL when not in the snapshot
    target_part INTEGER NOT NULL DEFAULT 0,
    target_is_balloon INTEGER NOT NULL DEFAULT 0,  -- target is a link or app balloon
    target_from_me INTEGER,
    target_sender_id TEXT,              -- handle of the target's sender; NULL when it is you
    reacted_at INTEGER NOT NULL,        -- unix seconds
    PRIMARY KEY (ingestion_id, message_rowid),
    FOREIGN KEY (ingestion_id) REFERENCES ingestion_meta(id)
);

CREATE INDEX IF NOT EXISTS idx_tapbacks_contact ON tapbacks(ingestion_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_tapbacks_target ON tapbacks(ingestion_id, target_rowid);

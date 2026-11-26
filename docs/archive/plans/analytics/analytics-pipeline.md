# Analytics Pipeline Implementation Plan

## Objective

Create `mlx/src/analytics.py` to generate all analytics data for the Insights page:

1. **Semantic Space Visualization** - UMAP 2D/3D projections + HDBSCAN clustering with LLM-generated labels
2. **Activity Heatmap** - Daily message counts (GitHub contribution graph style)
3. **Word Clouds** - Contact frequency + message content word frequencies

All analytics support date filtering via timestamp indexes.

---

## Benchmark Results (Clustering)

| Points | PCA (s) | HDBSCAN (s) | UMAP (s) | Total (s) |
|--------|---------|-------------|----------|-----------|
| 10k | 0.05 | 0.18 | 13.08 | 13.31 |
| 50k | 0.20 | 2.04 | 17.58 | 19.82 |
| 100k | 0.37 | 3.12 | 34.76 | 38.25 |

**Key insight**: UMAP dominates (89-98% of time). PCA + HDBSCAN are trivial.

---

## DuckDB Schema (add to `crates/ingestion/sql/duckdb_schema.sql`)

### Clustering Tables

```sql
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

-- UMAP projections + clustering results for each chunk (single table)
CREATE TABLE IF NOT EXISTS chunk_projections (
    chunk_id BIGINT PRIMARY KEY,

    -- 2D UMAP coordinates
    x_2d DOUBLE NOT NULL,
    y_2d DOUBLE NOT NULL,

    -- 3D UMAP coordinates
    x_3d DOUBLE NOT NULL,
    y_3d DOUBLE NOT NULL,
    z_3d DOUBLE NOT NULL,

    -- HDBSCAN clustering results
    cluster_id INTEGER NOT NULL,          -- -1 = noise
    cluster_label VARCHAR NOT NULL,       -- "Travel Plans", "Work Projects", etc.
    cluster_color VARCHAR NOT NULL,       -- "#00ff41"

    -- Denormalized for fast frontend queries (avoid JOINs)
    contact_id VARCHAR NOT NULL,
    contact_name VARCHAR,
    message_preview VARCHAR(150) NOT NULL,  -- First 150 chars of chunk (truncated in Python)
    chunk_date TIMESTAMP NOT NULL,          -- end_timestamp from message_chunks

    -- Tracking
    clustering_run_id INTEGER NOT NULL,

    FOREIGN KEY (chunk_id) REFERENCES message_chunks(chunk_id),
    FOREIGN KEY (clustering_run_id) REFERENCES clustering_runs(id)
);

-- Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_projections_cluster ON chunk_projections(cluster_id);
CREATE INDEX IF NOT EXISTS idx_projections_contact ON chunk_projections(contact_id);
CREATE INDEX IF NOT EXISTS idx_projections_run ON chunk_projections(clustering_run_id);
CREATE INDEX IF NOT EXISTS idx_projections_date ON chunk_projections(chunk_date);
```

### Activity & Word Cloud Tables

```sql
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
    avg_response_time_secs DOUBLE,              -- avg time between msg pairs

    PRIMARY KEY (date, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON daily_activity(date);
CREATE INDEX IF NOT EXISTS idx_daily_activity_contact ON daily_activity(contact_id);

-- Daily word frequencies (for content word cloud)
-- Aggregated across all contacts per day for efficiency
CREATE TABLE IF NOT EXISTS daily_word_counts (
    date DATE NOT NULL,
    word VARCHAR(50) NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (date, word)
);

CREATE INDEX IF NOT EXISTS idx_daily_words_date ON daily_word_counts(date);
CREATE INDEX IF NOT EXISTS idx_daily_words_word ON daily_word_counts(word);
```

### Additional Indexes on message_chunks

```sql
-- For efficient date-filtered queries on chunks
CREATE INDEX IF NOT EXISTS idx_chunks_end_timestamp ON message_chunks(end_timestamp);
CREATE INDEX IF NOT EXISTS idx_chunks_contact_timestamp ON message_chunks(contact_id, end_timestamp);
```

---

## Design Decisions

### Clustering
1. **Single table** - `chunk_projections` stores everything (both 2D and 3D coords, clustering info)
2. **Both 2D and 3D** - Compute both projections in one pass; frontend toggles view
3. **Denormalized data** - Store contact_name, message_preview, date directly to avoid JOINs
4. **Cluster summaries via aggregation** - No separate table; use `GROUP BY cluster_id` when needed
5. **Run tracking** - `clustering_runs` table (matches `ingestion_runs` pattern)
6. **Semantic labels** - LLM-generated topic labels instead of generic "Cluster 1"

### Activity & Word Clouds
1. **Pre-aggregated daily** - Store per-contact-per-day counts for fast date range queries
2. **Word frequencies per day** - Aggregated across contacts (not per-contact) to keep table size manageable
3. **Contact word cloud via direct query** - Query `message_chunks` with date filter, no pre-aggregation needed
4. **All tables indexed by date** - Supports efficient date range filtering

---

## Frontend Query Patterns

### Semantic Space (No Date Filtering)

```sql
-- Get all points for 3D view
SELECT
    x_3d AS x, y_3d AS y, z_3d AS z,
    cluster_id, cluster_label, cluster_color,
    message_preview, contact_name, chunk_date
FROM chunk_projections
ORDER BY cluster_id;

-- Get all points for 2D view
SELECT
    x_2d AS x, y_2d AS y,
    cluster_id, cluster_label, cluster_color,
    message_preview, contact_name, chunk_date
FROM chunk_projections
ORDER BY cluster_id;

-- Get cluster summaries (computed via aggregation)
SELECT
    cluster_id,
    cluster_label,
    cluster_color,
    COUNT(*) as point_count,
    AVG(x_3d) as center_x,
    AVG(y_3d) as center_y,
    AVG(z_3d) as center_z
FROM chunk_projections
WHERE cluster_id >= 0  -- exclude noise
GROUP BY cluster_id, cluster_label, cluster_color
ORDER BY point_count DESC;
```

**Note**: The semantic space shows ALL messages. The Insights date brush only affects the timeline/word clouds, not the visualization.

### Activity Heatmap (With Date Filtering)

```sql
-- Activity heatmap (all contacts) - GitHub contribution style
SELECT date, SUM(message_count) as count
FROM daily_activity
WHERE date BETWEEN ? AND ?
GROUP BY date
ORDER BY date;

-- Activity heatmap (specific contact)
SELECT date, message_count as count
FROM daily_activity
WHERE date BETWEEN ? AND ? AND contact_id = ?
ORDER BY date;
```

### Contact Word Cloud (With Date Filtering)

```sql
-- Top contacts by message count in date range
SELECT
    contact_id,
    contact_name,
    COUNT(*) as message_count
FROM message_chunks
WHERE end_timestamp BETWEEN ? AND ?
GROUP BY contact_id, contact_name
ORDER BY message_count DESC
LIMIT 50;
```

### Content Word Cloud (With Date Filtering)

```sql
-- Top words by frequency in date range
SELECT word, SUM(count) as total
FROM daily_word_counts
WHERE date BETWEEN ? AND ?
GROUP BY word
ORDER BY total DESC
LIMIT 100;
```

### Summary Stats (With Date Filtering)

```sql
SELECT
    SUM(message_count) as total_messages,
    SUM(sent_count) as total_sent,
    SUM(received_count) as total_received,
    COUNT(DISTINCT date) as active_days,
    AVG(avg_response_time_secs) as avg_response_time
FROM daily_activity
WHERE date BETWEEN ? AND ?;

-- Topic count (from clustering - not date filtered)
SELECT COUNT(DISTINCT cluster_id) as topic_count
FROM chunk_projections
WHERE cluster_id >= 0;
```

---

## `mlx/src/analytics.py` Structure

```python
#!/usr/bin/env python3
"""
Analytics pipeline for Insights page.

Computes:
1. Semantic space (UMAP + HDBSCAN clustering + LLM labels)
2. Daily activity aggregates
3. Daily word frequencies

Usage:
    python analytics.py --db-path ~/.be-right-back/data/db/brb.duckdb
"""

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime

import duckdb
import numpy as np

# Core flow:
def main():
    # 1. Semantic Space Pipeline
    #    a. Load embeddings + metadata from message_chunks
    #    b. PCA: 768D → 50D
    #    c. HDBSCAN: cluster the 50D data
    #    d. UMAP 2D: 50D → 2D (for 2D view)
    #    e. UMAP 3D: 50D → 3D (for 3D view)
    #    f. Generate semantic cluster labels via local LLM
    #    g. Assign cluster colors
    #    h. Create clustering_runs record
    #    i. Write to chunk_projections table

    # 2. Daily Activity Pipeline
    #    a. Query messages grouped by date + contact
    #    b. Compute sent/received counts
    #    c. Compute average response times
    #    d. Write to daily_activity table

    # 3. Word Frequency Pipeline
    #    a. Load all chunk texts with dates
    #    b. Tokenize, filter stop words
    #    c. Aggregate by date
    #    d. Write to daily_word_counts table

    # 4. Emit JSON progress to stdout (for Tauri integration)
    pass
```

---

## Semantic Cluster Labeling (Local LLM)

Use a local LLM to generate meaningful labels for each cluster based on sample messages.

### Approach

1. For each cluster, sample ~10-20 representative messages (closest to cluster centroid)
2. Send to local LLM with a prompt asking for a 2-4 word topic label
3. Fall back to "Cluster N" if LLM unavailable or fails

### Implementation

```python
import json
import sys
import numpy as np

# Load MLX-LM once at module level for efficiency
_model = None
_tokenizer = None

def load_llm():
    """Load LLM model once for all cluster labeling."""
    global _model, _tokenizer
    if _model is None:
        try:
            from mlx_lm import load
            print(json.dumps({"type": "progress", "stage": "labeling", "percent": 70, "message": "Loading LLM for cluster labeling..."}))
            _model, _tokenizer = load(
                "mlx-community/Qwen3-4B-8bit",
                tokenizer_config={"trust_remote_code": True}
            )
        except ImportError:
            print(json.dumps({"type": "warning", "message": "MLX-LM not installed, using fallback labels"}))
            return None, None
    return _model, _tokenizer


def generate_cluster_labels(
    cluster_ids: np.ndarray,
    messages: list[str],
    embeddings_50d: np.ndarray,
) -> dict[int, str]:
    """Generate semantic labels for each cluster using local LLM."""

    unique_clusters = [c for c in np.unique(cluster_ids) if c >= 0]  # exclude noise (-1)
    labels = {}

    model, tokenizer = load_llm()

    for i, cluster_id in enumerate(unique_clusters):
        # Progress update
        progress = 70 + int((i / len(unique_clusters)) * 20)  # 70-90%
        print(json.dumps({
            "type": "progress",
            "stage": "labeling",
            "percent": progress,
            "message": f"Generating semantic labels ({i + 1}/{len(unique_clusters)})..."
        }))

        # Get messages in this cluster
        mask = cluster_ids == cluster_id
        cluster_messages = [m for m, in_cluster in zip(messages, mask) if in_cluster]
        cluster_embeddings = embeddings_50d[mask]

        # Find centroid and get closest messages
        centroid = cluster_embeddings.mean(axis=0)
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        closest_indices = np.argsort(distances)[:15]
        sample_messages = [cluster_messages[i] for i in closest_indices]

        # Generate label via local LLM
        label = get_llm_label(model, tokenizer, sample_messages, cluster_id)
        labels[cluster_id] = label

    # Noise cluster gets special label
    labels[-1] = "Uncategorized"

    return labels


def get_llm_label(model, tokenizer, sample_messages: list[str], cluster_id: int) -> str:
    """Call local LLM to generate a topic label."""

    # Truncate messages to 150 chars each for the prompt
    truncated_messages = [m[:150] for m in sample_messages[:10]]

    prompt = f"""Based on these conversation excerpts, provide a 2-4 word topic label that captures the main theme.

Messages:
{chr(10).join(f'- {m}' for m in truncated_messages)}

Respond with ONLY the topic label, nothing else. Examples: "Travel Plans", "Work Projects", "Family Updates", "Sports Discussion"

Topic label:"""

    if model is None or tokenizer is None:
        return f"Cluster {cluster_id + 1}"

    try:
        from mlx_lm import generate

        response = generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=20,
            verbose=False,
        )

        # Extract just the label from response
        label = response.strip()

        # If the response contains the prompt, extract just the new text
        if prompt in label:
            label = label[len(prompt):].strip()

        # Clean up: remove EOS tokens, quotes, limit length
        eos_tokens = ["<|endoftext|>", "<|end|>", "</s>", "<|im_end|>"]
        for eos_token in eos_tokens:
            if eos_token in label:
                label = label.split(eos_token)[0].strip()
                break

        label = label.strip('"\'').strip()
        label = label.split('\n')[0]  # First line only

        if len(label) > 30:
            label = label[:30]

        if label:
            return label

    except Exception as e:
        print(json.dumps({"type": "warning", "message": f"LLM labeling failed for cluster {cluster_id}: {e}"}), file=sys.stderr)

    # Fallback
    return f"Cluster {cluster_id + 1}"
```

---

## Daily Activity Aggregation

```python
def compute_daily_activity(conn: duckdb.DuckDBPyConnection) -> None:
    """Compute daily message counts and response times per contact."""

    print(json.dumps({
        "type": "progress",
        "stage": "activity",
        "percent": 92,
        "message": "Computing daily activity metrics..."
    }))

    # Clear existing data
    conn.execute("DELETE FROM daily_activity")

    # Aggregate from message_chunks
    # Note: This assumes message_chunks has is_from_me or similar field
    # Adjust query based on actual schema
    conn.execute("""
        INSERT INTO daily_activity (date, contact_id, message_count, sent_count, received_count)
        SELECT
            DATE(end_timestamp) as date,
            contact_id,
            COUNT(*) as message_count,
            SUM(CASE WHEN is_from_me THEN 1 ELSE 0 END) as sent_count,
            SUM(CASE WHEN NOT is_from_me THEN 1 ELSE 0 END) as received_count
        FROM message_chunks
        GROUP BY DATE(end_timestamp), contact_id
    """)

    # TODO: Compute avg_response_time_secs
    # This requires analyzing consecutive message pairs, which is more complex
    # For MVP, leave as NULL and implement later
```

---

## Word Frequency Extraction

```python
import re
from collections import Counter

STOP_WORDS = {
    # Common English stop words
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'under',
    'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where',
    'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
    'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until',
    'while', 'this', 'that', 'these', 'those',
    # Pronouns
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'what', 'which', 'who', 'whom', 'whose',
    # Common texting words
    'im', 'ive', 'youre', 'dont', 'didnt', 'wont', 'cant', 'isnt',
    'arent', 'wasnt', 'werent', 'hasnt', 'havent', 'hadnt', 'doesnt',
    'wouldnt', 'couldnt', 'shouldnt', 'yeah', 'yea', 'yes', 'no', 'ok',
    'okay', 'like', 'get', 'got', 'going', 'go', 'know', 'think',
    'want', 'see', 'come', 'make', 'take', 'good', 'well', 'back',
    'now', 'way', 'even', 'new', 'want', 'use', 'also', 'right',
    'lol', 'haha', 'hahaha', 'lmao', 'omg', 'gonna', 'wanna', 'gotta',
}


def extract_words(text: str) -> Counter:
    """Extract meaningful words from text, filtering stop words."""
    # Lowercase and extract words (3+ chars, letters only)
    words = re.findall(r'\b[a-z]{3,}\b', text.lower())
    # Filter stop words
    words = [w for w in words if w not in STOP_WORDS]
    return Counter(words)


def compute_daily_word_counts(conn: duckdb.DuckDBPyConnection) -> None:
    """Compute daily word frequencies from chunk texts."""

    print(json.dumps({
        "type": "progress",
        "stage": "words",
        "percent": 95,
        "message": "Computing word frequencies..."
    }))

    # Clear existing data
    conn.execute("DELETE FROM daily_word_counts")

    # Load chunks with dates
    chunks = conn.execute("""
        SELECT DATE(end_timestamp) as date, chunk_text
        FROM message_chunks
    """).fetchall()

    # Aggregate word counts by date
    daily_counts: dict[str, Counter] = {}

    for date, text in chunks:
        date_str = str(date)
        if date_str not in daily_counts:
            daily_counts[date_str] = Counter()
        daily_counts[date_str] += extract_words(text)

    # Insert into database (only top 500 words per day to limit size)
    for date_str, word_counts in daily_counts.items():
        top_words = word_counts.most_common(500)
        for word, count in top_words:
            conn.execute(
                "INSERT INTO daily_word_counts (date, word, count) VALUES (?, ?, ?)",
                [date_str, word, count]
            )

    conn.commit()
```

---

## Cluster Colors (CRT Theme)

```python
CLUSTER_COLORS = [
    "#00ff41",  # green - primary
    "#00d4ff",  # cyan
    "#ff6b9d",  # pink
    "#ffb000",  # amber
    "#a855f7",  # purple
    "#06b6d4",  # teal
    "#f43f5e",  # rose
    "#84cc16",  # lime
]

# Noise cluster (-1) gets a special muted color
NOISE_COLOR = "#4a4a4a"  # dark gray
```

---

## 2D vs 3D Support

**Compute both projections** during clustering:

```python
# In analytics.py - compute both in one run
reducer_2d = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1, random_state=42)
coords_2d = reducer_2d.fit_transform(X_50d)

reducer_3d = umap.UMAP(n_components=3, n_neighbors=15, min_dist=0.1, random_state=42)
coords_3d = reducer_3d.fit_transform(X_50d)

# Store both in chunk_projections table
# x_2d, y_2d for 2D view
# x_3d, y_3d, z_3d for 3D view
```

**Frontend toggle**: SemanticSpace.tsx can render as:
- 3D scatter plot (Plotly 3D) using `x_3d`, `y_3d`, `z_3d`
- 2D scatter plot using `x_2d`, `y_2d`

**Performance note**: Running UMAP twice roughly doubles the compute time (~6-10 mins total for 333k points). This is acceptable since it runs once after ingestion.

---

## Progress Protocol (JSON to stdout)

Match the pattern from `embed.py`:

```json
{"type": "progress", "stage": "loading", "percent": 5, "message": "Loading embeddings..."}
{"type": "progress", "stage": "pca", "percent": 15, "message": "PCA reduction (768D → 50D)..."}
{"type": "progress", "stage": "hdbscan", "percent": 25, "message": "Clustering with HDBSCAN..."}
{"type": "progress", "stage": "umap_2d", "percent": 35, "message": "UMAP projection (50D → 2D)..."}
{"type": "progress", "stage": "umap_3d", "percent": 55, "message": "UMAP projection (50D → 3D)..."}
{"type": "progress", "stage": "labeling", "percent": 75, "message": "Generating semantic labels (cluster 5/12)..."}
{"type": "progress", "stage": "saving_clusters", "percent": 90, "message": "Saving cluster data..."}
{"type": "progress", "stage": "activity", "percent": 92, "message": "Computing daily activity metrics..."}
{"type": "progress", "stage": "words", "percent": 95, "message": "Computing word frequencies..."}
{"type": "progress", "stage": "complete", "percent": 100, "message": "Analytics complete"}
{"type": "result", "success": true, "data": {"n_clusters": 12, "n_points": 333000, "noise_ratio": 0.15, "days_processed": 3650, "unique_words": 45000}}
```

---

## Files to Create/Modify

### New Files
1. `mlx/src/analytics.py` - Main analytics script (replaces cluster.py)

### Modify
2. `mlx/pyproject.toml` - Add `hdbscan`, `umap-learn` dependencies
3. `crates/ingestion/sql/duckdb_schema.sql` - Add all new tables and indexes
4. `apps/desktop/src-tauri/src/commands/system.rs` - Call analytics.py after ingestion
5. `apps/desktop/src-tauri/src/commands/insights.rs` - Implement query commands

---

## Dependencies to Add

### mlx/pyproject.toml
```toml
# Add to existing dependencies
"hdbscan>=0.8.33",
"umap-learn>=0.5.0",
```

---

## Integration with Ingestion Pipeline

In `apps/desktop/src-tauri/src/commands/system.rs` (after embedding completes):

```rust
// After embedding completes, run analytics pipeline
let python_path = get_app_dir().join("mlx-venv/bin/python");
let analytics_script = std::env::current_dir()?.join("mlx/src/analytics.py");

if analytics_script.exists() {
    info!("Running analytics pipeline...");
    let _ = std::process::Command::new(&python_path)
        .arg(&analytics_script)
        .arg("--db-path")
        .arg(&db_dir.join("brb.duckdb"))
        .status();
}
```

---

## Tauri Command Implementations

In `apps/desktop/src-tauri/src/commands/insights.rs`:

### Semantic Space

```rust
#[tauri::command]
pub async fn get_embeddings_for_viz(use_3d: bool) -> Result<EmbeddingVizData, String> {
    let db_path = get_db_path()?;
    let conn = duckdb::Connection::open(&db_path)?;

    let query = if use_3d {
        "SELECT x_3d AS x, y_3d AS y, z_3d AS z,
                cluster_id, cluster_label, cluster_color,
                message_preview, contact_name, chunk_date
         FROM chunk_projections"
    } else {
        "SELECT x_2d AS x, y_2d AS y, 0.0 AS z,
                cluster_id, cluster_label, cluster_color,
                message_preview, contact_name, chunk_date
         FROM chunk_projections"
    };

    // ... execute and return
}
```

### Activity Heatmap

```rust
#[tauri::command]
pub async fn get_activity_heatmap(
    start_date: String,
    end_date: String,
    contact_id: Option<String>,
) -> Result<Vec<ActivityDay>, String> {
    let db_path = get_db_path()?;
    let conn = duckdb::Connection::open(&db_path)?;

    let query = match contact_id {
        Some(cid) => format!(
            "SELECT date, message_count as count
             FROM daily_activity
             WHERE date BETWEEN '{}' AND '{}' AND contact_id = '{}'
             ORDER BY date",
            start_date, end_date, cid
        ),
        None => format!(
            "SELECT date, SUM(message_count) as count
             FROM daily_activity
             WHERE date BETWEEN '{}' AND '{}'
             GROUP BY date
             ORDER BY date",
            start_date, end_date
        ),
    };

    // ... execute and return
}
```

### Word Clouds

```rust
#[tauri::command]
pub async fn get_contact_word_cloud(
    start_date: String,
    end_date: String,
    limit: Option<i32>,
) -> Result<Vec<WordCloudItem>, String> {
    let limit = limit.unwrap_or(50);
    let query = format!(
        "SELECT contact_id, contact_name, COUNT(*) as message_count
         FROM message_chunks
         WHERE end_timestamp BETWEEN '{}' AND '{}'
         GROUP BY contact_id, contact_name
         ORDER BY message_count DESC
         LIMIT {}",
        start_date, end_date, limit
    );
    // ... execute and return
}

#[tauri::command]
pub async fn get_content_word_cloud(
    start_date: String,
    end_date: String,
    limit: Option<i32>,
) -> Result<Vec<WordCloudItem>, String> {
    let limit = limit.unwrap_or(100);
    let query = format!(
        "SELECT word, SUM(count) as total
         FROM daily_word_counts
         WHERE date BETWEEN '{}' AND '{}'
         GROUP BY word
         ORDER BY total DESC
         LIMIT {}",
        start_date, end_date, limit
    );
    // ... execute and return
}
```

### Summary Stats

```rust
#[tauri::command]
pub async fn get_insights_summary(
    start_date: String,
    end_date: String,
) -> Result<InsightsSummary, String> {
    let db_path = get_db_path()?;
    let conn = duckdb::Connection::open(&db_path)?;

    let stats = conn.query_row(
        &format!(
            "SELECT
                SUM(message_count) as total_messages,
                SUM(sent_count) as total_sent,
                SUM(received_count) as total_received,
                COUNT(DISTINCT date) as active_days,
                AVG(avg_response_time_secs) as avg_response_time
             FROM daily_activity
             WHERE date BETWEEN '{}' AND '{}'",
            start_date, end_date
        ),
        [],
        |row| {
            Ok(InsightsSummary {
                total_messages: row.get(0)?,
                total_sent: row.get(1)?,
                total_received: row.get(2)?,
                active_days: row.get(3)?,
                avg_response_time: row.get(4)?,
            })
        },
    )?;

    // Get topic count (not date filtered)
    let topic_count: i32 = conn.query_row(
        "SELECT COUNT(DISTINCT cluster_id) FROM chunk_projections WHERE cluster_id >= 0",
        [],
        |row| row.get(0),
    )?;

    Ok(InsightsSummary { topic_count, ..stats })
}
```

---

## Expected Performance

For 333k points (production scale):

### Clustering Pipeline
- **PCA**: ~1-2 seconds
- **HDBSCAN**: ~15-30 seconds
- **UMAP 2D**: ~3-5 minutes
- **UMAP 3D**: ~3-5 minutes
- **LLM Labeling**: ~30-60 seconds (2-3s per cluster, ~12-20 clusters typical)

### Activity & Word Aggregation
- **Daily activity**: ~5-10 seconds (SQL aggregation)
- **Word frequencies**: ~30-60 seconds (tokenization + aggregation)

### Total: ~9-14 minutes

This runs **once after ingestion**, results are cached. Frontend queries are instant:
- Semantic space: ~50ms for 333k rows
- Activity heatmap: ~10ms
- Word clouds: ~20ms
- Summary stats: ~5ms

---

## Implementation Order

1. Add all new tables and indexes to `crates/ingestion/sql/duckdb_schema.sql`
2. Add `hdbscan`, `umap-learn` dependencies to `mlx/pyproject.toml`
3. Create `mlx/src/analytics.py` with full pipeline:
   - Clustering (PCA → HDBSCAN → UMAP 2D → UMAP 3D → LLM labeling)
   - Daily activity aggregation
   - Word frequency extraction
4. Wire into `system.rs` (call analytics.py after ingestion completes)
5. Implement Tauri commands in `insights.rs`:
   - `get_embeddings_for_viz(use_3d: bool)`
   - `get_activity_heatmap(start, end, contact_id?)`
   - `get_contact_word_cloud(start, end, limit?)`
   - `get_content_word_cloud(start, end, limit?)`
   - `get_insights_summary(start, end)`
6. Test end-to-end with real data

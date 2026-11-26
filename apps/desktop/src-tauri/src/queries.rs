//! DuckDB query strings for insights analytics.
//!
//! This module centralizes all SQL queries used by the desktop app's
//! analytics/insights features.

// =============================================================================
// Timeline Queries
// =============================================================================

/// Get date range from daily_activity for auto-aggregation level determination
pub const SELECT_DATE_RANGE: &str = r#"
    SELECT CAST(MIN(date) AS VARCHAR), CAST(MAX(date) AS VARCHAR) FROM daily_activity
"#;

/// Daily timeline data aggregated from daily_activity
pub const SELECT_DAILY_TIMELINE: &str = r#"
    SELECT
        CAST(date AS VARCHAR) as date,
        SUM(sent_count) as from_me,
        SUM(received_count) as from_them,
        SUM(message_count) as total
    FROM daily_activity
    GROUP BY date
    ORDER BY date
"#;

/// Build weekly timeline query
pub fn build_weekly_timeline_query() -> String {
    r#"
    SELECT
        CAST(MIN(date) AS VARCHAR) as period_start,
        SUM(CASE WHEN is_from_me THEN message_count ELSE 0 END) as from_me,
        SUM(CASE WHEN NOT is_from_me THEN message_count ELSE 0 END) as from_them,
        SUM(message_count) as total
    FROM daily_messages
    GROUP BY YEARWEEK(date)
    ORDER BY period_start
    "#
    .to_string()
}

/// Build monthly timeline query
pub fn build_monthly_timeline_query() -> String {
    r#"
    SELECT
        CAST(MIN(date) AS VARCHAR) as period_start,
        SUM(CASE WHEN is_from_me THEN message_count ELSE 0 END) as from_me,
        SUM(CASE WHEN NOT is_from_me THEN message_count ELSE 0 END) as from_them,
        SUM(message_count) as total
    FROM daily_messages
    GROUP BY DATE_TRUNC('month', date)
    ORDER BY period_start
    "#
    .to_string()
}

// =============================================================================
// Word Frequency Queries
// =============================================================================

/// Build word frequencies query with optional date range filter
pub fn build_word_frequencies_query(start_date: Option<&str>, end_date: Option<&str>, limit: usize) -> String {
    match (start_date, end_date) {
        (Some(start), Some(end)) => format!(
            r#"
            SELECT word, SUM(count) as total
            FROM daily_word_counts
            WHERE date >= '{}' AND date <= '{}'
            GROUP BY word
            ORDER BY total DESC
            LIMIT {}
            "#,
            start, end, limit
        ),
        _ => format!(
            r#"
            SELECT word, SUM(count) as total
            FROM daily_word_counts
            GROUP BY word
            ORDER BY total DESC
            LIMIT {}
            "#,
            limit
        ),
    }
}

// =============================================================================
// Calendar Queries
// =============================================================================

/// Query daily message counts for GitHub-style contribution calendar
pub const SELECT_CALENDAR_DATA: &str = r#"
    SELECT
        CAST(date AS VARCHAR) as date,
        SUM(message_count) as count,
        SUM(CASE WHEN is_from_me THEN message_count ELSE 0 END) as sent,
        SUM(CASE WHEN NOT is_from_me THEN message_count ELSE 0 END) as received
    FROM daily_messages
    GROUP BY date
    ORDER BY date
"#;

// =============================================================================
// Day Detail Queries
// =============================================================================
//
// Each takes two bind parameters: the first and last ISO date of the period,
// both inclusive. A single day passes the same date twice. The heatmap buckets
// days in UTC (see `apple_timestamp_to_date`), so chunk timestamps are bucketed
// in UTC too, to land on the same day as the clicked cell.

/// Sent and received counts per contact for a period, busiest first.
/// The name comes from the chunk tables, which are the only ones that store it.
pub const SELECT_DAY_CONTACTS: &str = r#"
    WITH day AS (
        SELECT
            contact_id,
            SUM(CASE WHEN is_from_me THEN message_count ELSE 0 END) AS sent,
            SUM(CASE WHEN NOT is_from_me THEN message_count ELSE 0 END) AS received
        FROM daily_messages
        WHERE date BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        GROUP BY contact_id
    ),
    names AS (
        SELECT contact_id, ANY_VALUE(contact_name) AS contact_name
        FROM message_chunks
        WHERE contact_name IS NOT NULL
          AND contact_id IN (SELECT contact_id FROM day)
        GROUP BY contact_id
    )
    SELECT
        day.contact_id,
        COALESCE(names.contact_name, day.contact_id) AS name,
        day.sent,
        day.received
    FROM day
    LEFT JOIN names USING (contact_id)
    ORDER BY day.sent + day.received DESC, name
"#;

/// Topic clusters active in a period, by chunk count. Noise (-1) is left out.
pub const SELECT_DAY_TOPICS: &str = r#"
    SELECT cluster_id, ANY_VALUE(cluster_label) AS label, COUNT(*) AS chunks
    FROM chunk_projections
    WHERE cluster_id >= 0
      AND CAST(timezone('UTC', chunk_date) AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
    GROUP BY cluster_id
    ORDER BY chunks DESC, label
    LIMIT 6
"#;

/// Conversation snippets from a period, in time order.
pub const SELECT_DAY_SNIPPETS: &str = r#"
    SELECT
        COALESCE(contact_name, contact_id) AS name,
        message_preview,
        strftime(timezone('UTC', chunk_date), '%Y-%m-%dT%H:%M:%SZ') AS at
    FROM chunk_projections
    WHERE CAST(timezone('UTC', chunk_date) AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
    ORDER BY chunk_date
    LIMIT 8
"#;

// =============================================================================
// Statistics Queries
// =============================================================================

/// Query overall message statistics
pub const SELECT_STATS: &str = r#"
    SELECT
        COALESCE(SUM(message_count), 0),
        COUNT(DISTINCT date),
        CAST(MIN(date) AS VARCHAR),
        CAST(MAX(date) AS VARCHAR)
    FROM daily_messages
"#;

/// Query count of distinct topic clusters
pub const SELECT_TOPICS_COUNT: &str = r#"
    SELECT COUNT(DISTINCT cluster_id) FROM chunk_projections WHERE cluster_id >= 0
"#;

/// Check if visualization data exists
pub const SELECT_PROJECTIONS_COUNT: &str = "SELECT COUNT(*) FROM chunk_projections";

// =============================================================================
// Embedding Visualization Queries
// =============================================================================

/// Query 3D embedding points for visualization
pub const SELECT_EMBEDDING_POINTS_3D: &str = r#"
    SELECT
        x_3d, y_3d, z_3d,
        cluster_id, cluster_label, cluster_color,
        message_preview, contact_name, CAST(chunk_date AS VARCHAR) as chunk_date
    FROM chunk_projections
    ORDER BY cluster_id
"#;

/// Query 2D embedding points for visualization
pub const SELECT_EMBEDDING_POINTS_2D: &str = r#"
    SELECT
        x_2d, y_2d, 0.0,
        cluster_id, cluster_label, cluster_color,
        message_preview, contact_name, CAST(chunk_date AS VARCHAR) as chunk_date
    FROM chunk_projections
    ORDER BY cluster_id
"#;

/// Query 3D cluster info with center coordinates
pub const SELECT_CLUSTER_INFO_3D: &str = r#"
    SELECT
        cluster_id,
        cluster_label,
        cluster_color,
        COUNT(*) as point_count,
        AVG(x_3d) as center_x,
        AVG(y_3d) as center_y,
        AVG(z_3d) as center_z
    FROM chunk_projections
    WHERE cluster_id >= 0
    GROUP BY cluster_id, cluster_label, cluster_color
    ORDER BY point_count DESC
"#;

/// Query 2D cluster info with center coordinates
pub const SELECT_CLUSTER_INFO_2D: &str = r#"
    SELECT
        cluster_id,
        cluster_label,
        cluster_color,
        COUNT(*) as point_count,
        AVG(x_2d) as center_x,
        AVG(y_2d) as center_y,
        0.0 as center_z
    FROM chunk_projections
    WHERE cluster_id >= 0
    GROUP BY cluster_id, cluster_label, cluster_color
    ORDER BY point_count DESC
"#;

/// Query 3D noise/uncategorized cluster statistics
pub const SELECT_NOISE_CLUSTER_3D: &str = r#"
    SELECT
        COUNT(*) as point_count,
        AVG(x_3d) as center_x,
        AVG(y_3d) as center_y,
        AVG(z_3d) as center_z
    FROM chunk_projections
    WHERE cluster_id = -1
"#;

/// Query 2D noise/uncategorized cluster statistics
pub const SELECT_NOISE_CLUSTER_2D: &str = r#"
    SELECT
        COUNT(*) as point_count,
        AVG(x_2d) as center_x,
        AVG(y_2d) as center_y,
        0.0 as center_z
    FROM chunk_projections
    WHERE cluster_id = -1
"#;

// =============================================================================
// Sampled Embedding Queries (for performance with large datasets)
// =============================================================================
//
// DuckDB 2.0 rejects volatile functions such as RANDOM() inside a window
// ORDER BY. The `shuffled` CTE computes the random key as a column first.

/// Build sampled 3D embedding points query with per-cluster and uncategorized limits
pub fn build_sampled_embedding_points_3d(max_per_cluster: usize, max_uncategorized: usize) -> String {
    format!(
        r#"
        WITH shuffled AS (
            SELECT *, RANDOM() AS sort_key FROM chunk_projections
        ),
        ranked AS (
            SELECT
                x_3d, y_3d, z_3d,
                cluster_id, cluster_label, cluster_color,
                message_preview, contact_name, CAST(chunk_date AS VARCHAR) as chunk_date,
                ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY sort_key) as rn
            FROM shuffled
        )
        SELECT x_3d, y_3d, z_3d, cluster_id, cluster_label, cluster_color,
               message_preview, contact_name, chunk_date
        FROM ranked
        WHERE (cluster_id >= 0 AND rn <= {max_per_cluster})
           OR (cluster_id = -1 AND rn <= {max_uncategorized})
        ORDER BY cluster_id
        "#,
        max_per_cluster = max_per_cluster,
        max_uncategorized = max_uncategorized,
    )
}

/// Build sampled 2D embedding points query with per-cluster and uncategorized limits
pub fn build_sampled_embedding_points_2d(max_per_cluster: usize, max_uncategorized: usize) -> String {
    format!(
        r#"
        WITH shuffled AS (
            SELECT *, RANDOM() AS sort_key FROM chunk_projections
        ),
        ranked AS (
            SELECT
                x_2d, y_2d, 0.0 as z,
                cluster_id, cluster_label, cluster_color,
                message_preview, contact_name, CAST(chunk_date AS VARCHAR) as chunk_date,
                ROW_NUMBER() OVER (PARTITION BY cluster_id ORDER BY sort_key) as rn
            FROM shuffled
        )
        SELECT x_2d, y_2d, z, cluster_id, cluster_label, cluster_color,
               message_preview, contact_name, chunk_date
        FROM ranked
        WHERE (cluster_id >= 0 AND rn <= {max_per_cluster})
           OR (cluster_id = -1 AND rn <= {max_uncategorized})
        ORDER BY cluster_id
        "#,
        max_per_cluster = max_per_cluster,
        max_uncategorized = max_uncategorized,
    )
}

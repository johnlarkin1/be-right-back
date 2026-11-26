//! Insights commands for the analytics dashboard.
//!
//! Provides Tauri commands to fetch insights data for the Insights page:
//! - Timeline data (message counts over time, auto-aggregated)
//! - Word frequencies (filterable by date range)
//! - Contribution calendar (daily message counts)
//! - 3D/2D embedding visualization (UMAP coordinates + Leiden clusters)

use crate::queries;
use ingestion::tapbacks::{
    ReactedMessage, TapbackContact, TapbackEmoji, TapbackMonth, TapbackSummary, TapbackWindow,
};
use ingestion::{DuckDbConnection, MetadataDb, VectorDb};
use serde::{Deserialize, Serialize};
use tracing::info;

// =============================================================================
// Types - These match the TypeScript types in apps/desktop/src/types.ts
// =============================================================================

/// Timeline bucket size. Picked automatically from the date span unless the
/// caller requests one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
#[serde(rename_all = "snake_case")]
pub enum AggregationType {
    Daily,
    Weekly,
    Monthly,
}

/// Aggregated message count for one timeline bucket.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct AggregatedCount {
    /// ISO date string: "2024-01-15" (daily), "2024-W03" (weekly), "2024-01" (monthly)
    pub period: String,
    /// Human-readable: "Jan 15", "Week of Jan 15", "Jan 2024"
    pub display_period: String,
    /// Messages sent by user
    pub from_me: usize,
    /// Messages received
    pub from_them: usize,
    /// Total messages
    pub total: usize,
    pub aggregation_type: AggregationType,
}

/// Word frequency for word cloud
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct WordFrequency {
    pub word: String,
    pub count: usize,
    /// Normalized weight 0.0-1.0 for sizing
    pub weight: f64,
}

/// Single cell in GitHub-style contribution calendar
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct CalendarCell {
    /// ISO date "2024-01-15"
    pub date: String,
    /// 0 = Sunday, 6 = Saturday (row position)
    pub day_of_week: u8,
    /// Column index (0-52)
    pub week_index: usize,
    /// Total message count for this day
    pub count: usize,
    /// Messages sent by user
    pub sent: usize,
    /// Messages received from others
    pub received: usize,
    /// Normalized intensity 0.0-1.0
    pub intensity: f64,
}

// =============================================================================
// Granular Response Types - For split endpoints
// =============================================================================

/// Stats-only response (aggregation-independent)
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct InsightsStats {
    pub total_messages: usize,
    pub avg_response_time_mins: f64,
    pub active_days: usize,
    pub topics_count: usize,
    pub date_span_days: usize,
}

/// Timeline-only response (aggregation-dependent)
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TimelineResponse {
    pub timeline_data: Vec<AggregatedCount>,
    pub aggregation_type: AggregationType,
}

/// Calendar-only response (GitHub-style contributions)
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct CalendarResponse {
    pub calendar_data: Vec<CalendarCell>,
}

/// One contact's activity on a single day.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct DayContact {
    pub contact_id: String,
    pub name: String,
    pub sent: usize,
    pub received: usize,
}

/// One topic cluster active on a single day.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct DayTopic {
    pub cluster_id: i32,
    pub label: String,
    /// Conversation chunks in this topic on this day
    pub chunks: usize,
}

/// A conversation snippet from a single day.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct DaySnippet {
    pub name: String,
    pub preview: String,
    /// UTC instant, "2024-01-15T18:30:00Z"
    pub at: String,
}

/// Everything the day panel shows for one day, or for a timeline week or month.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct DayDetails {
    /// First ISO date of the period, "2024-01-15"
    pub date: String,
    /// Last ISO date of the period, inclusive. Equals `date` for a single day.
    pub end_date: String,
    pub sent: usize,
    pub received: usize,
    pub contacts: Vec<DayContact>,
    pub topics: Vec<DayTopic>,
    pub words: Vec<WordFrequency>,
    pub snippets: Vec<DaySnippet>,
}

/// Single point in 3D embedding visualization
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct EmbeddingPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub cluster: i32,
    pub cluster_label: String,
    pub color: String,
    /// First ~50 chars of message
    pub message_preview: String,
    pub contact_name: String,
    /// "Jan 15" format
    pub date: String,
}

/// Cluster metadata for legend/filters
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ClusterInfo {
    pub id: i32,
    pub label: String,
    pub color: String,
    pub count: usize,
    pub center_x: f64,
    pub center_y: f64,
    pub center_z: f64,
}

/// Complete embedding visualization data
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct EmbeddingVizData {
    pub points: Vec<EmbeddingPoint>,
    pub clusters: Vec<ClusterInfo>,
    /// Total points in the database (before sampling)
    pub total_points: usize,
    /// Whether the data was sampled
    pub sampled: bool,
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Open a read-only VectorDb connection via the ingestion crate abstraction
fn open_db() -> Result<VectorDb, String> {
    VectorDb::open_readonly().map_err(|e| format!("Failed to open database: {}", e))
}

/// Format a date for display
fn format_date_display(date_str: &str) -> String {
    // Parse YYYY-MM-DD and format as "Jan 15"
    if date_str.len() >= 10 {
        let month = match &date_str[5..7] {
            "01" => "Jan",
            "02" => "Feb",
            "03" => "Mar",
            "04" => "Apr",
            "05" => "May",
            "06" => "Jun",
            "07" => "Jul",
            "08" => "Aug",
            "09" => "Sep",
            "10" => "Oct",
            "11" => "Nov",
            "12" => "Dec",
            _ => "???",
        };
        let day = date_str[8..10].trim_start_matches('0');
        format!("{} {}", month, day)
    } else {
        date_str.to_string()
    }
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Get word frequencies filtered by date range
#[tauri::command]
pub async fn get_word_frequencies_for_range(
    start_date: String,
    end_date: String,
) -> Result<Vec<WordFrequency>, String> {
    info!(start_date = %start_date, end_date = %end_date, "Fetching word frequencies for range");

    let db = open_db()?;
    let conn = db.connection();
    query_word_frequencies(conn, Some(&start_date), Some(&end_date), 50)
}

/// Calculate sampling budget for embedding visualization.
/// Returns (max_per_cluster, max_uncategorized, should_sample).
/// If `target` is 0, sampling is disabled (show all points).
///
/// NOTE: Total sampled points may exceed `target` when there are many clusters,
/// since each cluster gets at least MIN_PER_CLUSTER points. For example, with
/// target=4000 and 60 clusters, we might show 60×50 = 3000 cluster points
/// + 800 uncategorized = 3800 (within budget). But with MAX_PER_CLUSTER or
///   uneven clusters the sum can exceed `target`. This is intentional — the
///   budget is a soft guideline, not a hard cap.
fn calculate_sampling_budget(total_points: usize, cluster_count: usize, target: usize) -> (usize, usize, bool) {
    const MIN_PER_CLUSTER: usize = 50;
    const MAX_PER_CLUSTER: usize = 500;

    // target=0 means show all
    if target == 0 || total_points <= target {
        return (total_points, total_points, false);
    }

    // No clusters: return all budget to uncategorized
    if cluster_count == 0 {
        return (0, target, true);
    }

    // 80% budget to real clusters, 20% to uncategorized
    let cluster_budget = (target * 80) / 100;
    let uncategorized_budget = target - cluster_budget;

    let per_cluster = (cluster_budget / cluster_count).clamp(MIN_PER_CLUSTER, MAX_PER_CLUSTER);

    (per_cluster, uncategorized_budget, true)
}

/// Get pre-computed embedding visualization data
#[tauri::command]
pub async fn get_embeddings_for_viz(
    use_3d: Option<bool>,
    max_points: Option<usize>,
) -> Result<EmbeddingVizData, String> {
    let use_3d = use_3d.unwrap_or(true);
    info!(use_3d, max_points = ?max_points, "Fetching embedding visualization data");

    let db = open_db()?;
    let conn = db.connection();

    // Check if chunk_projections has data
    let total_points: i64 = conn
        .query_row(queries::SELECT_PROJECTIONS_COUNT, [], |row| row.get(0))
        .unwrap_or(0);

    if total_points == 0 {
        return Err("No visualization data - run analytics pipeline first".to_string());
    }

    let total_points = total_points as usize;

    // Query cluster info first (needed for sampling budget)
    let clusters = query_cluster_info(conn, use_3d)?;
    let real_cluster_count = clusters.iter().filter(|c| c.id >= 0).count();

    // Calculate sampling budget (default 4000, 0 = show all)
    let target = max_points.unwrap_or(4000);
    let (max_per_cluster, max_uncategorized, should_sample) =
        calculate_sampling_budget(total_points, real_cluster_count, target);

    // Query points (sampled or full)
    let points = if should_sample {
        query_sampled_embedding_points(conn, use_3d, max_per_cluster, max_uncategorized)?
    } else {
        query_embedding_points(conn, use_3d)?
    };

    info!(
        total_points,
        displayed_points = points.len(),
        clusters = clusters.len(),
        sampled = should_sample,
        "Embedding data fetched"
    );

    Ok(EmbeddingVizData {
        points,
        clusters,
        total_points,
        sampled: should_sample,
    })
}

// =============================================================================
// Granular Tauri Commands - Split endpoints for independent loading
// =============================================================================

/// Get stats only (aggregation-independent, fetch once)
#[tauri::command]
pub async fn get_insights_stats() -> Result<InsightsStats, String> {
    info!("Fetching insights stats");

    let db = open_db()?;
    let conn = db.connection();

    // Query basic stats
    let (total_messages, active_days, date_span_days) = query_stats(conn)?;

    // Query topic count
    let topics_count = query_topics_count(conn)?;

    // Query average response time from SQLite
    let avg_response_time_mins = query_avg_response_time()?;

    info!(
        total_messages,
        active_days, topics_count, avg_response_time_mins, "Stats fetched"
    );

    Ok(InsightsStats {
        total_messages,
        avg_response_time_mins,
        active_days,
        topics_count,
        date_span_days,
    })
}

/// Get timeline data only (aggregation-dependent)
#[tauri::command]
pub async fn get_insights_timeline(aggregation_type: Option<AggregationType>) -> Result<TimelineResponse, String> {
    info!(
        aggregation_type = ?aggregation_type,
        "Fetching timeline data"
    );

    let db = open_db()?;
    let conn = db.connection();

    let timeline_data = query_timeline_data(conn, aggregation_type)?;
    let aggregation_type = timeline_data
        .first()
        .map_or(AggregationType::Daily, |c| c.aggregation_type);

    info!(count = timeline_data.len(), ?aggregation_type, "Timeline data fetched");

    Ok(TimelineResponse {
        timeline_data,
        aggregation_type,
    })
}

/// Get calendar data only (GitHub-style contributions, fetch once)
#[tauri::command]
pub async fn get_insights_calendar() -> Result<CalendarResponse, String> {
    info!("Fetching calendar data");

    let db = open_db()?;
    let conn = db.connection();
    let calendar_data = query_calendar_data(conn)?;

    info!(days = calendar_data.len(), "Calendar data fetched");

    Ok(CalendarResponse { calendar_data })
}

/// Get the details of one day, or of a period up to `end_date`, for the side panel
#[tauri::command]
pub async fn get_day_details(date: String, end_date: Option<String>) -> Result<DayDetails, String> {
    let end_date = end_date.unwrap_or_else(|| date.clone());
    info!(%date, %end_date, "Fetching day details");

    let db = open_db()?;
    let details = query_day_details(db.connection(), &date, &end_date)?;

    info!(
        contacts = details.contacts.len(),
        topics = details.topics.len(),
        "Day details fetched"
    );

    Ok(details)
}

// =============================================================================
// Tapbacks (brb.db)
// =============================================================================

/// Tapback totals and kind mix. With `contact_id`, only Tapbacks between you and that person.
#[tauri::command]
pub async fn get_tapback_summary(
    window: TapbackWindow,
    contact_id: Option<String>,
) -> Result<TapbackSummary, String> {
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;
    db.tapback_summary(contact_id.as_deref(), window)
        .map_err(|e| format!("Failed to read tapbacks: {}", e))
}

/// People ranked by Tapbacks exchanged with you.
#[tauri::command]
pub async fn get_tapback_contacts(window: TapbackWindow, limit: usize) -> Result<Vec<TapbackContact>, String> {
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;
    db.tapback_contacts(window, limit)
        .map_err(|e| format!("Failed to read tapbacks: {}", e))
}

/// Given and received Tapbacks per month and kind.
#[tauri::command]
pub async fn get_tapback_monthly(window: TapbackWindow) -> Result<Vec<TapbackMonth>, String> {
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;
    db.tapback_monthly(window)
        .map_err(|e| format!("Failed to read tapbacks: {}", e))
}

/// Your messages with the most Tapbacks from others, with their text.
#[tauri::command]
pub async fn get_most_reacted_messages(window: TapbackWindow, limit: usize) -> Result<Vec<ReactedMessage>, String> {
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;
    db.tapback_most_reacted(window, limit)
        .map_err(|e| format!("Failed to read tapbacks: {}", e))
}

/// Emoji Tapbacks, most used first.
#[tauri::command]
pub async fn get_tapback_emojis(window: TapbackWindow, limit: usize) -> Result<Vec<TapbackEmoji>, String> {
    let db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;
    db.tapback_emojis(window, limit)
        .map_err(|e| format!("Failed to read tapbacks: {}", e))
}

/// Get all word frequencies (no date filter, fetch once)
#[tauri::command]
pub async fn get_word_frequencies() -> Result<Vec<WordFrequency>, String> {
    info!("Fetching all word frequencies");

    let db = open_db()?;
    let conn = db.connection();
    let frequencies = query_word_frequencies(conn, None, None, 50)?;

    info!(words = frequencies.len(), "Word frequencies fetched");

    Ok(frequencies)
}

// =============================================================================
// Query Functions
// =============================================================================

fn query_timeline_data(
    conn: &DuckDbConnection,
    requested_aggregation: Option<AggregationType>,
) -> Result<Vec<AggregatedCount>, String> {
    // Get date range from daily_activity to determine aggregation level
    // Note: daily_messages is not populated yet, so we use daily_activity
    let date_range: Result<(String, String), _> = conn.query_row(queries::SELECT_DATE_RANGE, [], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });

    let (min_date, max_date) = match date_range {
        Ok((min, max)) => (min, max),
        Err(_) => return Ok(vec![]), // No data
    };

    // Calculate date span for fallback auto-aggregation
    let span_days = calculate_date_span(&min_date, &max_date);

    // Use requested aggregation type or fall back to auto-calculation
    let aggregation_type = requested_aggregation.unwrap_or(if span_days <= 365 {
        AggregationType::Daily
    } else if span_days <= 1825 {
        AggregationType::Weekly
    } else {
        AggregationType::Monthly
    });

    let mut timeline = Vec::new();

    if aggregation_type == AggregationType::Daily {
        // Query from daily_activity
        // Note: sent_count/received_count may be inaccurate (chunk-level, not message-level)
        let mut stmt = conn
            .prepare(queries::SELECT_DAILY_TIMELINE)
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let date: String = row.get(0)?;
                let from_me: i64 = row.get(1)?;
                let from_them: i64 = row.get(2)?;
                let total: i64 = row.get(3)?;
                Ok((date, from_me as usize, from_them as usize, total as usize))
            })
            .map_err(|e| format!("Query error: {}", e))?;

        for row in rows {
            let (date, from_me, from_them, total) = row.map_err(|e| format!("Row error: {}", e))?;
            timeline.push(AggregatedCount {
                display_period: format_date_display(&date),
                period: date,
                from_me,
                from_them,
                total,
                aggregation_type: AggregationType::Daily,
            });
        }
    } else {
        // Weekly or monthly aggregation from daily_messages
        let query = if aggregation_type == AggregationType::Weekly {
            queries::build_weekly_timeline_query()
        } else {
            queries::build_monthly_timeline_query()
        };

        let mut stmt = conn.prepare(&query).map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let date: String = row.get(0)?;
                let from_me: i64 = row.get(1)?;
                let from_them: i64 = row.get(2)?;
                let total: i64 = row.get(3)?;
                Ok((date, from_me as usize, from_them as usize, total as usize))
            })
            .map_err(|e| format!("Query error: {}", e))?;

        for row in rows {
            let (date, from_me, from_them, total) = row.map_err(|e| format!("Row error: {}", e))?;
            let display = if aggregation_type == AggregationType::Weekly {
                format!("Week of {}", format_date_display(&date))
            } else {
                // Format as "Jan 2024"
                if date.len() >= 7 {
                    let month = match &date[5..7] {
                        "01" => "Jan",
                        "02" => "Feb",
                        "03" => "Mar",
                        "04" => "Apr",
                        "05" => "May",
                        "06" => "Jun",
                        "07" => "Jul",
                        "08" => "Aug",
                        "09" => "Sep",
                        "10" => "Oct",
                        "11" => "Nov",
                        "12" => "Dec",
                        _ => "???",
                    };
                    format!("{} {}", month, &date[0..4])
                } else {
                    date.clone()
                }
            };
            timeline.push(AggregatedCount {
                display_period: display,
                period: date,
                from_me,
                from_them,
                total,
                aggregation_type,
            });
        }
    }

    Ok(timeline)
}

fn query_word_frequencies(
    conn: &DuckDbConnection,
    start_date: Option<&str>,
    end_date: Option<&str>,
    limit: usize,
) -> Result<Vec<WordFrequency>, String> {
    let query = queries::build_word_frequencies_query(start_date, end_date, limit);

    let mut stmt = conn.prepare(&query).map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let word: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((word, count as usize))
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut words: Vec<(String, usize)> = Vec::new();
    for row in rows {
        let (word, count) = row.map_err(|e| format!("Row error: {}", e))?;
        words.push((word, count));
    }

    // Normalize weights
    let max_count = words.iter().map(|(_, c)| *c).max().unwrap_or(1) as f64;
    let frequencies: Vec<WordFrequency> = words
        .into_iter()
        .map(|(word, count)| WordFrequency {
            word,
            count,
            weight: count as f64 / max_count,
        })
        .collect();

    Ok(frequencies)
}

fn query_day_details(conn: &DuckDbConnection, date: &str, end_date: &str) -> Result<DayDetails, String> {
    // The word query interpolates the dates, so only real dates get through.
    for d in [date, end_date] {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| format!("Invalid date: {}", d))?;
    }

    let mut stmt = conn
        .prepare(queries::SELECT_DAY_CONTACTS)
        .map_err(|e| format!("Query error: {}", e))?;
    let contacts = stmt
        .query_map([date, end_date], |row| {
            Ok(DayContact {
                contact_id: row.get(0)?,
                name: row.get(1)?,
                sent: row.get::<_, i64>(2)? as usize,
                received: row.get::<_, i64>(3)? as usize,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Row error: {}", e))?;

    let mut stmt = conn
        .prepare(queries::SELECT_DAY_TOPICS)
        .map_err(|e| format!("Query error: {}", e))?;
    let topics = stmt
        .query_map([date, end_date], |row| {
            Ok(DayTopic {
                cluster_id: row.get(0)?,
                label: row.get(1)?,
                chunks: row.get::<_, i64>(2)? as usize,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Row error: {}", e))?;

    let mut stmt = conn
        .prepare(queries::SELECT_DAY_SNIPPETS)
        .map_err(|e| format!("Query error: {}", e))?;
    let snippets = stmt
        .query_map([date, end_date], |row| {
            Ok(DaySnippet {
                name: row.get(0)?,
                preview: row.get(1)?,
                at: row.get(2)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Row error: {}", e))?;

    let words = query_word_frequencies(conn, Some(date), Some(end_date), 8)?;

    Ok(DayDetails {
        date: date.to_string(),
        end_date: end_date.to_string(),
        sent: contacts.iter().map(|c| c.sent).sum(),
        received: contacts.iter().map(|c| c.received).sum(),
        contacts,
        topics,
        words,
        snippets,
    })
}

fn query_calendar_data(conn: &DuckDbConnection) -> Result<Vec<CalendarCell>, String> {
    use chrono::Datelike;

    // Query ALL available activity data from daily_messages (no date filter)
    // Year filtering will happen on the frontend for performance
    let mut stmt = conn
        .prepare(queries::SELECT_CALENDAR_DATA)
        .map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let date: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            let sent: i64 = row.get(2)?;
            let received: i64 = row.get(3)?;
            Ok((date, count as usize, sent as usize, received as usize))
        })
        .map_err(|e| format!("Query error: {}", e))?;

    // Collect all dates and counts
    let mut date_counts: Vec<(String, usize, usize, usize)> = Vec::new();
    for row in rows {
        let data = row.map_err(|e| format!("Row error: {}", e))?;
        date_counts.push(data);
    }

    if date_counts.is_empty() {
        return Ok(vec![]);
    }

    // Find max for normalization across all data
    let max_count = date_counts.iter().map(|(_, c, _, _)| *c).max().unwrap_or(1) as f64;

    // Build calendar cells from actual data
    // weekIndex is computed per-year on the frontend, so we set it to 0 here
    let mut calendar: Vec<CalendarCell> = Vec::new();

    for (date_str, count, sent, received) in date_counts {
        // Parse date to get day of week
        if let Ok(date) = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
            let dow = date.weekday().num_days_from_sunday() as u8;

            calendar.push(CalendarCell {
                date: date_str,
                day_of_week: dow,
                week_index: 0, // Frontend will recompute this per selected year
                count,
                sent,
                received,
                intensity: if max_count > 0.0 { count as f64 / max_count } else { 0.0 },
            });
        }
    }

    Ok(calendar)
}

fn query_stats(conn: &DuckDbConnection) -> Result<(usize, usize, usize), String> {
    // Query from daily_messages for accurate stats
    let result: Result<(i64, i64, String, String), _> = conn.query_row(queries::SELECT_STATS, [], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    });

    match result {
        Ok((total, active_days, min_date, max_date)) => {
            let span = calculate_date_span(&min_date, &max_date);
            Ok((total as usize, active_days as usize, span))
        }
        Err(_) => Ok((0, 0, 0)),
    }
}

fn query_topics_count(conn: &DuckDbConnection) -> Result<usize, String> {
    match conn.query_row(queries::SELECT_TOPICS_COUNT, [], |row| row.get::<_, i64>(0)) {
        Ok(count) => Ok(count as usize),
        Err(e) => {
            tracing::warn!(error = %e, "Failed to query topics count");
            Ok(0)
        }
    }
}

fn query_avg_response_time() -> Result<f64, String> {
    // Response time data is in SQLite contact_stats, not DuckDB
    let metadata_db = MetadataDb::open().map_err(|e| format!("Failed to open metadata db: {}", e))?;

    let stats = metadata_db
        .get_all_contact_stats()
        .map_err(|e| format!("Failed to get contact stats: {}", e))?;

    // Compute weighted average response time based on message count
    let mut total_weighted_time = 0.0;
    let mut total_messages = 0i64;

    for stat in stats {
        if let Some(response_time_secs) = stat.avg_response_time_secs {
            total_weighted_time += response_time_secs * stat.message_count as f64;
            total_messages += stat.message_count;
        }
    }

    if total_messages == 0 {
        return Ok(0.0);
    }

    // Convert seconds to minutes
    let avg_secs = total_weighted_time / total_messages as f64;
    Ok(avg_secs / 60.0)
}

/// Shared helper: execute a query and collect rows into EmbeddingPoints.
/// Both `query_embedding_points` and `query_sampled_embedding_points` use
/// the same row→EmbeddingPoint mapping, so this avoids duplicating the closure.
fn collect_embedding_points(conn: &DuckDbConnection, query: &str) -> Result<Vec<EmbeddingPoint>, String> {
    let mut stmt = conn.prepare(query).map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let x: f64 = row.get(0)?;
            let y: f64 = row.get(1)?;
            let z: f64 = row.get(2)?;
            let cluster: i32 = row.get(3)?;
            let cluster_label: String = row.get(4)?;
            let color: String = row.get(5)?;
            let message_preview: String = row.get(6)?;
            let contact_name: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
            let chunk_date: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();

            Ok(EmbeddingPoint {
                x,
                y,
                z,
                cluster,
                cluster_label,
                color,
                message_preview,
                contact_name,
                date: format_date_display(&chunk_date),
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut points = Vec::new();
    for row in rows {
        points.push(row.map_err(|e| format!("Row error: {}", e))?);
    }

    Ok(points)
}

fn query_embedding_points(conn: &DuckDbConnection, use_3d: bool) -> Result<Vec<EmbeddingPoint>, String> {
    let query = if use_3d {
        queries::SELECT_EMBEDDING_POINTS_3D
    } else {
        queries::SELECT_EMBEDDING_POINTS_2D
    };
    collect_embedding_points(conn, query)
}

fn query_sampled_embedding_points(
    conn: &DuckDbConnection,
    use_3d: bool,
    max_per_cluster: usize,
    max_uncategorized: usize,
) -> Result<Vec<EmbeddingPoint>, String> {
    let query = if use_3d {
        queries::build_sampled_embedding_points_3d(max_per_cluster, max_uncategorized)
    } else {
        queries::build_sampled_embedding_points_2d(max_per_cluster, max_uncategorized)
    };
    collect_embedding_points(conn, &query)
}

fn query_cluster_info(conn: &DuckDbConnection, use_3d: bool) -> Result<Vec<ClusterInfo>, String> {
    // Query for real clusters (cluster_id >= 0)
    let query = if use_3d {
        queries::SELECT_CLUSTER_INFO_3D
    } else {
        queries::SELECT_CLUSTER_INFO_2D
    };

    let mut stmt = conn.prepare(query).map_err(|e| format!("Query error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ClusterInfo {
                id: row.get(0)?,
                label: row.get(1)?,
                color: row.get(2)?,
                count: row.get::<_, i64>(3)? as usize,
                center_x: row.get(4)?,
                center_y: row.get(5)?,
                center_z: row.get(6)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut clusters = Vec::new();
    for row in rows {
        clusters.push(row.map_err(|e| format!("Row error: {}", e))?);
    }

    // Also query for uncategorized points (cluster_id = -1)
    let noise_query = if use_3d {
        queries::SELECT_NOISE_CLUSTER_3D
    } else {
        queries::SELECT_NOISE_CLUSTER_2D
    };

    // Add uncategorized cluster if it has any points
    if let Ok(noise_result) = conn.query_row(noise_query, [], |row| {
        Ok((
            row.get::<_, i64>(0)? as usize,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, f64>(3)?,
        ))
    }) {
        let (count, center_x, center_y, center_z) = noise_result;
        if count > 0 {
            clusters.push(ClusterInfo {
                id: -1,
                label: "Uncategorized".to_string(),
                color: "#4a4a4a".to_string(), // NOISE_COLOR
                count,
                center_x,
                center_y,
                center_z,
            });
        }
    }

    Ok(clusters)
}

fn calculate_date_span(min_date: &str, max_date: &str) -> usize {
    // Simple calculation: parse YYYY-MM-DD and compute difference
    // Returns 0 on parse error
    use chrono::NaiveDate;

    let min = NaiveDate::parse_from_str(min_date, "%Y-%m-%d").ok();
    let max = NaiveDate::parse_from_str(max_date, "%Y-%m-%d").ok();

    match (min, max) {
        (Some(min), Some(max)) => (max - min).num_days().max(0) as usize,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds the tables the day panel reads, with rows on two UTC days.
    fn day_details_fixture() -> DuckDbConnection {
        let conn = DuckDbConnection::open_in_memory().expect("in-memory duckdb");
        conn.execute_batch(
            "SET TimeZone='America/New_York';
             CREATE TABLE daily_messages (date DATE, contact_id VARCHAR, is_from_me BOOLEAN, message_count INTEGER);
             CREATE TABLE message_chunks (contact_id VARCHAR, contact_name VARCHAR);
             CREATE TABLE chunk_projections (
                 cluster_id INTEGER, cluster_label VARCHAR, contact_id VARCHAR,
                 contact_name VARCHAR, message_preview VARCHAR, chunk_date TIMESTAMPTZ);
             CREATE TABLE daily_word_counts (date DATE, word VARCHAR, count INTEGER);
             INSERT INTO daily_messages VALUES
                 ('2024-06-02', '+1555', true, 4), ('2024-06-02', '+1555', false, 6),
                 ('2024-06-02', '+1666', true, 1), ('2024-06-03', '+1555', true, 9);
             INSERT INTO message_chunks VALUES ('+1555', 'Alice'), ('+1666', NULL);
             INSERT INTO chunk_projections VALUES
                 (0, 'Dinner plans', '+1555', 'Alice', 'pizza tonight?', TIMESTAMPTZ '2024-06-02 00:30:00+00'),
                 (0, 'Dinner plans', '+1555', 'Alice', 'sounds good',    TIMESTAMPTZ '2024-06-02 15:00:00+00'),
                 (-1, 'Noise',       '+1555', 'Alice', 'ok',             TIMESTAMPTZ '2024-06-02 16:00:00+00'),
                 (1, 'Work',         '+1666', NULL,    'standup at 9',   TIMESTAMPTZ '2024-06-03 12:00:00+00');
             INSERT INTO daily_word_counts VALUES ('2024-06-02', 'pizza', 3), ('2024-06-03', 'standup', 2);",
        )
        .expect("schema + fixtures");
        conn
    }

    #[test]
    fn test_day_details_counts_contacts_topics_and_words() {
        let conn = day_details_fixture();
        let day = query_day_details(&conn, "2024-06-02", "2024-06-02").expect("day details");

        assert_eq!((day.sent, day.received), (5, 6));
        let contacts: Vec<_> = day
            .contacts
            .iter()
            .map(|c| (c.name.as_str(), c.sent, c.received))
            .collect();
        // Busiest first; a contact with no stored name falls back to its id.
        assert_eq!(contacts, vec![("Alice", 4, 6), ("+1666", 1, 0)]);

        let topics: Vec<_> = day.topics.iter().map(|t| (t.label.as_str(), t.chunks)).collect();
        assert_eq!(topics, vec![("Dinner plans", 2)]);

        assert_eq!(day.words.len(), 1);
        assert_eq!(day.words[0].word, "pizza");
    }

    #[test]
    fn test_day_details_buckets_snippets_by_utc_day() {
        let conn = day_details_fixture();
        let day = query_day_details(&conn, "2024-06-02", "2024-06-02").expect("day details");

        // 00:30 UTC is still June 1 in New York, but the heatmap buckets by UTC.
        let snippets: Vec<_> = day
            .snippets
            .iter()
            .map(|s| (s.preview.as_str(), s.at.as_str()))
            .collect();
        assert_eq!(
            snippets,
            vec![
                ("pizza tonight?", "2024-06-02T00:30:00Z"),
                ("sounds good", "2024-06-02T15:00:00Z"),
                ("ok", "2024-06-02T16:00:00Z"),
            ]
        );
    }

    #[test]
    fn test_day_details_sums_a_multi_day_period() {
        let conn = day_details_fixture();
        let week = query_day_details(&conn, "2024-06-02", "2024-06-08").expect("period details");

        assert_eq!((week.sent, week.received), (14, 6));
        assert_eq!(week.contacts[0].name, "Alice");
        assert_eq!(week.contacts[0].sent, 13);
        let topics: Vec<_> = week.topics.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(topics, vec!["Dinner plans", "Work"]);
        assert_eq!(week.snippets.len(), 4);
        assert_eq!(week.words.len(), 2);
    }

    #[test]
    fn test_day_details_rejects_a_non_date() {
        let conn = day_details_fixture();
        assert!(query_day_details(&conn, "2024-06-02' OR 1=1 --", "2024-06-02").is_err());
    }

    #[test]
    fn test_sampling_disabled_when_target_zero() {
        let (per, uncat, sample) = calculate_sampling_budget(50000, 20, 0);
        assert!(!sample);
        assert_eq!(per, 50000);
        assert_eq!(uncat, 50000);
    }

    #[test]
    fn test_no_sampling_when_under_target() {
        let (per, uncat, sample) = calculate_sampling_budget(3000, 10, 4000);
        assert!(!sample);
        assert_eq!(per, 3000);
        assert_eq!(uncat, 3000);
    }

    #[test]
    fn test_sampling_budget_typical() {
        let (per, uncat, sample) = calculate_sampling_budget(50000, 20, 4000);
        assert!(sample);
        // 80% of 4000 = 3200, /20 clusters = 160 per cluster
        assert_eq!(per, 160);
        // 20% of 4000 = 800
        assert_eq!(uncat, 800);
    }

    #[test]
    fn test_sampling_clamps_min() {
        // Many clusters: budget per cluster would be tiny, should clamp to MIN_PER_CLUSTER=50
        let (per, _uncat, sample) = calculate_sampling_budget(50000, 200, 4000);
        assert!(sample);
        assert_eq!(per, 50); // MIN_PER_CLUSTER
    }

    #[test]
    fn test_sampling_clamps_max() {
        // Few clusters: budget per cluster would be huge, should clamp to MAX_PER_CLUSTER=500
        let (per, _uncat, sample) = calculate_sampling_budget(50000, 1, 4000);
        assert!(sample);
        assert_eq!(per, 500); // MAX_PER_CLUSTER
    }

    #[test]
    fn test_zero_clusters_returns_all_to_uncategorized() {
        let (per, uncat, sample) = calculate_sampling_budget(50000, 0, 4000);
        assert!(sample);
        assert_eq!(per, 0);
        assert_eq!(uncat, 4000);
    }
}

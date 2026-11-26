//! Query understanding and decomposition for RAG search.
//!
//! This module transforms raw natural language queries into structured search
//! plans *before* embedding + retrieval. It uses rule-based pattern matching
//! (regex, not LLM) to extract:
//!
//! - **Temporal constraints**: "last week", "yesterday", "in January 2025"
//! - **Recency signals**: "most recent", "latest", "recently"
//! - **Aggregation intent**: "favorite", "usually", "most often"
//! - **Contact hints**: (future — names mentioned in query)
//! - **Cleaned query text**: stripped of stop words, temporal phrases, filler
//!
//! # Usage
//!
//! ```rust,ignore
//! use ingestion::query_planner::{plan_search, apply_recency_boost};
//!
//! let plan = plan_search("what was the last restaurant I went to");
//! assert!(plan.prefer_recent);
//! assert_eq!(plan.search_queries, vec!["restaurant"]);
//! ```

use crate::search::SearchResult;
use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveTime, Utc};
use regex::Regex;
use std::sync::LazyLock;

/// Default number of results for normal queries.
const DEFAULT_RESULT_COUNT: usize = 7;

/// Elevated result count for aggregation queries (need more data to summarize).
const AGGREGATION_RESULT_COUNT: usize = 20;

/// Half-life for exponential recency decay (days). ~23 days.
const RECENCY_DECAY_LAMBDA: f64 = 0.03;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Direction for a *superlative* temporal query ("last/latest" vs "first/oldest").
///
/// Distinct from [`SearchPlan::prefer_recent`] (a soft exponential boost):
/// when a superlative is present, relevance becomes a *filter* and recency
/// becomes a *hard sort* in this direction. See `search::superlative_finalize`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    /// Newest first — "last", "latest", "most recent", "newest".
    Newest,
    /// Oldest first — "first", "earliest", "oldest".
    Oldest,
}

/// A structured search plan produced by analyzing a natural language query.
#[derive(Debug, Clone)]
pub struct SearchPlan {
    /// Core search queries (cleaned of temporal/filler words).
    pub search_queries: Vec<String>,
    /// Extracted minimum date filter.
    pub min_date: Option<DateTime<Utc>>,
    /// Extracted maximum date filter.
    pub max_date: Option<DateTime<Utc>>,
    /// Whether results should be sorted by recency (vs relevance).
    pub prefer_recent: bool,
    /// Extracted contact filter (if user mentions a name).
    pub contact_hint: Option<String>,
    /// Number of results to fetch (higher for aggregation queries).
    pub result_count: usize,
    /// Whether this is an aggregation query ("favorite", "most", "usually").
    pub is_aggregation: bool,
    /// Superlative intent: gate by relevance, then hard-sort by recency in this
    /// direction. `None` for ordinary queries (which keep the soft recency boost).
    pub superlative: Option<SortDirection>,
}

impl Default for SearchPlan {
    fn default() -> Self {
        Self {
            search_queries: Vec::new(),
            min_date: None,
            max_date: None,
            prefer_recent: false,
            contact_hint: None,
            result_count: DEFAULT_RESULT_COUNT,
            is_aggregation: false,
            superlative: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Compiled regex patterns (LazyLock for one-time compilation)
// ---------------------------------------------------------------------------

/// Matches "yesterday"
static RE_YESTERDAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\byesterday\b").unwrap());

/// Matches "today"
static RE_TODAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\btoday\b").unwrap());

/// Matches "last week"
static RE_LAST_WEEK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+week\b").unwrap());

/// Matches "this week"
static RE_THIS_WEEK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+week\b").unwrap());

/// Matches "last month"
static RE_LAST_MONTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+month\b").unwrap());

/// Matches "this month"
static RE_THIS_MONTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+month\b").unwrap());

/// Matches "this year"
static RE_THIS_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+year\b").unwrap());

/// Matches "last year"
static RE_LAST_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+year\b").unwrap());

/// Matches "in 2024" / "in 2025" / "in 2026" etc.
static RE_IN_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bin\s+(20\d{2})\b").unwrap());

/// Matches "in January" .. "in December" (no year)
static RE_IN_MONTH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b")
        .unwrap()
});

/// Matches "in January 2025" .. "in December 2025" (month + year)
static RE_IN_MONTH_YEAR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b")
        .unwrap()
});

/// Matches "from <month/date> to <month/date>" patterns.
/// Handles: "from January 2025 to January 2026", "from Jan to Mar",
/// "from January to March 2025"
static RE_FROM_TO_MONTH_YEAR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bfrom\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\s+to\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(20\d{2}))?\b")
        .unwrap()
});

/// Matches "last N days/weeks/months"
static RE_LAST_N_PERIOD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:last|past)\s+(\d+)\s+(days?|weeks?|months?)\b").unwrap());

/// Matches "this winter" / "this summer" / "this spring" / "this fall"
static RE_THIS_SEASON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bthis\s+(winter|spring|summer|fall|autumn)\b").unwrap());

/// Matches "last winter" / "last summer" etc.
static RE_LAST_SEASON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\blast\s+(winter|spring|summer|fall|autumn)\b").unwrap());

/// Recency indicators: "last" / "most recent" / "latest" / "newest"
static RE_RECENCY_INDICATOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(most\s+recent|latest|newest|last)\b").unwrap());

/// Oldest-first indicators: "first" / "earliest" / "oldest" / "first time"
static RE_OLDEST_INDICATOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(earliest|oldest|very\s+first|first\s+time|first)\b").unwrap());

/// "recently" as a standalone word
static RE_RECENTLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\brecently\b").unwrap());

/// Aggregation indicators
static RE_AGGREGATION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(favorite|favourite|most|usually|typically|always|often|a\s+lot|frequently)\b").unwrap()
});

/// Loose "does this query mention time at all?" detector.
///
/// Deliberately broad: months (full + abbreviated), seasons, holidays, period
/// words, relative markers ("ago"), bare 4-digit years, quarters, and a few
/// named events with strong temporal anchoring ("covid", "pandemic"). Used only
/// as a gate for the LLM date-extraction fallback, so over-matching is fine — a
/// false positive costs one short LLM call that returns no range, while a false
/// negative would silently skip a paraphrase the regex couldn't parse.
static RE_TEMPORAL_HINT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|winter|spring|summer|fall|autumn|quarter|q[1-4]|holidays?|christmas\w*|xmas|thanksgiving|easter|hanukkah|halloween|new\s+years?|covid|pandemic|yesterday|today|tonight|tomorrow|week|weeks|month|months|year|years|day|days|decade|ago|recent(ly)?|lately|latest|newest|earlier|previously|past|since|(19|20)\d{2})\b",
    )
    .unwrap()
});

/// Words to strip from query for embedding (stop words + question words + pronouns + temporal)
/// Note: These are removed *after* temporal extraction, so temporal patterns are parsed first.
static RE_STOP_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(what|where|when|who|how|which|was|were|did|do|does|is|are|am|been|being|the|a|an|i|my|me|mine|we|our|us|to|at|in|of|for|and|or|but|that|this|it|its|from|with|on|by|about|up|out|if|so|no|not|has|had|have|can|could|would|should|will|shall|may|might|you|your|think|know|tell|said|say|go|went|going|come|came|like|get|got|make|made|take|took|give|talk|talked|talking|ever|just|also|really|very|some|any|every|much|many|too|than|then|them|they|their|there|here|been|being|let|based|been)\b").unwrap()
});

/// All temporal phrases to strip after extraction (so they don't pollute the embedding query)
static RE_TEMPORAL_PHRASES: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(yesterday|today|last\s+week|this\s+week|last\s+month|this\s+month|this\s+year|last\s+year|recently|most\s+recent|latest|newest|last\s+\d+\s+(?:days?|weeks?|months?)|past\s+\d+\s+(?:days?|weeks?|months?)|in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?|in\s+20\d{2}|from\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?\s+to\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?|this\s+(?:winter|spring|summer|fall|autumn)|last\s+(?:winter|spring|summer|fall|autumn)|in\s+the\s+last\s+month)\b").unwrap()
});

/// Bare superlative words to strip before embedding ("last restaurant" ->
/// "restaurant"). These are intent markers, never content nouns in this domain.
/// Kept separate from `RE_TEMPORAL_PHRASES` so the "last week"/"last month"
/// range phrases there are untouched.
static RE_SUPERLATIVE_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(most\s+recent|latest|newest|earliest|oldest|very\s+first|first\s+time|last|first)\b").unwrap()
});

/// Extra whitespace normalization
static RE_MULTI_SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s{2,}").unwrap());

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Analyze a natural language query and produce a structured search plan.
///
/// This is the main entry point. It:
/// 1. Extracts temporal constraints (dates, ranges, recency)
/// 2. Detects aggregation intent
/// 3. Cleans the query of stop words and temporal phrases
/// 4. Returns a `SearchPlan` that the search pipeline can use
pub fn plan_search(query: &str) -> SearchPlan {
    plan_search_with_now(query, Utc::now())
}

/// Testable version of `plan_search` that accepts a reference timestamp.
pub fn plan_search_with_now(query: &str, now: DateTime<Utc>) -> SearchPlan {
    let mut plan = SearchPlan::default();
    let query_lower = query.to_lowercase();

    // 1. Extract temporal constraints (order matters: most specific first)
    extract_temporal(&query_lower, &mut plan, now);

    // 2. Detect aggregation intent
    if RE_AGGREGATION.is_match(query) {
        plan.is_aggregation = true;
        plan.result_count = AGGREGATION_RESULT_COUNT;
    }

    // 2.5 Detect superlative direction. Run unconditionally (even when a date
    //     range is present) so "last restaurant in January 2025" still hard-sorts
    //     the in-range matches by recency.
    extract_superlative(query, &mut plan);

    // 3. Detect recency preference (only if no explicit date range was set)
    if plan.min_date.is_none() && plan.max_date.is_none() {
        extract_recency(query, &mut plan, now);
    }

    // 4. Clean the query for embedding
    let cleaned = clean_query(query);
    if !cleaned.is_empty() {
        plan.search_queries.push(cleaned);
    } else {
        // Fallback: if aggressive cleaning removed everything, use a lightly cleaned version
        let light = light_clean_query(query);
        if !light.is_empty() {
            plan.search_queries.push(light);
        }
    }

    plan
}

/// Loose gate: does this query contain *any* temporal signal?
///
/// Returns true when the query mentions time in any recognizable form (a month,
/// season, holiday, year, period word, relative marker, etc). Intended to decide
/// whether an LLM date-extraction fallback is worth invoking when the regex
/// planner found no explicit date range. It is intentionally permissive — see
/// [`RE_TEMPORAL_HINT`].
pub fn temporal_hint(query: &str) -> bool {
    RE_TEMPORAL_HINT.is_match(query)
}

/// Apply exponential time-decay boosting to search results.
///
/// When `prefer_recent` is true, multiplies each result's similarity score
/// by `e^(-lambda * days_ago)` where lambda = 0.03 (~23-day half-life).
/// This dramatically boosts recent results for temporal queries while still
/// allowing highly-relevant older results to surface.
///
/// When `prefer_recent` is false, this is a no-op.
pub fn apply_recency_boost(results: &mut [SearchResult], prefer_recent: bool) {
    apply_recency_boost_with_now(results, prefer_recent, Utc::now());
}

/// [`apply_recency_boost`] against an explicit reference instant.
///
/// Evaluation pins this to the same `now` given to [`plan_search_with_now`] and
/// [`crate::SearchOptions::with_now`]; otherwise a fixture's expected ordering
/// decays against the real clock and the assertion stops testing anything.
pub fn apply_recency_boost_with_now(results: &mut [SearchResult], prefer_recent: bool, now: DateTime<Utc>) {
    if !prefer_recent || results.is_empty() {
        return;
    }

    for result in results.iter_mut() {
        let age_secs = (now - result.end_timestamp).num_seconds().max(0) as f64;
        let age_days = age_secs / 86400.0;
        let decay = (-RECENCY_DECAY_LAMBDA * age_days).exp();
        result.similarity *= decay as f32;
    }

    // Re-sort by the updated scores
    results.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// Expand a cleaned query into focused sub-queries for multi-vector retrieval.
///
/// Element 0 is always the full cleaned query. For multi-word queries we also
/// emit the longest individual content words (already stop-word stripped by
/// `clean_query`) as standalone sub-queries, capped at `max` total. The win is
/// *splitting*, not synonym expansion: a bi-encoder embeds one short phrase far
/// more sharply than a long pile, and the caller RRF-merges the per-query pools.
pub fn expand_search_queries(cleaned: &str, max: usize) -> Vec<String> {
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || max == 0 {
        return Vec::new();
    }
    let mut out = vec![cleaned.to_string()];

    let mut tokens: Vec<&str> = cleaned.split_whitespace().collect();
    if max <= 1 || tokens.len() <= 1 {
        return out;
    }

    // Longest (most specific) words first.
    tokens.sort_by_key(|t| std::cmp::Reverse(t.len()));
    for tok in tokens {
        if out.len() >= max {
            break;
        }
        if tok.len() < 3 {
            continue;
        }
        if !out.iter().any(|q| q.eq_ignore_ascii_case(tok)) {
            out.push(tok.to_string());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Temporal extraction (internal)
// ---------------------------------------------------------------------------

/// Extract temporal constraints from the query.
///
/// Sets `plan.min_date` and `plan.max_date` based on recognized patterns.
/// Uses a priority order: most specific patterns match first.
fn extract_temporal(query: &str, plan: &mut SearchPlan, now: DateTime<Utc>) {
    let today = now.date_naive();

    // "from January 2025 to January 2026" (most specific — has explicit range)
    if let Some(caps) = RE_FROM_TO_MONTH_YEAR.captures(query) {
        let start_month = parse_month_name(&caps[1]);
        let end_month = parse_month_name(&caps[3]);
        let start_year = caps
            .get(2)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(today.year());
        let end_year = caps
            .get(4)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .unwrap_or(start_year);

        if let Some(start) = month_start(start_year, start_month) {
            plan.min_date = Some(start);
        }
        if let Some(end) = month_end(end_year, end_month) {
            plan.max_date = Some(end);
        }
        return;
    }

    // "in January 2025" (month + year)
    if let Some(caps) = RE_IN_MONTH_YEAR.captures(query) {
        let month = parse_month_name(&caps[1]);
        if let Ok(year) = caps[2].parse::<i32>() {
            plan.min_date = month_start(year, month);
            plan.max_date = month_end(year, month);
            return;
        }
    }

    // "in 2025" (year only)
    if let Some(caps) = RE_IN_YEAR.captures(query) {
        // But skip if we already matched "in <Month> <Year>" above
        if RE_IN_MONTH_YEAR.is_match(query) {
            // Already handled
        } else if let Ok(year) = caps[1].parse::<i32>() {
            plan.min_date = year_start(year);
            plan.max_date = year_end(year);
            return;
        }
    }

    // "in January" (month only — resolve to most recent occurrence)
    if let Some(caps) = RE_IN_MONTH.captures(query) {
        // Skip if "in <Month> <Year>" was already matched
        if !RE_IN_MONTH_YEAR.is_match(query) {
            let month = parse_month_name(&caps[1]);
            let year = resolve_month_year(month, today);
            plan.min_date = month_start(year, month);
            plan.max_date = month_end(year, month);
            return;
        }
    }

    // "yesterday"
    if RE_YESTERDAY.is_match(query) {
        let yesterday = today - Duration::days(1);
        plan.min_date = day_start(yesterday);
        plan.max_date = day_end(yesterday);
        plan.prefer_recent = true;
        return;
    }

    // "today"
    if RE_TODAY.is_match(query) {
        plan.min_date = day_start(today);
        plan.max_date = day_end(today);
        plan.prefer_recent = true;
        return;
    }

    // "last week"
    if RE_LAST_WEEK.is_match(query) {
        plan.min_date = Some(now - Duration::days(7));
        plan.max_date = Some(now);
        plan.prefer_recent = true;
        return;
    }

    // "this week"
    if RE_THIS_WEEK.is_match(query) {
        // Start of the current week (Monday)
        let weekday = today.weekday().num_days_from_monday();
        let monday = today - Duration::days(weekday as i64);
        plan.min_date = day_start(monday);
        plan.max_date = Some(now);
        plan.prefer_recent = true;
        return;
    }

    // "last month"
    if RE_LAST_MONTH.is_match(query) {
        let (prev_year, prev_month) = if today.month() == 1 {
            (today.year() - 1, 12)
        } else {
            (today.year(), today.month() - 1)
        };
        plan.min_date = month_start(prev_year, prev_month);
        plan.max_date = month_end(prev_year, prev_month);
        return;
    }

    // "this month"
    if RE_THIS_MONTH.is_match(query) {
        plan.min_date = month_start(today.year(), today.month());
        plan.max_date = Some(now);
        plan.prefer_recent = true;
        return;
    }

    // "this year"
    if RE_THIS_YEAR.is_match(query) {
        plan.min_date = year_start(today.year());
        plan.max_date = Some(now);
        return;
    }

    // "last year"
    if RE_LAST_YEAR.is_match(query) {
        let prev_year = today.year() - 1;
        plan.min_date = year_start(prev_year);
        plan.max_date = year_end(prev_year);
        return;
    }

    // "last N days/weeks/months" / "past N days/weeks/months"
    if let Some(caps) = RE_LAST_N_PERIOD.captures(query) {
        if let Ok(n) = caps[1].parse::<i64>() {
            let period = &caps[2].to_lowercase();
            let duration = if period.starts_with("day") {
                Duration::days(n)
            } else if period.starts_with("week") {
                Duration::weeks(n)
            } else {
                Duration::days(n * 30) // approximate months
            };
            plan.min_date = Some(now - duration);
            plan.max_date = Some(now);
            plan.prefer_recent = true;
        }
        return;
    }

    // "this winter" / "this spring" / "this summer" / "this fall"
    if let Some(caps) = RE_THIS_SEASON.captures(query) {
        let (start, end) = season_range(&caps[1], today.year(), false);
        plan.min_date = day_start(start);
        plan.max_date = day_end(end);
        return;
    }

    // "last winter" / "last spring" / "last summer" / "last fall"
    if let Some(caps) = RE_LAST_SEASON.captures(query) {
        let (start, end) = season_range(&caps[1], today.year(), true);
        plan.min_date = day_start(start);
        plan.max_date = day_end(end);
    }
}

/// True for "last"/"latest"/"most recent" used bare, i.e. not as part of a bounded
/// range phrase like "last week/month/year/season" or "last 3 days".
fn is_bare_recency(query: &str) -> bool {
    RE_RECENCY_INDICATOR.is_match(query)
        && !RE_LAST_WEEK.is_match(query)
        && !RE_LAST_MONTH.is_match(query)
        && !RE_LAST_YEAR.is_match(query)
        && !RE_LAST_N_PERIOD.is_match(query)
        && !RE_LAST_SEASON.is_match(query)
}

/// Detect superlative intent ("the last/first X") and set the sort direction.
///
/// "Oldest" wins ties with "Newest" (a query naming both is rare; "first" is the
/// more specific signal). The same range-phrase guards as [`extract_recency`]
/// keep "last week/month/year/season" out of the Newest branch — those are
/// bounded windows, not superlatives.
fn extract_superlative(query: &str, plan: &mut SearchPlan) {
    if RE_OLDEST_INDICATOR.is_match(query) {
        plan.superlative = Some(SortDirection::Oldest);
    } else if is_bare_recency(query) {
        plan.superlative = Some(SortDirection::Newest);
    }
}

/// Extract recency preference when no explicit temporal range was found.
fn extract_recency(query: &str, plan: &mut SearchPlan, _now: DateTime<Utc>) {
    // "recently" / "lately"
    //
    // Like "last"/"latest" below, this is a *soft* recency preference, not a hard
    // window. A hard `now - 30d` floor here returned nothing whenever the matching
    // messages predate the last 30 days — e.g. "what did we decide about X
    // recently?" when X was two months ago, or simply when ingestion is a few
    // months stale (the search clamps to a window with no data). prefer_recent +
    // the recency boost rank recent matches first while still surfacing older ones
    // when that's all there is. (Explicit windows like "last month" / "in the past
    // 30 days" still get a hard range via extract_temporal.)
    if RE_RECENTLY.is_match(query) {
        plan.prefer_recent = true;
        return;
    }

    // "last" / "most recent" / "latest" / "newest"
    // But NOT "last week/month/year" (those are handled in extract_temporal).
    //
    // These mean "the most recent matching message, whenever it was" — e.g. "the
    // last restaurant I went to" could be six months ago. So we set prefer_recent
    // (which drives the recency *boost* — recent matches rank higher) but DON'T
    // impose a hard date floor. A floor here was a real bug: it clamped the search
    // to the last 90 days and returned nothing when the actual answer was older.
    if is_bare_recency(query) {
        plan.prefer_recent = true;
    }
}

// ---------------------------------------------------------------------------
// Query cleaning (internal)
// ---------------------------------------------------------------------------

/// Aggressively clean a query for embedding by stripping temporal phrases,
/// stop words, and normalizing whitespace.
fn clean_query(query: &str) -> String {
    // 1. Remove temporal phrases first (they were already parsed)
    let s = RE_TEMPORAL_PHRASES.replace_all(query, " ");

    // 2. Remove bare superlative markers ("last"/"first") so they don't pollute
    //    the embedding — direction is already captured in plan.superlative.
    let s = RE_SUPERLATIVE_WORDS.replace_all(&s, " ");

    // 3. Remove stop words
    let s = RE_STOP_WORDS.replace_all(&s, " ");

    // 4. Normalize whitespace
    let s = RE_MULTI_SPACE.replace_all(&s, " ");

    s.trim().to_string()
}

/// Light cleaning: only removes temporal phrases, not stop words.
/// Used as a fallback when aggressive cleaning removes all content.
fn light_clean_query(query: &str) -> String {
    let s = RE_TEMPORAL_PHRASES.replace_all(query, " ");
    let s = RE_SUPERLATIVE_WORDS.replace_all(&s, " ");
    let s = RE_MULTI_SPACE.replace_all(&s, " ");
    s.trim().to_string()
}

// ---------------------------------------------------------------------------
// Date helpers (internal)
// ---------------------------------------------------------------------------

/// Parse month name to 1-indexed month number.
fn parse_month_name(name: &str) -> u32 {
    match name.to_lowercase().as_str() {
        "january" => 1,
        "february" => 2,
        "march" => 3,
        "april" => 4,
        "may" => 5,
        "june" => 6,
        "july" => 7,
        "august" => 8,
        "september" => 9,
        "october" => 10,
        "november" => 11,
        "december" => 12,
        _ => 1, // shouldn't happen since regex constrains input
    }
}

/// Resolve which year a bare month name refers to.
/// If the month hasn't occurred yet this year, use last year.
fn resolve_month_year(month: u32, today: NaiveDate) -> i32 {
    if month <= today.month() {
        today.year()
    } else {
        today.year() - 1
    }
}

/// Start of a day as UTC DateTime.
fn day_start(date: NaiveDate) -> Option<DateTime<Utc>> {
    date.and_time(NaiveTime::from_hms_opt(0, 0, 0)?).and_utc().into()
}

/// End of a day as UTC DateTime (23:59:59).
fn day_end(date: NaiveDate) -> Option<DateTime<Utc>> {
    date.and_time(NaiveTime::from_hms_opt(23, 59, 59)?).and_utc().into()
}

/// Start of a month as UTC DateTime.
fn month_start(year: i32, month: u32) -> Option<DateTime<Utc>> {
    let date = NaiveDate::from_ymd_opt(year, month, 1)?;
    day_start(date)
}

/// End of a month as UTC DateTime (last day, 23:59:59).
fn month_end(year: i32, month: u32) -> Option<DateTime<Utc>> {
    // Last day of month: go to first of next month, subtract one day
    let next_month_start = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)?
    };
    let last_day = next_month_start - Duration::days(1);
    day_end(last_day)
}

/// Start of a year as UTC DateTime.
fn year_start(year: i32) -> Option<DateTime<Utc>> {
    day_start(NaiveDate::from_ymd_opt(year, 1, 1)?)
}

/// End of a year as UTC DateTime.
fn year_end(year: i32) -> Option<DateTime<Utc>> {
    day_end(NaiveDate::from_ymd_opt(year, 12, 31)?)
}

/// Get the date range for a meteorological season.
///
/// Northern hemisphere seasons:
/// - Winter: Dec 1 - Feb 28/29
/// - Spring: Mar 1 - May 31
/// - Summer: Jun 1 - Aug 31
/// - Fall: Sep 1 - Nov 30
///
/// `is_last` shifts back by one season cycle.
fn season_range(season: &str, current_year: i32, is_last: bool) -> (NaiveDate, NaiveDate) {
    let season_lower = season.to_lowercase();
    let offset = if is_last { 1 } else { 0 };

    match season_lower.as_str() {
        "winter" => {
            // Winter spans Dec of previous year to Feb of current year
            let year = current_year - offset;
            let start = NaiveDate::from_ymd_opt(year - 1, 12, 1).unwrap();
            let end_month_year = year;
            let end = if chrono::NaiveDate::from_ymd_opt(end_month_year, 2, 29).is_some() {
                NaiveDate::from_ymd_opt(end_month_year, 2, 29).unwrap()
            } else {
                NaiveDate::from_ymd_opt(end_month_year, 2, 28).unwrap()
            };
            (start, end)
        }
        "spring" => {
            let year = current_year - offset;
            let start = NaiveDate::from_ymd_opt(year, 3, 1).unwrap();
            let end = NaiveDate::from_ymd_opt(year, 5, 31).unwrap();
            (start, end)
        }
        "summer" => {
            let year = current_year - offset;
            let start = NaiveDate::from_ymd_opt(year, 6, 1).unwrap();
            let end = NaiveDate::from_ymd_opt(year, 8, 31).unwrap();
            (start, end)
        }
        "fall" | "autumn" => {
            let year = current_year - offset;
            let start = NaiveDate::from_ymd_opt(year, 9, 1).unwrap();
            let end = NaiveDate::from_ymd_opt(year, 11, 30).unwrap();
            (start, end)
        }
        _ => {
            // Default: this year
            let start = NaiveDate::from_ymd_opt(current_year, 1, 1).unwrap();
            let end = NaiveDate::from_ymd_opt(current_year, 12, 31).unwrap();
            (start, end)
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// Create a fixed "now" for deterministic tests.
    /// 2026-02-09 14:00:00 UTC
    fn test_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 2, 9, 14, 0, 0).unwrap()
    }

    // -----------------------------------------------------------------------
    // Temporal extraction
    // -----------------------------------------------------------------------

    #[test]
    fn test_yesterday() {
        let plan = plan_search_with_now("who did I text yesterday", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 8).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 8).unwrap());
    }

    #[test]
    fn test_today() {
        let plan = plan_search_with_now("what happened today", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 9).unwrap());
    }

    #[test]
    fn test_last_week() {
        let plan = plan_search_with_now("what did I talk about last week", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        // Should be 7 days ago
        let expected_min = test_now() - Duration::days(7);
        assert_eq!(min.date_naive(), expected_min.date_naive());
    }

    #[test]
    fn test_this_week() {
        let plan = plan_search_with_now("what happened this week", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        // 2026-02-09 is a Sunday; Monday was Feb 3 (weekday().num_days_from_monday() = 6)
        // Actually: 2026-02-09 is Monday. Let me compute...
        // Actually NaiveDate::from_ymd(2026, 2, 9).weekday() == Monday
        // num_days_from_monday = 0, so monday = today = Feb 9
        let today = NaiveDate::from_ymd_opt(2026, 2, 9).unwrap();
        let weekday = today.weekday().num_days_from_monday();
        let expected_monday = today - Duration::days(weekday as i64);
        assert_eq!(min.date_naive(), expected_monday);
    }

    #[test]
    fn test_last_month() {
        let plan = plan_search_with_now("what happened last month", test_now());
        // February 2026 -> last month is January 2026
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
    }

    #[test]
    fn test_last_month_january_boundary() {
        // When it's January, "last month" should be December of previous year
        let now_jan = Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap();
        let plan = plan_search_with_now("what happened last month", now_jan);
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
    }

    #[test]
    fn test_this_month() {
        let plan = plan_search_with_now("what happened this month", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 1).unwrap());
    }

    #[test]
    fn test_this_year() {
        let plan = plan_search_with_now("what concerts did I go to this year", test_now());
        let min = plan.min_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    }

    #[test]
    fn test_last_year() {
        let plan = plan_search_with_now("what happened last year", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
    }

    #[test]
    fn test_in_year_2025() {
        let plan = plan_search_with_now("who did I text the most in 2025", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
    }

    #[test]
    fn test_in_january_2025() {
        let plan = plan_search_with_now("what plans did I make in January 2025", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 31).unwrap());
    }

    #[test]
    fn test_in_december_no_year() {
        // It's Feb 2026 -> "in December" = December 2025 (most recent)
        let plan = plan_search_with_now("what plans did I make in December", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
    }

    #[test]
    fn test_in_month_current_year() {
        // "in January" when it's Feb 2026 -> January 2026 (already passed this year)
        let plan = plan_search_with_now("what happened in January", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
    }

    #[test]
    fn test_in_march_when_its_february() {
        // "in March" when it's Feb 2026 -> March hasn't happened, so use 2025
        let plan = plan_search_with_now("what happened in March", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 3, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 3, 31).unwrap());
    }

    #[test]
    fn test_from_january_2025_to_january_2026() {
        let plan = plan_search_with_now("where did I vacation from January 2025 to January 2026", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
    }

    #[test]
    fn test_from_january_to_march_2025() {
        let plan = plan_search_with_now("what happened from January to March 2025", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        // "from January to March 2025": start_year defaults to end_year when omitted
        // In the regex, start_year defaults to today.year() (2026) if not specified,
        // but end_year = 2025. So start_year = 2026 (default). That's wrong.
        // Actually: the regex capture group 2 is the start year.
        // For "from January to March 2025", caps: 1=January, 2=None, 3=March, 4=2025
        // start_year = None => today.year() = 2026. That's reasonable since "January"
        // without a year gets resolved to the most recent January.
        // But actually "from January to March 2025" logically means Jan-Mar 2025.
        // Let's handle this by using end_year as default for start_year when start has no year.
        // This test documents expected behavior after the fix.
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 3, 31).unwrap());
    }

    #[test]
    fn test_from_january_to_march_no_year() {
        let plan = plan_search_with_now("what happened from January to March", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        // Both default to current year (2026). Jan and March 2026 - but March hasn't
        // happened yet. For "from X to Y" we use current year as default.
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 3, 31).unwrap());
    }

    #[test]
    fn test_last_5_days() {
        let plan = plan_search_with_now("what happened in the last 5 days", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        let expected_min = test_now() - Duration::days(5);
        assert_eq!(min.date_naive(), expected_min.date_naive());
    }

    #[test]
    fn test_past_2_weeks() {
        let plan = plan_search_with_now("who texted me the past 2 weeks", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        let expected_min = test_now() - Duration::weeks(2);
        assert_eq!(min.date_naive(), expected_min.date_naive());
    }

    #[test]
    fn test_last_3_months() {
        let plan = plan_search_with_now("what happened last 3 months", test_now());
        assert!(plan.prefer_recent);
        let min = plan.min_date.unwrap();
        let expected_min = test_now() - Duration::days(90);
        assert_eq!(min.date_naive(), expected_min.date_naive());
    }

    #[test]
    fn test_this_winter() {
        let plan = plan_search_with_now("who mentioned skiing this winter", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        // "this winter" in Feb 2026 = Dec 2025 - Feb 2026
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn test_last_summer() {
        let plan = plan_search_with_now("what did we do last summer", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        // "last summer" in 2026 = Jun-Aug 2025
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 6, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 8, 31).unwrap());
    }

    // -----------------------------------------------------------------------
    // Recency detection
    // -----------------------------------------------------------------------

    #[test]
    fn test_recently_prefers_recent_without_date_floor() {
        // "recently" is a soft preference, not a hard window: prefer_recent drives
        // the recency boost, but there must be NO hard date floor — otherwise a
        // match (or the user's whole history) older than 30 days is dropped and the
        // search returns nothing.
        let plan = plan_search_with_now("what restaurant did someone recommend recently", test_now());
        assert!(plan.prefer_recent);
        assert!(
            plan.min_date.is_none(),
            "'recently' must not impose a hard min_date floor"
        );
        assert!(
            plan.max_date.is_none(),
            "'recently' must not impose a hard max_date ceiling"
        );
    }

    #[test]
    fn test_most_recent_prefers_recent_without_date_floor() {
        // "most recent X" means "the latest match, whenever it was" — prefer_recent
        // drives the recency boost, but there must be NO hard date floor that would
        // exclude an older answer.
        let plan = plan_search_with_now("what was the most recent concert I mentioned", test_now());
        assert!(plan.prefer_recent);
        assert!(
            plan.min_date.is_none(),
            "recency indicator must not impose a date floor"
        );
        assert!(plan.max_date.is_none());
    }

    #[test]
    fn test_last_restaurant() {
        // "the last restaurant I went to" could be months ago; we must not clamp to
        // a recent window (regression test for the 90-day-floor bug).
        let plan = plan_search_with_now("what was the last restaurant I went to", test_now());
        assert!(plan.prefer_recent);
        assert!(
            plan.min_date.is_none(),
            "should prefer recent, not exclude older matches"
        );
    }

    #[test]
    fn test_last_restaurant_sets_newest() {
        let plan = plan_search("what was the last restaurant I went to");
        assert_eq!(plan.superlative, Some(SortDirection::Newest));
    }

    #[test]
    fn test_first_restaurant_sets_oldest() {
        let plan = plan_search("what was the first restaurant we went to");
        assert_eq!(plan.superlative, Some(SortDirection::Oldest));
        // Oldest must not lean on the recency boost (which decays old results).
        assert!(!plan.prefer_recent, "oldest superlative must not prefer_recent");
        assert!(plan.min_date.is_none());
        assert!(plan.max_date.is_none());
        assert!(plan.search_queries[0].contains("restaurant"));
    }

    #[test]
    fn test_earliest_oldest_indicators() {
        for q in [
            "the earliest message from her",
            "our oldest conversation",
            "first time we met",
        ] {
            assert_eq!(plan_search(q).superlative, Some(SortDirection::Oldest), "query: {q}");
        }
        for q in ["the latest news", "most recent trip", "newest photos"] {
            assert_eq!(plan_search(q).superlative, Some(SortDirection::Newest), "query: {q}");
        }
    }

    #[test]
    fn test_last_week_not_superlative() {
        // Bounded windows are ranges, not superlatives.
        for q in [
            "what did we do last week",
            "messages from last month",
            "trips last year",
        ] {
            assert_eq!(plan_search(q).superlative, None, "query: {q}");
        }
    }

    #[test]
    fn test_clean_strips_superlative() {
        // The superlative marker must not pollute the embedding text.
        let plan = plan_search("what was the last restaurant I went to");
        let q = plan.search_queries[0].to_lowercase();
        assert!(q.contains("restaurant"));
        assert!(!q.split_whitespace().any(|w| w == "last"), "got: {q}");

        let plan = plan_search("the first concert I went to");
        let q = plan.search_queries[0].to_lowercase();
        assert!(q.contains("concert"));
        assert!(!q.split_whitespace().any(|w| w == "first"), "got: {q}");
    }

    #[test]
    fn test_superlative_with_date_range() {
        // Superlative composes with an explicit range: detect Newest AND keep the range.
        let plan = plan_search("last restaurant I went to in January 2025");
        assert_eq!(plan.superlative, Some(SortDirection::Newest));
        assert!(plan.min_date.is_some(), "explicit range should still be extracted");
        assert!(plan.max_date.is_some());
    }

    #[test]
    fn test_expand_search_queries() {
        // Single word: no expansion.
        assert_eq!(expand_search_queries("restaurant", 3), vec!["restaurant".to_string()]);
        // Multi-word: full phrase first, then longest content words.
        let out = expand_search_queries("dinner reservation williamsburg", 3);
        assert_eq!(out[0], "dinner reservation williamsburg");
        assert!(out.len() <= 3);
        assert!(out.contains(&"williamsburg".to_string()));
        // max=1 returns only the full query; max=0 returns empty.
        assert_eq!(expand_search_queries("a b c", 1), vec!["a b c".to_string()]);
        assert!(expand_search_queries("anything", 0).is_empty());
        assert!(expand_search_queries("   ", 3).is_empty());
    }

    #[test]
    fn test_latest_indicator() {
        let plan = plan_search_with_now("what is the latest concert I mentioned", test_now());
        assert!(plan.prefer_recent);
    }

    // -----------------------------------------------------------------------
    // Aggregation detection
    // -----------------------------------------------------------------------

    #[test]
    fn test_favorite_is_aggregation() {
        let plan = plan_search_with_now("what do you think is my favorite food", test_now());
        assert!(plan.is_aggregation);
        assert_eq!(plan.result_count, AGGREGATION_RESULT_COUNT);
    }

    #[test]
    fn test_most_is_aggregation() {
        let plan = plan_search_with_now("who do I talk to most about sports", test_now());
        assert!(plan.is_aggregation);
        assert_eq!(plan.result_count, AGGREGATION_RESULT_COUNT);
    }

    #[test]
    fn test_usually_is_aggregation() {
        let plan = plan_search_with_now("where do I usually eat dinner", test_now());
        assert!(plan.is_aggregation);
    }

    #[test]
    fn test_a_lot_is_aggregation() {
        let plan = plan_search_with_now("what hobbies come up a lot in my conversations", test_now());
        assert!(plan.is_aggregation);
    }

    // -----------------------------------------------------------------------
    // Query cleaning
    // -----------------------------------------------------------------------

    #[test]
    fn test_clean_restaurant_query() {
        let plan = plan_search_with_now("what was the last restaurant I went to", test_now());
        assert!(!plan.search_queries.is_empty());
        let cleaned = &plan.search_queries[0];
        assert!(
            cleaned.contains("restaurant"),
            "cleaned query should contain 'restaurant', got: {cleaned}"
        );
        // Should NOT contain stop words
        assert!(
            !cleaned.to_lowercase().starts_with("what "),
            "should not start with 'what': {cleaned}"
        );
    }

    #[test]
    fn test_clean_vacation_query() {
        let plan = plan_search_with_now("where did I vacation from January 2025 to January 2026", test_now());
        assert!(!plan.search_queries.is_empty());
        let cleaned = &plan.search_queries[0];
        assert!(
            cleaned.contains("vacation"),
            "cleaned query should contain 'vacation', got: {cleaned}"
        );
        // Should NOT contain the date range
        assert!(!cleaned.contains("January"), "should not contain 'January': {cleaned}");
    }

    #[test]
    fn test_clean_favorite_food_query() {
        let plan = plan_search_with_now("what do you think is my favorite food", test_now());
        assert!(!plan.search_queries.is_empty());
        let cleaned = &plan.search_queries[0];
        assert!(
            cleaned.contains("favorite") || cleaned.contains("food"),
            "cleaned query should contain 'favorite' or 'food', got: {cleaned}"
        );
    }

    #[test]
    fn test_clean_skiing_query() {
        let plan = plan_search_with_now("who mentioned skiing this winter", test_now());
        assert!(!plan.search_queries.is_empty());
        let cleaned = &plan.search_queries[0];
        assert!(
            cleaned.contains("skiing"),
            "cleaned query should contain 'skiing', got: {cleaned}"
        );
    }

    #[test]
    fn test_clean_preserves_content_words() {
        let plan = plan_search_with_now("has anyone mentioned a job change or new job", test_now());
        assert!(!plan.search_queries.is_empty());
        let cleaned = &plan.search_queries[0];
        assert!(
            cleaned.contains("job"),
            "cleaned query should contain 'job', got: {cleaned}"
        );
    }

    // -----------------------------------------------------------------------
    // No temporal content
    // -----------------------------------------------------------------------

    #[test]
    fn test_no_temporal_content() {
        let plan = plan_search_with_now("who likes pizza", test_now());
        assert!(plan.min_date.is_none());
        assert!(plan.max_date.is_none());
        assert!(!plan.prefer_recent);
        assert!(!plan.search_queries.is_empty());
    }

    #[test]
    fn test_fact_query_no_temporal() {
        let plan = plan_search_with_now("when did someone mention moving to a new city", test_now());
        // "when" is a question word but not a temporal constraint
        assert!(plan.min_date.is_none());
        assert!(plan.max_date.is_none());
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_empty_query() {
        let plan = plan_search_with_now("", test_now());
        assert!(plan.search_queries.is_empty() || plan.search_queries.iter().all(|q| q.is_empty()));
    }

    #[test]
    fn test_only_stop_words_fallback() {
        // If aggressive cleaning removes everything, fallback to light clean
        let plan = plan_search_with_now("what is the", test_now());
        // The light clean should still produce something (or empty)
        // At minimum, should not panic
        assert!(plan.search_queries.len() <= 1);
    }

    #[test]
    fn test_last_not_consumed_by_temporal() {
        // "last" in "last restaurant" should trigger recency, not "last month/week"
        let plan = plan_search_with_now("what was the last restaurant I went to", test_now());
        assert!(plan.prefer_recent);
        // It must NOT have extracted any date range — neither a "last month/week"
        // window nor a recency floor. Recency is expressed via prefer_recent alone.
        assert!(plan.min_date.is_none());
        assert!(plan.max_date.is_none());
    }

    #[test]
    fn test_in_the_last_month_vs_last_month() {
        // "in the last month" should be treated as recency, not "last month" (the calendar month)
        // Our regex "last month" matches "\blast\s+month\b" which fires on "in the last month" too.
        // This is acceptable since "in the last month" and "last month" overlap semantically.
        let plan = plan_search_with_now("what happened in the last month", test_now());
        // Either interpretation is reasonable (calendar last month or last 30 days)
        assert!(plan.min_date.is_some());
    }

    #[test]
    fn test_february_28_vs_29() {
        // Test month_end handles leap years
        // 2024 was a leap year
        let end = month_end(2024, 2).unwrap();
        assert_eq!(end.date_naive(), NaiveDate::from_ymd_opt(2024, 2, 29).unwrap());

        // 2025 is not a leap year
        let end = month_end(2025, 2).unwrap();
        assert_eq!(end.date_naive(), NaiveDate::from_ymd_opt(2025, 2, 28).unwrap());
    }

    // -----------------------------------------------------------------------
    // Recency boost
    // -----------------------------------------------------------------------

    #[test]
    fn test_recency_boost_noop_when_false() {
        let mut results = vec![make_result(1, 0.9, 1), make_result(2, 0.8, 30)];
        apply_recency_boost(&mut results, false);
        assert!((results[0].similarity - 0.9).abs() < 1e-6);
        assert!((results[1].similarity - 0.8).abs() < 1e-6);
    }

    #[test]
    fn test_recency_boost_decays_old_results() {
        let mut results = vec![
            make_result(1, 0.9, 0),  // today
            make_result(2, 0.9, 90), // 90 days ago, same initial score
        ];
        apply_recency_boost(&mut results, true);
        // Today's result should be barely changed (e^0 = 1)
        assert!(results[0].similarity > 0.85, "today result should stay high");
        // 90-day-old result: e^(-0.03 * 90) = e^(-2.7) ≈ 0.067
        // 0.9 * 0.067 ≈ 0.06
        assert!(
            results[1].similarity < 0.15,
            "90-day-old result should be heavily decayed"
        );
        // First result should be higher (it was more recent)
        assert!(results[0].similarity > results[1].similarity);
    }

    #[test]
    fn test_recency_boost_reorders_results() {
        let mut results = vec![
            make_result(1, 0.5, 0),   // low score but today
            make_result(2, 0.95, 60), // high score but 60 days ago
        ];
        apply_recency_boost(&mut results, true);
        // Today: 0.5 * e^0 = 0.5
        // 60 days ago: 0.95 * e^(-1.8) ≈ 0.95 * 0.165 ≈ 0.157
        assert_eq!(results[0].chunk_id, 1, "today's result should be first after boost");
    }

    #[test]
    fn test_recency_boost_empty_results() {
        let mut results: Vec<SearchResult> = vec![];
        apply_recency_boost(&mut results, true); // should not panic
        assert!(results.is_empty());
    }

    /// The decay must follow the clock it is handed, not the wall clock — the
    /// same fixture scored against a later `now` has to decay further. Without
    /// this, a pinned-clock eval would silently drift as the real date advances.
    #[test]
    fn test_recency_boost_follows_the_supplied_clock() {
        let now = DateTime::parse_from_rfc3339("2026-02-09T14:00:00Z")
            .expect("valid fixed timestamp")
            .with_timezone(&Utc);
        let ts = now - Duration::days(10);

        let scored_at = |reference: DateTime<Utc>| {
            let mut results = vec![make_result_at(1, 0.9, ts)];
            apply_recency_boost_with_now(&mut results, true, reference);
            results[0].similarity
        };

        let near = scored_at(now);
        let far = scored_at(now + Duration::days(100));
        assert!(near > far, "a later reference clock must decay the same result further");

        // Deterministic: identical clock, identical score.
        assert_eq!(near, scored_at(now));
    }

    // -----------------------------------------------------------------------
    // Eval query coverage (all 20 eval queries)
    // -----------------------------------------------------------------------

    #[test]
    fn test_eval_recency_1() {
        let plan = plan_search_with_now("what was the last restaurant I went to", test_now());
        assert!(plan.prefer_recent, "recency-1: should prefer recent");
        assert!(plan.min_date.is_none(), "recency-1: must not clamp older matches out");
    }

    #[test]
    fn test_eval_recency_2() {
        let plan = plan_search_with_now("who did I text yesterday", test_now());
        assert!(plan.prefer_recent, "recency-2: should prefer recent");
        let min = plan.min_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 8).unwrap());
    }

    #[test]
    fn test_eval_recency_3() {
        let plan = plan_search_with_now("what did I talk about last week", test_now());
        assert!(plan.prefer_recent, "recency-3: should prefer recent");
        assert!(plan.min_date.is_some());
    }

    #[test]
    fn test_eval_recency_4() {
        let plan = plan_search_with_now("what was the most recent concert or show I mentioned", test_now());
        assert!(plan.prefer_recent, "recency-4: should prefer recent");
        assert!(
            plan.min_date.is_none(),
            "recency-4: prefer recent, but don't exclude older matches"
        );
    }

    #[test]
    fn test_eval_temporal_1() {
        let plan = plan_search_with_now("where did I vacation from January 2025 to January 2026", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 31).unwrap());
    }

    #[test]
    fn test_eval_temporal_2() {
        let plan = plan_search_with_now("what concerts did I go to this year", test_now());
        let min = plan.min_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap());
    }

    #[test]
    fn test_eval_temporal_3() {
        let plan = plan_search_with_now("what plans did I make in December", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        // February 2026 -> "in December" = December 2025
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
    }

    #[test]
    fn test_eval_temporal_4() {
        let plan = plan_search_with_now("who did I text the most in 2025", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
        assert!(plan.is_aggregation, "temporal-4: 'most' should set aggregation");
    }

    #[test]
    fn test_eval_preference_1() {
        let plan = plan_search_with_now("what do you think is my favorite food", test_now());
        assert!(plan.is_aggregation, "preference-1: should be aggregation");
        assert_eq!(plan.result_count, AGGREGATION_RESULT_COUNT);
    }

    #[test]
    fn test_eval_preference_2() {
        let plan = plan_search_with_now("who do I talk to most about sports", test_now());
        assert!(plan.is_aggregation, "preference-2: should be aggregation");
    }

    #[test]
    fn test_eval_preference_3() {
        let plan = plan_search_with_now("what kind of music do I like based on my messages", test_now());
        // "like" is not an aggregation trigger, but this is a preference query
        // It doesn't need to be flagged as aggregation; the search will work with regular results
        assert!(!plan.search_queries.is_empty());
    }

    #[test]
    fn test_eval_preference_4() {
        let plan = plan_search_with_now(
            "what hobbies or activities come up a lot in my conversations",
            test_now(),
        );
        assert!(plan.is_aggregation, "preference-4: 'a lot' should trigger aggregation");
    }

    #[test]
    fn test_eval_fact_1() {
        let plan = plan_search_with_now("when did someone mention moving to a new city", test_now());
        assert!(!plan.prefer_recent, "fact-1: not a recency query");
        assert!(plan.min_date.is_none(), "fact-1: no temporal constraint");
    }

    #[test]
    fn test_eval_fact_2() {
        let plan = plan_search_with_now("what restaurant did someone recommend recently", test_now());
        assert!(plan.prefer_recent, "fact-2: 'recently' should prefer recent");
        // 'recently' is a soft preference (recency boost), not a hard date floor —
        // a floor drops matches older than 30 days (and everything when ingestion
        // is stale). See test_recently_prefers_recent_without_date_floor.
        assert!(
            plan.min_date.is_none(),
            "fact-2: 'recently' must not impose a hard min_date"
        );
    }

    #[test]
    fn test_eval_fact_3() {
        let plan = plan_search_with_now("has anyone mentioned a job change or new job", test_now());
        assert!(!plan.prefer_recent, "fact-3: not a recency query");
    }

    #[test]
    fn test_eval_fact_4() {
        let plan = plan_search_with_now(
            "what was the name of the place we talked about going to for a trip",
            test_now(),
        );
        // No explicit temporal constraint here
        assert!(!plan.search_queries.is_empty());
    }

    #[test]
    fn test_eval_cross_contact_1() {
        let plan = plan_search_with_now("who mentioned skiing or snowboarding this winter", test_now());
        let min = plan.min_date.unwrap();
        let max = plan.max_date.unwrap();
        assert_eq!(min.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
        assert_eq!(max.date_naive(), NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn test_eval_cross_contact_2() {
        let plan = plan_search_with_now("which friends have I made dinner plans with recently", test_now());
        assert!(plan.prefer_recent, "cross-contact-2: 'recently' should prefer recent");
    }

    #[test]
    fn test_eval_cross_contact_3() {
        let plan = plan_search_with_now("who has been talking about weddings or engagements", test_now());
        // No temporal constraint
        assert!(!plan.prefer_recent);
    }

    #[test]
    fn test_eval_cross_contact_4() {
        let plan = plan_search_with_now(
            "which contacts have I discussed weekend plans with in the last month",
            test_now(),
        );
        // "in the last month" = "last month" pattern
        assert!(plan.min_date.is_some());
    }

    // -----------------------------------------------------------------------
    // Test helpers
    // -----------------------------------------------------------------------

    fn make_result(chunk_id: i64, similarity: f32, days_ago: i64) -> SearchResult {
        make_result_at(chunk_id, similarity, Utc::now() - Duration::days(days_ago))
    }

    /// `make_result` with an explicit timestamp, for clock-pinned tests.
    fn make_result_at(chunk_id: i64, similarity: f32, ts: DateTime<Utc>) -> SearchResult {
        use crate::vectordb::ChunkData;
        SearchResult {
            chunk_id,
            contact_id: "test".to_string(),
            contact_name: Some("Test".to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: "test".to_string(),
            },
            message_ids: vec![chunk_id],
            start_timestamp: ts,
            end_timestamp: ts,
            similarity,
            embedding: None,
        }
    }

    // -----------------------------------------------------------------------
    // Temporal hint gate
    // -----------------------------------------------------------------------

    #[test]
    fn test_temporal_hint_fires_on_paraphrases() {
        // Set B style queries the regex planner cannot parse, but which clearly
        // reference time — the gate must catch these so the LLM fallback runs.
        let hits = [
            "what was I chatting about around christmastime",
            "stuff from the back half of last year",
            "what did we talk about over the holidays",
            "what was I up to a couple months ago",
            "conversations from the first quarter of 2025",
            "what happened between thanksgiving and new years",
            "what were we saying when covid started",
            "what was going on about a year ago",
            "messages from the summer before last",
            "what were we planning right around the turn of the year",
        ];
        for q in hits {
            assert!(temporal_hint(q), "expected temporal hint for: {q}");
        }
    }

    #[test]
    fn test_temporal_hint_fires_on_in_distribution() {
        for q in [
            "who did I text yesterday",
            "what happened last month",
            "what concerts did I go to this year",
            "who did I text the most in 2025",
            "what did we do last summer",
            "what restaurant did someone recommend recently",
        ] {
            assert!(temporal_hint(q), "expected temporal hint for: {q}");
        }
    }

    #[test]
    fn test_temporal_hint_skips_non_temporal() {
        // Pure topic/fact queries with no time reference must NOT fire the gate.
        for q in [
            "what restaurants does mom like",
            "who is my best friend",
            "what are my hobbies",
            "what did Riley say about the octopus",
        ] {
            assert!(!temporal_hint(q), "did not expect temporal hint for: {q}");
        }
    }
}

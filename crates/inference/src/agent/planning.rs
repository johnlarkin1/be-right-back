//! Query planning for the Casper agent: regex-first, LLM-fallback.
//!
//! The regex planner ([`ingestion::plan_search`]) is fast and exact on the
//! calendar phrasings it has patterns for, but silently returns no date range
//! for natural paraphrases ("first quarter of 2025", "over the holidays", "when
//! covid started"). When that happens *and* the query clearly mentions time
//! ([`ingestion::temporal_hint`]), we ask the already-loaded agent model to
//! extract a date range as JSON and merge it in. The regex result is always
//! authoritative — the LLM only fills fields the regex left empty, so the
//! in-distribution behavior (and its tests) never regress.
//!
//! See `eval/planner/` for the benchmark that motivates this policy.

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use ingestion::{SearchPlan, plan_search_with_now, temporal_hint};
use serde::Deserialize;
use tracing::{debug, warn};

use crate::config::{ChatMessage, GenerationConfig};
use crate::engines::mlx_python::MLXPythonEngine;
use crate::traits::AsyncInferenceEngineBackend;

/// Structured plan the LLM is asked to emit. Every field is optional so that a
/// partial or slightly-malformed object still parses (we fall back to the regex
/// plan for anything missing).
#[derive(Debug, Default, Deserialize)]
pub struct ExtractedPlan {
    #[serde(default)]
    pub date_min: Option<String>,
    #[serde(default)]
    pub date_max: Option<String>,
    #[serde(default)]
    pub prefer_recent: Option<bool>,
    #[serde(default)]
    pub result_count: Option<usize>,
}

/// Resolve the date/recency plan for a user turn.
///
/// Runs the regex planner first; only when it finds no date range AND the query
/// contains a temporal hint do we spend an LLM call to extract one. Errors in
/// the LLM path degrade gracefully to the regex plan.
pub async fn resolve_turn_plan(engine: &mut MLXPythonEngine, question: &str, now: DateTime<Utc>) -> SearchPlan {
    let regex_plan = plan_search_with_now(question, now);

    // Regex already found a range, or the query has no temporal signal at all:
    // nothing for the LLM to add.
    if regex_plan.min_date.is_some() || regex_plan.max_date.is_some() || !temporal_hint(question) {
        return regex_plan;
    }

    debug!(
        question = question,
        "Regex found no date range but query is temporal; invoking LLM planner"
    );
    let extracted = extract_plan_via_llm(engine, question, now).await;
    merge_plans(regex_plan, extracted)
}

/// Ask the agent model to extract a date range as JSON. Returns `None` on any
/// generation or parse failure (caller falls back to the regex plan).
async fn extract_plan_via_llm(
    engine: &mut MLXPythonEngine,
    question: &str,
    now: DateTime<Utc>,
) -> Option<ExtractedPlan> {
    let messages = vec![
        ChatMessage::system(extraction_system_prompt(now)),
        ChatMessage::user(question),
    ];

    // Deterministic, tiny output. enable_thinking=false must actually suppress
    // chain-of-thought in the daemon (otherwise Qwen3.5 thinks by default and
    // never emits the JSON within budget) — see inference_daemon.py.
    let config = GenerationConfig::deterministic()
        .with_max_tokens(200)
        .with_enable_thinking(false);

    match engine.generate(&messages, &config).await {
        Ok(raw) => {
            let parsed = parse_extracted(&raw);
            if parsed.is_none() {
                warn!(raw_preview = %raw.chars().take(200).collect::<String>(), "LLM planner output did not parse as JSON");
            }
            parsed
        }
        Err(e) => {
            warn!(error = %e, "LLM planner generation failed; falling back to regex plan");
            None
        }
    }
}

/// Merge an LLM-extracted plan into the (authoritative) regex plan.
///
/// Pure and model-free so it can be unit-tested directly. The regex plan wins on
/// every field it populated; the LLM only fills an empty date range, and may set
/// `prefer_recent` / `result_count` when the regex did not.
pub fn merge_plans(mut regex: SearchPlan, llm: Option<ExtractedPlan>) -> SearchPlan {
    // Defensive: never override a regex-supplied range.
    if regex.min_date.is_some() || regex.max_date.is_some() {
        return regex;
    }
    let Some(llm) = llm else {
        return regex;
    };

    let min = llm.date_min.as_deref().and_then(parse_day_start);
    let max = llm.date_max.as_deref().and_then(parse_day_end);

    // Only adopt the LLM plan if it actually produced a range. A null/null
    // response (correct abstention on an unknowable query) leaves the regex plan
    // untouched — i.e. no date filter, same as today.
    if min.is_none() && max.is_none() {
        return regex;
    }

    regex.min_date = min;
    regex.max_date = max;
    regex.prefer_recent = regex.prefer_recent || llm.prefer_recent.unwrap_or(false);
    if !regex.is_aggregation
        && let Some(rc) = llm.result_count
        && rc > 0
    {
        regex.result_count = rc;
    }
    regex
}

/// Extract the first balanced JSON object from raw model output and deserialize it.
pub fn parse_extracted(raw: &str) -> Option<ExtractedPlan> {
    let cleaned = strip_noise(raw);
    let blob = first_json_object(&cleaned)?;
    serde_json::from_str::<ExtractedPlan>(blob).ok()
}

/// Strip ``` fences and `<think>...</think>` blocks from model output.
fn strip_noise(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    // Drop a leading ```json / ``` fence and trailing fence.
    s = s.trim_start_matches("```json").trim_start_matches("```").to_string();
    if let Some(idx) = s.rfind("```") {
        s.truncate(idx);
    }
    // Remove a <think>...</think> block if present.
    if let (Some(start), Some(end)) = (s.find("<think>"), s.find("</think>"))
        && end > start
    {
        s.replace_range(start..end + "</think>".len(), "");
    }
    s
}

/// Return the first brace-balanced `{...}` substring, if any.
fn first_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0usize;
    for (i, ch) in text[start..].char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..start + i + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_day_start(s: &str) -> Option<DateTime<Utc>> {
    let date = NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()?;
    Some(date.and_time(NaiveTime::from_hms_opt(0, 0, 0)?).and_utc())
}

fn parse_day_end(s: &str) -> Option<DateTime<Utc>> {
    let date = NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()?;
    Some(date.and_time(NaiveTime::from_hms_opt(23, 59, 59)?).and_utc())
}

/// System prompt for date extraction. Mirrors `eval/planner/run_llm_planner.py`
/// so the harness and production stay in sync; `now` is injected for relative
/// date resolution.
fn extraction_system_prompt(now: DateTime<Utc>) -> String {
    let today = now.format("%A, %Y-%m-%d");
    format!(
        r#"You extract a date range from a question about the user's message history.

Today is {today}.

Output ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
- "date_min": earliest date to include as "YYYY-MM-DD", or null if the question has no time constraint
- "date_max": latest date to include as "YYYY-MM-DD", or null
- "prefer_recent": true if the user wants the most recent matches (recently, lately, latest), else false
- "result_count": 20 if the question is aggregative (favorite, most, usually, how often), else 7

Resolve relative and fuzzy dates against today's date. Use world knowledge for events, holidays, and seasons (e.g. "around christmastime", "when covid started"). If the time reference is unknowable from the question alone (e.g. "my birthday" with no known date), set both dates to null."#
    )
}

/// Convenience wrapper used by tests that already have a parsed plan (skips the
/// model call but exercises the regex-first + merge policy).
#[cfg(test)]
fn resolve_with_extracted(question: &str, now: DateTime<Utc>, extracted: Option<ExtractedPlan>) -> SearchPlan {
    let regex_plan = plan_search_with_now(question, now);
    if regex_plan.min_date.is_some() || regex_plan.max_date.is_some() {
        return regex_plan;
    }
    merge_plans(regex_plan, extracted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 2, 9, 14, 0, 0).unwrap()
    }

    #[test]
    fn test_parse_extracted_plain() {
        let raw = r#"{"date_min": "2025-01-01", "date_max": "2025-03-31", "prefer_recent": false, "result_count": 7}"#;
        let p = parse_extracted(raw).unwrap();
        assert_eq!(p.date_min.as_deref(), Some("2025-01-01"));
        assert_eq!(p.date_max.as_deref(), Some("2025-03-31"));
    }

    #[test]
    fn test_parse_extracted_with_fence_and_think() {
        let raw =
            "<think>the user means Q1</think>\n```json\n{\"date_min\":\"2025-01-01\",\"date_max\":\"2025-03-31\"}\n```";
        let p = parse_extracted(raw).unwrap();
        assert_eq!(p.date_min.as_deref(), Some("2025-01-01"));
        assert_eq!(p.date_max.as_deref(), Some("2025-03-31"));
    }

    #[test]
    fn test_parse_extracted_garbage_returns_none() {
        assert!(parse_extracted("I cannot determine a date.").is_none());
    }

    #[test]
    fn test_merge_fills_empty_range_from_llm() {
        // "first quarter of 2025": regex finds nothing, LLM supplies Q1.
        let extracted = ExtractedPlan {
            date_min: Some("2025-01-01".into()),
            date_max: Some("2025-03-31".into()),
            prefer_recent: Some(false),
            result_count: Some(7),
        };
        let plan = resolve_with_extracted("conversations from the first quarter of 2025", now(), Some(extracted));
        assert_eq!(
            plan.min_date.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2025, 1, 1).unwrap()
        );
        assert_eq!(
            plan.max_date.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2025, 3, 31).unwrap()
        );
    }

    #[test]
    fn test_merge_never_overrides_regex_range() {
        // "in January 2025": regex is authoritative; a (wrong) LLM range is ignored.
        let extracted = ExtractedPlan {
            date_min: Some("2099-01-01".into()),
            date_max: Some("2099-12-31".into()),
            prefer_recent: Some(true),
            result_count: Some(20),
        };
        let plan = resolve_with_extracted("what plans did I make in January 2025", now(), Some(extracted));
        assert_eq!(
            plan.min_date.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2025, 1, 1).unwrap()
        );
        assert_eq!(
            plan.max_date.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2025, 1, 31).unwrap()
        );
    }

    #[test]
    fn test_merge_abstains_when_llm_returns_null() {
        // Unknowable query: LLM correctly returns null/null -> no date filter.
        let extracted = ExtractedPlan {
            date_min: None,
            date_max: None,
            prefer_recent: None,
            result_count: None,
        };
        let plan = resolve_with_extracted("anything from my friend's wedding", now(), Some(extracted));
        assert!(plan.min_date.is_none() && plan.max_date.is_none());
    }

    #[test]
    fn test_merge_no_llm_is_regex() {
        let plan = resolve_with_extracted("what restaurants does mom like", now(), None);
        assert!(plan.min_date.is_none() && plan.max_date.is_none());
    }

    #[test]
    fn test_max_date_is_end_of_day() {
        let extracted = ExtractedPlan {
            date_min: None,
            date_max: Some("2025-12-31".into()),
            prefer_recent: None,
            result_count: None,
        };
        let plan = resolve_with_extracted("messages up to the end of last year", now(), Some(extracted));
        let max = plan.max_date.unwrap();
        assert_eq!(max.time(), NaiveTime::from_hms_opt(23, 59, 59).unwrap());
    }
}

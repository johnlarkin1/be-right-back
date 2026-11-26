//! Dump the regex query planner's output over the planner eval dataset.
//!
//! Reads eval/planner/dataset.json, runs `plan_search_with_now` with the
//! dataset's fixed `now`, and writes eval/planner/regex_out.json.
//!
//! Run from repo root: `cargo run -p ingestion --example plan_dump`

use std::fs;

use chrono::{NaiveDate, TimeZone, Utc};
use ingestion::plan_search_with_now;
use serde_json::{Value, json};

fn main() {
    let raw = fs::read_to_string("eval/planner/dataset.json").expect("read dataset.json");
    let ds: Value = serde_json::from_str(&raw).expect("parse dataset.json");

    let now_str = ds["now"].as_str().expect("now field");
    let now_date = NaiveDate::parse_from_str(now_str, "%Y-%m-%d").expect("parse now");
    let now = Utc.from_utc_datetime(&now_date.and_hms_opt(14, 0, 0).unwrap());

    let mut out = Vec::new();
    for case in ds["cases"].as_array().expect("cases array") {
        let id = case["id"].as_str().unwrap();
        let query = case["query"].as_str().unwrap();
        let plan = plan_search_with_now(query, now);

        out.push(json!({
            "id": id,
            "query": query,
            "min": plan.min_date.map(|d| d.format("%Y-%m-%d").to_string()),
            "max": plan.max_date.map(|d| d.format("%Y-%m-%d").to_string()),
            "prefer_recent": plan.prefer_recent,
            "is_aggregation": plan.is_aggregation,
            "result_count": plan.result_count,
            "cleaned_query": plan.search_queries.first().cloned().unwrap_or_default(),
        }));
    }

    let out_json = serde_json::to_string_pretty(&json!(out)).unwrap();
    fs::write("eval/planner/regex_out.json", &out_json).expect("write regex_out.json");
    println!("Wrote {} regex results to eval/planner/regex_out.json", out.len());
}

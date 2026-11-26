//! End-to-end eval of the live regex-first → LLM-fallback turn planner.
//!
//! Spawns the real agent daemon, loads the agent model, and runs
//! `resolve_turn_plan` (the exact code path the Casper agent uses) over the
//! planner eval dataset with a fixed `now`, writing results in the same shape as
//! `eval/planner/run_llm_planner.py` so `score.py` can compare it head-to-head
//! with the regex baseline and the simulated hybrid.
//!
//! Run from repo root (needs the daemon + model present):
//!   cargo run -p inference --example plan_eval -- mlx-community/Qwen3.5-9B-4bit 9b
//!
//! Writes eval/planner/llm_out_hybrid_live_<tag>.json

use std::fs;
use std::time::Instant;

use chrono::{TimeZone, Utc};
use inference::{MLXPythonEngine, resolve_turn_plan};
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let model = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| common::DEFAULT_MLX_AGENT_MODEL.to_string());
    let tag = args.get(2).cloned().unwrap_or_else(|| "9b".to_string());

    let raw = fs::read_to_string("eval/planner/dataset.json").expect("read dataset.json");
    let ds: Value = serde_json::from_str(&raw).expect("parse dataset.json");
    let now_str = ds["now"].as_str().expect("now field");
    let now_date = chrono::NaiveDate::parse_from_str(now_str, "%Y-%m-%d").expect("parse now");
    let now = Utc.from_utc_datetime(&now_date.and_hms_opt(14, 0, 0).unwrap());

    eprintln!("Spawning agent daemon and loading {model} ...");
    let mut engine = MLXPythonEngine::spawn_for_agent().expect("spawn agent engine");
    engine.load_model_with_override(Some(&model)).expect("load model");

    let mut out: Vec<Value> = Vec::new();
    for case in ds["cases"].as_array().expect("cases array") {
        let id = case["id"].as_str().unwrap();
        let query = case["query"].as_str().unwrap();

        let t0 = Instant::now();
        let plan = resolve_turn_plan(&mut engine, query, now).await;
        let dt = t0.elapsed().as_secs_f64();

        let min = plan.min_date.map(|d| d.format("%Y-%m-%d").to_string());
        let max = plan.max_date.map(|d| d.format("%Y-%m-%d").to_string());
        eprintln!(
            "{id:22} min={min:?} max={max:?} recent={} ({dt:.1}s)",
            plan.prefer_recent
        );

        out.push(json!({
            "id": id,
            "query": query,
            "min": min,
            "max": max,
            "prefer_recent": plan.prefer_recent,
            "result_count": plan.result_count,
            // Rust always returns a plan; "parse_ok" kept for score.py compatibility.
            "parse_ok": true,
            "latency_s": (dt * 100.0).round() / 100.0,
        }));
    }

    let path = format!("eval/planner/llm_out_hybrid_live_{tag}.json");
    fs::write(&path, serde_json::to_string_pretty(&json!(out)).unwrap()).expect("write output");
    eprintln!("\nWrote {} results to {path}", out.len());
}

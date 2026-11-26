/// Search message history using the hybrid search pipeline (semantic + BM25).
use chrono::Utc;
use comfy_table::{Cell, Color, Table};
use ingestion::{
    HybridSearchBreakdown, SearchOptions, SearchResult, VectorDb, apply_recency_boost, embed_query, plan_search,
};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use tracing::{debug, info};

use common::{Result, relative_time};

/// JSON-serializable search result (matches eval harness expectations).
#[derive(Debug, Serialize)]
struct CliSearchResult {
    chunk_id: i64,
    contact_id: String,
    contact_name: Option<String>,
    formatted: String,
    message_count: usize,
    total_chars: usize,
    start_timestamp: String,
    end_timestamp: String,
    similarity: f32,
}

impl From<&SearchResult> for CliSearchResult {
    fn from(r: &SearchResult) -> Self {
        Self {
            chunk_id: r.chunk_id,
            contact_id: r.contact_id.clone(),
            contact_name: r.contact_name.clone(),
            formatted: r.chunk_data.formatted.clone(),
            message_count: r.chunk_data.messages.len(),
            total_chars: r.chunk_data.formatted.len(),
            start_timestamp: r.start_timestamp.to_rfc3339(),
            end_timestamp: r.end_timestamp.to_rfc3339(),
            similarity: r.similarity,
        }
    }
}

pub fn handle_search(
    query: &str,
    contact_id: Option<&str>,
    limit: Option<usize>,
    json: bool,
    breakdown: bool,
) -> Result<()> {
    // Step 1: Query planner — temporal extraction, query cleaning
    let plan = plan_search(query);
    let limit = limit.unwrap_or(plan.result_count);
    let embed_query_text = plan
        .search_queries
        .first()
        .cloned()
        .unwrap_or_else(|| query.to_string());
    let prefer_recent = plan.prefer_recent;

    info!(
        query = %query,
        cleaned_query = %embed_query_text,
        ?contact_id,
        limit,
        plan_min_date = ?plan.min_date,
        plan_max_date = ?plan.max_date,
        prefer_recent,
        is_aggregation = plan.is_aggregation,
        "CLI search query"
    );

    if !json {
        eprintln!("Embedding query...");
    }

    // Step 2: Embed the cleaned query via Python subprocess
    let embedding = embed_query(&embed_query_text)?;
    debug!(dims = embedding.len(), "Query embedding generated");

    // Step 3: Open vector DB and run hybrid search
    let db = VectorDb::open()?;

    let mut options = SearchOptions::new()
        .with_limit(limit)
        .with_min_similarity(0.1)
        .with_query_text(query)
        .with_date_range(plan.min_date, plan.max_date)
        .with_embeddings()
        .with_rerank();

    if let Some(cid) = contact_id {
        options = options.with_contact(cid);
    }

    if !json {
        eprintln!("Searching...");
    }

    if breakdown {
        let mut bopts = SearchOptions::new()
            .with_limit(limit)
            .with_min_similarity(0.1)
            .with_query_text(query)
            .with_date_range(plan.min_date, plan.max_date);
        if let Some(cid) = contact_id {
            bopts = bopts.with_contact(cid);
        }
        let bd = db.hybrid_search_breakdown(&embedding, bopts)?;
        print_breakdown(&bd, limit);
    }

    let mut results = db.hybrid_search(&embedding, options)?;

    // Step 4: Apply recency boost if query planner detected temporal intent
    apply_recency_boost(&mut results, prefer_recent);

    info!(result_count = results.len(), "Search complete");

    // Step 5: Output
    if json {
        let cli_results: Vec<CliSearchResult> = results.iter().map(CliSearchResult::from).collect();
        let json_str = serde_json::to_string(&cli_results)?;
        println!("{json_str}");
    } else {
        print_table(&results);
    }

    Ok(())
}

fn print_table(results: &[SearchResult]) {
    if results.is_empty() {
        println!("No results found.");
        return;
    }

    let mut table = Table::new();
    table.set_header(vec![
        Cell::new("#"),
        Cell::new("Contact"),
        Cell::new("Score"),
        Cell::new("Date"),
        Cell::new("Preview"),
    ]);

    for (i, r) in results.iter().enumerate() {
        let name = r.contact_name.as_deref().unwrap_or(&r.contact_id);
        let date = r.end_timestamp.format("%Y-%m-%d").to_string();
        let relative = relative_time(r.end_timestamp);
        let preview = r
            .chunk_data
            .formatted
            .lines()
            .take(2)
            .collect::<Vec<_>>()
            .join(" | ")
            .chars()
            .take(80)
            .collect::<String>();

        table.add_row(vec![
            Cell::new(i + 1),
            Cell::new(name).fg(Color::Cyan),
            Cell::new(format!("{:.3}", r.similarity)),
            Cell::new(format!("{date} ({relative})")),
            Cell::new(preview),
        ]);
    }

    println!("{table}");
    println!("\n{} result(s)", results.len());
}

/// Prints per-ranker rankings for the top `n` chunks in the fused list.
/// For each fused-top chunk, shows its rank in each ranker (or `—` if absent),
/// the computed RRF score, and a preview of the chunk text.
fn print_breakdown(bd: &HybridSearchBreakdown, top_n: usize) {
    const K: f32 = 60.0;

    let semantic_rank: HashMap<i64, usize> = bd
        .semantic
        .iter()
        .enumerate()
        .map(|(i, r)| (r.chunk_id, i + 1))
        .collect();
    let bm25_rank: HashMap<i64, usize> = bd.bm25.iter().enumerate().map(|(i, r)| (r.chunk_id, i + 1)).collect();
    let keyword_rank: HashMap<i64, usize> = bd
        .keyword
        .iter()
        .enumerate()
        .map(|(i, r)| (r.chunk_id, i + 1))
        .collect();

    eprintln!("\n=== RRF breakdown (top {top_n} fused chunks) ===\n");
    eprintln!(
        "Per-ranker list sizes:  semantic={}  bm25={}  ilike={}",
        bd.semantic.len(),
        bd.bm25.len(),
        bd.keyword.len()
    );
    eprintln!();

    let now_secs = Utc::now().timestamp() as f32;

    let mut table = Table::new();
    table.set_header(vec![
        Cell::new("fused#"),
        Cell::new("chunk_id"),
        Cell::new("sem"),
        Cell::new("bm25"),
        Cell::new("ilike"),
        Cell::new("RRF (raw)"),
        Cell::new("age (d)"),
        Cell::new("boosted"),
        Cell::new("contact"),
        Cell::new("preview"),
    ]);

    let union_chunks: BTreeSet<i64> = bd.fused.iter().take(top_n).map(|r| r.chunk_id).collect();

    for (i, r) in bd.fused.iter().take(top_n).enumerate() {
        let s = semantic_rank.get(&r.chunk_id);
        let b = bm25_rank.get(&r.chunk_id);
        let k = keyword_rank.get(&r.chunk_id);

        let s_term = s.map(|r| 1.0 / (K + *r as f32)).unwrap_or(0.0);
        let b_term = b.map(|r| 1.0 / (K + *r as f32)).unwrap_or(0.0);
        let k_term = k.map(|r| 1.0 / (K + *r as f32)).unwrap_or(0.0);
        let rrf = s_term + b_term + k_term;

        let breakdown_str = format!(
            "{:.5} = {} + {} + {}",
            rrf,
            fmt_term(s, s_term),
            fmt_term(b, b_term),
            fmt_term(k, k_term),
        );

        let age_days = ((now_secs - r.end_timestamp.timestamp() as f32) / 86400.0).max(0.0);
        let recency_boost = 1.0 / (1.0 + 0.01 * age_days);
        let boosted = rrf * recency_boost;

        let name = r.contact_name.as_deref().unwrap_or(&r.contact_id);
        let preview = r
            .chunk_data
            .formatted
            .replace('\n', " | ")
            .chars()
            .take(70)
            .collect::<String>();

        table.add_row(vec![
            Cell::new(i + 1),
            Cell::new(r.chunk_id),
            Cell::new(s.map(|r| r.to_string()).unwrap_or_else(|| "—".into())),
            Cell::new(b.map(|r| r.to_string()).unwrap_or_else(|| "—".into())),
            Cell::new(k.map(|r| r.to_string()).unwrap_or_else(|| "—".into())),
            Cell::new(breakdown_str),
            Cell::new(format!("{:.0}", age_days)),
            Cell::new(format!("{:.5}", boosted)),
            Cell::new(name).fg(Color::Cyan),
            Cell::new(preview),
        ]);
    }

    eprintln!("{table}");

    // Full-text dump of the fused top-N chunks (no truncation)
    eprintln!("\n--- full chunk text (fused top {top_n}) ---");
    for (i, r) in bd.fused.iter().take(top_n).enumerate() {
        let name = r.contact_name.as_deref().unwrap_or(&r.contact_id);
        eprintln!(
            "\n[fused #{} | chunk_id={} | {} | {}]\n{}",
            i + 1,
            r.chunk_id,
            name,
            r.end_timestamp.format("%Y-%m-%d"),
            r.chunk_data.formatted
        );
    }
    eprintln!();

    // Also print any chunks that were top-N in a single ranker but missed the fused top-N
    let mut singletons: Vec<(&'static str, &SearchResult, usize)> = Vec::new();
    for (i, r) in bd.semantic.iter().take(top_n).enumerate() {
        if !union_chunks.contains(&r.chunk_id) {
            singletons.push(("semantic", r, i + 1));
        }
    }
    for (i, r) in bd.bm25.iter().take(top_n).enumerate() {
        if !union_chunks.contains(&r.chunk_id) {
            singletons.push(("bm25", r, i + 1));
        }
    }
    for (i, r) in bd.keyword.iter().take(top_n).enumerate() {
        if !union_chunks.contains(&r.chunk_id) {
            singletons.push(("ilike", r, i + 1));
        }
    }

    if !singletons.is_empty() {
        eprintln!("\nChunks in a single ranker's top-{top_n} that did NOT make the fused top-{top_n}:");
        for (src, r, rank) in singletons.iter().take(8) {
            let preview = r
                .chunk_data
                .formatted
                .replace('\n', " | ")
                .chars()
                .take(60)
                .collect::<String>();
            eprintln!("  [{src} rank {rank}] chunk_id={} :: {preview}", r.chunk_id);
        }
    }

    eprintln!("\n=== end breakdown ===\n");
}

fn fmt_term(rank: Option<&usize>, value: f32) -> String {
    match rank {
        Some(r) => format!("1/{}={:.5}", 60 + r, value),
        None => "0".to_string(),
    }
}

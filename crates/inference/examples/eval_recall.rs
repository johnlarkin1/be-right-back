//! Retrieval recall eval over the synthetic corpus.
//!
//! Answers "is the right chunk actually being retrieved" with a number, against
//! authored gold (`synthetic/world/gold.jsonl`, resolved to stable iMessage
//! ROWIDs by `make synthetic-build`).
//!
//! Two things make the number mean something:
//!
//! *   **It drives the real surface.** `SearchMessagesTool::ranked` is the exact
//!     path Casper searches through, so planner, embedding fusion, MMR, the
//!     contact-diversity penalty and the recency boost are all exercised as
//!     shipped. Reassembling the pipeline here would measure the reassembly.
//! *   **The clock is pinned.** Every time-dependent stage resolves against
//!     `frozen_now` from the build manifest, so a corpus with fixed timestamps
//!     scores the same tomorrow. Without it the recency term drifts daily and
//!     temporal strata quietly stop meaning anything.
//!
//! Gold is a set of `message_id`s scored as *message coverage*: a hit is the gold
//! message appearing in any surviving retrieved chunk. With overlapping chunks
//! (stride < window) one message sits in several chunks, and MMR is designed to thin
//! them -- counting those as independent gold would measure dedup, not retrieval.
//!
//! Run from the repo root. `make eval-corpus` builds the corpus this scores
//! against, into its own DuckDB so a dev machine's real one is never touched.
//!
//!   make eval-corpus          # once, and after any change to synthetic/world/
//!   make eval-recall          # the loop
//!   BRB_EVAL_BLESS=1 make eval-recall   # accept the new ranks
//!
//! Exits non-zero if any query ranks worse than `eval/retrieval/baseline.json`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::process::ExitCode;

use chrono::{DateTime, Utc};
use inference::agent::builtin::SearchMessagesTool;
use ingestion::{ChunkData, VectorDb};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Where `make synthetic-build` leaves the gold set and the manifest. Override
/// with `--gold-dir` to score a corpus built at another size or anchor -- gold
/// re-resolves to fresh ROWIDs on every build, so it must travel with the
/// database it was resolved against.
const DEFAULT_GOLD_DIR: &str = "synthetic/build";
const CAST_PATH: &str = "synthetic/world/cast.json";
const BASELINE_PATH: &str = "eval/retrieval/baseline.json";
const EMBED_CACHE_PATH: &str = "eval/retrieval/query-embeddings.json";

/// One gold query, as emitted by `brb_synthetic.build.write_sidecars`.
#[derive(Debug, Deserialize)]
struct GoldRecord {
    id: String,
    query: String,
    stratum: String,
    gold_message_ids: Vec<i64>,
    #[serde(default)]
    contact_scope: Option<String>,
    #[serde(default)]
    gold_contacts: Option<Vec<String>>,
    k: usize,
    metric: String,
}

/// What one query scored.
#[derive(Debug, Serialize)]
struct Scored {
    id: String,
    stratum: String,
    metric: String,
    /// 1-indexed rank of the first result covering a gold message; `None` = miss.
    rank: Option<usize>,
    /// Fraction of `gold_contacts` represented in the top-k. `None` unless cross-contact.
    contact_recall: Option<f64>,
    returned: usize,
}

/// Committed per-query ranks, so a regression names the query that moved.
///
/// Aggregate thresholds are the wrong gate at n=19 -- recall@k moves in steps of
/// 1/19 and any tolerance is either untrippable or permanently flaky. A per-query
/// rank diff is exact.
#[derive(Debug, Serialize, Deserialize)]
struct Baseline {
    embed_model: String,
    frozen_now: String,
    /// query id -> rank (0 encodes a miss, so the file stays plain JSON numbers)
    ranks: BTreeMap<String, usize>,
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("\x1b[31merror:\x1b[0m {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode, String> {
    let db_path = parse_db_arg()?;

    // The DuckDB schema is defined in Rust only; `mlx/src/entry/embed.py` assumes
    // the tables already exist because production always opens the database from
    // Rust first. Building an eval corpus at a fresh path has no such step, so
    // offer one here rather than teaching Python a second copy of the schema.
    if std::env::args().any(|a| a == "--init") {
        VectorDb::open_at(&db_path)
            .and_then(|db| db.initialize())
            .map_err(|e| format!("initialize {}: {e}", db_path.display()))?;
        println!("initialized empty schema at {}", db_path.display());
        return Ok(ExitCode::SUCCESS);
    }

    let gold_dir = PathBuf::from(flag("--gold-dir").unwrap_or_else(|| DEFAULT_GOLD_DIR.to_string()));
    let manifest_path = gold_dir.join("build-manifest.json");
    let manifest: Value = read_json(&manifest_path)?;
    let frozen_now = manifest
        .get("frozen_now")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            format!(
                "{} has no `frozen_now` -- rebuild the corpus with `make synthetic-build`",
                manifest_path.display()
            )
        })?
        .to_string();
    let now: DateTime<Utc> = frozen_now
        .parse::<DateTime<Utc>>()
        .map_err(|e| format!("unparseable frozen_now {frozen_now:?}: {e}"))?;

    let gold = read_gold(&gold_dir)?;
    let contact_names = read_contact_names()?;

    let db = VectorDb::open_readonly_at(&db_path).map_err(|e| format!("open {}: {e}", db_path.display()))?;
    let chunk_count = db.get_chunk_count().map_err(|e| e.to_string())?;
    assert_gold_resolvable(&db, &gold)?;
    drop(db);

    let embeddings = embed_queries(&gold)?;

    let tool = SearchMessagesTool::new()
        .with_now(now)
        .with_db_path(&db_path)
        .with_contact_names(contact_names);

    println!("db          {} ({chunk_count} chunks)", db_path.display());
    println!("now         {} (frozen, from build manifest)", now.to_rfc3339());
    println!("surface     agent -- min_similarity 0.25, MMR on, contact penalty Standard, rerank off");
    println!(
        "embeddings  {} ({} queries)\n",
        common::DEFAULT_MLX_EMBEDDING_MODEL,
        gold.len()
    );

    let explain = std::env::args().any(|a| a == "--explain");
    if explain {
        println!("per-stage rank of gold (semantic = raw cosine, fused = +BM25 +recency):");
    }

    let mut scored = Vec::with_capacity(gold.len());
    for record in &gold {
        let mut args = json!({
            "query": record.query,
            "_embedding": embeddings[&record.query],
            "limit": record.k,
        });
        if let Some(cid) = &record.contact_scope {
            args["contact_id"] = json!(cid);
        }

        let ranked = tool
            .ranked(&args)
            .map_err(|e| format!("{}: search failed: {e}", record.id))?;

        let gold_ids: HashSet<i64> = record.gold_message_ids.iter().copied().collect();
        let rank = ranked
            .results
            .iter()
            .position(|r| r.chunk_data.messages.iter().any(|m| gold_ids.contains(&m.message_id)))
            .map(|i| i + 1);

        // Cross-contact asks a different question: not "is the answer here" but
        // "did the search reach across everyone who knows". Breadth, not position.
        let contact_recall = record.gold_contacts.as_ref().map(|wanted| {
            let found: HashSet<&str> = ranked.results.iter().map(|r| r.contact_id.as_str()).collect();
            let hits = wanted.iter().filter(|c| found.contains(c.as_str())).count();
            hits as f64 / wanted.len() as f64
        });

        if explain {
            explain_query(record, &db_path, &embeddings[&record.query], now, &gold_ids, rank)?;
        }

        scored.push(Scored {
            id: record.id.clone(),
            stratum: record.stratum.clone(),
            metric: record.metric.clone(),
            rank,
            contact_recall,
            returned: ranked.results.len(),
        });
    }

    report(&scored);
    compare_baseline(&scored, &frozen_now)
}

/// Attribute one query's outcome to a stage, by comparing gold's rank in the raw
/// semantic list against its rank after fusion.
///
/// `semantic` is pure cosine (exact in-memory scan). `fused` is that merged with
/// BM25 through RRF -- and, critically, multiplied by the always-on recency term
/// in `rrf_merge`. Gold ranking well in `semantic` and badly in `fused` means the
/// embedder found it and the merge buried it, which is a completely different bug
/// from the embedder never finding it at all.
///
/// Ages are printed because the recency multiplier is a function of age alone:
/// if the result that displaced gold is consistently newer, that is the mechanism.
fn explain_query(
    record: &GoldRecord,
    db_path: &std::path::Path,
    embedding: &[f32],
    now: DateTime<Utc>,
    gold_ids: &HashSet<i64>,
    final_rank: Option<usize>,
) -> Result<(), String> {
    let db = VectorDb::open_readonly_at(db_path).map_err(|e| e.to_string())?;
    let mut options = ingestion::SearchOptions::new()
        .with_limit(record.k)
        .with_min_similarity(0.25)
        .with_query_text(&record.query)
        .with_embeddings()
        .with_now(now);
    if let Some(cid) = &record.contact_scope {
        options = options.with_contact(cid);
    }

    let breakdown = db
        .hybrid_search_breakdown(embedding, options)
        .map_err(|e| format!("{}: breakdown failed: {e}", record.id))?;

    // The same semantic search with the similarity floor removed. The agent
    // surface drops anything under cosine 0.25, so a gold chunk the embedder
    // ranked perfectly well can still vanish before fusion ever sees it. If gold
    // is a miss at 0.25 and a hit at 0.0, the floor is the bug -- not recall.
    let mut unfiltered = ingestion::SearchOptions::new()
        .with_limit(record.k)
        .with_min_similarity(0.0)
        .with_query_text(&record.query)
        .with_embeddings()
        .with_now(now);
    if let Some(cid) = &record.contact_scope {
        unfiltered = unfiltered.with_contact(cid);
    }
    let open_floor = db
        .hybrid_search_breakdown(embedding, unfiltered)
        .map_err(|e| format!("{}: breakdown failed: {e}", record.id))?;

    let rank_of = |list: &[ingestion::SearchResult]| {
        list.iter()
            .position(|r| r.chunk_data.messages.iter().any(|m| gold_ids.contains(&m.message_id)))
            .map(|i| i + 1)
    };
    let age = |r: &ingestion::SearchResult| (now - r.end_timestamp).num_days();
    let show = |r: Option<usize>| r.map_or("miss".to_string(), |v| v.to_string());

    let gold_age = breakdown
        .semantic
        .iter()
        .chain(&breakdown.fused)
        .find(|r| r.chunk_data.messages.iter().any(|m| gold_ids.contains(&m.message_id)))
        .map(age);

    println!(
        "  {:<12} sem {:>4}  sem@0 {:>4}  bm25 {:>4}  fused {:>4}  final {:>4}   gold_age {:>4}d  top1_age {:>4}d",
        record.id,
        show(rank_of(&breakdown.semantic)),
        show(rank_of(&open_floor.semantic)),
        show(rank_of(&breakdown.bm25)),
        show(rank_of(&breakdown.fused)),
        show(final_rank),
        gold_age.map_or("?".to_string(), |d| d.to_string()),
        breakdown.fused.first().map_or("?".to_string(), |r| age(r).to_string()),
    );
    Ok(())
}

/// Check that gold survives the trip from ROWID to chunk.
///
/// A query whose gold is *entirely* unindexed is unscoreable and fails the run --
/// otherwise a wrong database, or one that was never re-ingested, scores every
/// query 0 and reads as a total retrieval regression, which is the most expensive
/// possible way to learn you pointed at the wrong file.
///
/// Partially-indexed gold is a different thing and is only reported: message
/// coverage counts a hit if *any* gold message is retrieved, so the query stays
/// scoreable, just harder. It usually means the corpus contains something the
/// pipeline deliberately drops (group chats, filtered by `room_name IS NULL`
/// throughout `messages-db`), which is worth seeing rather than crashing on.
fn assert_gold_resolvable(db: &VectorDb, gold: &[GoldRecord]) -> Result<(), String> {
    let wanted: HashSet<i64> = gold.iter().flat_map(|g| g.gold_message_ids.iter().copied()).collect();

    let mut present = HashSet::new();
    let mut stmt = db
        .connection()
        .prepare("SELECT chunk_data::VARCHAR FROM message_chunks")
        .map_err(|e| format!("prepare resolver query: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("run resolver query: {e}"))?;
    for raw in rows.flatten() {
        if let Ok(data) = serde_json::from_str::<ChunkData>(&raw) {
            for m in data.messages {
                if wanted.contains(&m.message_id) {
                    present.insert(m.message_id);
                }
            }
        }
    }

    let unscoreable: Vec<&str> = gold
        .iter()
        .filter(|g| !g.gold_message_ids.iter().any(|m| present.contains(m)))
        .map(|g| g.id.as_str())
        .collect();
    if !unscoreable.is_empty() {
        return Err(format!(
            "gold unresolvable: {} of {} queries have no gold message in any chunk ({}).\n\
             The database being searched is not the synthetic corpus, or it predates the \
             current build. Fix with:\n  make synthetic-install && brb ingest",
            unscoreable.len(),
            gold.len(),
            unscoreable.join(", ")
        ));
    }

    for g in gold {
        let dropped: Vec<i64> = g
            .gold_message_ids
            .iter()
            .copied()
            .filter(|m| !present.contains(m))
            .collect();
        if !dropped.is_empty() {
            println!(
                "\x1b[33mnote\x1b[0m {} scores on partial gold: message_id {:?} is indexed nowhere",
                g.id, dropped
            );
        }
    }
    Ok(())
}

/// Embed every gold query, caching to disk.
///
/// `embed_query` cold-loads ModernBERT per call (~3s), which turns a 19-query run
/// into a minute of model loading and an eval loop nobody runs twice. The cache is
/// keyed by embedding model so swapping it invalidates rather than silently
/// scoring old vectors against a new index.
fn embed_queries(gold: &[GoldRecord]) -> Result<HashMap<String, Vec<f32>>, String> {
    #[derive(Serialize, Deserialize)]
    struct Cache {
        embed_model: String,
        queries: HashMap<String, Vec<f32>>,
    }

    let mut cache = match std::fs::read_to_string(EMBED_CACHE_PATH).ok().and_then(|raw| {
        serde_json::from_str::<Cache>(&raw)
            .ok()
            .filter(|c| c.embed_model == common::DEFAULT_MLX_EMBEDDING_MODEL)
    }) {
        Some(c) => c,
        None => Cache {
            embed_model: common::DEFAULT_MLX_EMBEDDING_MODEL.to_string(),
            queries: HashMap::new(),
        },
    };

    let missing: Vec<&str> = gold
        .iter()
        .map(|g| g.query.as_str())
        .filter(|q| !cache.queries.contains_key(*q))
        .collect();

    for (i, query) in missing.iter().enumerate() {
        eprintln!("embedding {}/{}: {query}", i + 1, missing.len());
        let vector = ingestion::embed_query(query).map_err(|e| format!("embed {query:?}: {e}"))?;
        cache.queries.insert((*query).to_string(), vector);
    }

    if !missing.is_empty() {
        write_json(EMBED_CACHE_PATH, &cache)?;
    }
    Ok(cache.queries)
}

fn report(scored: &[Scored]) {
    let mut by_stratum: BTreeMap<&str, Vec<&Scored>> = BTreeMap::new();
    for s in scored {
        by_stratum.entry(&s.stratum).or_default().push(s);
    }

    println!(
        "{:<15} {:>3}  {:>6} {:>6} {:>6} {:>7}  {:>6}",
        "stratum", "n", "hit@1", "hit@3", "hit@5", "hit@10", "MRR"
    );
    for (stratum, rows) in &by_stratum {
        print_row(stratum, rows);
    }
    println!();
    print_row("overall", &scored.iter().collect::<Vec<_>>());

    let cross: Vec<&Scored> = scored.iter().filter(|s| s.contact_recall.is_some()).collect();
    if !cross.is_empty() {
        let mean = cross.iter().filter_map(|s| s.contact_recall).sum::<f64>() / cross.len() as f64;
        println!(
            "\ncontact_recall@k  {mean:.3}  (n={}, cross-contact breadth)",
            cross.len()
        );
    }

    let misses: Vec<&Scored> = scored.iter().filter(|s| s.rank.is_none()).collect();
    if !misses.is_empty() {
        println!("\nmisses ({}):", misses.len());
        for m in misses {
            println!(
                "  {:<12} {:<16} {} results returned, no gold",
                m.id, m.stratum, m.returned
            );
        }
    }

    // "the right answer at rank 2" is a failure for these: the agent presents
    // result[0] as the answer, so anything below the top is the wrong answer.
    let rank1: Vec<&Scored> = scored.iter().filter(|s| s.metric == "rank_of_argmax@1").collect();
    let rank1_wrong: Vec<&&Scored> = rank1.iter().filter(|s| s.rank != Some(1)).collect();
    if !rank1.is_empty() {
        println!(
            "\nrank1_accuracy    {:.3}  (n={}, superlative/recency -- rank 2 is a wrong answer)",
            (rank1.len() - rank1_wrong.len()) as f64 / rank1.len() as f64,
            rank1.len()
        );
        for s in rank1_wrong {
            println!("  {:<12} gold at rank {:?}", s.id, s.rank);
        }
    }
}

fn print_row(label: &str, rows: &[&Scored]) {
    let n = rows.len() as f64;
    let hit = |k: usize| rows.iter().filter(|s| s.rank.is_some_and(|r| r <= k)).count() as f64 / n;
    // `+ 0.0` normalizes negative zero, which prints as "-0.000" and reads like a bug.
    let mrr = rows.iter().filter_map(|s| s.rank).map(|r| 1.0 / r as f64).sum::<f64>() / n + 0.0;
    println!(
        "{:<15} {:>3}  {:>6.3} {:>6.3} {:>6.3} {:>7.3}  {:>6.3}",
        label,
        rows.len(),
        hit(1),
        hit(3),
        hit(5),
        hit(10),
        mrr
    );
}

fn compare_baseline(scored: &[Scored], frozen_now: &str) -> Result<ExitCode, String> {
    let current = Baseline {
        embed_model: common::DEFAULT_MLX_EMBEDDING_MODEL.to_string(),
        frozen_now: frozen_now.to_string(),
        ranks: scored.iter().map(|s| (s.id.clone(), s.rank.unwrap_or(0))).collect(),
    };

    if std::env::var("BRB_EVAL_BLESS").is_ok() {
        write_json(BASELINE_PATH, &current)?;
        println!("\n\x1b[33mblessed\x1b[0m {BASELINE_PATH}");
        return Ok(ExitCode::SUCCESS);
    }

    let previous: Baseline = match std::fs::read_to_string(BASELINE_PATH) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("parse {BASELINE_PATH}: {e}"))?,
        Err(_) => {
            write_json(BASELINE_PATH, &current)?;
            println!("\n\x1b[33mwrote initial baseline\x1b[0m {BASELINE_PATH} -- review and commit it");
            return Ok(ExitCode::SUCCESS);
        }
    };

    // An embedder swap invalidates every committed rank. Say so rather than
    // reporting a 19-query regression.
    if previous.embed_model != current.embed_model {
        return Err(format!(
            "baseline was blessed under {} but this run used {}. Re-bless with BRB_EVAL_BLESS=1.",
            previous.embed_model, current.embed_model
        ));
    }

    // A miss (0) is worse than any rank, so compare on a key that sorts that way.
    let severity = |rank: usize| if rank == 0 { usize::MAX } else { rank };
    let mut worse = Vec::new();
    let mut better = Vec::new();
    for (id, &rank) in &current.ranks {
        match previous.ranks.get(id) {
            Some(&was) if severity(rank) > severity(was) => worse.push((id, was, rank)),
            Some(&was) if severity(rank) < severity(was) => better.push((id, was, rank)),
            Some(_) => {}
            None => println!("\n\x1b[33mnew query\x1b[0m {id} (rank {rank}) -- bless to record it"),
        }
    }

    let show = |(id, was, now): &(&String, usize, usize)| {
        let fmt = |r: usize| if r == 0 { "miss".to_string() } else { r.to_string() };
        format!("  {:<12} {} -> {}", id, fmt(*was), fmt(*now))
    };

    if !better.is_empty() {
        println!("\n\x1b[32mimproved ({}):\x1b[0m", better.len());
        better.iter().for_each(|d| println!("{}", show(d)));
    }
    if !worse.is_empty() {
        println!("\n\x1b[31mregressed ({}):\x1b[0m", worse.len());
        worse.iter().for_each(|d| println!("{}", show(d)));
        println!("\nIf this is intentional, re-bless: BRB_EVAL_BLESS=1 cargo run -p inference --example eval_recall");
        return Ok(ExitCode::FAILURE);
    }
    if better.is_empty() {
        println!("\n\x1b[32mno change\x1b[0m vs {BASELINE_PATH}");
    }
    Ok(ExitCode::SUCCESS)
}

fn parse_db_arg() -> Result<PathBuf, String> {
    let args: Vec<String> = std::env::args().collect();
    match args.iter().position(|a| a == "--db") {
        Some(i) => args
            .get(i + 1)
            .map(PathBuf::from)
            .ok_or_else(|| "--db needs a path".to_string()),
        None => common::get_brb_duckdb_db().map_err(|e| e.to_string()),
    }
}

fn read_gold(gold_dir: &std::path::Path) -> Result<Vec<GoldRecord>, String> {
    let path = gold_dir.join("gold.resolved.jsonl");
    let name = path.display();
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("{name}: {e} -- run `make synthetic-build` first"))?;
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<GoldRecord>(l).map_err(|e| format!("{name}: {e}")))
        .collect()
}

/// Value of a `--flag <value>` argument, if present.
fn flag(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

/// Display names straight from the world manifest.
///
/// The tool otherwise reads the canonical `brb.db`, which on a dev machine holds
/// real contacts -- a synthetic id colliding with a real one would silently borrow
/// a real person's name into the eval.
fn read_contact_names() -> Result<HashMap<String, String>, String> {
    let cast: Value = read_json(CAST_PATH)?;
    let contacts = cast
        .get("contacts")
        .and_then(|c| c.as_array())
        .ok_or_else(|| format!("{CAST_PATH}: no contacts array"))?;
    Ok(contacts
        .iter()
        .filter_map(|c| {
            Some((
                c.get("identifier")?.as_str()?.to_string(),
                c.get("name")?.as_str()?.to_string(),
            ))
        })
        .collect())
}

fn read_json(path: impl AsRef<std::path::Path>) -> Result<Value, String> {
    let path = path.as_ref();
    let raw = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_json<T: Serialize>(path: &str, value: &T) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{path}: {e}"))?;
    }
    let body = serde_json::to_string_pretty(value).map_err(|e| format!("{path}: {e}"))?;
    std::fs::write(path, body + "\n").map_err(|e| format!("{path}: {e}"))
}

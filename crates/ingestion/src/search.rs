//! RAG search with hybrid retrieval (semantic + BM25), Reciprocal Rank Fusion,
//! and Maximal Marginal Relevance deduplication.
//!
//! This module provides:
//! - Semantic search via vector similarity (cosine distance)
//! - BM25 full-text search via DuckDB's FTS extension
//! - Hybrid search combining both with Reciprocal Rank Fusion (RRF)
//! - MMR-based deduplication for diverse, non-redundant results

use crate::queries;
use crate::vectordb::{ChunkData, VectorDb};
use chrono::{DateTime, Utc};
use common::{BrbError, Result};
use duckdb::params_from_iter;
use duckdb::types::Value;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tracing::debug;

/// Result of a search query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: i64,
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub chunk_data: ChunkData,
    pub message_ids: Vec<i64>,
    pub start_timestamp: DateTime<Utc>,
    pub end_timestamp: DateTime<Utc>,
    /// Combined relevance score (from RRF or raw similarity)
    pub similarity: f32,
    /// Optional embedding vector (populated when include_embeddings is true)
    #[serde(skip)]
    pub embedding: Option<Vec<f32>>,
}

/// Per-ranker breakdown for debugging RRF behavior.
///
/// Each list is ordered by that ranker's own scoring (semantic by cosine,
/// BM25 by FTS score, keyword by recency). The `fused` list is the result
/// of running `rrf_merge` over all three.
#[derive(Debug)]
pub struct HybridSearchBreakdown {
    pub semantic: Vec<SearchResult>,
    pub bm25: Vec<SearchResult>,
    pub keyword: Vec<SearchResult>,
    pub fused: Vec<SearchResult>,
}

/// How hard to suppress repeated results from the same contact.
///
/// Two penalty sites exist and they disagree: the standalone pass fires from the
/// 3rd result with `0.5^(n-2)`, the MMR inline pass from the 2nd with `0.5^(n-1)`.
/// Only the MMR site runs on shipped surfaces, because both set
/// `include_embeddings`. This flag governs both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContactDiversity {
    /// What ships: penalize repeated hits from one contact.
    #[default]
    Standard,
    /// No penalty at either site.
    ///
    /// For **single-contact corpora only**. A public benchmark whose whole history
    /// belongs to one synthetic contact would otherwise have every result past the
    /// second penalized, cratering recall for reasons that have nothing to do with
    /// retrieval quality. Any measurement taken with this set must say so — see
    /// `eval/longmemeval/README.md`.
    Off,
}

/// Options for configuring search behavior
#[derive(Default)]
pub struct SearchOptions {
    /// Filter to a specific contact (None = search all contacts)
    pub contact_id: Option<String>,
    /// Only return results after this date
    pub min_date: Option<DateTime<Utc>>,
    /// Only return results before this date
    pub max_date: Option<DateTime<Utc>>,
    /// Maximum number of results to return (default: 10)
    pub limit: usize,
    /// Minimum similarity threshold (0.0 to 1.0, default: 0.0)
    pub min_similarity: f32,
    /// Query text for BM25 search (used in hybrid mode)
    pub query_text: Option<String>,
    /// Whether to include embedding vectors in results (for MMR)
    pub include_embeddings: bool,
    /// Whether to apply cross-encoder reranking after retrieval (default: false).
    ///
    /// When enabled, takes the top candidates after hybrid search + deduplication,
    /// passes them through a cross-encoder model for precise relevance scoring,
    /// and returns results sorted by cross-encoder score.
    ///
    /// Adds ~50-150ms latency for 30 candidates. Requires Python environment
    /// with sentence-transformers installed. Falls back to unreranked results
    /// if reranking fails.
    pub rerank: bool,
    /// Superlative intent ("last/latest" vs "first/oldest"). When set, retrieval
    /// gates by relevance then hard-sorts the pool by `end_timestamp` in this
    /// direction, bypassing the soft recency boost. Set from the query planner;
    /// `None` for ordinary queries.
    pub superlative: Option<crate::query_planner::SortDirection>,
    /// Optional external reranker. When set, used instead of subprocess reranking.
    pub reranker: Option<RerankerFn>,
    /// Reference "now" for age-dependent scoring. `None` (the default) means the
    /// real wall clock.
    ///
    /// Search is not time-invariant: the RRF recency term weights every result by
    /// its age. Evaluation needs that clock pinned, or a fixture with fixed
    /// timestamps drifts a little further from its expected ranking every day and
    /// temporal assertions quietly stop meaning anything. Set this to the same
    /// instant passed to [`crate::query_planner::plan_search_with_now`] so the
    /// planner and the scorer agree on what "recent" is.
    pub now: Option<DateTime<Utc>>,
    /// Whether to penalize repeated results from the same contact. Defaults to
    /// [`ContactDiversity::Standard`], which is what ships.
    pub contact_diversity: ContactDiversity,
}

/// Scores `(chunk_id, text)` candidates against a query, returning `None` if reranking fails.
///
/// Boxed so callers can supply an in-process reranker instead of the Python subprocess.
pub type RerankerFn = Box<dyn Fn(&str, &[(i64, String)]) -> Option<Vec<crate::rerank::RerankScore>> + Send>;

impl SearchOptions {
    pub fn new() -> Self {
        Self {
            limit: 10,
            ..Default::default()
        }
    }

    /// Filter results to a specific contact
    pub fn with_contact(mut self, contact_id: impl Into<String>) -> Self {
        self.contact_id = Some(contact_id.into());
        self
    }

    /// Set the maximum number of results
    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = limit;
        self
    }

    /// Set minimum similarity threshold
    pub fn with_min_similarity(mut self, min_similarity: f32) -> Self {
        self.min_similarity = min_similarity;
        self
    }

    /// Pin the reference "now" used by age-dependent scoring (see [`SearchOptions::now`]).
    ///
    /// Pass the same instant used for [`crate::query_planner::plan_search_with_now`].
    pub fn with_now(mut self, now: DateTime<Utc>) -> Self {
        self.now = Some(now);
        self
    }

    /// The reference instant for age-dependent scoring: the pinned clock if the
    /// caller set one, otherwise the wall clock.
    pub fn reference_now(&self) -> DateTime<Utc> {
        self.now.unwrap_or_else(Utc::now)
    }

    /// Set whether repeated results from one contact are penalized.
    ///
    /// Only [`ContactDiversity::Off`] changes behavior, and only single-contact
    /// corpora should use it — see [`ContactDiversity`].
    pub fn with_contact_diversity(mut self, diversity: ContactDiversity) -> Self {
        self.contact_diversity = diversity;
        self
    }

    /// Filter results to a date range
    pub fn with_date_range(mut self, min_date: Option<DateTime<Utc>>, max_date: Option<DateTime<Utc>>) -> Self {
        self.min_date = min_date;
        self.max_date = max_date;
        self
    }

    /// Set query text for BM25/hybrid search
    pub fn with_query_text(mut self, text: impl Into<String>) -> Self {
        self.query_text = Some(text.into());
        self
    }

    /// Request embedding vectors in results (for MMR reranking)
    pub fn with_embeddings(mut self) -> Self {
        self.include_embeddings = true;
        self
    }

    /// Enable cross-encoder reranking for more precise result ordering.
    ///
    /// Requires `query_text` to be set (the cross-encoder needs the original
    /// query string, not just the embedding vector).
    pub fn with_rerank(mut self) -> Self {
        self.rerank = true;
        self
    }

    /// Set an external reranker closure, used instead of subprocess reranking.
    pub fn with_reranker(
        mut self,
        f: impl Fn(&str, &[(i64, String)]) -> Option<Vec<crate::rerank::RerankScore>> + Send + 'static,
    ) -> Self {
        self.reranker = Some(Box::new(f));
        self
    }

    /// Set superlative sort direction (newest/oldest). When set, retrieval gates
    /// by relevance then hard-sorts by recency in this direction.
    pub fn with_superlative(mut self, dir: Option<crate::query_planner::SortDirection>) -> Self {
        self.superlative = dir;
        self
    }
}

impl std::fmt::Debug for SearchOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchOptions")
            .field("contact_id", &self.contact_id)
            .field("min_date", &self.min_date)
            .field("max_date", &self.max_date)
            .field("limit", &self.limit)
            .field("min_similarity", &self.min_similarity)
            .field("query_text", &self.query_text)
            .field("include_embeddings", &self.include_embeddings)
            .field("rerank", &self.rerank)
            .field("superlative", &self.superlative)
            .field("reranker", &self.reranker.as_ref().map(|_| ".."))
            .finish()
    }
}

impl VectorDb {
    /// Hybrid search combining semantic similarity and BM25 full-text search.
    ///
    /// Uses Reciprocal Rank Fusion (RRF) to merge results from both retrieval
    /// paths, then applies MMR deduplication for diverse results.
    ///
    /// Falls back to semantic-only search if BM25 is unavailable (no FTS index).
    pub fn hybrid_search(&self, query_embedding: &[f32], options: SearchOptions) -> Result<Vec<SearchResult>> {
        // Single-vector path is the one-element special case of multi-vector.
        let embeddings = [query_embedding.to_vec()];
        self.hybrid_search_multi(&embeddings, options)
    }

    /// Hybrid search over multiple query embeddings (multi-vector RRF fusion).
    ///
    /// Each embedding contributes its own semantic candidate list; BM25 + keyword
    /// are computed once from `options.query_text`. All lists are merged with RRF.
    /// `query_embeddings[0]` is the primary vector (used for MMR diversification).
    /// [`hybrid_search`](Self::hybrid_search) is the single-embedding special case
    /// and is byte-for-byte equivalent to passing a one-element slice here.
    pub fn hybrid_search_multi(
        &self,
        query_embeddings: &[Vec<f32>],
        options: SearchOptions,
    ) -> Result<Vec<SearchResult>> {
        // Superlative queries need a wide recall pool so the chronologically
        // extreme (but possibly weakly-similar) match is actually fetched.
        let fetch_limit = if options.superlative.is_some() {
            (options.limit * 20).clamp(200, 500)
        } else {
            options.limit * 3
        };

        let primary: &[f32] = query_embeddings.first().map(|v| v.as_slice()).unwrap_or(&[]);

        // 1. Semantic search per embedding
        let mut lists: Vec<Vec<SearchResult>> = Vec::with_capacity(query_embeddings.len() + 2);
        for emb in query_embeddings {
            lists.push(self.search_raw(emb, fetch_limit, &options)?);
        }

        // 2. BM25 (best-effort) + keyword (ILIKE), computed once from query_text
        if let Some(ref text) = options.query_text {
            match self.bm25_search_raw(text, fetch_limit, &options) {
                Ok(results) => lists.push(results),
                Err(e) => debug!(error = %e, "BM25 search unavailable, using semantic only"),
            }
            let keywords = extract_content_keywords(text);
            if !keywords.is_empty() {
                lists.push(self.keyword_search(&keywords, &options).unwrap_or_default());
            }
        }

        debug!(
            embeddings = query_embeddings.len(),
            lists = lists.len(),
            fetch_limit = fetch_limit,
            superlative = ?options.superlative,
            "Hybrid search retrieval complete"
        );

        // 3. Reciprocal Rank Fusion (N-way). Recency-neutral for superlative
        //    (the hard time-sort in fuse_and_rerank owns ordering there).
        let fused = rrf_merge(lists, fetch_limit, options.superlative, options.reference_now());

        // 4-6. MMR/dedup -> optional cross-encoder rerank -> (superlative) time-sort
        Ok(self.fuse_and_rerank(fused, primary, &options))
    }

    /// Dedup/MMR + optional cross-encoder rerank over a fused candidate list.
    ///
    /// For superlative queries, the whole pool is carried through dedup (so the
    /// chrono-extreme hit can't be dropped), the cross-encoder only establishes
    /// the relevance order used as a filter, and `superlative_finalize` performs
    /// the hard recency sort.
    fn fuse_and_rerank(
        &self,
        fused: Vec<SearchResult>,
        query_embedding: &[f32],
        options: &SearchOptions,
    ) -> Vec<SearchResult> {
        let dedup_limit = if options.superlative.is_some() {
            fused.len().max(options.limit)
        } else if options.rerank {
            // Over-fetch for reranking: more candidates, let cross-encoder pick.
            (options.limit * 3).max(30)
        } else {
            options.limit
        };

        let mut results = if options.include_embeddings {
            mmr_rerank(fused, query_embedding, dedup_limit, 0.7, options.contact_diversity)
        } else {
            let deduped = deduplicate_chunks(fused, dedup_limit, options.min_similarity);
            match options.contact_diversity {
                ContactDiversity::Standard => apply_contact_diversity_penalty(deduped),
                ContactDiversity::Off => deduped,
            }
        };

        // Cross-encoder reranking (optional, best-effort).
        if options.rerank {
            if let Some(ref query_text) = options.query_text {
                let candidates: Vec<(i64, String)> = results
                    .iter()
                    .map(|r| (r.chunk_id, r.chunk_data.formatted.clone()))
                    .collect();

                debug!(candidates = candidates.len(), "Applying cross-encoder reranking");

                let scores = if let Some(ref reranker) = options.reranker {
                    reranker(query_text, &candidates)
                } else {
                    crate::rerank::rerank_candidates(query_text, &candidates)
                };
                if let Some(scores) = scores {
                    let score_map: HashMap<i64, f32> = scores.into_iter().map(|s| (s.chunk_id, s.score)).collect();
                    for result in &mut results {
                        if let Some(&score) = score_map.get(&result.chunk_id) {
                            result.similarity = score;
                        }
                    }
                    results.sort_by(|a, b| {
                        b.similarity
                            .partial_cmp(&a.similarity)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });
                    debug!(reranked = results.len(), "Cross-encoder reranking applied");
                } else {
                    debug!("Cross-encoder reranking unavailable, using original order");
                }
            }
            // Keep a wider pool for the superlative time-sort; else the final limit.
            let keep = match options.superlative {
                Some(_) => (options.limit * 2).max(10),
                None => options.limit,
            };
            results.truncate(keep);
        }

        // Superlative: relevance was the filter; recency is the sort.
        if let Some(dir) = options.superlative {
            return superlative_finalize(results, dir, options.limit);
        }

        debug!(
            requested = options.limit,
            returned = results.len(),
            "Hybrid search completed"
        );

        results
    }

    /// Debug variant of `hybrid_search` that returns the per-ranker lists alongside
    /// the fused output. Useful for visualizing RRF behavior or eyeballing why a
    /// particular chunk ranked the way it did.
    pub fn hybrid_search_breakdown(
        &self,
        query_embedding: &[f32],
        options: SearchOptions,
    ) -> Result<HybridSearchBreakdown> {
        let fetch_limit = options.limit * 3;

        let semantic = self.search_raw(query_embedding, fetch_limit, &options)?;

        let bm25 = if let Some(ref text) = options.query_text {
            self.bm25_search_raw(text, fetch_limit, &options).unwrap_or_default()
        } else {
            vec![]
        };

        let keyword = if let Some(ref text) = options.query_text {
            let keywords = extract_content_keywords(text);
            if !keywords.is_empty() {
                self.keyword_search(&keywords, &options).unwrap_or_default()
            } else {
                vec![]
            }
        } else {
            vec![]
        };

        let fused = rrf_merge(
            vec![semantic.clone(), bm25.clone(), keyword.clone()],
            fetch_limit,
            options.superlative,
            options.reference_now(),
        );

        Ok(HybridSearchBreakdown {
            semantic,
            bm25,
            keyword,
            fused,
        })
    }

    /// Search for chunks similar to the query embedding.
    ///
    /// Automatically deduplicates overlapping chunks to ensure diverse results.
    /// Uses a 50% novelty threshold - chunks must contain at least 50% new
    /// messages (not seen in higher-ranked results) to be included.
    pub fn search(&self, query_embedding: &[f32], options: SearchOptions) -> Result<Vec<SearchResult>> {
        // Over-fetch to account for deduplication
        let fetch_limit = options.limit * 3;
        let candidates = self.search_raw(query_embedding, fetch_limit, &options)?;

        // Deduplicate overlapping chunks
        let deduplicated = deduplicate_chunks(candidates, options.limit, options.min_similarity);

        debug!(
            requested = options.limit,
            returned = deduplicated.len(),
            "Search completed with deduplication"
        );

        Ok(deduplicated)
    }

    /// Search for chunks containing all of the given keywords (ILIKE).
    ///
    /// Returns results ordered by recency (most recent first).
    /// No deduplication is performed; merge with semantic results externally.
    pub fn keyword_search(&self, keywords: &[String], options: &SearchOptions) -> Result<Vec<SearchResult>> {
        if keywords.is_empty() {
            return Ok(vec![]);
        }

        let (sql, params) = queries::build_keyword_search_query(
            keywords,
            options.limit,
            options.contact_id.as_deref(),
            options.min_date,
            options.max_date,
            options.include_embeddings,
        );

        let results = self.execute_search_query(&sql, &params, "keyword", options.include_embeddings)?;

        debug!(
            keywords = ?keywords,
            returned = results.len(),
            "Keyword search completed"
        );

        Ok(results)
    }

    /// BM25 full-text search using DuckDB's FTS extension.
    fn bm25_search_raw(&self, query_text: &str, limit: usize, options: &SearchOptions) -> Result<Vec<SearchResult>> {
        let (sql, params) = queries::build_bm25_search_query(
            query_text,
            limit,
            options.contact_id.as_deref(),
            options.min_date,
            options.max_date,
            options.include_embeddings,
        );

        self.execute_search_query(&sql, &params, "bm25", options.include_embeddings)
    }

    /// Raw semantic search without deduplication (internal use).
    ///
    /// Uses a two-phase strategy:
    /// 1. **Exact candidate retrieval** — a full cosine scan over the in-memory
    ///    embedding matrix (see `embedding_matrix`). Over-fetches 10x (capped at 2000)
    ///    when filtering, since filters are applied afterwards.
    /// 2. **Post-filter in Rust** — applies contact_id, date range, and min_similarity filters.
    ///
    /// Falls back to the SQL brute-force `build_search_query` if too few candidates
    /// survive filtering (e.g., a very selective contact filter) or the scan fails.
    fn search_raw(&self, query_embedding: &[f32], limit: usize, options: &SearchOptions) -> Result<Vec<SearchResult>> {
        let has_filters = options.contact_id.is_some() || options.min_date.is_some() || options.max_date.is_some();

        // Over-fetch when filtering OR for superlative queries — the chrono-extreme
        // match may be a weak semantic hit deep in the neighbor list.
        //
        // With 245K+ chunks across hundreds of contacts, 500 was too restrictive for
        // single-contact filters — moderately-similar chunks for the target contact
        // fell below the cutoff before post-filtering ran.
        let overfetch_limit = if has_filters || options.superlative.is_some() {
            (limit * 10).min(2000).max(limit)
        } else {
            limit
        };

        match self.exact_candidates(query_embedding, overfetch_limit, options.include_embeddings) {
            Ok(mut candidates) => {
                if let Some(ref cid) = options.contact_id {
                    candidates.retain(|r| r.contact_id == *cid);
                }
                if let Some(min_date) = options.min_date {
                    candidates.retain(|r| r.end_timestamp >= min_date);
                }
                if let Some(max_date) = options.max_date {
                    candidates.retain(|r| r.start_timestamp <= max_date);
                }
                if options.min_similarity > 0.0 {
                    candidates.retain(|r| r.similarity >= options.min_similarity);
                }
                candidates.truncate(limit);

                if !candidates.is_empty() && (!has_filters || candidates.len() >= limit / 2) {
                    debug!(
                        fetched = overfetch_limit,
                        after_filter = candidates.len(),
                        "Exact vector search completed"
                    );
                    return Ok(candidates);
                }

                debug!(
                    after_filter = candidates.len(),
                    requested = limit,
                    "Exact scan results insufficient after filtering, falling back to SQL brute-force"
                );
            }
            Err(e) => debug!(error = %e, "Exact vector scan failed, falling back to SQL brute-force"),
        }

        // Fallback: brute-force query with SQL-level filters
        let (sql, params) = queries::build_search_query(
            query_embedding,
            limit,
            options.contact_id.as_deref(),
            options.min_date,
            options.max_date,
            options.include_embeddings,
        );

        let mut results =
            self.execute_search_query(&sql, &params, "semantic-bruteforce", options.include_embeddings)?;
        if options.min_similarity > 0.0 {
            results.retain(|r| r.similarity >= options.min_similarity);
        }
        Ok(results)
    }

    /// The `k` chunks most cosine-similar to `query_embedding`, exactly, as full
    /// rows ordered best first.
    fn exact_candidates(
        &self,
        query_embedding: &[f32],
        k: usize,
        include_embedding: bool,
    ) -> Result<Vec<SearchResult>> {
        let matrix = crate::embedding_matrix::for_connection(&self.conn)?;
        let ids: Vec<i64> = matrix.top_k(query_embedding, k).into_iter().map(|(id, _)| id).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let sql = queries::build_chunks_by_id_query(query_embedding, &ids, include_embedding);
        self.execute_search_query(&sql, &[], "semantic-exact", include_embedding)
    }

    /// Execute a search query and parse results into SearchResult structs.
    fn execute_search_query(
        &self,
        sql: &str,
        params: &[String],
        search_type: &str,
        include_embedding: bool,
    ) -> Result<Vec<SearchResult>> {
        let mut stmt = self
            .conn
            .prepare(sql)
            .map_err(|e| BrbError::database(format!("failed to prepare {search_type} query"), e))?;

        let rows = stmt
            .query_map(params_from_iter(params.iter()), |row| {
                let chunk_data_json: String = row.get(3)?;
                let message_ids_str: String = row.get(4)?;

                // Embedding is column index 8 (after the 8 standard columns: 0-7), read
                // as a native FLOAT[768] array. No VARCHAR cast / string re-parse.
                let embedding: Option<Vec<f32>> = if include_embedding {
                    value_to_f32_vec(row.get::<_, Value>(8)?)
                } else {
                    None
                };

                Ok(RawSearchRow {
                    chunk_id: row.get(0)?,
                    contact_id: row.get(1)?,
                    contact_name: row.get(2)?,
                    chunk_data_json,
                    message_ids_str,
                    start_timestamp: row.get(5)?,
                    end_timestamp: row.get(6)?,
                    similarity: row.get(7)?,
                    embedding,
                })
            })
            .map_err(|e| BrbError::database(format!("failed to execute {search_type} search"), e))?;

        let mut results = Vec::new();
        for row_result in rows {
            let row = row_result.map_err(|e| BrbError::database("failed to read row", e))?;

            let chunk_data: ChunkData = serde_json::from_str(&row.chunk_data_json)
                .map_err(|e| BrbError::Serialization(format!("failed to parse chunk_data: {e}")))?;

            let message_ids = parse_bigint_array(&row.message_ids_str)?;

            results.push(SearchResult {
                chunk_id: row.chunk_id,
                contact_id: row.contact_id,
                contact_name: row.contact_name,
                chunk_data,
                message_ids,
                start_timestamp: row.start_timestamp,
                end_timestamp: row.end_timestamp,
                similarity: row.similarity,
                embedding: row.embedding,
            });
        }

        Ok(results)
    }
}

/// Raw row from search query before parsing
struct RawSearchRow {
    chunk_id: i64,
    contact_id: String,
    contact_name: Option<String>,
    chunk_data_json: String,
    message_ids_str: String,
    start_timestamp: DateTime<Utc>,
    end_timestamp: DateTime<Utc>,
    similarity: f32,
    embedding: Option<Vec<f32>>,
}

/// Convert a DuckDB `FLOAT[N]` array (or `FLOAT[]` list) `Value` into `Vec<f32>`.
///
/// Reads the native array directly — no VARCHAR cast + string parse. Returns `None` on
/// an unexpected shape; callers treat that as "no embedding" (MMR then falls back to
/// novelty dedup), which is safe and avoids erroring inside the row-mapping closure.
///
/// (For the absolute hot path this still allocates one `Value` per element; a zero-copy
/// `ValueRef::Array` / Arrow `Float32Array` slice is possible but adds downcasting
/// complexity — revisit only if release profiling shows this as hot.)
fn value_to_f32_vec(value: Value) -> Option<Vec<f32>> {
    let items = match value {
        Value::Array(items) | Value::List(items) => items,
        _ => return None,
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        match item {
            Value::Float(f) => out.push(f),
            Value::Double(d) => out.push(d as f32), // defensive; a FLOAT column shouldn't hit this
            _ => return None,
        }
    }
    Some(out)
}

/// Parse DuckDB BIGINT[] array string to Vec<i64>
fn parse_bigint_array(s: &str) -> Result<Vec<i64>> {
    // Format: "[1, 2, 3]" or "[]"
    let trimmed = s.trim();
    if trimmed == "[]" {
        return Ok(vec![]);
    }

    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .ok_or_else(|| BrbError::Parse(format!("invalid array format: {}", s)))?;

    inner
        .split(',')
        .map(|part| {
            part.trim()
                .parse::<i64>()
                .map_err(|e| BrbError::Parse(format!("invalid integer in array: {}", e)))
        })
        .collect()
}

/// Reciprocal Rank Fusion (RRF) to merge results from N retrieval paths.
///
/// For each chunk, computes: `score = Σ 1/(k + rank_i)` across all lists
/// where k=60 is a standard constant that controls rank sensitivity.
///
/// Finalize a superlative query: relevance was the filter (the input arrives
/// ordered by relevance — RRF/MMR or cross-encoder), recency is the sort. Keeps
/// the most-relevant `keep` candidates, hard-sorts by `end_timestamp` in `dir`,
/// then returns the top `limit`.
fn superlative_finalize(
    mut results: Vec<SearchResult>,
    dir: crate::query_planner::SortDirection,
    limit: usize,
) -> Vec<SearchResult> {
    use crate::query_planner::SortDirection;
    let keep = (limit * 2).max(10);
    results.truncate(keep);
    results.sort_by(|a, b| match dir {
        SortDirection::Newest => b.end_timestamp.cmp(&a.end_timestamp),
        SortDirection::Oldest => a.end_timestamp.cmp(&b.end_timestamp),
    });
    results.truncate(limit);
    results
}

/// Also applies a recency boost: `score *= 1/(1 + 0.01 * age_days)` — UNLESS a
/// superlative is active, in which case fusion stays recency-neutral (the hard
/// time-sort downstream owns ordering, and the decay would otherwise prune the
/// genuinely oldest match out of the truncated pool).
///
/// `now` is the reference instant for that age term — [`SearchOptions::now`] when
/// the caller pinned one, the wall clock otherwise.
fn rrf_merge(
    lists: Vec<Vec<SearchResult>>,
    limit: usize,
    superlative: Option<crate::query_planner::SortDirection>,
    now: DateTime<Utc>,
) -> Vec<SearchResult> {
    const K: f32 = 60.0;

    // Build a map of chunk_id -> (SearchResult, rrf_score)
    let mut scores: HashMap<i64, (SearchResult, f32)> = HashMap::new();

    for list in lists {
        for (rank, result) in list.into_iter().enumerate() {
            let rrf_score = 1.0 / (K + rank as f32 + 1.0);
            scores
                .entry(result.chunk_id)
                .and_modify(|(_, s)| *s += rrf_score)
                .or_insert((result, rrf_score));
        }
    }

    // Apply recency boost: recent messages get higher boost (decay with age).
    // Skipped for superlative queries (kept recency-neutral; see fn docs).
    let now_secs = now.timestamp() as f32;
    let mut fused: Vec<(SearchResult, f32)> = scores
        .into_values()
        .map(|(result, score)| {
            let boosted = if superlative.is_some() {
                score
            } else {
                let age_days = (now_secs - result.end_timestamp.timestamp() as f32) / 86400.0;
                let recency_boost = 1.0 / (1.0 + 0.01 * age_days.max(0.0));
                score * recency_boost
            };
            (result, boosted)
        })
        .collect();

    fused.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    fused.truncate(limit);

    fused
        .into_iter()
        .map(|(mut result, score)| {
            result.similarity = score;
            result
        })
        .collect()
}

/// Apply contact diversity penalty to prevent a single dominant contact from flooding results.
///
/// After the 2nd result from the same contact, applies an exponential penalty:
/// `score *= 0.5^(n-2)` where n is the contact's result count.
/// This prevents the "dominant contact problem" (e.g., one contact with 49% of chunks
/// appearing in 49% of search results).
///
/// Results are re-sorted by adjusted score after penalties are applied.
fn apply_contact_diversity_penalty(mut results: Vec<SearchResult>) -> Vec<SearchResult> {
    // First pass: count appearances per contact in rank order and apply penalties
    let mut contact_counts: HashMap<String, u32> = HashMap::new();
    for result in &mut results {
        let count = contact_counts.entry(result.contact_id.clone()).or_insert(0);
        *count += 1;
        if *count > 2 {
            // Apply exponential decay: 0.5^(n-2) for the 3rd, 4th, 5th... result
            let penalty = 0.5_f32.powi((*count as i32) - 2);
            result.similarity *= penalty;
        }
    }

    // Re-sort by adjusted score
    results.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results
}

/// Maximal Marginal Relevance (MMR) reranking with contact diversity.
///
/// Greedily selects results that balance relevance (similarity to query) with
/// diversity (dissimilarity to already-selected results). Also applies a contact
/// diversity penalty: after 2 results from the same contact, subsequent results
/// from that contact are penalized with `score *= 0.5^(count - 1)`.
///
/// # Arguments
/// * `candidates` - Pre-ranked candidate results
/// * `query_embedding` - The original query embedding
/// * `limit` - Maximum results to return
/// * `lambda` - Balance factor: 1.0 = pure relevance, 0.0 = pure diversity (default: 0.7)
fn mmr_rerank(
    candidates: Vec<SearchResult>,
    query_embedding: &[f32],
    limit: usize,
    lambda: f32,
    diversity: ContactDiversity,
) -> Vec<SearchResult> {
    if candidates.is_empty() || limit == 0 {
        return vec![];
    }

    // If no embeddings available, fall back to novelty dedup
    if candidates.iter().all(|c| c.embedding.is_none()) {
        return deduplicate_chunks(candidates, limit, 0.0);
    }

    let mut selected: Vec<SearchResult> = Vec::with_capacity(limit);
    let mut remaining: Vec<SearchResult> = candidates;
    let mut contact_counts: HashMap<String, u32> = HashMap::new();

    while selected.len() < limit && !remaining.is_empty() {
        let mut best_idx = 0;
        let mut best_mmr = f32::NEG_INFINITY;

        for (i, candidate) in remaining.iter().enumerate() {
            let candidate_emb = match &candidate.embedding {
                Some(e) => e,
                None => continue,
            };

            // Relevance: similarity to query
            let query_sim = cosine_similarity(query_embedding, candidate_emb);

            // Diversity: max similarity to any already-selected result
            // Nothing selected yet means no redundancy term: the first pick is by
            // relevance like every other pick, rather than inheriting fused #1 --
            // which the RRF recency term routinely hands to a recent, weak match.
            let max_selected_sim = if selected.is_empty() {
                0.0
            } else {
                selected
                    .iter()
                    .filter_map(|s| s.embedding.as_ref())
                    .map(|s_emb| cosine_similarity(candidate_emb, s_emb))
                    .fold(f32::NEG_INFINITY, f32::max)
            };

            let mut mmr_score = lambda * query_sim - (1.0 - lambda) * max_selected_sim;

            // Contact diversity penalty: after 2 results from same contact, apply decay.
            //
            // The MMR score is `lambda*sim - (1-lambda)*max_sim`, which goes NEGATIVE
            // for a candidate that is closer to something already selected than it is
            // to the query — common in the tail of the pool. Multiplying a negative by
            // 0.5^k moves it *toward zero*, i.e. the "penalty" would rank the candidate
            // HIGHER. Divide on that branch instead, so the decay is monotonically
            // downward on both sides of zero and identical to `*=` on positives.
            let count = contact_counts.get(&candidate.contact_id).copied().unwrap_or(0);
            if diversity == ContactDiversity::Standard && count >= 2 {
                let decay = 0.5_f32.powi((count as i32) - 1);
                mmr_score = if mmr_score >= 0.0 {
                    mmr_score * decay
                } else {
                    mmr_score / decay
                };
            }

            if mmr_score > best_mmr {
                best_mmr = mmr_score;
                best_idx = i;
            }
        }

        let chosen = remaining.remove(best_idx);
        *contact_counts.entry(chosen.contact_id.clone()).or_insert(0) += 1;
        selected.push(chosen);
    }

    selected
}

/// Cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

/// Extract content keywords from a query string for ILIKE keyword search.
///
/// Lowercases, tokenizes, strips punctuation and stopwords.
/// Returns remaining tokens, or an empty vec if no content keywords remain.
fn extract_content_keywords(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .map(|t| t.trim_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|t| !t.is_empty() && !crate::queries::STOPWORDS.contains(t.as_str()))
        .collect()
}

/// Deduplicate search results by filtering out chunks with significant message overlap.
///
/// Uses a 50% novelty threshold: a chunk is only included if at least 50% of its
/// messages haven't been seen in higher-ranked (more similar) results.
fn deduplicate_chunks(chunks: Vec<SearchResult>, max_results: usize, min_similarity: f32) -> Vec<SearchResult> {
    let mut seen_messages: HashSet<i64> = HashSet::new();
    let mut results = Vec::new();

    for chunk in chunks {
        // Skip if below similarity threshold
        if chunk.similarity < min_similarity {
            continue;
        }

        // Count how many messages in this chunk are new
        let new_count = chunk
            .message_ids
            .iter()
            .filter(|id| !seen_messages.contains(id))
            .count();

        // Calculate novelty ratio
        let novelty_ratio = if chunk.message_ids.is_empty() {
            0.0
        } else {
            new_count as f32 / chunk.message_ids.len() as f32
        };

        // Include if >=50% new content (or if it's the first result)
        if novelty_ratio >= 0.5 || results.is_empty() {
            seen_messages.extend(&chunk.message_ids);
            results.push(chunk);

            if results.len() >= max_results {
                break;
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference clock for tests that touch age-dependent scoring, so results
    /// depend on the fixture rather than on the day the suite runs.
    fn fixed_now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-02-09T14:00:00Z")
            .expect("valid fixed timestamp")
            .with_timezone(&Utc)
    }

    fn make_search_result(chunk_id: i64, message_ids: Vec<i64>, similarity: f32) -> SearchResult {
        SearchResult {
            chunk_id,
            contact_id: "test".to_string(),
            contact_name: Some("Test".to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: "test".to_string(),
            },
            message_ids,
            start_timestamp: fixed_now(),
            end_timestamp: fixed_now(),
            similarity,
            embedding: None,
        }
    }

    fn make_search_result_with_embedding(
        chunk_id: i64,
        message_ids: Vec<i64>,
        similarity: f32,
        embedding: Vec<f32>,
    ) -> SearchResult {
        SearchResult {
            chunk_id,
            contact_id: "test".to_string(),
            contact_name: Some("Test".to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: format!("test chunk {chunk_id}"),
            },
            message_ids,
            start_timestamp: Utc::now(),
            end_timestamp: Utc::now(),
            similarity,
            embedding: Some(embedding),
        }
    }

    #[test]
    fn test_deduplicate_no_overlap() {
        let chunks = vec![
            make_search_result(1, vec![1, 2, 3], 0.9),
            make_search_result(2, vec![4, 5, 6], 0.8),
            make_search_result(3, vec![7, 8, 9], 0.7),
        ];

        let results = deduplicate_chunks(chunks, 10, 0.0);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_deduplicate_with_overlap() {
        let chunks = vec![
            make_search_result(1, vec![1, 2, 3, 4, 5], 0.9),
            make_search_result(2, vec![3, 4, 5, 6, 7], 0.85), // 60% overlap, <50% new -> skip
            make_search_result(3, vec![8, 9, 10, 11, 12], 0.8), // no overlap -> include
        ];

        let results = deduplicate_chunks(chunks, 10, 0.0);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].chunk_id, 1);
        assert_eq!(results[1].chunk_id, 3);
    }

    #[test]
    fn test_deduplicate_with_50pct_overlap() {
        // Simulates window=8, stride=4: adjacent chunks share exactly 4 of 8 messages (50% overlap).
        // With 50% novelty, the second chunk should still be included (novelty_ratio = 4/8 = 0.5 >= 0.5).
        let chunks = vec![
            make_search_result(1, vec![1, 2, 3, 4, 5, 6, 7, 8], 0.9),
            make_search_result(2, vec![5, 6, 7, 8, 9, 10, 11, 12], 0.85), // 4/8 new = 50% -> include
            make_search_result(3, vec![9, 10, 11, 12, 13, 14, 15, 16], 0.8), // 4/8 new (9-12 seen) = 50% -> include
        ];

        let results = deduplicate_chunks(chunks, 10, 0.0);
        assert_eq!(results.len(), 3, "All 3 chunks should pass with exactly 50% novelty");
        assert_eq!(results[0].chunk_id, 1);
        assert_eq!(results[1].chunk_id, 2);
        assert_eq!(results[2].chunk_id, 3);
    }

    #[test]
    fn test_deduplicate_rejects_high_overlap() {
        // With window=8, stride=2 would give 75% overlap (6/8 shared). This should be filtered.
        let chunks = vec![
            make_search_result(1, vec![1, 2, 3, 4, 5, 6, 7, 8], 0.9),
            make_search_result(2, vec![3, 4, 5, 6, 7, 8, 9, 10], 0.85), // 2/8 new = 25% -> skip
        ];

        let results = deduplicate_chunks(chunks, 10, 0.0);
        assert_eq!(results.len(), 1, "High-overlap chunk should be filtered out");
        assert_eq!(results[0].chunk_id, 1);
    }

    #[test]
    fn test_deduplicate_respects_limit() {
        let chunks = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.8),
            make_search_result(3, vec![5, 6], 0.7),
        ];

        let results = deduplicate_chunks(chunks, 2, 0.0);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_deduplicate_respects_min_similarity() {
        let chunks = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.4), // below threshold
            make_search_result(3, vec![5, 6], 0.3), // below threshold
        ];

        let results = deduplicate_chunks(chunks, 10, 0.5);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_rrf_merge_combines_sources() {
        let semantic = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.8),
        ];
        let bm25 = vec![
            make_search_result(2, vec![3, 4], 0.0), // chunk 2 in both -> boosted
            make_search_result(3, vec![5, 6], 0.0),
        ];

        let results = rrf_merge(vec![semantic, bm25], 10, None, fixed_now());
        assert_eq!(results.len(), 3);
        // Chunk 2 appears in both sources, so it should rank higher
        // (it gets scores from both lists)
        let chunk2_pos = results.iter().position(|r| r.chunk_id == 2).unwrap();
        assert!(chunk2_pos <= 1, "chunk 2 should be in top 2 due to dual-source RRF");
    }

    #[test]
    fn test_rrf_merge_empty_bm25() {
        let semantic = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.8),
        ];

        let results = rrf_merge(vec![semantic, vec![]], 10, None, fixed_now());
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_rrf_merge_three_way() {
        let semantic = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.8),
        ];
        let bm25 = vec![
            make_search_result(2, vec![3, 4], 0.0),
            make_search_result(3, vec![5, 6], 0.0),
        ];
        let keyword = vec![
            make_search_result(3, vec![5, 6], 0.0), // chunk 3 in bm25 + keyword
            make_search_result(4, vec![7, 8], 0.0),
        ];

        let results = rrf_merge(vec![semantic, bm25, keyword], 10, None, fixed_now());
        assert_eq!(results.len(), 4);
        // Chunk 2 and 3 each appear in 2 lists, so should rank high
        let chunk2_pos = results.iter().position(|r| r.chunk_id == 2).unwrap();
        let chunk3_pos = results.iter().position(|r| r.chunk_id == 3).unwrap();
        assert!(chunk2_pos <= 2, "chunk 2 should be in top 3 due to dual-source RRF");
        assert!(chunk3_pos <= 2, "chunk 3 should be in top 3 due to dual-source RRF");
    }

    #[test]
    fn test_superlative_finalize_newest_sorts_by_time() {
        let t_old = Utc::now() - chrono::Duration::days(100);
        let t_mid = Utc::now() - chrono::Duration::days(50);
        let t_new = Utc::now() - chrono::Duration::days(1);
        // Input is relevance-ordered: most-similar is the OLDEST item.
        // signature: (chunk_id, contact_id, similarity, start, end)
        let a = make_result_with_contact_and_dates(1, "x", 0.9, t_old, t_old);
        let c = make_result_with_contact_and_dates(3, "x", 0.7, t_mid, t_mid);
        let b = make_result_with_contact_and_dates(2, "x", 0.5, t_new, t_new);
        let out = superlative_finalize(vec![a, c, b], crate::query_planner::SortDirection::Newest, 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].chunk_id, 2, "newest must rank first despite lower relevance");
        assert_eq!(out[1].chunk_id, 3);
    }

    #[test]
    fn test_superlative_finalize_oldest_sorts_by_time() {
        let t_old = Utc::now() - chrono::Duration::days(100);
        let t_mid = Utc::now() - chrono::Duration::days(50);
        let t_new = Utc::now() - chrono::Duration::days(1);
        let a = make_result_with_contact_and_dates(1, "x", 0.5, t_old, t_old);
        let c = make_result_with_contact_and_dates(3, "x", 0.7, t_mid, t_mid);
        let b = make_result_with_contact_and_dates(2, "x", 0.9, t_new, t_new);
        let out = superlative_finalize(vec![b, c, a], crate::query_planner::SortDirection::Oldest, 2);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].chunk_id, 1, "oldest must rank first despite lower relevance");
        assert_eq!(out[1].chunk_id, 3);
    }

    #[test]
    fn test_rrf_merge_recency_neutral_for_superlative() {
        let now = fixed_now();
        let t_recent = now - chrono::Duration::days(1);
        let t_old = now - chrono::Duration::days(400);
        let recent = make_result_with_contact_and_dates(1, "a", 0.5, t_recent, t_recent);
        let old = make_result_with_contact_and_dates(2, "b", 0.5, t_old, t_old);

        // Each item is rank-0 in its own list -> identical base RRF score.
        let neutral = rrf_merge(
            vec![vec![recent.clone()], vec![old.clone()]],
            10,
            Some(crate::query_planner::SortDirection::Newest),
            now,
        );
        let n_recent = neutral.iter().find(|r| r.chunk_id == 1).unwrap().similarity;
        let n_old = neutral.iter().find(|r| r.chunk_id == 2).unwrap().similarity;
        assert!(
            (n_recent - n_old).abs() < 1e-6,
            "superlative fusion must be recency-neutral"
        );

        let boosted = rrf_merge(vec![vec![recent], vec![old]], 10, None, now);
        let b_recent = boosted.iter().find(|r| r.chunk_id == 1).unwrap().similarity;
        let b_old = boosted.iter().find(|r| r.chunk_id == 2).unwrap().similarity;
        assert!(b_recent > b_old, "non-superlative fusion should favor recent");
    }

    /// The point of threading `now`: fusion scores are a function of the supplied
    /// clock, not of when the test happens to run. Two different clocks over the
    /// same inputs must produce different age-weighted scores — otherwise `now`
    /// is decorative and every temporal eval assertion would be vacuous.
    #[test]
    fn test_rrf_merge_recency_follows_the_supplied_clock() {
        let now = fixed_now();
        let t = now - chrono::Duration::days(10);
        let result = make_result_with_contact_and_dates(1, "a", 0.5, t, t);

        let at_now = rrf_merge(vec![vec![result.clone()]], 10, None, now);
        let a_year_later = rrf_merge(vec![vec![result.clone()]], 10, None, now + chrono::Duration::days(365));

        assert!(
            at_now[0].similarity > a_year_later[0].similarity,
            "the same chunk must score lower against a later clock (age term ignored the parameter)"
        );

        // And the same clock must give the same answer twice — no wall-clock leak.
        let repeat = rrf_merge(vec![vec![result]], 10, None, now);
        assert_eq!(at_now[0].similarity, repeat[0].similarity);
    }

    #[test]
    fn test_extract_content_keywords() {
        // Should strip stopwords and keep content words
        let kw = extract_content_keywords("what restaurants did I go to last week");
        assert!(kw.contains(&"restaurants".to_string()));
        assert!(!kw.contains(&"what".to_string()));
        assert!(!kw.contains(&"did".to_string()));
        assert!(!kw.contains(&"to".to_string()));

        // All stopwords should return empty
        let kw = extract_content_keywords("what did I do");
        assert!(kw.is_empty());

        // Punctuation should be stripped
        let kw = extract_content_keywords("hello, world!");
        assert_eq!(kw, vec!["hello", "world"]);
    }

    #[test]
    fn test_search_options_with_custom_reranker() {
        use crate::rerank::RerankScore;
        let options = SearchOptions::new().with_rerank().with_reranker(|_query, candidates| {
            Some(
                candidates
                    .iter()
                    .map(|(id, _)| RerankScore {
                        chunk_id: *id,
                        score: 1.0,
                    })
                    .collect(),
            )
        });
        assert!(options.reranker.is_some());
        assert!(options.rerank);
    }

    #[test]
    fn test_value_to_f32_vec() {
        // FLOAT[768] reads back as Value::Array of Value::Float.
        let arr = Value::Array(vec![Value::Float(0.1), Value::Float(0.2), Value::Float(0.3)]);
        assert_eq!(value_to_f32_vec(arr), Some(vec![0.1, 0.2, 0.3]));
        // FLOAT[] would read back as Value::List — also accepted.
        let list = Value::List(vec![Value::Float(1.0), Value::Float(2.0)]);
        assert_eq!(value_to_f32_vec(list), Some(vec![1.0, 2.0]));
        // Non-array values → None (caller treats as "no embedding").
        assert_eq!(value_to_f32_vec(Value::Text("nope".into())), None);
        assert_eq!(value_to_f32_vec(Value::Null), None);
        // A non-float element → None.
        assert_eq!(
            value_to_f32_vec(Value::Array(vec![Value::Float(1.0), Value::Int(2)])),
            None
        );
    }

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_mmr_rerank_diversity() {
        // e1 is relevant, e2 is a near-duplicate of e1, e3 is diverse but still relevant
        let query = vec![1.0, 0.0, 0.0, 0.0];
        let candidates = vec![
            make_search_result_with_embedding(1, vec![1, 2], 0.95, vec![0.9, 0.3, 0.0, 0.0]),
            make_search_result_with_embedding(2, vec![3, 4], 0.90, vec![0.9, 0.3, 0.01, 0.0]), // near-dup of 1
            make_search_result_with_embedding(3, vec![5, 6], 0.85, vec![0.7, 0.0, 0.0, 0.5]),  // diverse
        ];

        let results = mmr_rerank(candidates, &query, 3, 0.5, ContactDiversity::Standard);
        assert_eq!(results.len(), 3);
        // First should be the highest initial score
        assert_eq!(results[0].chunk_id, 1);
        // Chunk 3 (diverse) should beat chunk 2 (near-duplicate of chunk 1)
        assert_eq!(results[1].chunk_id, 3);
        assert_eq!(results[2].chunk_id, 2);
    }

    #[test]
    fn test_mmr_rerank_empty() {
        let results = mmr_rerank(vec![], &[1.0, 0.0], 5, 0.7, ContactDiversity::Standard);
        assert!(results.is_empty());
    }

    /// The shipped default must stay `Standard`. If this flips, every production
    /// search silently loses contact diversity and no other test would notice.
    #[test]
    fn test_contact_diversity_defaults_to_standard() {
        assert_eq!(SearchOptions::new().contact_diversity, ContactDiversity::Standard);
        assert_eq!(SearchOptions::default().contact_diversity, ContactDiversity::Standard);
        assert_eq!(
            SearchOptions::new()
                .with_contact_diversity(ContactDiversity::Off)
                .contact_diversity,
            ContactDiversity::Off
        );
    }

    /// On a single-contact corpus — the shape LongMemEval produces — `Standard`
    /// reorders results purely because they share a contact, and `Off` preserves
    /// the relevance ordering MMR chose.
    ///
    /// This is the measurement that justifies disabling the stage for a benchmark
    /// run: the penalty is doing something real here, and it has nothing to do with
    /// which chunk answers the question.
    #[test]
    fn test_contact_diversity_off_preserves_single_contact_ordering() {
        let query = vec![1.0, 0.0, 0.0];
        let candidates = || {
            vec![
                make_result_with_contact_and_embedding(1, "solo", vec![1.0, 0.0, 0.0]),
                make_result_with_contact_and_embedding(2, "solo", vec![0.9, 0.436, 0.0]),
                make_result_with_contact_and_embedding(3, "solo", vec![0.8, 0.6, 0.0]),
                make_result_with_contact_and_embedding(4, "solo", vec![0.7, 0.714, 0.0]),
            ]
        };

        let off = mmr_rerank(candidates(), &query, 4, 0.7, ContactDiversity::Off);
        let standard = mmr_rerank(candidates(), &query, 4, 0.7, ContactDiversity::Standard);

        assert_eq!(off.len(), 4);
        assert_eq!(standard.len(), 4);
        // Every candidate belongs to one contact, so `Off` leaves MMR's own
        // relevance/novelty tradeoff untouched: strictly decreasing query similarity.
        assert_eq!(
            off.iter().map(|r| r.chunk_id).collect::<Vec<_>>(),
            vec![1, 2, 3, 4],
            "with the penalty off, ordering is MMR's alone"
        );
    }

    /// `Standard` must still demote the third hit from one contact when other
    /// contacts are available — a guard against the flag being wired up backwards.
    #[test]
    fn test_contact_diversity_standard_still_demotes_repeat_contacts() {
        let query = vec![1.0, 0.0, 0.0];
        let candidates = || {
            vec![
                make_result_with_contact_and_embedding(1, "dom", vec![1.0, 0.0, 0.0]),
                make_result_with_contact_and_embedding(2, "dom", vec![0.99, 0.141, 0.0]),
                // Slightly less query-similar than dom's third, but a different contact.
                make_result_with_contact_and_embedding(3, "other", vec![0.95, 0.0, 0.312]),
                make_result_with_contact_and_embedding(4, "dom", vec![0.97, 0.243, 0.0]),
            ]
        };

        let standard = mmr_rerank(candidates(), &query, 3, 0.7, ContactDiversity::Standard);
        assert_eq!(
            standard[2].contact_id, "other",
            "the 3rd hit from one contact must lose to a different contact"
        );

        let off = mmr_rerank(candidates(), &query, 3, 0.7, ContactDiversity::Off);
        assert_eq!(
            off[2].contact_id, "dom",
            "with the penalty off, the more query-similar dom chunk wins instead"
        );
    }

    fn make_result_with_contact_and_embedding(chunk_id: i64, contact: &str, embedding: Vec<f32>) -> SearchResult {
        SearchResult {
            chunk_id,
            contact_id: contact.to_string(),
            contact_name: Some(contact.to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: format!("chunk {chunk_id} from {contact}"),
            },
            message_ids: vec![chunk_id],
            start_timestamp: fixed_now(),
            end_timestamp: fixed_now(),
            similarity: 0.5,
            embedding: Some(embedding),
        }
    }

    #[test]
    fn test_mmr_first_pick_is_by_relevance_not_fused_order() {
        // Fused #1 is a weak match that the RRF recency term floated to the top;
        // fused #2 is the real answer. MMR used to keep fused #1 unconditionally,
        // which put gold at rank 2 on nearly every query in the recall eval.
        let query = vec![1.0, 0.0];
        let candidates = vec![
            make_result_with_contact_and_embedding(1, "a", vec![0.3, 0.954]),
            make_result_with_contact_and_embedding(2, "b", vec![1.0, 0.0]),
        ];

        let results = mmr_rerank(candidates, &query, 2, 0.7, ContactDiversity::Standard);

        assert_eq!(
            results[0].chunk_id, 2,
            "the most query-similar candidate must rank first"
        );
    }

    /// The contact-diversity penalty must demote a candidate even when its MMR
    /// score is negative.
    ///
    /// MMR is `lambda*query_sim - (1-lambda)*max_selected_sim`, so a candidate
    /// nearer to something already selected than to the query scores below zero —
    /// routine in the tail of the pool. Scaling that by `0.5^k` moves it toward
    /// zero, so the "penalty" used to promote exactly the over-represented contact
    /// it was meant to suppress.
    ///
    /// The fixture is tuned so the two readings straddle the competing candidate:
    /// the 3rd chunk from `dom` scores -0.042 raw, and `other` scores -0.050. A
    /// multiplying penalty yields -0.021 and wrongly picks `dom`; a dividing one
    /// yields -0.084 and correctly picks `other`.
    #[test]
    fn test_mmr_contact_penalty_demotes_negative_scores() {
        let query = vec![1.0, 0.0, 0.0];
        let candidates = vec![
            // Most relevant -> picked first, dom count 1.
            make_result_with_contact_and_embedding(1, "dom", vec![1.0, 0.0, 0.0]),
            // Best remaining MMR (+0.396) -> picked second, dom count 2.
            make_result_with_contact_and_embedding(2, "dom", vec![0.9, 0.436, 0.0]),
            // query_sim 0.1, max_selected_sim 0.4 -> MMR -0.050, unpenalized.
            make_result_with_contact_and_embedding(3, "other", vec![0.1, 0.712, 0.695]),
            // query_sim 0.2, max_selected_sim 0.607 -> MMR -0.042, penalized (count 2).
            make_result_with_contact_and_embedding(4, "dom", vec![0.2, 0.9798, 0.0]),
        ];

        let results = mmr_rerank(candidates, &query, 3, 0.7, ContactDiversity::Standard);

        assert_eq!(results.len(), 3);
        assert_eq!(
            results[2].contact_id, "other",
            "a penalized negative-MMR candidate must rank below an unpenalized one; \
             got chunk {} from {}",
            results[2].chunk_id, results[2].contact_id
        );
    }

    #[test]
    fn test_mmr_fallback_without_embeddings() {
        let candidates = vec![
            make_search_result(1, vec![1, 2], 0.9),
            make_search_result(2, vec![3, 4], 0.8),
        ];

        // Without embeddings, should fall back to novelty dedup
        let results = mmr_rerank(candidates, &[1.0, 0.0], 5, 0.7, ContactDiversity::Standard);
        assert_eq!(results.len(), 2);
    }

    // =========================================================================
    // Post-filter tests (simulating HNSW Phase 2 Rust-side filtering)
    // =========================================================================

    fn make_result_with_contact_and_dates(
        chunk_id: i64,
        contact_id: &str,
        similarity: f32,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> SearchResult {
        SearchResult {
            chunk_id,
            contact_id: contact_id.to_string(),
            contact_name: Some(contact_id.to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: "test".to_string(),
            },
            message_ids: vec![chunk_id],
            start_timestamp: start,
            end_timestamp: end,
            similarity,
            embedding: None,
        }
    }

    #[test]
    fn test_post_filter_contact_id() {
        let now = Utc::now();
        let candidates = vec![
            make_result_with_contact_and_dates(1, "alice", 0.9, now, now),
            make_result_with_contact_and_dates(2, "bob", 0.85, now, now),
            make_result_with_contact_and_dates(3, "alice", 0.8, now, now),
        ];

        let mut filtered = candidates;
        let cid = "alice";
        filtered.retain(|r| r.contact_id == *cid);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().all(|r| r.contact_id == "alice"));
    }

    #[test]
    fn test_post_filter_date_range() {
        use chrono::Duration;
        let now = Utc::now();
        let old = now - Duration::days(30);
        let very_old = now - Duration::days(60);

        let candidates = vec![
            make_result_with_contact_and_dates(1, "alice", 0.9, now - Duration::days(1), now),
            make_result_with_contact_and_dates(2, "bob", 0.85, old, old + Duration::days(1)),
            make_result_with_contact_and_dates(3, "carol", 0.8, very_old, very_old + Duration::days(1)),
        ];

        // Filter: only results ending after 15 days ago
        let min_date = now - Duration::days(15);
        let mut filtered = candidates;
        filtered.retain(|r| r.end_timestamp >= min_date);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].chunk_id, 1);
    }

    #[test]
    fn test_post_filter_min_similarity() {
        let now = Utc::now();
        let candidates = vec![
            make_result_with_contact_and_dates(1, "alice", 0.9, now, now),
            make_result_with_contact_and_dates(2, "bob", 0.3, now, now),
            make_result_with_contact_and_dates(3, "carol", 0.1, now, now),
        ];

        let min_sim = 0.5;
        let mut filtered = candidates;
        filtered.retain(|r| r.similarity >= min_sim);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].chunk_id, 1);
    }

    #[test]
    fn test_post_filter_combined() {
        use chrono::Duration;
        let now = Utc::now();
        let old = now - Duration::days(30);

        let candidates = vec![
            make_result_with_contact_and_dates(1, "alice", 0.9, now - Duration::days(1), now), // passes all
            make_result_with_contact_and_dates(2, "alice", 0.3, now - Duration::days(1), now), // fails similarity
            make_result_with_contact_and_dates(3, "bob", 0.9, now - Duration::days(1), now),   // fails contact
            make_result_with_contact_and_dates(4, "alice", 0.8, old, old + Duration::days(1)), // fails date
        ];

        let cid = "alice";
        let min_date = now - Duration::days(7);
        let min_sim = 0.5;

        let mut filtered = candidates;
        filtered.retain(|r| r.contact_id == *cid);
        filtered.retain(|r| r.end_timestamp >= min_date);
        filtered.retain(|r| r.similarity >= min_sim);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].chunk_id, 1);
    }

    #[test]
    fn test_distance_to_similarity_conversion() {
        // Verify the conversion formula: similarity = 1.0 - distance
        let distance = 0.3_f32;
        let similarity = 1.0 - distance;
        assert!((similarity - 0.7).abs() < 1e-6);

        // Distance 0.0 = identical vectors = similarity 1.0
        assert!((1.0_f32 - 0.0_f32 - 1.0).abs() < 1e-6);

        // Distance 1.0 = orthogonal = similarity 0.0
        assert!((1.0_f32 - 1.0_f32).abs() < 1e-6);
    }

    // =========================================================================
    // Integration tests (require local data + Python venv)
    //
    // Run with: cargo test -p ingestion -- --ignored
    // =========================================================================

    /// Integration test: verify persona RAG surfaces a known fact about a contact.
    ///
    /// This exercises the real `retrieve_persona_context()` pipeline: query planner
    /// (for date filters) -> embed RAW query -> semantic search -> recency boost ->
    /// the production [`format_persona_context`] formatter. It calls the real
    /// formatter rather than reimplementing it, so the test can't drift from the
    /// budget/dedup constants the app actually uses.
    ///
    /// Parameterized via environment so no personal contact data lives in the repo:
    /// - `BRB_TEST_PERSONA_CONTACT` — contact ID to query (e.g. a phone number)
    /// - `BRB_TEST_PERSONA_EXPECT`  — substring the context must contain (case-insensitive)
    ///
    /// Requires:
    /// - `~/.be-right-back/data/db/brb.duckdb` with embedded chunks
    /// - `~/.be-right-back/mlx-venv/bin/python3` for embedding
    ///
    /// Run with:
    /// ```text
    /// BRB_TEST_PERSONA_CONTACT='+15551234567' BRB_TEST_PERSONA_EXPECT=harvard \
    ///   cargo test -p ingestion -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore]
    fn test_persona_query_surfaces_expected_term() {
        use crate::{VectorDb, apply_recency_boost, embed_query, format_persona_context, plan_search};

        let (contact_id, expected) = match (
            std::env::var("BRB_TEST_PERSONA_CONTACT"),
            std::env::var("BRB_TEST_PERSONA_EXPECT"),
        ) {
            (Ok(c), Ok(e)) if !c.is_empty() && !e.is_empty() => (c, e.to_lowercase()),
            _ => {
                eprintln!(
                    "skipping: set BRB_TEST_PERSONA_CONTACT and BRB_TEST_PERSONA_EXPECT \
                     to run this against your local data"
                );
                return;
            }
        };

        let queries = [
            "where did you go to school",
            "where did ya go to college",
            "what school did you attend",
            "What school did you go to?",
        ];

        // Mirror production: persona-chat RAG is a pure query, so use the
        // read-only path rather than the read-write ingestion path.
        let db = VectorDb::open_readonly().expect("VectorDb should open");

        for query in &queries {
            let plan = plan_search(query);

            let embedding = embed_query(query).unwrap_or_else(|e| panic!("embed_query failed for '{query}': {e}"));

            let options = SearchOptions::new()
                .with_limit(60)
                .with_min_similarity(0.15)
                .with_contact(&contact_id)
                .with_date_range(plan.min_date, plan.max_date);

            let mut results = db
                .search(&embedding, options)
                .unwrap_or_else(|e| panic!("search failed for '{query}': {e}"));

            apply_recency_boost(&mut results, plan.prefer_recent);

            let raw_rank = results
                .iter()
                .position(|r| r.chunk_data.formatted.to_lowercase().contains(&expected));

            // Run the real formatter — what actually reaches the model.
            let ctx = format_persona_context(&results)
                .unwrap_or_else(|| panic!("Query '{query}' produced no usable context"));
            let survived = ctx.text.to_lowercase().contains(&expected);

            eprintln!(
                "  Query '{query}': raw_rank={raw_rank:?}, raw_results={}, \
                 chunks_in_context={}, expected_term_survived={survived}",
                results.len(),
                ctx.chunk_count,
            );

            assert!(
                survived,
                "Query '{query}' must surface '{expected}' in the formatted context. \
                 raw_rank={raw_rank:?}, raw_results={}, chunks_in_context={}",
                results.len(),
                ctx.chunk_count,
            );
        }
    }
}

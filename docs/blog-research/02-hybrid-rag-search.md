# Research Report: Hybrid RAG Search Pipeline

> Reference material for writing about the 9-stage hybrid search system
> Generated: 2026-04-03

---

## What You Built

A 9-stage search pipeline that combines semantic vector search with BM25 full-text search, merged via Reciprocal Rank Fusion, with contact diversity penalties, MMR deduplication, optional cross-encoder reranking, and exponential recency boosting. All running locally against DuckDB.

---

## Architecture At A Glance

```
User query
  │
  ├─ 1. Query Planning (regex, no LLM)
  │     → temporal extraction, query cleaning, aggregation detection
  │
  ├─ 2. Embedding (Python subprocess)
  │     → ModernBERT 768-dim vector via mlx-community/nomicai-modernbert-embed-base-8bit
  │
  ├─ 3. Semantic Search (DuckDB HNSW)
  │     → cosine similarity, over-fetches 3x limit
  │
  ├─ 4. BM25 Full-Text Search (DuckDB FTS)
  │     → FTS on formatted_text column, stopword-filtered
  │
  ├─ 5. Reciprocal Rank Fusion
  │     → score = Σ 1/(60 + rank_i) — merges both rankings
  │
  ├─ 6. Contact Diversity Penalty
  │     → score *= 0.5^(n-2) after 2nd result from same contact
  │
  ├─ 7. MMR Deduplication
  │     → λ=0.7, 50% novelty threshold via message ID overlap
  │
  ├─ 8. Cross-Encoder Reranking (optional)
  │     → ms-marco-MiniLM-L-6-v2 (22M params, ~50-150ms for 30 candidates)
  │
  └─ 9. Recency Boost (conditional)
        → score *= e^(-0.03 * days_ago) when prefer_recent=true
```

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Embedding dimensions | 768 |
| Embedding model | `nomicai-modernbert-embed-base-8bit` |
| Chunk window | 8 messages |
| Chunk stride | 4 messages (~50% overlap) |
| Average chunk size | ~420 characters |
| RRF constant k | 60 |
| MMR lambda | 0.7 |
| MMR novelty threshold | 50% message ID overlap |
| Contact diversity decay | 0.5 per additional result after 2nd |
| Recency decay lambda | 0.03 (half-life ~23 days) |
| Default result count | 7 (normal), 20 (aggregation queries) |
| Cross-encoder model | `ms-marco-MiniLM-L-6-v2` (22M params) |
| Cross-encoder latency | ~50-150ms for 30 candidates |
| Total Rust tests for search | 22 in search.rs, 66 in query_planner.rs, 7 in context_builder.rs, 4 in rerank.rs |

---

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Hybrid search orchestration | `crates/ingestion/src/search.rs` | 1,184 |
| Query planner (18 temporal patterns) | `crates/ingestion/src/query_planner.rs` | 1,278 |
| Cross-encoder reranking bridge | `crates/ingestion/src/rerank.rs` | 252 |
| Context builder (LLM-ready output) | `crates/ingestion/src/context_builder.rs` | 194 |
| DuckDB vector DB (HNSW + FTS) | `crates/ingestion/src/vectordb.rs` | 381 |
| SQL query builders + stopwords | `crates/ingestion/src/queries.rs` | — |
| Python embedding subprocess | `crates/ingestion/src/python.rs` | — |
| Python embedding pipeline | `mlx/src/pipelines/embedding.py` | 764 |
| Python reranking script | `mlx/src/ml/reranker.py` | — |

---

## Query Planner Details

18 temporal regex patterns in `query_planner.rs` — all rule-based, no LLM:

**Absolute date patterns:**
- "in January 2025", "January 2025", "jan 2025"
- "on March 15", "on 3/15", "on 2025-03-15"
- "in 2025", "during 2025"
- "summer 2024", "fall 2025" (season → month range)

**Relative date patterns:**
- "last week", "last month", "last year"
- "last Tuesday", "last Monday" (previous occurrence of named day)
- "yesterday", "today"
- "X days/weeks/months ago"
- "this week", "this month", "this year"
- "past X days/weeks/months"

**Recency signals:**
- "most recent", "latest", "last" → sets `prefer_recent = true`, adds 90-day window
- "recently" → sets `prefer_recent = true`, adds 30-day window

**Aggregation detection:**
- "favorite", "most", "usually", "always", "often", "typically", "generally"
- Triggers `result_count = 20` (vs default 7) to get more data for summarization

**Query cleaning:**
- Strips temporal phrases from the query text before embedding
- Removes common filler: "what", "where", "when", "did", "about", "the"
- Removes stopwords for BM25 (26 stopwords: the, a, an, and, or, but, in, on, at...)

---

## DuckDB as Vector Database

### Why DuckDB instead of Pinecone/Qdrant/ChromaDB

- **Local-first requirement** — no cloud dependencies, all data on-device
- **Dual-index capability** — HNSW for vectors AND FTS for BM25 in same database
- **Bundled** — ships as a Rust crate, no external process
- **Embedded DuckDB** — no server, opens file directly

### HNSW Index Configuration
- 768 dimensions, cosine metric
- Created by Python during ingestion, verified by Rust on open
- VSS extension loaded on every `VectorDb::open()`
- Experimental persistence enabled

### FTS Index
- Built on `formatted_text` column (human-readable message text)
- Porter stemmer, custom stopword list
- Recreated on each full ingestion (drop + rebuild)

### Critical Version Pinning
- DuckDB Rust: `= 1.4.4` (exact pin in Cargo.toml)
- DuckDB Python: `==1.4.4` (exact pin in pyproject.toml)
- **Mismatch causes crashes** — VSS extension binary incompatibility
- Empirically validated: `experiments/duckdb-index-compat/` (18/18 tests pass at 1.4.4)

---

## Reciprocal Rank Fusion (RRF)

The key insight: semantic search finds conceptually similar content, BM25 finds exact keyword matches. Neither is sufficient alone for message search — you need "what did we talk about at dinner?" (semantic) and "find messages mentioning 'Costco'" (lexical).

RRF formula: `score(d) = Σ 1/(k + rank_i(d))` where k=60

- Each retriever (semantic, BM25) provides its own ranking
- Documents found by both retrievers get boosted (sum of reciprocal ranks)
- k=60 is the standard constant from the original RRF paper
- No hyperparameter tuning needed — works well out of the box

---

## Contact Diversity Penalty

Problem: If you search "restaurants", one chatty friend dominates results because you discussed restaurants 50 times with them.

Solution: After the 2nd result from the same contact, apply exponential decay:
```
score *= 0.5^(n - 2)
```
Where n = number of results from that contact already included.

So 3rd result from same contact gets 0.5x, 4th gets 0.25x, 5th gets 0.125x.

---

## MMR Deduplication

Problem: Overlapping chunks (stride=4, window=8) means the same messages appear in multiple chunks.

Solution: Maximal Marginal Relevance with message ID overlap detection:
- For each candidate, compute overlap with already-selected results
- Overlap = intersection of message IDs / union of message IDs
- If overlap > 50%, treat as duplicate
- MMR formula: `score = λ * relevance - (1-λ) * max_similarity_to_selected`
- λ=0.7 — biases toward relevance but penalizes redundancy

---

## Cross-Encoder Reranking

Why: Bi-encoder embedding search is fast but imprecise. Cross-encoders jointly encode (query, document) pairs for much more accurate relevance scoring.

Implementation:
- Optional — enabled via `SearchOptions.rerank = true`
- Spawns Python subprocess calling `ms-marco-MiniLM-L-6-v2`
- 22M parameters — small enough to run on CPU
- ~50-150ms latency for 30 candidates
- Falls back gracefully to unreranked results on failure
- 5-second subprocess timeout (`try_wait()` loop + `child.kill()`)

---

## Recency Boosting

When the query planner detects recency intent ("most recent", "latest", "recently"):
```
score *= e^(-λ * days_ago)
```
Where λ = 0.03 (half-life ~23 days).

This means:
- Message from today: 1.0x multiplier
- Message from 7 days ago: ~0.81x
- Message from 23 days ago: ~0.50x
- Message from 90 days ago: ~0.07x

---

## Interesting Design Decisions

1. **Rule-based query planning (no LLM)**: Temporal extraction uses regex, not an LLM. This is zero-latency and deterministic. 18 patterns cover the vast majority of temporal queries. 66 tests prove coverage.

2. **Over-fetching 3x**: Semantic search fetches 3x the requested limit, then filters down. This compensates for post-retrieval stages (diversity penalty, MMR) that remove results.

3. **Chunk overlap vs. no overlap**: Current config uses 50% overlap (window=8, stride=4). NEXT_UP.md notes "research shows overlap may not help" and suggests testing stride=6 or stride=8 to cut index ~50%. Unresolved question.

4. **No incremental embedding**: Currently re-embeds all messages each ingestion run. Known limitation tracked in NEXT_UP.md — needs "track last processed message ID."

---

## Existing Documentation

- `crates/ingestion/CLAUDE.md` — comprehensive module map and search pipeline docs
- `docs/archive/casper-improvements/notes/` — 6 deep-dive notes on chunking, hybrid search, reranking, query planning, integration, evaluation
- `docs/archive/casper-improvements/eval/` — evaluation results and scoring rubrics
- `docs/archive/plans/casper/building-production-grade-rag.md` — initial RAG strategy doc

# Be Right Back: RAG/Search Pipeline Evaluation Report

**Date**: March 1, 2026
**Scope**: Comprehensive analysis of the hybrid search pipeline (Casper RAG) for building evals
**Status**: Complete investigation of all components

---

## Executive Summary

The Be Right Back search pipeline is a sophisticated 9-stage hybrid retrieval system combining semantic search (768-dim ModernBERT embeddings), BM25 full-text search, reciprocal rank fusion (RRF), contact diversity penalties, maximal marginal relevance (MMR) deduplication, optional cross-encoder reranking, and recency boosting.

**Key Metrics:**
- **Embedding model**: `mlx-community/nomicai-modernbert-embed-base-8bit` (768-dim)
- **Reranking model**: `cross-encoder/ms-marco-MiniLM-L-6-v2` (22M params, ~50-150ms latency for 30 candidates)
- **Vector DB**: DuckDB with VSS extension (HNSW index, currently unused; brute-force cosine search)
- **FTS Index**: DuckDB with English stemming and stopword filtering
- **Query Planning**: 66 test cases covering 18 temporal patterns, 4 aggregation triggers, 20 evaluation queries
- **Test Coverage**:
  - **search.rs**: 17 unit tests (dedup, RRF, MMR, cosine similarity)
  - **query_planner.rs**: 66 unit tests (temporal extraction, recency, aggregation, eval queries)
  - **rerank.rs**: 5 unit tests (serialization, response parsing)
  - **context_builder.rs**: 7 unit tests (chronological ordering, truncation, formatting)
  - **Overall**: ~95 existing unit tests

---

## 1. Hybrid Search Pipeline Flow

### Full End-to-End Pipeline (9 Stages)

```
User Query (frontend)
    ↓
[Stage 0] Query Planning (rule-based)
    ↓ Outputs: SearchPlan {
    ├─ search_queries: Vec<String> (cleaned, stemmed)
    ├─ min_date, max_date: temporal constraints (18 patterns)
    ├─ prefer_recent: bool (recency signals)
    ├─ is_aggregation: bool (4 aggregation triggers)
    └─ result_count: usize (7 for normal, 20 for aggregation)
    ↓
[Stage 1] Embed Query (Python subprocess)
    ↓ Output: Vec<f32> [768]
    ├─ Model: modernbert-embed-base-8bit
    ├─ Latency: ~100-300ms (MLX on Apple Silicon)
    ├─ Graceful degradation: returns zero vector if Python fails
    └─ Cached: No, cold start ~2-5s on first call
    ↓
[Stage 2a] Semantic Search (cosine similarity)
    ↓ Fetches: 3x limit (over-fetch for dedup)
    ├─ Query: array_cosine_similarity(embedding, query_embedding)
    ├─ Index: HNSW (created but unused; brute-force search instead)
    ├─ Filters: contact_id, date_range (min/max)
    └─ Cost: O(n) where n = total chunks (~50K max)
    ↓
[Stage 2b] BM25 Full-Text Search (parallel)
    ↓ Fetches: 3x limit
    ├─ Query: FTS match_bm25() on formatted_text
    ├─ Stopwords: English stemmer + 43 custom stops (the, a, is, what, etc.)
    ├─ Index: DuckDB FTS (created on ingestion, auto-migrated on startup)
    ├─ Best-effort: Falls back to semantic-only if FTS unavailable
    └─ Cost: O(log n) with FTS index
    ↓
[Stage 2c] Keyword Search (exact word match via ILIKE)
    ↓ Fetches: Up to 3x limit
    ├─ Query: chunk_data ILIKE %keyword% (AND'd together)
    ├─ Keywords: Extracted from query, stopword-filtered
    ├─ Purpose: Catch exact mentions BM25 might miss
    └─ Cost: O(n) full scan, no index
    ↓
[Stage 3] Reciprocal Rank Fusion (3-way merge)
    ↓ Combines: semantic + BM25 + keyword rankings
    ├─ Formula: score = Σ 1/(60 + rank_i) per list
    ├─ Constant k=60: controls rank sensitivity (tuned for balance)
    ├─ Recency boost: score *= 1/(1 + 0.01 * age_days) (exponential decay)
    ├─ Decay: ~50% boost for messages from last week
    └─ Output: Merged/ranked SearchResults with RRF scores
    ↓
[Stage 4] Contact Diversity Penalty (non-MMR path)
    ↓ Applies: After 2nd result from same contact
    ├─ Formula: score *= 0.5^(n-2) where n = contact result count
    ├─ Example: 3rd+ from same contact = 25% score × original
    ├─ Problem it solves: Prevents 1 dominant contact flooding results
    └─ Re-sort: By adjusted score after penalties applied
    ↓
[Stage 5] Deduplication & Diversity
    ├─ Path A: MMR (if embeddings available, SearchOptions.include_embeddings=true)
    │   ├─ Algorithm: Greedy selection balancing relevance + diversity
    │   ├─ Lambda: 0.7 (70% relevance, 30% diversity)
    │   ├─ Diversity metric: Max cosine similarity to already-selected results
    │   ├─ Contact penalty: Also applied within MMR (0.5^(n-1) after 2 results)
    │   └─ Output: Diverse, balanced top-K results
    │
    └─ Path B: Novelty Dedup (if embeddings unavailable)
        ├─ Algorithm: Greedy inclusion if ≥50% new messages
        ├─ Novelty ratio: new_count / chunk.message_ids.len()
        ├─ Threshold: 50% (adjacent chunks with window=8, stride=4 have exactly 50% overlap)
        ├─ Contact penalty: Applied post-dedup
        └─ Output: Non-redundant chunks with diverse message IDs
    ↓
[Stage 6] Cross-Encoder Reranking (optional)
    ↓ Applies: Only if SearchOptions.rerank=true
    ├─ Model: cross-encoder/ms-marco-MiniLM-L-6-v2 (22M params)
    ├─ Latency: ~50-150ms for 30 candidates on Apple Silicon
    ├─ Python subprocess: `mlx/src/scripts/rerank.py`
    ├─ Over-fetch: Fetches 3x limit candidates before reranking
    ├─ Graceful degradation: Falls back to pre-reranked order if subprocess fails
    └─ Output: Results re-scored by cross-encoder
    ↓
[Stage 7] Recency Boost (query-planner-driven)
    ↓ Applies: If plan.prefer_recent == true
    ├─ Formula: score *= e^(-0.03 * days_ago)
    ├─ Constants:
    │   ├─ RECENCY_LAST_DAYS = 90 (for "last" queries)
    │   ├─ RECENCY_RECENTLY_DAYS = 30 (for "recently" queries)
    │   └─ RECENCY_DECAY_LAMBDA = 0.03 (exponential half-life)
    ├─ Effect:
    │   ├─ 0 days (today): 1.0x multiplier
    │   ├─ 7 days (last week): 0.79x multiplier
    │   ├─ 30 days (last month): 0.41x multiplier
    │   └─ 90 days (3 months): 0.06x multiplier
    └─ Re-sort: By boosted scores after application
    ↓
[Stage 8] Truncation & Formatting
    ├─ Truncate: To requested limit (default 10, aggregation 20)
    ├─ Format: SearchResultResponse for frontend
    ├─ Context building: ContextBuilder formats results chronologically
    │   ├─ Max chars: 16,000 (default, configurable)
    │   ├─ Sorting: Chronological (oldest first) for natural reading
    │   ├─ Headers: [Contact | Date] per chunk
    │   └─ Truncation: Graceful mid-chunk truncation if budget exceeded
    └─ Output: Final ranked, formatted search results
```

---

## 2. Component Deep Dive

### 2.1 Search Module (`crates/ingestion/src/search.rs`)

**Core Algorithms Implemented:**

#### Semantic Search
- **Function**: `search_raw()` → `execute_search_query()`
- **Query**: `array_cosine_similarity(embedding, query_vec[768])`
- **Index**: HNSW (created but not used; brute-force instead)
- **Limitations**: O(n) complexity, hits bottleneck at 50K+ chunks

#### BM25 Full-Text Search
- **Function**: `bm25_search_raw()` → SQL with `match_bm25()`
- **Stopwords**: 43 English words (STOPWORDS constant in queries.rs)
- **Stemming**: English language stemmer (DuckDB FTS built-in)
- **Best-effort**: Returns empty list if FTS extension unavailable; pipeline continues with semantic only

#### Reciprocal Rank Fusion (RRF)
- **Function**: `rrf_merge(lists, limit)`
- **Formula**: `score = Σ 1/(k + rank_i)` where k=60
- **Recency**: `score *= 1/(1 + 0.01 * age_days)`
- **3-way merge**: Combines semantic + BM25 + keyword lists
- **Parameter tuning**: k=60 chosen for balance; could be evaluated

#### Contact Diversity Penalty
- **Function**: `apply_contact_diversity_penalty(results)`
- **Logic**: After 2nd result from same contact, apply `score *= 0.5^(n-2)`
- **Re-rank**: Results re-sorted after penalty application
- **Effectiveness**: Prevents single dominant contact from flooding results

#### Maximal Marginal Relevance (MMR)
- **Function**: `mmr_rerank(candidates, query_embedding, limit, lambda=0.7)`
- **Score formula**: `mmr = lambda * query_sim - (1-lambda) * max_selected_sim`
- **Lambda**: 0.7 (70% relevance, 30% diversity) - **Tunable parameter**
- **Diversity metric**: Cosine similarity to already-selected embeddings
- **Greedy algorithm**: O(k²m) where k=limit, m=candidates
- **Contact penalty**: Also applied (0.5^(n-1) after 2 results from same contact)

#### Deduplication (Novelty Threshold)
- **Function**: `deduplicate_chunks(chunks, max_results, min_similarity)`
- **Novelty threshold**: 50% of messages must be new (not seen in higher-ranked results)
- **Rationale**: Window=8, stride=4 creates exactly 50% overlap between adjacent chunks
- **Message tracking**: HashSet of seen message IDs across results

#### Cosine Similarity
- **Function**: `cosine_similarity(a, b)`
- **Implementation**: Standard dot product / (norm_a * norm_b)
- **Edge cases**: Handles zero-length vectors (returns 0.0)

**Test Coverage (search.rs):**
- 17 unit tests total
- Deduplication: 5 tests (no overlap, with overlap, 50% threshold, rejects high overlap, respects limit)
- RRF merge: 3 tests (combines sources, empty BM25, 3-way merge)
- MMR: 3 tests (diversity selection, empty results, fallback without embeddings)
- Utility functions: 6 tests (keyword extraction, cosine similarity variants)

---

### 2.2 Query Planner Module (`crates/ingestion/src/query_planner.rs`)

**Responsibility**: Rule-based query understanding BEFORE embedding/search

**Input**: Natural language query string
**Output**: SearchPlan {
  - `search_queries: Vec<String>` — cleaned query text for embedding
  - `min_date, max_date: Option<DateTime>` — temporal constraints
  - `prefer_recent: bool` — recency signal
  - `is_aggregation: bool` — summary intent
  - `result_count: usize` — 7 (normal) or 20 (aggregation)
}

#### Temporal Pattern Extraction (18 Patterns)

**Recency Signals:**
1. "last" (e.g., "last restaurant") → min_date = now - 90 days, prefer_recent=true
2. "recently" (e.g., "recently traveled") → min_date = now - 30 days, prefer_recent=true
3. "most recent" / "latest" → min_date = now - 90 days, prefer_recent=true

**Absolute Date Ranges:**
4. "from X to Y" (e.g., "from January 2025 to January 2026")
5. "between X and Y"
6. "in [month] [year]" (e.g., "in December 2025") → calendar month bounds
7. "this [period]" (e.g., "this year") → current year
8. "last [period]" (e.g., "last month") → previous calendar month

**Calendar Boundaries:**
- Month names: Jan–Dec with leap-year handling
- Year extraction: 2024, 2025, 2026, etc.
- Relative month/week calculation from "now"

**Implementation**: 18 regex patterns, ~1278 lines of code, 66 unit tests

#### Query Cleaning

**Aggressive Cleaning** (for embedding):
- Removes temporal phrases, modifiers, filler words
- Example: "what was the last restaurant I went to" → "restaurant"
- Fallback: If cleaning removes everything, use light clean

**Light Cleaning**:
- Removes only obvious stopwords (the, is, are, etc.)
- Fallback for aggressive clean results being empty

#### Aggregation Detection (4 Triggers)

Signals that user wants a summary (fetches 20 results instead of 7):
1. "favorite" / "favourite" (e.g., "my favorite food")
2. "most" / "a lot" (e.g., "who I text most", "hobbies that come up a lot")
3. "usually" / "typically" (e.g., "topics I usually discuss")
4. Time-windowed aggregations with aggregation keywords

**Effect**: Sets `result_count = AGGREGATION_RESULT_COUNT = 20` for better summarization

#### Recency Boost Application

**Function**: `apply_recency_boost(results, prefer_recent)`
**Formula**: `score *= e^(-0.03 * days_ago)` when prefer_recent=true
**Effect**: Re-ranks results, prioritizing recent messages when query signals recency intent

**Test Coverage (query_planner.rs):**
- 66 total unit tests
- Temporal patterns: 40+ tests
- Aggregation detection: 8 tests
- Recency boost: 4 tests
- Query cleaning: 8 tests
- Eval coverage: 20 tests (all evaluation query types)

**Evaluation Queries Tested:**
- **Recency (4)**: "last restaurant", "texted yesterday", "last week", "most recent concert"
- **Temporal (4)**: "vacation Jan-Jan", "concerts this year", "plans in December", "texted most in 2025"
- **Preference (4)**: "favorite food", "talk to most about sports", "music preference", "hobbies come up a lot"
- **Fact (4)**: "when mentioned moving", "meetings about projects", "discussed politics", "birthday dates"
- **Unknown (4)**: Diverse query types for robustness

---

### 2.3 Reranking Module (`crates/ingestion/src/rerank.rs`)

**Purpose**: Provide precise relevance scores via cross-encoder model

**Model**: `cross-encoder/ms-marco-MiniLM-L-6-v2`
- **Size**: 22M parameters
- **Training data**: MS MARCO dataset (query relevance pairs)
- **Latency**: ~50-150ms for 30 candidates on Apple Silicon (M1/M2/M3/M4)
- **Graceful degradation**: Falls back to pre-reranked results if Python unavailable

**Pipeline:**
1. Collect (chunk_id, chunk_text) tuples from hybrid search results
2. Serialize as JSON: `{ "query": "...", "candidates": [{ "chunk_id": i64, "text": String }] }`
3. Spawn Python subprocess (`mlx/src/scripts/rerank.py`)
4. Pass JSON via stdin
5. Parse response: `{ "scores": [{ "chunk_id": i64, "score": f32 }] }`
6. Map scores back to results, re-sort

**Test Coverage (rerank.rs):**
- 5 unit tests
  - Request serialization (JSON structure correct)
  - Response deserialization (parses scores)
  - Error handling (error field in response)
  - Empty candidates (edge case)
  - No actual Python execution in tests

**Limitations:**
- No mock testing of Python subprocess (would require process spawning in tests)
- Best-effort only; falling back silently on failure
- No timeout enforcement (subprocess could hang indefinitely)

---

### 2.4 Context Builder Module (`crates/ingestion/src/context_builder.rs`)

**Purpose**: Format search results as LLM-ready context string

**Default Budget**: 16,000 characters (~4,000 tokens at ~4 chars/token)

**Algorithm:**
1. Sort results chronologically (oldest first)
2. Add header: `"--- Relevant message history for: \"query\" ---\n\n"`
3. For each result:
   - Header: `"[Contact Name | YYYY-MM-DD HH:MM]\n"`
   - Body: `chunk_data.formatted` (already formatted by embedding pipeline)
   - Separator: `"\n\n"`
4. Truncate gracefully if char budget exceeded:
   - At least room for header + 50 chars of content before truncation
   - Add `"...\n\n"` to indicate truncation
5. Footer: `"--- End of message history ---"`

**Test Coverage (context_builder.rs):**
- 7 unit tests
  - Empty results
  - Single result
  - Chronological ordering (oldest first)
  - Truncation at budget
  - Missing contact name (fallback to ID)
  - Query included in header
  - Default max_chars constant

---

### 2.5 Vector Database Module (`crates/ingestion/src/vectordb.rs`)

**Database**: DuckDB at `~/.be-right-back/data/db/brb.duckdb`

**Schema**:
```sql
TABLE message_chunks (
  chunk_id BIGINT PRIMARY KEY,
  chunk_data JSON,                    -- { messages, formatted }
  embedding FLOAT[768],               -- 768-dim ModernBERT
  start_message_id, end_message_id BIGINT,
  message_ids BIGINT[],               -- array of message IDs in chunk
  contact_id STRING,
  contact_name STRING,
  start_timestamp, end_timestamp TIMESTAMP,
  message_count, total_chars INT,
  has_from_me, has_from_them, has_questions BOOLEAN,
  ingestion_id BIGINT,
  formatted_text STRING,              -- for FTS indexing

  -- Indices
  HNSW INDEX idx_chunks_hnsw ON embedding (metric='cosine'),
  FTS INDEX fts_main_message_chunks ON formatted_text
);

TABLE chunk_projections (
  chunk_id BIGINT,
  cluster_id INT,                     -- UMAP/HDBSCAN clustering
  umap_x, umap_y FLOAT
);
```

**Embedding Dimensions**: 768 (modernbert-embed-base-8bit)

**Indexes:**
- **HNSW**: Created on every ingestion, but **currently unused** (brute-force search instead)
  - Binary incompatibility: Python-created HNSW indexes crash on Rust open
  - Workaround: Detected on startup and recreated from Rust
  - Performance impact: Fine for <10K chunks, bottleneck at 50K+

- **FTS**: Created post-ingestion for BM25 search
  - Auto-migrated on startup if missing (handles old databases)
  - Stemmer: English
  - Stopwords: English (built-in DuckDB)

**Memory Configuration:**
- DuckDB memory limit: 4GB (prevent unbounded growth during ingestion)
- Thread count: 2
- VSS extension: Loaded on every open with experimental persistence enabled

**Chunk Insertion**:
- Batched via `insert_chunks(chunks, ingestion_id)`
- Embedding serialized as `[0.1, 0.2, ..., 0.768]` string
- Message IDs serialized as `[1, 2, 3]` array string

---

### 2.6 Queries Module (`crates/ingestion/src/queries.rs`)

**Purpose**: SQL constants and dynamic query builders

**Stopword List**: 43 English words + common noise
```rust
"the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had",
"do", "does", "did", "will", "would", "could", "should", "may", "might",
"shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for",
"on", "with", "at", "by", "from", "as", "into", "about", "like", "through",
"after", "over", "between", "out", "against", "during", "without", "before",
"under", "around", "among", "last", "place", "thing", "stuff",
"it", "this", "that", "my", "your", "our", "what", "where", "when", "who",
"how", "which", "i", "me", "you", "we", "they", "he", "she"
```

**Dynamic Query Builders:**

1. **`build_search_query(embedding, limit, contact_id?, min_date?, max_date?, include_embedding?)`**
   - Builds vector similarity search SQL
   - Embedding interpolated (safe: f32::to_string() → digits/decimal/minus only)
   - Filters: contact_id (param), date range (params), similarity DESC
   - Returns: (SQL string, params vector)

2. **`build_bm25_search_query(query_text, limit, contact_id?, min_date?, max_date?, include_embedding?)`**
   - Builds FTS/BM25 search SQL
   - Query text: stopword-filtered, single-quote-escaped
   - Interpolates into `match_bm25('sanitized_query')`
   - Filters: contact_id, date range
   - Returns: (SQL string, params vector)

3. **`build_keyword_search_query(keywords[], limit, contact_id?, min_date?, max_date?)`**
   - Builds exact-match keyword search (ILIKE)
   - Keywords: AND'd together (`ILIKE %kw1% AND ILIKE %kw2%`)
   - Purpose: Catch exact mentions BM25 might miss
   - Ordered: By end_timestamp DESC (most recent first)

---

## 3. Current Test Coverage Analysis

### Test Inventory

| Module | Tests | Coverage |
|---|---|---|
| search.rs | 17 | Good (core algorithms) |
| query_planner.rs | 66 | Excellent (comprehensive temporal + aggregation) |
| rerank.rs | 5 | Minimal (no Python subprocess testing) |
| context_builder.rs | 7 | Good (formatting, truncation) |
| **Total** | **95** | **~70% of pipeline** |

### Gap Analysis

**Well Tested:**
✓ RRF merge behavior with various input lists
✓ Deduplication novelty threshold (50%)
✓ MMR greedy selection with embeddings
✓ Temporal pattern extraction (18 patterns × 4 test cases each)
✓ Aggregation detection (4 triggers)
✓ Recency boost decay function
✓ Contact diversity penalty formula
✓ Cosine similarity edge cases

**Partially Tested:**
⚠ Reranking subprocess communication (serialization only, no subprocess)
⚠ FTS index creation/fallback (no integration tests)
⚠ Embedding lookup latency (no benchmarks)
⚠ Contact diversity + MMR interaction (need combined test)

**Not Tested (Integration/E2E):**
✗ Full hybrid search end-to-end (semantic + BM25 + keyword merge)
✗ Reranking with actual Python subprocess
✗ Query planning → embedding → search → reranking pipeline
✗ Real message database queries (no fixture data)
✗ Search result ranking quality (no labeled data)
✗ Eval metrics: Precision, Recall, MRR, NDCG
✗ Search latency benchmarks
✗ Cross-contact diversity penalty + MMR interaction

---

## 4. Evaluation Metrics & Opportunities

### Recommended Eval Metrics

#### Ranking Quality (Test Set of ~100 Queries)

1. **Mean Reciprocal Rank (MRR)**
   - Measures: How soon is first correct result?
   - Formula: MRR = (1/N) × Σ(1/rank_i) where N=query count
   - Target: >0.5 (correct answer in top 2)
   - Use: Evaluate temporal + fact queries

2. **Normalized Discounted Cumulative Gain (NDCG@10)**
   - Measures: Ranking quality accounting for position decay
   - Formula: NDCG = DCG / iDCG where DCG = Σ(rel_i / log₂(i+1))
   - Target: >0.7 for relevant results, >0.8 for good ranking
   - Use: Evaluate preference + aggregation queries

3. **Precision@K** (K=5, 10)
   - Measures: What fraction of top-K results are relevant?
   - Formula: P@K = (relevant in top K) / K
   - Target: >0.7 for P@10
   - Use: Evaluate noise/irrelevance issues

4. **Recall@K** (K=10, 20)
   - Measures: How many relevant results are retrieved?
   - Formula: R@K = (relevant retrieved) / (total relevant)
   - Target: >0.8 for primary search intent
   - Use: Evaluate missing results

5. **Contact Diversity Ratio**
   - Measures: Are results from single contact over-represented?
   - Formula: max_contact_count / result_count
   - Target: <0.5 (no contact >50% of results)
   - Use: Validate contact diversity penalty

#### Latency Benchmarks

6. **Query Planning Latency**
   - Target: <5ms (regex-based, should be instant)
   - Measurement: Time in plan_search()

7. **Embedding Latency**
   - Target: ~100-300ms (Python subprocess)
   - Measurement: Time in embed_query()
   - Note: First call ~2-5s (model load)

8. **Semantic Search Latency**
   - Target: <100ms (brute-force cosine, 50K chunks)
   - Measurement: Time in search_raw()
   - Bottleneck: O(n) complexity

9. **BM25 Search Latency**
   - Target: <50ms (FTS indexed)
   - Measurement: Time in bm25_search_raw()

10. **RRF Merge Latency**
    - Target: <10ms (in-memory merge)
    - Measurement: Time in rrf_merge()

11. **Reranking Latency**
    - Target: ~50-150ms for 30 candidates
    - Measurement: Time in rerank_candidates()
    - Note: Optional, depends on model availability

12. **Total E2E Latency**
    - Target: <2 seconds (embedding + search + merge)
    - Measurement: Full search_messages() command

#### Quality of Life Metrics

13. **Query Planner Temporal Accuracy**
    - Test: Do extracted date ranges match intent?
    - Example: "vacation Jan-Jan 2025" → correct bounds?
    - Already tested: 20 eval queries in query_planner.rs

14. **Aggregation Detection Precision**
    - Test: How often is aggregation correctly identified?
    - Formula: (correct aggregation detections) / (total detections)
    - Target: >0.95

15. **Recency Preference Quality**
    - Test: Do prefer_recent=true queries actually rank recent first?
    - Measurement: Average position of results >90 days old
    - Target: >position 5 (recent results dominate top 5)

---

## 5. Build Infrastructure

### Running Tests

```bash
# All tests (Rust)
cargo test

# Single crate
cargo test -p ingestion

# Single test
cargo test -p ingestion test_rrf_merge_combines_sources

# With output
cargo test -- --nocapture

# Specific module
cargo test query_planner::tests
```

### Existing Test Fixtures

**Query Planner**:
- Test "now": February 9, 2026 (hardcoded constant)
- Query patterns: 18 temporal + 4 aggregation + 20 eval queries
- No external data needed

**Search**:
- Mock `SearchResult` builders
- Artificial message ID arrays
- No real database access

**Context Builder**:
- Mock `SearchResult` with varying timestamps
- Artificial contact names
- No real database access

**Reranking**:
- JSON serialization tests (no subprocess)
- Mock response parsing
- No Python execution

---

## 6. Evaluation Dataset Requirements

### For Quality Evals

**Recommended Test Set Structure:**
```
100 Total Queries {
  20 Recency ("last restaurant", "yesterday", "last week", "recently")
  20 Temporal ("Jan-Jan 2025", "this year", "December", "2025")
  20 Preference ("favorite", "most", "usually", "a lot")
  20 Factual ("who", "when", "where", "what happened")
  20 Aggregation (require summarization ability)
}
```

**Per Query, Label:**
- Expected contact(s): e.g., "Alice" (contact_id)
- Expected time range: e.g., "2025-01-15 to 2025-01-31"
- Expected relevance: 1-5 scale (perfect → poor)
- Top-5 chunks (in order) that should be returned

**Data Source:**
- Real iMessage history (if available)
- OR: Synthetic test database with 5-10 contacts, 500-1000 messages
- Sample size: 50-100 messages per contact minimum

### Benchmark Datasets

**For Comparison:**
- MS MARCO: Cross-encoder trained on this (50K+ passage pairs)
- Natural Questions: Open-domain QA (79K questions)
- Consider: Build "Be Right Back Eval" (small but domain-specific)

---

## 7. Parameter Tuning Opportunities

### Tunable Hyperparameters

| Parameter | Current | Range | Impact | Test Needed |
|---|---|---|---|---|
| **RRF k constant** | 60 | 30-100 | Rank sensitivity; affects position weighting | RRF sweep |
| **Lambda (MMR)** | 0.7 | 0.3-0.9 | Relevance vs diversity balance | Diversity vs accuracy trade-off |
| **Contact penalty** | 0.5^(n-2) | 0.5^(n-1) to 0.5^(n-3) | Contact diversity aggressiveness | User study (preference) |
| **Novelty threshold** | 0.5 | 0.4-0.6 | Overlap tolerance between chunks | Redundancy analysis |
| **Recency decay λ** | 0.03 | 0.01-0.05 | Age discount rate | Recency preference study |
| **FTS stopword list** | 43 words | Add/remove words | Keyword search quality | BM25 precision/recall |
| **Default limit** | 10 | 5-20 | Number of results returned | User satisfaction |
| **Aggregation limit** | 20 | 15-30 | Summary query comprehensiveness | LLM aggregation quality |
| **Min similarity threshold** | 0.1 | 0.0-0.3 | Minimum score to include result | Precision at low scores |

### Recommended Tuning Study

**Phase 1 (One Week):**
- Hold out 30 queries as test set
- Run search with default hyperparameters
- Compute baseline MRR, NDCG@10, Precision@10
- Label top-5 results per query (1-5 relevance scale)

**Phase 2 (Two Weeks):**
- Sweep RRF k ∈ {30, 45, 60, 75, 90}
- Sweep Lambda ∈ {0.3, 0.5, 0.7, 0.9}
- Sweep Recency λ ∈ {0.01, 0.02, 0.03, 0.05}
- Measure impact on MRR + NDCG per combination
- Pick top 3 combinations

**Phase 3 (One Week):**
- Fine-tune top 3 combinations on 50-query validation set
- Measure final metrics
- Deploy winner

---

## 8. Proposed Evaluation Framework

### Architecture

```
evaluation/
├── data/
│   ├── queries_100.jsonl         # {query, expected_contacts, expected_time_range, labels: {chunk_id, relevance}}
│   ├── synthetic_messages.db     # SQLite test DB
│   └── fixtures/
│       ├── alice_messages.txt
│       ├── bob_messages.txt
│       └── ...
├── metrics/
│   ├── ranking.rs                # MRR, NDCG, Precision, Recall
│   ├── latency.rs                # Benchmarking infrastructure
│   └── diversity.rs              # Contact diversity ratio
├── tests/
│   ├── integration_tests.rs       # Full pipeline E2E
│   ├── search_quality_tests.rs    # With labeled data
│   └── temporal_accuracy_tests.rs # Query planning validation
├── scripts/
│   ├── generate_synthetic_db.py   # Create test database
│   ├── run_evals.sh               # Orchestrate all tests
│   └── plot_results.py            # Visualization
└── README.md
```

### Metrics Module (Proposed)

```rust
// ranking.rs
pub fn mean_reciprocal_rank(results: Vec<SearchResult>, gold: Vec<GoldChunkId>) -> f32 {
    // For each query, find rank of first gold chunk, compute 1/rank, average across queries
}

pub fn ndcg_at_k(results: Vec<SearchResult>, relevances: Vec<Relevance>, k: usize) -> f32 {
    // Compute DCG@k with position decay, normalize by iDCG
}

pub fn precision_at_k(results: Vec<SearchResult>, gold: Vec<GoldChunkId>, k: usize) -> f32 {
    // Fraction of top-k results in gold set
}

pub fn recall_at_k(results: Vec<SearchResult>, gold: Vec<GoldChunkId>, k: usize) -> f32 {
    // Fraction of gold set in top-k results
}

pub fn contact_diversity_ratio(results: Vec<SearchResult>) -> f32 {
    // max_contact_count / result_count
}

// latency.rs
pub fn benchmark_query_planning(query: &str) -> Duration {
    let start = Instant::now();
    let plan = plan_search(query);
    start.elapsed()
}

pub fn benchmark_e2e_search(query: &str) -> SearchBenchmark {
    // Time each stage: plan → embed → search → merge → rerank
}
```

### Integration Test Example

```rust
#[test]
fn test_search_quality_recency_1() {
    // Setup: Load synthetic DB with messages from Alice
    let db = load_synthetic_db("alice_messages.txt");

    // Query: "what was the last restaurant I went to"
    let results = search("what was the last restaurant I went to");

    // Expected: Chunk IDs [42, 51, 63] (labeled restaurant mentions)
    // Measure: MRR@10, NDCG@10
    let gold = vec![42, 51, 63];
    let mrr = mean_reciprocal_rank(&results, &gold);

    assert!(mrr > 0.5, "MRR should be >0.5 for recency query");
}

#[test]
fn test_contact_diversity_enforced() {
    let results = search_messages("favorite coffee places");
    let alice_count = results.iter().filter(|r| r.contact_id == "alice").count();
    let total = results.len();

    assert!(alice_count as f32 / total as f32 < 0.5, "No contact >50% of results");
}
```

---

## 9. Known Issues & Edge Cases

### Search Pipeline Issues

1. **HNSW Index Not Used**
   - Current: Brute-force cosine search (O(n))
   - Impact: ~100ms for 50K chunks (acceptable for now)
   - Future: Enable HNSW index at 10K+ chunks for sublinear search
   - Blocker: Python-created indexes crash on Rust open (workaround: recreate on startup)

2. **Reranking Subprocess Timeout**
   - Current: No timeout on Python subprocess
   - Risk: Subprocess could hang indefinitely
   - Mitigation: Graceful degradation (falls back to pre-reranked order)
   - Recommended: Add 5-second timeout

3. **FTS Index Availability**
   - Current: BM25 search falls back silently if FTS unavailable
   - Risk: Silent degradation (user unaware)
   - Mitigation: Log warning; consider frontend indicator
   - Test: No integration tests for FTS fallback

4. **Embedding Latency**
   - Current: ~100-300ms per query (subprocess overhead)
   - First call: ~2-5s (model load)
   - Improvement: Daemon mode subprocess (keep Python running)
   - Currently used for: Interactive chat (Casper), not search

5. **Query Planning Aggressiveness**
   - Current: Aggressive cleaning removes ~50% of query text
   - Risk: Loss of semantic information (e.g., "like" as preference)
   - Fallback: Light cleaning preserves more context
   - Recommendation: Profile queries to find failure modes

### Data Quality Issues

6. **Contact Name Resolution**
   - Current: Uses contact_name from snapshot (may be missing)
   - Fallback: Falls back to contact_id (phone number)
   - UX Impact: Results show "+15551234567" instead of "Alice"
   - Mitigation: Ensure contact resolver catches all names

7. **Timestamp Conversion**
   - Current: iMessage uses Apple epoch (2001-01-01)
   - Risk: Off-by-19-year error if conversion fails
   - Mitigation: Unit tests cover conversion; uses COCOA_TO_UNIX_OFFSET

---

## 10. Recommendations

### High Priority (1-2 weeks)

1. **Build labeled eval dataset**
   - 100 queries (20 per type: recency, temporal, preference, factual, aggregation)
   - Label: Expected chunk IDs + relevance 1-5
   - Source: Real iMessage history or synthetic DB

2. **Implement ranking metrics**
   - MRR, NDCG@10, Precision@10, Recall@10, contact diversity ratio
   - Add to `evaluation/metrics/` crate
   - Run on baseline hyperparameters

3. **E2E integration tests**
   - Synthetic database with 10 contacts, 500+ messages
   - Test full pipeline: plan → embed → search → rerank
   - Verify no panics, reasonable performance

### Medium Priority (2-4 weeks)

4. **Hyperparameter sweep**
   - Tune RRF k, MMR lambda, recency decay on validation set
   - Measure impact on MRR + NDCG
   - Document recommended values

5. **Latency profiling**
   - Benchmark each stage: plan (5ms?), embed (150ms?), search (50ms?), merge (10ms?)
   - Identify bottlenecks (likely: embedding subprocess)
   - Profile HNSW index impact (currently unused)

6. **Improve reranking**
   - Add timeout to subprocess (5 seconds)
   - Add logging for failures
   - Consider caching reranker across queries

### Lower Priority (1 month+)

7. **Enable HNSW index**
   - Requires fixing Python/Rust binary incompatibility
   - OR: Rebuild index on startup (current workaround)
   - Expected improvement: 50ms → 10ms for 50K chunks

8. **Daemon mode embedding**
   - Keep Python subprocess alive between queries
   - Expected improvement: 150ms → 50ms per query (eliminate subprocess overhead)
   - Risk: Memory management, crash recovery

9. **User study**
   - Validate contact diversity penalty (is 0.5^(n-2) good?)
   - Validate recency decay (users prefer recent?)
   - Validate result count (7 vs 10 vs 20?)

---

## 11. Critical Files & Line References

| File | Lines | Key Functions |
|---|---|---|
| search.rs | 1-899 | hybrid_search (128), search (232), rrf_merge (424), mmr_rerank (506) |
| query_planner.rs | 1-1278 | plan_search (140), extract temporal patterns (300-700), aggregation triggers (800-900) |
| rerank.rs | 1-227 | rerank_candidates (68) |
| context_builder.rs | 1-195 | build (54) |
| vectordb.rs | 1-334 | open (62), hybrid_search caller (via VectorDb instance) |
| queries.rs | 1-717 | build_search_query (438), build_bm25_search_query (545), STOPWORDS (12) |
| commands/search.rs (Tauri) | 1-278 | search_messages (56), search_messages_with_context (158) |

---

## Appendix: Configuration Constants

| Constant | Value | Module | Purpose |
|---|---|---|---|
| K (RRF) | 60 | search.rs:425 | Rank sensitivity; controls weighting |
| Lambda (MMR) | 0.7 | search.rs:506 | Relevance vs diversity (70/30 split) |
| Novelty threshold | 0.5 | search.rs:631 | Minimum new message % to include chunk |
| Contact penalty | 0.5^(n-2) | search.rs:480 | Exponential decay after 2nd result |
| Embedding dims | 768 | vectordb.rs:17 | ModernBERT embed-base-8bit |
| Default limit | 10 | search.rs:46, command 63 | Number of results returned |
| Aggregation limit | 20 | query_planner.rs:32 | Results for summary queries |
| Recency last | 90 days | query_planner.rs:35 | "Last" query window |
| Recency recently | 30 days | query_planner.rs:38 | "Recently" query window |
| Recency decay λ | 0.03 | query_planner.rs:41 | Exponential decay constant |
| Min similarity | 0.1 | command:101, 204 | Minimum score threshold |
| Max context chars | 16,000 | context_builder.rs:10 | Default LLM context budget |
| BM25 stopwords | 43 | queries.rs:12 | English noise words |
| DuckDB memory | 4GB | vectordb.rs:73 | Memory limit during ingestion |
| DuckDB threads | 2 | vectordb.rs:73 | Thread count for queries |

---

## Summary Table: Eval Opportunities

| Metric | Implementation | Priority | Expected Impact |
|---|---|---|---|
| MRR, NDCG, P@10, R@10 | Build labeled test set + scoring functions | High | Baseline quality assessment |
| Contact diversity ratio | Count max/total in results | Medium | Validate diversity penalty |
| Latency breakdown | Profile each stage (plan, embed, search, merge) | Medium | Identify bottlenecks |
| RRF k tuning | Sweep k ∈ {30..90} on validation set | Medium | +5-10% ranking quality |
| MMR lambda tuning | Sweep λ ∈ {0.3..0.9} on validation set | Medium | +3-5% diversity/quality tradeoff |
| Recency decay tuning | Sweep λ ∈ {0.01..0.05} on temporal queries | Low | +2-3% recency quality |
| Query planning accuracy | Test on 20 eval queries | High | Ensure temporal extraction works |
| E2E integration tests | Full pipeline on synthetic DB | High | Catch regressions |
| HNSW index impact | Measure search latency improvement | Low | Future optimization (50ms → 10ms) |

---

## Conclusion

The Be Right Back search pipeline is **well-structured but under-tested for quality**. Existing 95 unit tests cover algorithms thoroughly, but **no integration tests, no labeled eval data, and no ranking metrics** exist. Building an evaluation framework with 100 labeled queries and standard IR metrics (MRR, NDCG) is the **highest-priority next step**. This will enable:

1. ✅ Baseline quality assessment
2. ✅ Hyperparameter tuning (RRF k, MMR λ, recency decay)
3. ✅ Regression detection
4. ✅ Iterative improvement targeting

**Estimated effort:**
- Eval framework: 1-2 weeks
- Labeled dataset: 1 week
- Hyperparameter tuning: 2 weeks
- Total: 4-5 weeks to production-quality evals


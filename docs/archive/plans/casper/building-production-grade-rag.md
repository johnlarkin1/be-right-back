# Building a production-grade RAG agent over iMessage data

Casper's three query patterns each expose a different fundamental limitation of pure top-K vector search, and fixing them requires a **layered architecture** combining entity extraction at ingestion, hybrid retrieval (BM25 + vector), a deterministic query router, and cross-encoder re-ranking. The highest-impact changes are adding sender attribution to chunk text, building a pre-extracted entity table for exhaustive queries, and implementing DuckDB's native FTS extension alongside HNSW — together, these address all three query patterns while keeping the system entirely local on Apple Silicon.

This report provides concrete schemas, architecture decisions, model recommendations, and implementation patterns across six areas, organized from ingestion-time improvements through query-time architecture to retrieval-quality techniques.

---

## Sender attribution and overlapping chunks fix the embedding foundation

Two changes to your chunking strategy will have outsized impact on retrieval quality across all query types.

**Add sender attribution to chunk text before embedding.** Your current chunks join raw message text with no indication of who said what. This makes queries like "What did I say about sushi?" and "What did Riley recommend?" semantically indistinguishable during retrieval. The fix is simple — prepend sender labels:

```
Me: hey want to get sushi tomorrow?
Riley: omg yes definitely
Riley: that new place on 5th?
Me: yeah sashimi spot. 7pm work?
Riley: perfect see you there
```

Use **"Me:"** consistently for the user (creates a stable embedding pattern for first-person queries) and **actual contact names** for others. This format mirrors conversational transcripts that ModernBERT has seen in training data, so it encodes cleanly. Don't include timestamps in the embedded text — they add noise. Store them as metadata columns instead.

**Switch from non-overlapping to 2-message overlap windows.** Your current non-overlapping 5-message chunks split question-answer pairs at boundaries — a question at message 5 of chunk N gets separated from its answer at message 1 of chunk N+1. Adding **2-message overlap** (step size of 3) ensures every Q-A pair appears intact in at least one chunk. Research consensus across multiple RAG practitioners recommends 20–50% overlap for conversational text, and 2 out of 5 messages (40%) hits this range precisely.

Consider also switching to **token-budget chunking** (target ~200 tokens, max ~400) instead of fixed 5-message windows. Five emoji-only messages produce a near-empty chunk; five paragraph-length messages produce one that's unnecessarily large. A token budget normalizes information density across chunks.

For the `search_document:` prefix, prepend a lightweight metadata header before the conversation text:

```
search_document: Participants: Me, Riley | Date: 2025-01-15
Me: hey want to get sushi tomorrow?
Riley: omg yes definitely
...
```

This contextualizes the embedding without overwhelming it. Anthropic's Contextual Retrieval research found that adding situating context to chunks before embedding reduces retrieval failures by **35%** — and by **67%** when combined with BM25 hybrid search and re-ranking.

---

## Hybrid search with DuckDB's native BM25 catches what embeddings miss

Pure vector search fails on proper nouns, abbreviations, and personal jargon — exactly the content that dominates iMessage. **DuckDB has a native FTS extension** providing Okapi BM25 scoring via an inverted index, and combining it with HNSW cosine similarity via Reciprocal Rank Fusion is the single most effective retrieval improvement available.

**Setting up BM25 in DuckDB:**

```sql
INSTALL fts;
LOAD fts;

PRAGMA create_fts_index(
    'chunks', 'chunk_id', 'formatted_text',
    stemmer = 'english',
    stopwords = 'english',
    lower = 1,
    overwrite = 1
);
```

The FTS index does not auto-update on inserts — you must rebuild it with `overwrite = 1` after batch ingestion. BM25 queries return `NULL` for non-matching documents, which makes fusion straightforward.

**Reciprocal Rank Fusion (RRF) is the recommended fusion method** because it's score-agnostic — BM25 scores are unbounded while cosine similarity is bounded to [-1, 1], making direct score combination unreliable without careful normalization. RRF uses only rank positions:

```sql
WITH vector_results AS (
    SELECT chunk_id,
           ROW_NUMBER() OVER (ORDER BY array_cosine_similarity(embedding, ?::FLOAT[768]) DESC) AS vec_rank
    FROM chunks
    ORDER BY array_cosine_similarity(embedding, ?::FLOAT[768]) DESC
    LIMIT 100
),
bm25_results AS (
    SELECT chunk_id,
           ROW_NUMBER() OVER (ORDER BY fts_main_chunks.match_bm25(chunk_id, ?) DESC) AS bm25_rank
    FROM chunks
    WHERE fts_main_chunks.match_bm25(chunk_id, ?) IS NOT NULL
    LIMIT 100
),
fused AS (
    SELECT COALESCE(v.chunk_id, b.chunk_id) AS chunk_id,
           COALESCE(1.0 / (60 + v.vec_rank), 0) +
           COALESCE(1.0 / (60 + b.bm25_rank), 0) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN bm25_results b ON v.chunk_id = b.chunk_id
)
SELECT f.chunk_id, f.rrf_score, c.formatted_text
FROM fused f
JOIN chunks c ON f.chunk_id = c.chunk_id
ORDER BY f.rrf_score DESC
LIMIT 10;
```

The constant **k=60** is standard for RRF. Hybrid search is particularly valuable for iMessage because BM25 catches exact matches on restaurant names ("Nobu"), abbreviations ("lmk", "omw"), and personal jargon that embeddings trained on general web data miss entirely. If you later build evaluation data, experiment with convex combination (TM2C2) at α=0.6–0.7 favoring semantic search, which can outperform RRF with tuning.

---

## A pre-extracted entity table is the only reliable solution for exhaustive queries

Vector search returns top-K — it fundamentally cannot answer "find ALL restaurants I've chatted about" because you don't know K in advance, and informal mentions ("that ramen place on 5th") may embed far from "restaurant." The solution is **entity extraction at ingestion time** stored in a normalized table that SQL can scan exhaustively.

**Two-tier extraction pipeline:**

- **Tier 1 — GLiNER** (fast, every chunk): A compact 209M-parameter zero-shot NER model that accepts arbitrary entity type labels at inference. Pass labels like `["restaurant", "location", "person", "event", "activity", "food", "movie"]` and it extracts matching spans. Runs at ~50–100ms per chunk on CPU. Set threshold to **0.35** to favor recall over precision. One limitation: GLiNER underperforms on informal/tweet-style text compared to formal text, so it needs supplementation.

- **Tier 2 — Local LLM via MLX** (slower, catches informal mentions): A quantized 3B model like Llama-3.2-3B-Instruct handles "that ramen place on 5th" → `{type: "restaurant", mention: "that ramen place on 5th"}` through few-shot prompting. Processing a 5-message chunk takes ~1–3 seconds. Run this on all chunks during initial bulk ingestion, then on new chunks incrementally.

**Schema design — use two separate tables, not a JSON column:**

```sql
CREATE TABLE entities (
    entity_id       INTEGER PRIMARY KEY,
    entity_type     VARCHAR NOT NULL,     -- 'restaurant', 'location', etc.
    canonical_name  VARCHAR NOT NULL,     -- "Ichiran Ramen"
    aliases         VARCHAR[],            -- ["ichiran", "that ramen place on 5th"]
    first_seen      TIMESTAMP,
    last_seen       TIMESTAMP,
    mention_count   INTEGER DEFAULT 0,
    UNIQUE (entity_type, canonical_name)
);

CREATE TABLE entity_mentions (
    mention_id      INTEGER PRIMARY KEY,
    entity_id       INTEGER REFERENCES entities(entity_id),
    chunk_id        VARCHAR NOT NULL REFERENCES chunks(chunk_id),
    message_id      BIGINT,
    contact_id      VARCHAR NOT NULL,
    mention_text    VARCHAR NOT NULL,     -- exact text from message
    entity_type     VARCHAR NOT NULL,     -- denormalized for fast filtering
    confidence      FLOAT,
    is_from_me      BOOLEAN,
    timestamp       TIMESTAMP NOT NULL
);

CREATE INDEX idx_entities_type ON entities (entity_type);
CREATE INDEX idx_mentions_entity ON entity_mentions (entity_id);
CREATE INDEX idx_mentions_type ON entity_mentions (entity_type);
CREATE INDEX idx_mentions_contact ON entity_mentions (contact_id);
```

A JSON column on the chunks table prevents SQL-level filtering and aggregation. The normalized table enables the exact query pattern exhaustive discovery needs:

```sql
SELECT DISTINCT e.canonical_name, e.aliases,
       COUNT(*) as mention_count,
       MAX(em.timestamp) as last_mentioned,
       ARRAY_AGG(DISTINCT em.contact_id) as discussed_with
FROM entities e
JOIN entity_mentions em ON e.entity_id = em.entity_id
WHERE e.entity_type = 'restaurant'
GROUP BY e.entity_id, e.canonical_name, e.aliases
ORDER BY last_mentioned DESC;
```

**For maximum recall on exhaustive queries, use a multi-pass pipeline:** (1) Entity table scan for known entities, (2) BM25 keyword search with expanded terms ("restaurant dinner lunch cafe bistro food place eat") filtered through the LLM, (3) Vector search top-100 as a final sweep. Union and deduplicate. If pass 3 finds zero new entities after passes 1–2, confidence in completeness is high.

**DuckDB-specific optimization:** Insert chunks ordered by `min_timestamp`. DuckDB's zone maps (min/max per row group) will enable timestamp-range queries to skip irrelevant row groups entirely, providing substantial speedups for temporal queries.

---

## A semantic router plus deterministic graph beats a ReAct agent loop

Full ReAct-style agent loops add 200–2000ms per iteration from LLM calls. For a personal message system where users expect near-instant responses, a **two-stage classification plus deterministic routing graph** provides the right balance of flexibility and speed.

**Stage 1 — Semantic Router (~5ms):** Pre-encode 10–15 example utterances per intent category using your existing ModernBERT encoder. At query time, embed the query and find the maximum-similarity route via cosine similarity. This reuses your existing embedding infrastructure and adds negligible latency. The intent categories for Casper:

| Intent | Example | Primary strategy |
|---|---|---|
| `ENTITY_TEMPORAL` | "Last restaurant I went to?" | Entity table + temporal sort |
| `CONTACT_FILTERED` | "Where did @Riley travel?" | contact_id filter + vector search |
| `EXHAUSTIVE_DISCOVERY` | "All restaurants I've chatted about" | Multi-pass entity + BM25 + vector |
| `GENERAL_SEMANTIC` | "Conversations about moving" | Hybrid vector + BM25 |
| `MULTI_HOP` | "Last restaurant with Riley?" | Decompose → sub-queries → intersect |
| `FACTUAL_RECALL` | "Riley's address?" | Entity lookup → vector fallback |

**Stage 2 — LLM structured parameter extraction (~100–300ms):** After classification, use the local LLM to extract structured parameters — contact name, entity type, time range, sort order — that map directly to your `build_search_query()` filters. This is the "self-querying retrieval" pattern where the LLM generates metadata filters from natural language.

**The routing graph is deterministic, not agentic.** Each intent maps to a fixed execution plan:

```
User Query → Embed (5ms) → Semantic Route → LLM Extract Params (200ms)
    → DETERMINISTIC ROUTER
        → ENTITY_TEMPORAL:     entity_table + ORDER BY date DESC LIMIT 1
        → CONTACT_FILTERED:    WHERE contact_id=? + vector search
        → EXHAUSTIVE_DISCOVERY: entity_table + BM25 + vector (multi-pass)
        → GENERAL_SEMANTIC:    hybrid BM25 + vector with RRF
        → MULTI_HOP:          decompose → sub-queries → intersect
    → Result Merger (dedup, re-rank)
    → CRAG relevance check (optional, 100ms)
    → LLM Generation (500-1500ms, streamed)
```

For **CRAG (Corrective RAG)**, add a lightweight relevance check after retrieval: if top results score below a confidence threshold (e.g., cosine similarity < 0.5 and BM25 score is null), retry with query expansion or broader search. Cap at **3 total iterations** to bound latency. For most queries, 1 iteration suffices.

**Query decomposition for multi-hop queries** should be handled by the LLM during parameter extraction. "Last restaurant I went to with Riley?" decomposes into: (1) resolve "Riley" → contact_id, (2) search for restaurant mentions filtered by contact_id, (3) sort by timestamp descending, limit 1. The LLM can output this as a structured plan that the deterministic router executes.

---

## Cross-encoder re-ranking and MMR deliver the final quality lift

After hybrid retrieval, two techniques provide substantial quality improvements with acceptable latency on Apple Silicon.

**Cross-encoder re-ranking** takes (query, chunk) pairs and produces a relevance score via full cross-attention — far more accurate than bi-encoder cosine similarity, but ~100× slower per pair. The standard pipeline: retrieve top-20 with HNSW + BM25, re-rank with cross-encoder, return top-5.

Start with **ms-marco-MiniLM-L-6-v2** (22M parameters, ~5–15ms per pair on M2+, ~100–300ms total for 20 chunks). For better quality, **Qwen3-Reranker-0.6B** is the sweet spot — instruction-aware, available in MLX-compatible 4-bit quantized format via the `embed-rerank` package, which reports 0.2ms single-text embedding latency on MLX vs 45ms PyTorch MPS. Re-ranking typically improves accuracy **20–35%** and reduced Anthropic's measured retrieval failure rate from 5.7% to 1.9%.

**Replace your 50% message_id overlap deduplication with MMR (Maximal Marginal Relevance).** MMR iteratively selects documents that are both relevant to the query AND diverse from already-selected documents, using a tunable λ parameter (1.0 = pure relevance, 0.0 = pure diversity). For Casper, **λ=0.6** balances relevance with diversity well. MMR catches semantic near-duplicates that message_id overlap misses — two chunks from the same conversation discussing the same restaurant with different messages will both have high cosine similarity to each other, so MMR will select only the more relevant one.

A recommended tiered deduplication pipeline: (1) Remove chunks with >80% message_id overlap (cheap exact dedup), (2) Apply MMR with λ=0.6 to remaining results, (3) Group results by conversation_id and present top result per conversation with drill-down capability.

---

## The complete retrieval pipeline and implementation roadmap

The full Casper v2 pipeline, running entirely locally on Apple Silicon within a **~500ms–1.5s latency budget**:

```
Query → ModernBERT Embed (5ms) → Semantic Route (2ms) → LLM Param Extract (200ms)
  → Hybrid Search: HNSW top-50 + BM25 top-50 (20ms)
  → RRF Merge (top-30)
  → Cross-Encoder Rerank: top-30 → top-10 (200ms)
  → MMR Diversity: top-10 → top-5 (<5ms)
  → LLM Generation with 5 chunks as context (500-1500ms, streamed)
```

Memory budget for the full pipeline on Apple Silicon: ModernBERT (~1.5GB) + MiniLM reranker (~0.5GB) + Qwen3-0.6B for query expansion (~0.5GB) + 8B generation model (~5GB) = **~7.5GB total**. Comfortable on 16GB, spacious on 32GB+.

**Implementation priority, ordered by impact-to-effort ratio:**

- **Phase 1 (highest impact, do first):** Add sender attribution to chunk text ("Me:" / "Riley:"). Add DuckDB FTS index + hybrid search with RRF. Add 2-message overlap to sliding windows. Replace message_id dedup with MMR.

- **Phase 2 (entity infrastructure):** Build GLiNER + LLM entity extraction pipeline. Create `entities` and `entity_mentions` tables. Implement multi-pass exhaustive retrieval. Add cross-encoder re-ranking (MiniLM-L-6).

- **Phase 3 (agent intelligence):** Build semantic router for intent classification. Add LLM-based parameter extraction and query decomposition. Implement CRAG-style relevance checking. Add multi-query expansion with RRF.

- **Phase 4 (advanced, diminishing returns):** Contextual Retrieval (LLM-generated context prefixes at ingestion). Parent-child chunk retrieval. HyDE for vague exploratory queries. Token-budget adaptive chunking.

## Conclusion

The core insight is that personal message data requires fundamentally different retrieval strategies than document search. Messages are short, informal, context-dependent, and spread entity mentions across thousands of fragments — no single retrieval method handles all query types. The architecture that works is a **layered system**: structured entity tables for exhaustive queries, BM25 for exact keyword matches, vector search for semantic similarity, and a deterministic router that picks the right combination for each query. The entity extraction table is the most architecturally significant addition — it transforms "find all X" from an impossible top-K problem into a simple SQL scan. Hybrid BM25 + vector with RRF is the highest-impact single retrieval change. And sender attribution in chunk text is the cheapest change with the largest per-query quality improvement. Together, these move Casper from a basic vector search system to a genuinely capable personal knowledge agent.

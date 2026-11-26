# How Do You Know Casper's Retrieval Is Actually Working?

*Lead-engineer synthesis. One plan, prioritized, corrected against the adversarial reviews. The headline correction: the version of this that ships must test the **real embedder's geometry**, not hand-drawn vectors — otherwise a green check proves nothing about retrieval.*

---

## 1. The answer, in 5 sentences

Casper's retrieval is a hybrid pipeline — ModernBERT semantic search over a DuckDB HNSW index fused with BM25 via RRF (K=60), then MMR dedup, a contact-diversity penalty, optional cross-encoder rerank, and a recency prior — and "knowing it works" means measuring each of those stages against a labeled gold set, not eyeballing results. Because the corpus is private and per-user, I build gold four ways: a **committed synthetic fixture with *real* precomputed ModernBERT embeddings** as the deterministic CI regression gate, an **on-device self-labeled set** generated from the user's own messages for real per-user signal, a **tiny human seed** to keep the machinery honest, and a **public benchmark (LongMemEval_S)** so the numbers are legible to someone who has never seen my inbox. Gold is expressed as **stable iMessage `message_id`s resolved to chunks at eval time** (never `chunk_id`, which is non-stable, and never the `message_ids` range column, which over-counts), scored as **message-coverage** so the window=8/stride=4 overlap doesn't corrupt the metric. I report **recall@k, MRR, and per-stratum breakdowns with per-stage attribution** (semantic vs BM25 vs fused vs final) so a regression is *attributable* to the embedder, the FTS index, the fusion math, or the reranker — and gate CI on named-query assertions plus baseline-diff with a bless flag. Generation-side, a separate non-gating nightly eval checks **faithfulness and no-context refusal** — the failure the interviewer is really asking about — and it will *correctly* fail today because the system prompt literally instructs the model to never refuse.

---

## 2. What's missing today

**What exists:** 109 unit tests — `query_planner.rs` (76), `search.rs` (26, RRF/MMR mechanics), `context_builder.rs` (7). These are good and cover the *arithmetic*.

**What does not exist — the entire retrieval-quality layer:**

| Missing | Consequence |
|---|---|
| Any golden set (query → relevant chunk) | No notion of "correct" retrieval anywhere in the repo |
| recall@k / MRR / nDCG | Can't say whether the right chunk is even retrieved, let alone ranked well |
| A regression harness / baseline | RRF K=60, MMR λ=0.7, the `0.5^(n-2)` penalty, chunk window/stride can all be changed with zero test signal |
| Per-stage attribution | A recall drop can't be blamed on the embedder vs FTS vs fusion vs reranker |
| Faithfulness / hallucination / refusal eval | The **named interview failure mode** — "answers from training data, not retrieved context" — is completely unmeasured |
| A fixture-DB seam | `VectorDb::open()`/`open_readonly()` hardcode the path via `$HOME`; nothing can point at a test corpus |

**The honest framing for the write-up:** they have tested the *plumbing* thoroughly and the *retrieval quality* not at all. Everything below builds the second half.

**One thing to internalize before writing a line of eval code** (from the reviews): the three surfaces — CLI (in-search cross-encoder rerank, single-vector), desktop (post-hoc daemon rerank), agent (`hybrid_search_multi`, `min_similarity=0.25`, no in-tool rerank) — produce **different rankings for the same query**. Every metric is reported *per surface*. Default gate surface = **agent** (`SearchMessagesTool::execute` with precomputed `_embeddings`) because it's pure, MLX-free, and is what Casper ships.

---

## 3. The golden set

### 3.0 The one decision everything hangs on: how gold is expressed

`chunk_id` is **not** a valid gold key — chunks are sorted by text length before id assignment and offsets accumulate across contact batches (`_embed_and_write_batch:390`), so it's non-temporal, non-stable, and changes on every re-ingest. The `message_ids` DuckDB **column** is *also* wrong — it's a naive `range(start_id, end_id+1)` that includes gap/deleted/other-contact ROWIDs (`storage.py write_chunks_bulk_parquet`).

**Gold = a set of `message_id`s (stable iMessage ROWIDs), resolved to the current chunk set at eval time via the authoritative `chunk_data.messages[].message_id`.** ROWIDs are stable across re-chunking because they come from the source snapshot, not the chunker.

**Resolver, with the review-mandated sanity assertion:**
```sql
SELECT chunk_id
FROM message_chunks,
     UNNEST(json_extract(chunk_data, '$.messages[*].message_id')) AS t(mid)
WHERE CAST(mid AS BIGINT) IN (/* gold_message_ids */);
```
After resolving, **assert every `gold_message_id` mapped to ≥1 `chunk_id`, else hard-error "gold unresolvable"** — this distinguishes a resolver/JSON-path bug (which would silently score every query 0 and read as a "total regression") from a real retrieval miss. On device, resolve once per `ingestion_id` and cache.

**Scoring unit correction (from the rigor review):** window=8/stride=4 maps one gold message to ~2 overlapping near-duplicate chunks. These are **not** independent passages, and MMR + the contact penalty are *designed* to thin them. So do **not** count them as independent gold with multi-gold recall — that would measure dedup behavior, not retrieval. **Collapse each overlap set into one relevance unit: a hit = the gold *message* appears in any surviving retrieved chunk in top-k.** Score message-coverage, invariant to how dedup thins overlap.

### 3.1 Unified query-record schema (all three tracks share it)

```jsonc
{
  "id": "fact-001",
  "query": "what japanese restaurant did we want to try",
  "stratum": "fact",              // fact | semantic | temporal_range | superlative | aggregation | recency | cross_contact
  "source": "synthetic",          // synthetic | self_labeled | seed
  "surface": "agent",             // rankings differ per surface — pin it

  "frozen_now": "2026-02-09T14:00:00Z",   // used for BOTH planner and search clock (see §5)
  "expected_plan": {              // asserted via plan_search_with_now
    "is_aggregation": false, "superlative": null, "prefer_recent": false,
    "min_date": null, "max_date": null, "result_count": 7
  },

  "gold_message_ids": [1002],
  "gold_content_sha256": ["a1b2c3…"],     // anchor for re-resolution if a synthetic corpus is renumbered
  "hard_negative_message_ids": [1050],    // gold must outrank these (mining rules in §3.2)

  "metric": "mrr@10",             // recall@k | mrr@10 | rank_of_argmax@1 | in_range | contact_recall@k
  "k": 10,
  "contact_scope": null,          // SearchOptions.contact_id (planner has NO name extraction; contact_hint is dead code)
  "gold_contacts": null,          // cross_contact only
  "construction_retrieval_rank": 14,  // rank the generator saw; keep even if a miss (anti-survivorship, §3.2)
  "notes": "query says 'japanese'; chunk says 'Nobu/black cod' — semantic, no lexical bridge; 1050 has 'sushi place' but is the wrong answer"
}
```

Companion synthetic message record (committed):
```jsonc
{"message_id":1002,"contact_id":"sarah","contact_name":"Sarah","sender":"them",
 "text":"we should try Nobu, everyone raves about the black cod","day_offset":-26}
```
Note `day_offset` (relative to `frozen_now`), **not** an absolute timestamp — see §5.

### 3.2 Track A — On-device self-labeling (the scale engine, per-user signal)

Take a real chunk, ask the local `Qwen3.5-9B-4bit` to write the question it answers; gold = that chunk's `message_id`s. This is the only way to get volume on a private corpus.

**Leakage control (the central risk):** a naive question lexically paraphrases the chunk so BM25 wins trivially and recall is fake. Gate on **token-Jaccard / BM25 self-score** of the generated query vs the source `formatted_text` (reject > ~0.4 Jaccard) to force semantic answerability.

**Anti-survivorship correction (both reviews flagged this as fatal):** do **NOT** discard queries the current pipeline can't retrieve. The original "answerability filter" deletes exactly the hard cases the eval exists to catch, making the number structurally biased upward and blind to retrieval-failure regressions. Instead:
- Use the LLM/substring check **only** to reject *hallucinated gold* (the model invented an answer the chunk doesn't support).
- **Keep** unretrievable-but-valid queries as a labeled **miss cohort**, in the denominator. A growing miss cohort is the single most valuable signal you have. Record `construction_retrieval_rank` so the construction-time retrieval rate is visible and bounded.
- **Freeze and pin the generator model+version** separately from the system-under-test, so a regression in the SUT can't hide behind a co-evolving generator.

**Hard negatives (mined, with the overlap correction):** mine from top-k semantic neighbors of the gold chunk, but **exclude any chunk in the same conversation/time-adjacency window** (same `contact_id` AND overlapping `[start,end]` span) — otherwise the ~4-message overlap mislabels a *correct* adjacent chunk as a negative and punishes correct retrieval. Admit only same-entity-different-event and cross-contact confusables where the wrong-answer property is verifiable.

**Storage (private, gitignored — nothing leaves the device):**
```
~/.be-right-back/eval/self_labeled/<ingestion_id>-<ts>.jsonl
```
Generated via `brb eval build --self-label`. Target ~150 survivors, rebalanced toward the strata self-labeling underproduces (superlative, temporal, cross-contact).

### 3.3 Track B — Shareable synthetic fixture (the CI backbone) — **corrected to use real embeddings**

This is the deliverable that gates PRs, so the reviews' top risk lands here. **The original design shipped hand-authored/topic-seeded 768-d vectors engineered so gold wins by construction — that tests RRF/MMR/recency arithmetic, NOT ModernBERT recall.** A green check would coexist with a broken embedder.

**The fix, at zero CI cost:** commit **real precomputed ModernBERT embeddings** for the synthetic corpus chunks *and* queries.
```
crates/ingestion/tests/fixtures/eval/
  corpus.jsonl                 # synthetic messages: text + contact + day_offset (relative to frozen_now)
  queries.jsonl                # query records (§3.1)
  corpus.embeddings.json       # {message_or_chunk_key: [768 real ModernBERT floats]}  ← NEW, load-bearing
  queries.embeddings.json      # {query_id: [768 floats]} — 'search_query: ' prefix
  embed_model.lock             # model id + hash the vectors were generated under
  README.md                    # methodology writeup for the blog series
crates/ingestion/tests/eval_recall.rs     # the gated integration test
crates/ingestion/tests/support/{fixture_builder,metrics}.rs
```

Now the deterministic, MLX-free CI gate drives the **real embedding geometry** through the real HNSW + real BM25 + real fusion + real dedup. It exercises everything the team owns *and* the embedder's actual behavior. Real message text still populates `formatted_text`, so BM25/FTS is exercised for real.

Two guards the reviews demand:
- **Embedder-identity guard:** assert the model id/hash in `run.embed_model` matches `embed_model.lock`. If a PR changes the ModernBERT constant without regenerating + re-blessing the committed vectors, **fail loudly** — an embedder swap is otherwise invisible to a fixture with frozen vectors. Name it honestly in the report: Layer 1 catches *fusion/dedup/recency/planner mechanics + committed-embedding recall*; it does **not** re-run ModernBERT, so a live embedder swap is caught by this guard + the nightly Layer 2, not by the vectors moving.
- **Contested cases:** deliberately author queries where gold sits at rank ~8–15 in *both* the semantic and BM25 lists (never rank 1 in either), so the *final* position is a genuine function of K=60. Add a direct `rank_of_gold` assertion on `breakdown.fused` for those. Otherwise a K regression that reorders a real 100k-chunk corpus produces zero movement on a cleanly-separable fixture and slips the gate. Also author cases where semantic and BM25 each individually miss gold in top-k but fusion recovers it — only then is `fusion_gain > 0` a falsifiable signal rather than a tautology.

**Do NOT commit a binary `.duckdb`** — VSS/HNSW persistence is version-locked (Rust `=1.4.4` == Python `==1.4.4`). Build the DB at test time: `insert_chunks` → `create_hnsw_index()` → `create_fts_index()`.

**Layer 2 (nightly, gated — the review's "chunker + embedder are invisible" fix):** regenerate the fixture end-to-end through `python src/entry/embed.py` from a **synthetic snapshot SQLite**, so the *real Python chunker* (`create_chunks`, window=8/stride=4) and *real ModernBERT* run. This is the **only** path that can catch a chunk window/stride regression (the Rust gate reads a pre-chunked corpus and never invokes the chunker) or an embedder degradation on real geometry. Give it a committed `baseline_realembed.json` + tolerance and wire it as a **required nightly gate**, not a printed report. Add a small Rust↔Python round-trip test that runs `create_chunks` on a fixture snapshot and asserts the resolver maps known `message_id`s to the expected chunk set — live coverage for both chunker and resolver.

### 3.4 Track C — Human seed (the calibration anchor)

*(Track D — the public benchmark — is §3.5.)*

~20–40 queries the dev hand-labels from their own history. Private (`~/.be-right-back/eval/seed.jsonl`), same schema, `source:"seed"`. Jobs: validate Track A's generator (agreement on overlapping queries), cover what self-labeling can't (multi-hop, "you had to be there"), and ground-truth the metrics. **Report Wilson CIs on every seed-derived rate** — n=20 has a ±~22% CI, so present it as *illustrative of method*, never as *certifying* anything. Curate via `brb eval label`.

### 3.5 Track D — Public benchmark: LongMemEval_S (the legibility track) — *added 2026-07-26*

Tracks A–C all have the same weakness: **nobody outside this repo can check them.** Track D exists so the numbers are comparable to a board other people already report on. Target selection is settled in `casper-memory-benchmarks-2026.md`: **LongMemEval V1 `_S`** (~115K tok, MIT, use the Sept-2025 cleaned `xiaowu0162/longmemeval-cleaned` release), with **BEAM-128K/1M** as the un-saturated 2026 companion. **LongMemEval-V2 is explicitly NOT a target** — it is a web-agent-trajectory benchmark at 25M–115M tokens under a reused name (§2a of the benchmark doc).

**What is actually being claimed.** Not a rank. The board's ceiling is ~94.87% (Mastra OM) with Mem0 at 93.4% — a 4-bit on-device 9B does not win that, and shouldn't try. The claim is **ratio-under-constraint**: *N% of cloud SOTA with zero bytes leaving the device, at X ms/query.* Which means the eval must record latency and resident memory per query, not just accuracy — **those are load-bearing columns here, not nice-to-haves.**

**Which slices count.** Single-session-user (98.6) and single-session-assistant (98.2) are saturated and will not move under any pipeline change worth making. Report the full `_S` number once for the ratio; **track and gate only `multi-session` (88.0) and `knowledge-update`/temporal (93.6)**, which is also where Casper's known-hard strata live.

**Six mapping problems to solve before a number means anything** (this is the actual work — the benchmark does not drop into an iMessage-shaped schema):

1. **Contact-diversity penalty must be neutralized, explicitly and in the report.** LongMemEval is a *single* user↔assistant thread. Mapped faithfully, every haystack session belongs to one synthetic contact, so `0.5^(n-2)` fires on every result past the second and craters recall for reasons that have nothing to do with retrieval quality. Run Track D with the penalty disabled via config, and **state that in the published number** — silently disabling a shipped ranking stage to improve a benchmark score is the exact dishonesty this whole document exists to prevent. Also report the penalty-on number as the diagnostic it is.
2. **Gold granularity mismatch.** LongMemEval labels evidence at **session** level; Casper's gold is `message_id` sets (§3.0). Assign synthetic stable `message_id`s at ingest and persist an `evidence_session → message_ids` map alongside the corpus, so §3.0's resolver and message-coverage scoring apply unchanged.
3. **Chunk on session boundaries.** window=8/stride=4 sliding across a session boundary produces chunks whose evidence attribution is ambiguous across two sessions. Chunk **per session**, and assert no chunk's `chunk_data.messages[]` spans two session ids.
4. **Timestamps are load-bearing here.** The knowledge-update/temporal slice is the whole point, so session timestamps must be threaded through — which makes **Step 3 (freeze the search-side clock) a hard prerequisite**, not an optional companion. Without it, `rrf_merge`'s recency term compares benchmark timestamps against real `Utc::now()` and the temporal slice is noise.
5. **Two judges, and report their agreement.** LongMemEval scores QA accuracy with an LLM judge (GPT-4o in the paper). Using it is fine for the *published* number — the haystack is public synthetic data, so there is no privacy conflict — but a cloud judge cannot sit in a local regression loop. Run the **official judge once per published result** and a **local `Qwen3.5-9B-4bit` judge for the iteration loop**, and report **Cohen's κ with a CI** between them. If κ is poor, the local loop is not measuring the published metric and must say so.
6. **Report retrieval metrics, not just end-to-end QA.** The evidence-session labels make `recall@k` / MRR over evidence computable directly — that is the signal this document is about, and it decomposes a QA-accuracy drop into *retrieval missed it* vs *generation fumbled it*. The per-stage attribution in §4.2 applies here unchanged and is more informative on a public corpus than on the 48-chunk fixture.

**Placement:** never a PR gate. It needs the real embedder, the real model, and minutes-to-hours per run — same tier as §6. Wire it as an **on-demand + release-time** run (`brb eval bench --set longmemeval_s`), with its own committed `baseline_longmemeval.json` so a release can't silently regress the public number.

**Known unknowns to verify on download, before building against them:** the exact composition of the abstention subset in the cleaned release, whether the cleaned release renumbers question/session ids relative to the original (which would break any committed baseline across releases — pin the release hash), and the precise judge prompt/version the current leaderboard entries used (an unpinned judge makes the ratio claim unfalsifiable).

---

## 4. Metrics

### 4.1 Core — assert on order and coverage, never on `similarity` magnitude

`SearchResult.similarity` is **overloaded and mutated in place** (cosine → RRF fused score ~0.01–0.05 → raw cross-encoder score). Every metric compares **`chunk_id`/`message_id` membership and rank position**, which survive tie reordering.

```rust
/// 1-indexed rank of the first retrieved chunk containing a gold message; None if absent.
fn rank_of_gold(results: &[SearchResult], gold_msgs: &HashSet<i64>) -> Option<usize> {
    results.iter().position(|r| r.chunk_data_message_ids().iter().any(|m| gold_msgs.contains(m)))
           .map(|i| i + 1)
}
```

- **hit_rate@k** (= recall@k for single-passage gold): `(1/N)·Σ 1[rank_i ≤ k]`, report at k ∈ {1,3,5,10}.
- **MRR:** `(1/N)·Σ 1/rank_i` — catches "the reranker demoted the right answer from #1 to #4" that hit_rate@10 misses. Report **median rank and P90 rank** alongside (MRR is dominated by top-3 movement).
- **nDCG@k:** only for the semantic-fuzzy/topic stratum with graded `grade ∈ 0..3`; skip elsewhere (it collapses toward MRR on binary gold and just adds noise). Report **SUPPORTED-only as primary**; treat graded weights as a sensitivity band, not a headline.

### 4.2 Per-stage attribution — corrected to not over-claim the reranker

Compute `rank_of_gold` against the `HybridSearchBreakdown{semantic, bm25, keyword, fused}` lists plus the full `hybrid_search` output:

| Stage | Source | A drop here blames |
|---|---|---|
| `semantic` | `breakdown.semantic` (HNSW cosine) | ModernBERT / HNSW recall |
| `bm25` | `breakdown.bm25` (FTS `match_bm25`) | FTS index / stopwords / stemming |
| `keyword` | `breakdown.keyword` (ILIKE) | content-keyword extraction |
| `fused` | `breakdown.fused` (raw RRF, **carries the always-on recency term**) | fusion math (K=60) |
| `final` | full `hybrid_search` | MMR + contact-penalty + rerank + recency **together** |

**Correction (rigor review):** `final − fused` folds four stages, so it does **not** isolate the cross-encoder. Two fixes: (1) rename the derived metric **`post_fusion_block_gain`**, and for a true single-stage delta run the pipeline **rerank-off vs rerank-on** and **MMR-off vs MMR-on**; (2) `breakdown.fused` already contains the `1/(1+0.01·age)` recency term, so **exclude recency/temporal strata from the `fusion_gain ≥ 0` hard gate** (recency can legitimately push an older gold below both single rankers), or compute fusion attribution on a recency-disabled RRF path.

**Injected reranker caveat (regression review):** CI injects a fixed score table via `SearchOptions::with_reranker(closure)` and never spawns Python — so CI's `post_fusion_block_gain` reflects the *injected table, not ms-marco-MiniLM*. Label it as such in the report and cover the real cross-encoder in a **separate nightly test** that runs the actual model over a fixed candidate list with a committed expected ordering.

### 4.3 Per-stratum report — "correct" differs by class

| Stratum | Gold | Primary metric | Notes |
|---|---|---|---|
| fact | one message-coverage set | MRR, hit@3 | `superlative=None`, dates None |
| semantic-fuzzy | graded multi-chunk | nDCG@10 | uses `grade` |
| recency (soft) | recency-relevant set | MRR + relative-order assert | `prefer_recent=true`, no date floor |
| temporal-range | in-window set | in-window **overlap** + recall@k | see §4.4 |
| superlative | argmax/argmin-timestamp chunk | **rank-1 accuracy** | measured after `superlative_finalize` |
| aggregation | evidence set across contacts | assert `is_aggregation && result_count==20`; contact-coverage | final answer → faithfulness (§6) |
| cross-contact | distinct gold **contacts** | **contact-recall@k** = `\|gold_contacts ∩ contacts(topk)\| / \|gold_contacts\|` | breadth, targets the `0.5^(n-2)` penalty |

Also score the **planner separately** from retrieval: `plan.superlative == Some(Newest\|Oldest)` via `plan_search_with_now`. A superlative miss whose planner label is wrong is a *planner* bug, reported in a different column. Include the known false positive (bare "first" → Oldest even in "the first thing") as a labeled case.

### 4.4 Time-scored strata — do NOT score by semantic rank

- **Superlative:** gold = the single time-extremum chunk over the topic set (computed from the fixture at label-build time). Metric = **rank-1 accuracy** (`results[0]` is gold) — a right answer at rank 2 is a *failure*, because the agent presents `result[0]` as "the answer."
- **Temporal-range:** the strict-containment `[start,end] ⊆ [min,max]` predicate false-fails on chunks whose window legitimately straddles a boundary (window=8 chunks span hours/days). **Use an overlap/midpoint-in-range predicate** for the correctness check; report strict containment only as a diagnostic. Add a **range-sanity assertion `min_date ≤ max_date`** to catch the documented inverted-range bug in "from January to March 2025."

### 4.5 CI thresholds — corrected for statistical power (this was the rigor review's TOP risk)

With 4–8 queries/stratum, recall@k has 0.25 granularity, so a 0.03 tolerance is un-trippable-then-flaky and `hit_rate@10 < 0.80` is tripped by a *single* missing query (0.75 < 0.80). **Do not put hard proportional floors on tiny strata.** Instead:

**Hard fail (block merge) — named-query + aggregate only:**
- **Named-query assertions** for small strata: *this exact query ID must return gold in top-(k−1)* (a `k−1` margin absorbs one HNSW tie flip). This is the right gate for n<30 sets.
- `overall.macro.mrr` drops **> Wilson-CI-derived threshold** vs committed `baseline.json` (not a fixed 0.03) — computed on the **pooled/micro** counts which have enough n for a usable interval.
- `superlative.rank1_accuracy < 1.0` **on named superlative cases** (hand-verified fixture; anything below perfect there is a real bug).
- `temporal_range` range-sanity violations > 0, or planner accuracy < 1.0 on named cases.
- `fusion_gain < 0` **only on the contested non-recency cases authored for it**.
- **Embedder-identity guard** mismatch (§3.3).

**Soft warn (annotate, don't block):** macro-MRR small moves, median/P90 rank increases, component (`semantic`/`bm25`) recall down > 0.05 with `final` flat (a masked upstream degradation fusion is hiding).

**Family-wise discipline (rigor review):** the gate is dozens of checks on noisy samples. Bound the number of hard gates, add a **2-of-N re-run rule** before failing, and **empirically measure the red-build rate on a batch of no-op/whitespace PRs before enabling as a merge blocker.**

Baseline moves only via `BRB_EVAL_BLESS=1` in a reviewed commit — a legible audit trail of every recall change, exactly what the "how it's built" series wants.

---

## 5. The harness

### Recommended path

**Primary (CI gate):** a Rust integration test at `crates/ingestion/tests/eval_recall.rs` that builds the fixture DB in-process from `corpus.jsonl` + committed real embeddings, drives `SearchMessagesTool::execute` (agent surface) / `hybrid_search` / `hybrid_search_breakdown`, computes the §4 metrics, and diffs `baseline.json`. **Secondary (dogfood, never gates):** `brb eval` in `apps/cli/src/commands/eval.rs` against the dev's real `~/.be-right-back/data/db/brb.duckdb` with an on-device self-labeled set.

### The one required seam (small, load-bearing)

`open()`/`open_readonly()` hardcode the path and `open_readonly()` hands out clones of a **process-global cached connection**. Add:
```rust
// crates/ingestion/src/vectordb.rs
impl VectorDb {
    /// Open read-write at an explicit path. Test/eval seam only.
    pub fn open_at(db_path: &std::path::Path) -> Result<Self> { /* body of open() with path injected */ }
}
```
`open()` becomes `Self::open_at(&common::get_brb_duckdb_db()?)`. A fresh per-fixture connection sidesteps the `PRIMARY_RO` global entirely — no `--test-threads=1` needed.

### Determinism (the four real sources)

1. **Kill MLX** — query *and* corpus embeddings are committed real ModernBERT vectors (§3.3). Zero model load at test time.
2. **Kill the rerank subprocess** — inject a fixed table via `with_reranker(closure)`, or leave rerank off for the gate and cover the real cross-encoder in a nightly test.
3. **Force exact vector search** (regression review) — on a 48–64-chunk corpus HNSW is effectively exact, but pin it: disable HNSW or set `ef_search ≥ corpus_size` so ordering is fully determined, and use the **rank ≤ k−1** margin so one tie can't flip a gate. ANN-recall-at-scale is explicitly *out of scope* for the tiny fixture — cover it in the Layer 2 real-corpus path (or a few-thousand-chunk medium synthetic corpus vs a brute-force baseline).
4. **One clock (the cross-design bug both critics caught).** The planner uses a frozen `now`, but `rrf_merge`'s `1/(1+0.01·age)` (`search.rs:749`) and `apply_recency_boost`'s `e^(-0.03·days)` (`query_planner.rs:280`) call **real `Utc::now()`**. Mixing frozen-now date windows with real-now chunk timestamps makes every temporal_range assertion vacuous. **Fix: freeze the search-side clock too** — thread a `now` parameter into `rrf_merge`'s recency term and `apply_recency_boost`, stamp fixture chunk timestamps as `frozen_now − day_offset`, and plan via `plan_search_with_now(query, frozen_now)`. Add an assertion that ≥1 gold chunk actually falls inside every temporal query's `[min,max]`, so a mis-clocked window fails loudly instead of passing empty.

### min_similarity (regression review)

The agent surface filters at `min_similarity=0.25`, CLI/desktop at `0.1`. With **real** committed embeddings this is no longer an uncalibrated magic number — the vectors produce real cosine magnitudes, so the fixture behaves like production. Still: pin the constant with an explicit assertion so a regression that raises `min_similarity` (silently dropping recall) is caught, and run fusion-attribution on the `breakdown` surface with `min_similarity=0` to isolate ranking from filtering.

### Command sketch
```bash
cargo test -p ingestion --test eval_recall              # the PR gate (seconds, no MLX, no network)
BRB_EVAL_BLESS=1 cargo test -p ingestion --test eval_recall   # re-bless baseline in a reviewed commit
brb eval run --set ~/.be-right-back/eval/self_labeled/<id>.jsonl --surface agent --k 5 --json
brb eval build --self-label --out ~/.be-right-back/eval/self_labeled/<id>.jsonl
make eval-nightly                                       # Layer 2: real chunker + real ModernBERT, gated
```

---

## 6. Generation-side / the hallucination failure mode

This is what "answers from training data instead of retrieved context" actually means, and it's **a separate, non-gating deliverable** (needs the real 9B model, minutes/run, Apple-Silicon-only). Frame honestly: it does not certify retrieval; it certifies *answer behavior*.

**The one seam that unlocks it** — reconstruct the context the model was actually shown from `AgentResponse.tool_calls`:
```rust
pub fn retrieved_context(resp: &AgentResponse) -> Vec<Passage> {
    resp.tool_calls.iter()
        .filter(|c| matches!(c.tool_name.as_str(), "search_messages" | "get_conversation_context"))
        .filter_map(|c| c.result.as_success())
        .flat_map(|v| v["results"].as_array().cloned().unwrap_or_default())
        .map(|r| Passage { contact: r["contact_name"].as_str().unwrap_or("").into(),
                           date: r["date"].as_str().unwrap_or("").into(),
                           text: r["conversation"].as_str().unwrap_or("").into() })
        .collect()
}
```
This lets the harness distinguish **"retrieval was fine but generation hallucinated"** from **"retrieval returned nothing so refusal was required"** — different bugs, scored separately.

**Three orthogonal properties (report as 2-D, never averaged):**

1. **Faithfulness** — decompose `answer` into atomic claims; each must be entailed by the union of retrieved passages. Cheap tier (deterministic, no LLM), **corrected per review**: drop the fragile "capitalized token = proper noun" heuristic (it flags casual capitalization/paraphrase as hallucination). Check **only quoted spans and numeric/date atoms** as substrings of the context — the prompt tells the model to quote, so those are genuinely checkable. LLM tier: local `MLXPythonEngine` as NLI, per-claim `SUPPORTED|PARTIAL|UNSUPPORTED` with a **required verbatim `evidence_span` validated as an actual substring** of the context (a self-judging model can rationalize a verdict but cannot fabricate a substring). Report SUPPORTED-only as primary; PARTIAL=0.5 as a sensitivity band.

2. **Answer relevance** — cheap: cosine(question, answer) via the existing ModernBERT. **Validate this proxy against the human seed before trusting it** (ModernBERT is an asymmetric retrieval embedder; answer-as-query is off-distribution). LLM tier: RAGAS-style back-translation, **report the N-sample variance** rather than a bare point estimate.

3. **No-context refusal — the core of the interview question.** Build a synthetic corpus rich on topics A/B/C but **provably empty on topic Z**, then ask a Z question. Two flavors: empty retrieval, and the harder **distractor retrieval** (topically-adjacent wrong chunks). Pass iff the answer is an appropriate non-answer or grounds only the supported part. **This eval correctly fails today by design:** `CASPER_SYSTEM_PROMPT_QWEN3` (`prompts.rs:22`) literally says *"Never say 'I don't have access to that information'"* and *"make your best guess."* The fix is a `LOW_CONFIDENCE_PROMPT` guardrail injected before final synthesis when top `similarity` is below a floor / results are empty — and the **before/after refusal pass-rate is the money graph for the blog series.**

**Judge honesty:** same weights answer and judge (real self-judging bias). Mitigate with the substring-validated evidence (converts "trust the judge" into "verify the judge"), pair every LLM verdict with the mechanical check, and report **Cohen's κ (not raw agreement) with a CI** on judge↔heuristic. The n=20 calibration seed illustrates method for the blog but is explicitly **not** presented as certifying the judge (±~22% CI). Run generation at **temp 0** and record `model_id` per row for reproducibility.

---

## 7. Prioritized rollout

Ordered so **real signal lands in week one** and nothing downstream is polish-on-an-unproven-base (the scope review's fix). Each step: effort + concrete first file.

**Step 1 — `VectorDb::open_at` seam. `[S]`**
First file: `crates/ingestion/src/vectordb.rs`. Unlocks every fixture-based test with near-zero risk; `open()` delegates to it. Do this before anything else.

**Step 2 — ~20 hand-written synthetic queries + real committed embeddings + one metric. `[M]` — this is the smallest thing that answers "how do you know retrieval works."**
First files: `crates/ingestion/tests/fixtures/eval/{corpus.jsonl, queries.jsonl}`, then generate `corpus.embeddings.json` + `queries.embeddings.json` **once with real ModernBERT** and commit them with `embed_model.lock`. Gold = `message_id` sets resolved via `chunk_data.messages[].message_id`, scored as message-coverage recall@k + MRR. Include the frozen-clock fix (Step 3 is a prerequisite for temporal cases — sequence them together if you want temporal coverage in v1; otherwise ship fact/semantic/cross-contact first). This single file answers the interview question with the *real embedder*, not fake vectors.

**Step 3 — Freeze the search-side clock. `[S]`**
First file: `crates/ingestion/src/search.rs` (thread `now` into `rrf_merge` recency) + `crates/ingestion/src/query_planner.rs` (`apply_recency_boost`). Required before any temporal_range/recency stratum is trustworthy. Small, honest refactor worth calling out in the blog.

**Step 4 — The gated integration test + baseline + bless flag. `[M]`**
First file: `crates/ingestion/tests/eval_recall.rs` (+ `tests/support/{fixture_builder,metrics}.rs`). Named-query hard assertions for small strata, macro-MRR on pooled counts, embedder-identity guard, resolver sanity assertion, exact-search pinning. Wire `cargo test -p ingestion --test eval_recall` into the existing Rust CI job. **Measure the no-op-PR red-build rate before making it a blocker.**

**Step 5 — Per-stage attribution via `hybrid_search_breakdown`. `[M]`**
Extend `tests/support/metrics.rs`. Add the contested-case fixtures (gold mid-pack in both rankers) so K=60 is genuinely exercised. Rename `rerank_gain` → `post_fusion_block_gain`; add rerank-off/on and MMR-off/on runs for true single-stage deltas. Now a recall drop is *attributable*.

**Step 6 — `brb eval` CLI + on-device self-labeling. `[L]`**
First files: `apps/cli/src/cli.rs` (`Commands::Eval`) + `apps/cli/src/commands/eval.rs`. Reuses `handle_search` internals and `support/metrics.rs`. Ships `build --self-label` (keep the miss cohort, pin the generator version, mine hard negatives with the time-adjacency exclusion) and `run`/`label`. This is the real per-user quality signal and the richest blog material.

**Step 7 — Layer 2 nightly: real chunker + real ModernBERT, gated. `[M]`**
First file: `make eval-nightly` target driving `python src/entry/embed.py` from a synthetic snapshot SQLite → `baseline_realembed.json`. The **only** path that catches chunk window/stride and live embedder regressions. Add the Rust↔Python `create_chunks` resolver round-trip test.

**Step 8 — Generation-side eval (faithfulness + refusal). `[L]`, non-gating.**
First file: `crates/inference/src/eval/mod.rs` + the `retrieved_context` helper in `crates/inference/src/agent/mod.rs`. Cheap heuristic tier first (quoted-span/numeric substring check, refusal lexicon), then LLM-judge with substring-validated evidence, then the `LOW_CONFIDENCE_PROMPT` guardrail and the before/after refusal-pass-rate graph.

**Step 9 — Track D: LongMemEval_S harness. `[L]`, non-gating, runs off the critical path.** *(added 2026-07-26)*
First files: a `longmemeval` ingest adapter (session JSON → synthetic snapshot SQLite with stable `message_id`s + `evidence_session → message_ids` map) feeding the existing `python src/entry/embed.py` path, plus `brb eval bench` in `apps/cli/src/commands/eval.rs`. **Depends only on Steps 1 and 3** (the `open_at` seam and the frozen clock) — it does *not* need Steps 4–8, so it can run in parallel with them once those two land. Solve the six mapping problems in §3.5 in that order; problem 1 (contact-diversity neutralization, disclosed) and problem 2 (session→`message_id` gold map) are the two that block everything else. Deliverable is the ratio-under-constraint number plus the evidence-level recall@k/MRR, with latency and resident-memory columns. Add **BEAM-128K** afterward as the un-saturated 2026 companion, reusing the same adapter shape.

**The through-line for the write-up:** retrieval quality is *attributable per stage* against a gold set that survives re-chunking, the CI gate tests the *real embedder's geometry* (not a hand-drawn substitute) with statistically honest thresholds, and the generation-side eval exposes — then fixes — the always-guess prompt that is the actual documented hallucination bug. Steps 1–4 are shippable this week and are enough to say, truthfully, "here's how we know."

---

*Files/symbols this binds to: `crates/ingestion/src/vectordb.rs` (`open_at` seam, `insert_chunks`, `create_hnsw_index`/`create_fts_index`, `ChunkData`/`ChunkMessage`), `crates/ingestion/src/search.rs` (`hybrid_search`/`hybrid_search_multi`/`hybrid_search_breakdown`, `with_reranker`, `rrf_merge`, `superlative_finalize`), `crates/ingestion/src/query_planner.rs` (`plan_search_with_now`, `apply_recency_boost`), `crates/inference/src/agent/mod.rs` (`AgentResponse`, `retrieved_context`), `crates/inference/src/agent/prompts.rs` (`CASPER_SYSTEM_PROMPT_QWEN3`), `crates/inference/src/agent/builtin/search_messages.rs` (`SearchMessagesTool::execute`, `format_result`), `mlx/src/pipelines/embedding.py` (`create_chunks`), `mlx/src/entry/embed.py`, `apps/cli/src/cli.rs` (`Commands::Eval`).*
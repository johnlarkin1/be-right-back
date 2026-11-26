---
title: "Vector Search & RAG"
shortTitle: "Vector Search & RAG"
slug: vector-search-rag
order: 5
description: "How semantic search and retrieval-augmented generation power intelligent conversations."
---

## Overview

The [ingestion pipeline][ingestion-pipeline] left us with indexed chunks in DuckDB, about 250K of them for me. Those chunks are worthless until we can find the right ones.

Hence RAG: basically the bridge between raw vector search and a helpful conversational answer.

## Recommended Resources

I won't cover vector search in a ton of detail. The one-liner: when we model tokens, fragments, or sentences as vectors in a high-dimensional space, the directions between those vectors carry semantic meaning. For example, you can do things like:

$$ v_\text{king} - v_\text{man} + v_\text{woman} \approx v_\text{queen}$$


In all my reading over the past five or so years, I haven't found a clearer visualization than this 3Blue1Brown video:

<div style="width: 50%; margin: 1.5rem auto;">
  <div style="position: relative; width: 100%; padding-bottom: 56.25%; height: 0;">
    <iframe
      src="https://www.youtube-nocookie.com/embed/wjZofJX0v4M?start=864"
      title="3Blue1Brown — vector embeddings"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  </div>
</div>

The video starts at the relevant part.

## Hybrid Search: Semantic + BM25 + Keyword

Ok, this for sure has room for lots of improvement. However, our approach runs three strategies in parallel and merges the results:

1. **semantic search** - exact cosine scan over an in-memory copy of every chunk embedding, overfetches 3x the requested limit (so we can dedup). This used to be an :term[HNSW] index lookup, until we measured it — see [Why we deleted the HNSW index](#why-we-deleted-the-hnsw-index)
2. **:term[BM25] full text search** - DuckDB's FTS extension with English stemming and stopword removal. This helps us find exact keyword matchces that embedding similarity might rank lower on
3. **keyword search** - your vanilla `ilike` approach against chunk text. tries to catch things that the :term[BM25] stemmer might disregard with normalization

### Reciprocal Rank Fusion (RRF)

> We'll unpack :term[BM25] in detail below — for now, just treat it as a keyword-relevance score over an :term[inverted index].

:term[RRF] merges ranked lists from different retrieval systems without normalizing their scores. We do not want to compare apples to oranges. Basically, it lets us combine:
* cosine similarity from vector search
* :term[BM25] scores
* binary `ilike` search

For each document $d$, :term[RRF] sums its reciprocal rank across every ranker $r$ in the set $R$:

$$ \text{RRF}(d) = \sum_{r \in R} \frac{1}{k + \text{rank}_r(d)} $$

where:

* $d$ is a document (chunk)
* $R$ is the set of rankers (semantic, :term[BM25], ilike)
* $\text{rank}_r(d)$ is $d$'s 1-indexed position in ranker $r$ (or $\infty$ if $r$ didn't return it)
* $k$ is a smoothing constant (we use the original paper's $k = 60$)

::excalidraw[/diagrams/04-rrf-merge.excalidraw]{title="RRF: same chunk in multiple rankers wins"}

#### A real example from my own data

Ok, an example might help. This uses my real data, so enjoy free exposure to my text messages. I've removed contact names. `C` stands for contact (the chunks come from different contacts).

I ran `thanksgiving turkey` against my actual DuckDB and analyzed the candidate chunks.


| chunk_id | conversation | date | chunk text | sem | bm25 | ilike |
|---------:|---|---|---|:---:|:----:|:-----:|
| 175976 | Me <> C | 2019-11-28 | Me: Happy thanksgiving!! I am so thankful for you and appreciate you so much as a person. Love you tons hope you have a good turkey day / Aunt: Let us know when we can face time. Love you so and I am so thankful for you. | 4 | 5 | 12 |
| 181896 | Me <> C | 2020-11-23 | C: Wait actually my sister went out last week before coming to cincy and when she got to my parents apartment she tested positive for covid so everyone is on high alert since I can't do thanksgiving with them now lol. So maybe let's hit like Friday if that's okay so all the thanksgiving stuff is done / Me: Ahh yeah that checks out haha / Me: Maybe Sunday bc I hve my turkey day stuff Saturday? | 19 | 11 | 5 |
| 106915 | Me <> C | 2024-11-28 | C: I'm sorry that is annoying / Me: How are you doing? What are you making for thanksgiving / Me: Also can you tell me what your mom makes every year again that you love so much / C: Turkey is in the oven! / C: And we are making the stuffing and soup now / C: And mashed potatoes and green beans are up next | — | 24 | 1 |
| 172415 | Me <> C | 2024-05-05 | C: You cooked an entire thanksgiving meal / Me: Haha yes I am very pleased | 2 | — | — |

Some notes:
* **175976** and **181896** literally contain both *"thanksgiving"* and *"turkey"* as tokens. That's why :term[BM25] and `ilike` both rank them highly. The surrounding context is also about Thanksgiving turkey, so semantic search agrees.
- **106915** doesn't show up in semantic top-15. The chunk is a bit more about "what are you making" and "stuffing/soup/mashed potatoes," which embed closer to a generic *cooking* cluster than to my *thanksgiving + turkey* query. But it's `ilike` rank 1 because every keyword token is in the chunk text.
- **172415** is a tiny 2-message chunk. It's semantically dead-on (*"cooked an entire thanksgiving meal"*), but only 1 of the 2 query tokens is present, so `ilike` rejects it, and :term[BM25] — which is length-normalized — rates it less competitively against richer chunks.

Plugging each rank into $\frac{1}{k + \text{rank}}$ with $k = 60$ (so the denominator is just $60 + \text{rank}$), and summing across the three rankers (absent → 0):

$$
\begin{aligned}
\text{RRF}(175976) &= \tfrac{1}{60+4} + \tfrac{1}{60+5} + \tfrac{1}{60+12} &&= \tfrac{1}{64} + \tfrac{1}{65} + \tfrac{1}{72} &&\approx 0.0449 \\
\text{RRF}(181896) &= \tfrac{1}{60+19} + \tfrac{1}{60+11} + \tfrac{1}{60+5} &&= \tfrac{1}{79} + \tfrac{1}{71} + \tfrac{1}{65} &&\approx 0.0421 \\
\text{RRF}(106915) &= 0 + \tfrac{1}{60+24} + \tfrac{1}{60+1} &&= \tfrac{1}{84} + \tfrac{1}{61} &&\approx 0.0283 \\
\text{RRF}(172415) &= \tfrac{1}{60+2} + 0 + 0 &&= \tfrac{1}{62} &&\approx 0.0161 \\
\end{aligned}
$$

Pure-:term[RRF] order: **175976 > 181896 > 106915 > 172415**.

One other note: in production, `rrf_merge` multiplies each chunk's :term[RRF] score by a recency factor of $\tfrac{1}{1 + 0.01 \cdot \text{age\_days}}$. This is a deliberate product decision. Our testers (mainly my partner and me) wanted recent information more often than vanilla :term[RRF] surfaced it.

### Full-Text Search with DuckDB

One callout, because I don't think it's widely understood: **full-text search (FTS)** and **Best Match 25 (:term[BM25])** are two different layers. They're connected, but technically different. The best article on this is from Anthropic (shocker): [Introducing Contextual Retrieval][bm25].

- **FTS** is the whole pipeline that turns raw text columns into a searchable structure: tokenize the text into words, run them through a stemmer (i.e. truncate `running` to `run`), drop stopwords, build an :term[inverted index] (i.e. word to list of documents that contain it), and then provide a query interface on top.
- **:term[BM25]** is really JUST a *scoring function* - a formula for ranking how relevant a document is to a query, given the term frequencies in the :term[inverted index] that FTS built.

You can run FTS with a different scoring function, OR implement :term[BM25] against any :term[inverted index]. They usually ship together because :term[BM25] is what everyone wants once they have an :term[inverted index].

DuckDB's FTS extension gives us both: the indexing pipeline *and* a `match_bm25()` function as the default scorer.

::playground[inverted-index]{label="Try the inverted-index demo" preview="Click terms to highlight matching docs. Type queries to see AND/OR postings-list intersection."}

#### The FTS index

[DuckDB][duckdb] does not ship FTS in its core. It's an extension that you `install` and `load`. Then you create the index on the column you want to search:

```sql
INSTALL fts;
LOAD fts;

PRAGMA create_fts_index(
    'message_chunks',     -- table to index
    'chunk_id',           -- primary key column
    'formatted_text',     -- column whose text we want to search
    stemmer='english',    -- "running" → "run"
    stopwords='english',  -- drop "the", "and", "of", ...
    overwrite=1           -- recreate if it already exists
);
```

This is the literal `PRAGMA` we run during ingestion — same call on both the Python side (`mlx/src/data/storage.py`, when we finalize the ingestion run) and the Rust side (`crates/ingestion/src/queries.rs::CREATE_FTS_INDEX`, which acts as a safety net on app startup if the index is somehow missing).

That `PRAGMA` is doing all the heavy lifting of "make this column searchable": tokenizing, stemming with the English Snowball stemmer, applying the English stopword list, and building an inverted posting list.

This creates a separate schema (`fts_main_message_chunks`) that holds the index and a `match_bm25()` function you call from queries. An actual snippet from my code:

```rust
    let sql = format!(
        r#"
        SELECT
            chunk_id,
            contact_id,
            contact_name,
            chunk_data,
            message_ids::VARCHAR AS message_ids,
            start_timestamp,
            end_timestamp,
            fts_main_message_chunks.match_bm25(chunk_id, '{sanitized_query}') AS bm25_score{embedding_col}
        FROM message_chunks
        WHERE fts_main_message_chunks.match_bm25(chunk_id, '{sanitized_query}') IS NOT NULL
            {contact_filter}
            {min_date_filter}
            {max_date_filter}
        ORDER BY bm25_score DESC
        LIMIT {limit}
        "#,
        sanitized_query = sanitized_query,
        embedding_col = embedding_col,
        contact_filter = contact_filter,
        min_date_filter = min_date_filter,
        max_date_filter = max_date_filter,
        limit = limit,
    );
```

A couple of gotchas worth flagging on the indexing side:

- **The FTS index is dropped and rebuilt on every full ingestion.** We treat ingestion as a full rebuild rather than incremental — the Python pipeline drops FTS and rebuilds it after inserting fresh chunks. There's no vector index to rebuild anymore; see below.
- **DuckDB version pinning matters.** Python and Rust must agree on the DuckDB version exactly, or the FTS extension binary won't load the index the other side wrote. We pin to `1.4.4` on both.

#### BM25, the scoring function

Once the :term[inverted index] exists, :term[BM25] ("Best Matching 25") is the formula that takes a query and ranks documents. It's been the default in Lucene/Elasticsearch/Postgres FTS for decades, and embeddings haven't replaced it — they just sit next to it.

The intuition is three terms multiplied together:

$$ \text{BM25}(d, q) = \sum_{t \in q} \underbrace{\text{IDF}(t)}_{\text{rarity}} \cdot \underbrace{\frac{f(t, d) \cdot (k_1 + 1)}{f(t, d) + k_1 \cdot \left(1 - b + b \cdot \frac{|d|}{\text{avg}|d|}\right)}}_{\text{normalized term frequency}} $$

where:

* $d$ is a document (one of our chunks)
* $q$ is the query and $t$ is a term inside it
* $f(t, d)$ is the **term frequency** - how many times term $t$ appears in document $d$
* $|d|$ is the length of $d$ in tokens; $\text{avg}|d|$ is the average across the corpus
* $k_1$ controls term-frequency saturation (DuckDB default: $1.2$)
* $b$ controls how aggressively long documents are penalized (DuckDB default: $0.75$)
* $\text{IDF}(t)$ is the **:term[inverse document frequency]** of $t$ - a rarity weight, formally $\log \left( \tfrac{N - n(t) + 0.5}{n(t) + 0.5} + 1 \right)$, where $N$ is the total number of documents and $n(t)$ is how many of them contain $t$. Rare terms get bigger weights; ubiquitous terms get near-zero weights.

So squinting at the formula, you can read it as:

- **Rare terms are worth more** ($\text{IDF}$) - matching on "thanksgiving" is more informative than matching on "the".
- **Terms that show up a lot in a document are worth more, but with diminishing returns** (the saturating $f(t, d)$ in the numerator) — the 10th occurrence of "turkey" in a chunk doesn't move the needle the way the 1st did.
- **Long documents get penalized** ($|d| / \text{avg}|d|$ length normalization) - so a 500-message chunk doesn't dominate just by having more words.

That last term is exactly why chunk **172415** in the :term[RRF] example above — the tiny 2-message chunk — got rated less competitively by :term[BM25] than the longer, denser thanksgiving chunks. Length normalization works against very short documents.

DuckDB exposes :term[BM25] as a function you call against the FTS index:

```sql
SELECT
    chunk_id,
    formatted_text,
    fts_main_message_chunks.match_bm25(chunk_id, 'thanksgiving turkey') AS bm25_score
FROM message_chunks
WHERE fts_main_message_chunks.match_bm25(chunk_id, 'thanksgiving turkey') IS NOT NULL
ORDER BY bm25_score DESC
LIMIT 30
```

One gotcha here: **`match_bm25()` doesn't support bind parameters.** You have to interpolate the query text as a string literal, which means sanitizing single quotes yourself. Not ideal, but well-trodden territory.

::playground[bm25-scorer]{label="Try the BM25 scorer" preview="Drag tf, k1, b, and document length and watch the score — and its saturation curves — respond live."}

#### Our own stopword pass

DuckDB's `stopwords='english'` handles the classic list at index time. But we also pre-strip an *additional* list of tokens from the query before it ever hits `match_bm25()`:

```rust
pub static STOPWORDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "the", "a", "an", "is", "was", "were", "been", "be", "have", "has", "had",
        "do", "does", "did", "will", "would", "could", "should", "may", "might",
        // ...
        "i", "me", "you", "we", "they", "he", "she",
    ])
});
```

Two reasons for the second pass:

1. **Defensive overlap.** DuckDB's list is fine, but it gets applied at index time; we want symmetric filtering on the query side too. Pre-filtering means the query that hits `match_bm25()` is already clean and stable across DuckDB version upgrades.
2. **iMessage-specific noise.** Pronouns like "i", "me", "you", "we" aren't in the standard English stopword list (they're not "function words" in the linguistic sense), but in iMessage data they're in basically every chunk — they carry zero signal for search. Same for words like "thing", "stuff", "place".

There's also a guard: if *all* tokens get stripped (e.g., someone searches "what is the thing"), we fall back to the original query rather than sending an empty string to :term[BM25]. Returning nothing is worse than returning fuzzy results.

There's more on DuckDB FTS here :unfurl[https://duckdb.org/2025/06/13/text-analytics]{title="Lightweight Text Analytics Workflows with DuckDB" site="duckdb.org" icon="D"} and [here][duckdb-fts].

## Why we deleted the HNSW index

Every RAG tutorial, this one included until recently, tells you to put your vectors behind an ANN index. We did. Then we built a retrieval eval, and the eval said the semantic half of our hybrid search was mostly returning the wrong chunks.

The number that started it: **:term[HNSW] recall@10 vs an exact scan was 0.24** on a real 229k-chunk database. Of the ten chunks the index called "most similar", roughly two or three actually were.

Worth being precise about what that means, because a vector index isn't like a B-tree. `WHERE id = 42` through a B-tree gives the same answer as a full scan, just faster. HNSW is *approximate on purpose*: it walks a graph and checks a small fraction of your vectors, so it trades accuracy for speed. That's a fine trade at a billion vectors. The question is what you actually get for it.

My first write-up of this blamed HNSW for most of that 0.24. Then I had the claims reviewed adversarially, and most of the blame moved to my own code. Here's the corrected version.

1. **We were corrupting the index ourselves. This was the big one.** The Python pipeline truncated `message_chunks` without dropping the index first, so every re-ingestion left a full set of dead entries behind: 474k index entries for 229k live rows. Dead entries take up the `k` slots and then get filtered out, so `LIMIT 10` returned **3-5 rows**. Half the results, silently.
2. **HNSW still struggles with questions.** A clean index on the same vectors, at DuckDB's default settings (`M=16`, `ef_construction=128`, `ef_search=64`), finds about **56%** of the exact top-10 for question-style queries. Use a chunk itself as the query and it finds **96%**. The graph is built from chunk-to-chunk links, so it routes well between things that look like chunks. A question ("where is nina getting married") looks like none of them: its best match averages ~0.51 cosine, while a chunk's nearest neighbour averages ~0.88. Dead entries on top of that: 0.56 × 229k / 474k ≈ 0.27, which is close to what we saw. I measured this with `hnswlib` on our production vectors, so the gap is not a DuckDB bug.
3. **Tuning helps, but costs the speed.** Raising `ef_search` to 500 gets question recall to 0.85. A bigger graph (`M=64`) gets it to 0.94. Both work by checking more vectors per query, which is the speed the index was for.
4. **The exact scan is cheap at our size.** 248k vectors × 768 dims is ~190M multiply-adds. The first version of our scan took 82ms, because a single running `f32` sum can't be vectorized (float addition isn't associative, so the compiler can't reorder it). Sixteen separate running sums fixed that: **~11ms on an M4 Max**. The embeddings take ~700MB in memory.

One thing I originally claimed that turned out to be wrong: **chunk overlap was not the cause.** `window=8, stride=4` means neighbouring chunks share half their messages, and I assumed those near-twins crowded the graph. They're less alike than I thought (median cosine 0.83), and removing the overlap entirely gave 0.60 recall against 0.64 for a random half of the chunks. Same size index, no improvement.

I also originally quoted end-to-end search latency and memory for both approaches. The HNSW side of those numbers came from the index with twice as many entries as rows, so it wasn't a fair comparison, and I've dropped it.

So we deleted the index and now scan an in-memory `Vec<f32>`. Embeddings are L2-normalized, so cosine is just a dot product, and the whole thing is about 40 lines. On our 19-query eval (20k chunks), hit@1 went from 0.474 to 0.579 and MRR from 0.502 to 0.658. Five queries went from "not found" to rank 1-3, and one went from rank 5 to not found. That change also rebuilt the eval corpus, so not all of the gain is the exact scan.

The lesson isn't "ANN indexes are bad". A clean, tuned index would have done fine, and at millions of vectors we'd want one back. The lessons are that question-style queries are harder for HNSW than document-style ones, that at 250k vectors an exact scan is fast and simple enough to skip the question entirely, and that **we only found any of this because we measured recall against an exact scan.** Your index is a *guess*, and you should know how good the guess is.

## Handling Chunk Overlap

Right, so you'll hopefully recall from [ingestion pipeline][ingestion-pipeline] that we have chunking with some overlap (window = 8, stride = 4). So this means that if a search finds both chunks, then we'd show the message (or at least some portion of the chunk multiple times). We handle this with two strategies that target different kinds of duplication: **message overlap filtering** catches literal duplication (chunks that share raw message IDs), and **MMR** catches semantic near-duplicates (chunks that say roughly the same thing even without sharing messages). In practice these run as alternative paths — MMR is the production default when chunk embeddings are available, and message overlap filtering is the lightweight fallback when they aren't (e.g. :term[BM25]/keyword-only results).

### Message Overlap Filtering

We check how many *new* message IDs each candidate adds. A chunk that shares 4/8 messages with an already selected chunk has exactly 50% novelty. A chunk sharing 5+ messages gets filtered.

Basically from our source code:

```rust
fn deduplicate_chunks(chunks: Vec<SearchResult>, max_results: usize, min_similarity: f32) ->
Vec<SearchResult> {
    let mut seen_messages: HashSet<i64> = HashSet::new();
    let mut results = Vec::new();

    for chunk in chunks {
        if chunk.similarity < min_similarity {
            continue;
        }

        let new_count = chunk
            .message_ids
            .iter()
            .filter(|id| !seen_messages.contains(id))
            .count();

        let novelty_ratio = if chunk.message_ids.is_empty() {
            0.0
        } else {
            new_count as f32 / chunk.message_ids.len() as f32
        };

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
```

### Maximal Marginal Relevance (MMR)

This is a more classic approach: [maximal marginal relevance][mmr] balances relevance against diversity. Mathematically:

$$ \text{mmr score} = \lambda \cdot \text{relevance} - (1 - \lambda) \cdot \text{max similarity to selected} $$

$\lambda$ controls the tradeoff between relevance and diversity. $\lambda = 1$ is pure relevance and $\lambda = 0$ is pure diversity.

We pick $\lambda = 0.7$: 70% weight on relevance to the query and 30% on being different from the results we already have. The algorithm is greedy. At each step, we pick the candidate with the highest MMR score, add it to our set, and repeat.

## Contact Diversity

This one is a 🌶️ product call. A few people you text constantly tend to dominate your message history. So after the __second result__ from the same contact, we apply a small penalty. That keeps one contact from filling every slot. If someone's conversation is genuinely the most relevant, it still makes it through.

## Cross-Encoder Reranking

Everything up to this point has used a **:term[bi-encoder]{key="late fusion"}**. ModernBERT encodes the query once, encodes each chunk once (at ingestion time, whenever that is) and then we compare with your vanilla cosine similarity. The query and the chunk never actually see each other inside the model. They land in that $$\mathbb{R}^{768}$$ vec independently, and then just dot product for cosine sim. 

What's great about this is... it's fast! We precompute at ingestion time, embed the query once at query time, and then it's one dot product per chunk. We *used* to do that last step as an approximate nearest neighbour lookup against an :term[HNSW] index — $O(\log n)$ on the chunk side instead of $O(n)$ — but we deleted it. At our corpus size the $O(n)$ scan takes ~11ms and is exact. That story's below.

The **:term[cross encoder]{key="early fusion"}** is different - and heavier. It concatenates `[CLS] query [SEP] chunk [SEP]` and runs the _pairs_ through the transformer together, so attention can model the word-to-word interactions between query and chunk. This is way better - but also! More expensive. Running on pairs at query time is a thicc boi, and we don't have anything precomputed (what - we're gonna do precomputation of every pair between a user gen'd query and chunk somehow?).

So we run the cross-encoder only on the top 30 candidates that hybrid search, :term[RRF], and MMR already narrowed down.

Here's a *decent* AI-generated diagram:

::excalidraw[/diagrams/04-bi-vs-cross-encoder.excalidraw]{title="Bi-encoder vs Cross-encoder"}

### The model

We use [`cross-encoder/ms-marco-MiniLM-L-6-v2`][cross-encoder-model] — 22M params, 6 transformer layers, trained on the MS MARCO passage ranking dataset. On Apple Silicon, scoring 30 candidates lands in the ~50–150ms range once the model is loaded. Cold start (first call, model has to load into memory) is ~2s.

We pull this via `sentence-transformers` rather than running it through MLX, mostly because the model is tiny enough that the CPU overhead doesn't matter and the `CrossEncoder` API is one line:

```python
from sentence_transformers import CrossEncoder

model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
pairs = [[query, chunk_text] for chunk_text in passages]
scores = model.predict(pairs)  # raw logits, not normalized to [0, 1]
```

These scores are logits, so their absolute values aren't comparable to cosine similarities. We overwrite `result.similarity = score` and re-sort. I think that's fine, since nothing downstream uses the score except the display to the user.

### Over-fetching for the reranker

`hybrid_search` has a small trick worth pointing out. When `rerank = true`, we don't dedup down to the user's requested `limit` — we keep more candidates around:

```rust
let dedup_limit = if options.rerank {
    // Over-fetch for reranking: get more candidates, let cross-encoder pick the best
    (options.limit * 3).max(30)
} else {
    options.limit
};
```

The reasoning: dedup (MMR + message-overlap + contact diversity) is good but coarse. It's optimizing for "don't show the user the same chunk twice", not "is this chunk actually the most relevant". The cross-encoder is the thing that's actually good at the second question, so we want to give it a bigger pool to choose from. After reranking, we truncate to `options.limit`.

### Latency Implications

Reranking is on by default, and `SearchOptions` can disable it. At our chunk sizes, reranking takes only 50-150ms, while the LLM step takes seconds.

[comment]: <> (Bibliography)
[ingestion-pipeline]: /how-its-built/ingestion-pipeline
[duckdb-fts]: https://github.com/duckdb/duckdb-fts
[mmr]: https://medium.com/@adergunov/maximal-marginal-relevance-144c23b42be5
[cross-encoder-model]: https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2
[duckdb]: https://duckdb.org/
[bm25]: https://www.anthropic.com/engineering/contextual-retrieval
---
title: "Ingestion Pipeline"
shortTitle: "Ingestion Pipeline"
slug: ingestion-pipeline
order: 4
description: "The 6-stage pipeline that transforms raw messages into searchable vector embeddings."
---

## Overview

Ok so with the [data foundation][data-foundation] in place, we can read iMessages, decode Apple's binary blobs, and snapshot the database. So the next question is: how do we turn potentially millions of messages (I'm at ~1M) into something an LLM can search and reason about?

Before any RAG or BM25, the answer is a data pipeline that sets up our databases cleanly. I mix Rust and Python in a slightly convoluted way, for reasons of performance, Tauri, ergonomics, and benchmarking. Rust more or less handles the OS layer (snapshots, metadata, contact resolution). Python handles the ML (chunking, embedding, indexing). They communicate over a single pipe: JSON lines on stdout. More on that below.

I've distilled this down to 6 stages:

| #   | Stage     | Runner     | What It Does                                       |
| --- | --------- | ---------- | -------------------------------------------------- |
| 1   | Snapshot  | Rust       | Copy iMessage DB + AddressBook, init metadata      |
| 2   | Parsing   | Rust       | Count messages and contacts from snapshot          |
| 3   | Chunking  | Python     | Sliding-window chunks with conversation awareness  |
| 4   | Embedding | Python/MLX | Generate 768-dim vectors on Apple Silicon GPU      |
| 5   | Saving    | Python     | Bulk write to DuckDB + create the FTS index        |
| 6   | Analyzing | Python     | UMAP projections + HDBSCAN clustering for Insights |

Each stage reports its own 0-100% progress to the frontend, so the UI shows six progress bars that update in near real time.

## Stage 1: Snapshot

This stage front-loads as much expensive work as possible, so that later app startups are fast.

The [data foundation][data-foundation] section covered snapshot creation. Recall that we copy `chat.db`, grab the :term[WAL] and shm files atomically, and grab the AddressBook. This stage also collects metadata:

1. **count messages and contacts**
2. **open/create brb.db** (our SQLite metadata database)
3. **record ingestion metadata** - snapshot path, message count, date range
4. **pre-compute contact stats** - avg response times, date ranges per contact. computed once during ingestion so we can load them in $$O(1)$$
5. **resolve display names** - you'd be surprised, but the `AddressBook` join that maps phone numbers and emails to real names can be expensive.
6. **brb.duckdb** - create the DuckDB database with empty tables ready for embeddings

### Two Databases

We use two separate databases here. If you think that's slightly redundant, you _kind_ of have a point. But the access patterns and use cases differ enough to justify it. Yes, yes, I know about [`sqlite-vector`](https://github.com/sqliteai/sqlite-vector).

I admit some bias, because I wanted to experiment with DuckDB. But SQLite serves my OLTP workflows and DuckDB serves my OLAP workflows. DuckDB is columnar, so it's better for analytical operations. That gives us vectorized scans, the HNSW/FTS extensions, and bulk inserts.

The SQLite database (`brb.db`) holds metadata, contacts, and stats. It has fast ACID transactions, a small footprint, and quick key-value lookups. The DuckDB database (`brb.duckdb`) holds all the vector embeddings with HNSW indexes, full-text search with BM25, and more. It's purpose-built for RAG search, which the next section covers in detail.

Also note that I pin DuckDB to exactly `1.4.4` on both the Rust and Python sides. A version mismatch crashes the VSS (vector similarity search) extension, because its binary format isn't stable across versions. This absolutely ruined me for a while. The app kept detecting corruption and recreating indexes across the two languages.

## Stage 2: Parsing

This is pretty straightforward. As I said above, we parse metadata from our messages into the SQLite database.

The Ingestion Settings modal can narrow what gets ingested. It saves a date range and a minimum message count per contact. Python applies both in the contact-discovery SQL. The minimum counts messages after the date filter, so a contact with 200 messages total but 10 in range drops out. Empty settings mean no filter.

### Python Pipeline Notes

So! The next few sections are the most interesting part. Chunking, embedding, and saving all run inside a single Python subprocess. Rust spawns that subprocess and reads JSON progress lines from stdout. Basically:

```rust
let embedding_result = python::run_python_embeddings_cancellable(
    &snapshot_db,
    &addressbook_db,
    &output_db,
    ingestion_id,
    |stage, percent, message, stats| {
        progress_callback(stage, percent, message, stats);
    },
    &is_cancelled,
)?;
```

### Communication Protocol

This design choice is maybe a _bit_ juvenile, and I'm not convinced I'd make it again. Part of the reason was scope creep while still trying to move quickly.

The two processes talk over :term[OS pipes]. My old company, [Ab Initio][ab-initio], used them heavily for its graph protocol and DML components.

Security-wise, pipes are relatively safe. They're kernel-mediated, so no other process on the system can read from or write to them. There's no network exposure and no socket file on disk for another process to sniff.

The tradeoff is some programming overhead, but welcome to the era of AI. For example, we could get kinda burned if a Python dependency prints a stray message to stdout, or a segfault cuts a JSONL line in half. So the Rust side handles those cases gracefully:

```rust
        match serde_json::from_str::<PythonMessage>(&line) {
            Ok(PythonMessage::StageProgress {
                stage,
                percent,
                message,
                stats,
                current_contact,
            }) => {
                let ingestion_stage = map_python_stage(&stage);
                let ingestion_stats = convert_stats(&stats, current_contact);
                progress_callback(ingestion_stage, percent, &message, ingestion_stats);
            }
            Ok(PythonMessage::Result { success, data, error }) => {
                if success {
                    final_result = serde_json::from_value(data).ok();
                } else {
                    error_message = error;
                }
            }
            Ok(PythonMessage::Log { level, message }) => match level.as_str() {
                "info" => info!(target: "python_embed", "{}", message),
                "warn" => warn!(target: "python_embed", "{}", message),
                "error" => error!(target: "python_embed", "{}", message),
                _ => debug!(target: "python_embed", "{}", message),
            },
            Err(_) => {
                // Not JSON, might be a raw log line
                debug!(target: "python_embed", "Non-JSON output: {}", line);
            }
```

## Stage 3: Chunking

Single raw messages are not useful to an embedding model, so we group messages into **chunks** with a sliding window. In production we use `window_size=8, stride=4` (the function signature below shows the original library defaults — the production values get passed in from the caller). You'll note that this is _redundant by design_, which is common in RAG. Messages at chunk boundaries appear in two chunks so they keep enough context.

```python

def create_chunks(
    messages: list[dict],
    window_size: int = 5,
    stride: int = 3,
    min_chunk_chars: int = 10,
    contact_name: str | None = None,
) -> list[dict]:
    """Create conversation-aware, overlapping chunks from messages.

    Uses a sliding window with stride < window_size to create overlapping chunks,
    ensuring messages at chunk boundaries are seen together in at least one chunk.
    """
    chunks = []
    conversations = split_into_conversations(messages)

    for conversation in conversations:
        for i in range(0, len(conversation), stride):
            window = conversation[i : i + window_size]
```

> [!IMPORTANT]
> Two other notes:
>
> - **conversation splitting**
>   - before chunking, we split the messages into separate conversations based on time gaps
>   - a gap of more than 4 hours starts a new conversation
>   - depending on your texting style, that may be a bad assumption
>   - but I'm trying to keep a "good morning" from being lumped in with "going out tonight?" from hours later
> - **metadata info**
>   - each chunk gets a header line
>   - the header gives the embedding model context about who and when
>   - this seems to help a little

::playground[chunking]{label="Try the chunking demo" preview="Drag the window and stride sliders and watch overlapping chunks form over a real conversation."}

### Contact-Batched Processing

We do not load all the messages, chunk them, and embed everything at once. That makes memory spike and tears through your VRAM. I investigated this a good bit. Instead, we process in batches, kinda like this:

```python
# adaptive batch sizing
if pos < _HEAVY_CONTACT_COUNT:  # top 50 by message count
    size = _HEAVY_CONTACT_BATCH_SIZE   # 10 contacts
else:
    size = _NORMAL_CONTACT_BATCH_SIZE  # 50 contacts
```

Each batch follows the same sequence: `read -> chunk -> embed -> write -> free`. Memory cleanup happens between batches: garbage collection, plus a DuckDB `CHECKPOINT` every 5 batches to flush the :term[WAL] and return memory to the OS. Peak :term[RSS] SHOULD stay around 200MB (still hefty).

## Stage 4: Embedding

Each chunk gets embedded into a 768-dimensional vector using [`mlx-community/nomicai-modernbert-embed-base-8bit`][nomicai]. This is a **sentence-level transformer model**, pre-quantized for Apple Silicon (hence the `mlx`). MLX runs inference directly on the GPU through Metal, which is the whole point of targeting macOS.

### Why `nomicai-modernbert`?

There are a couple of reasons.

1. **modern**

This encoder is a late-2024 redesign of the original BERT encoder, with recent bells and whistles: rotary embeddings, alternating local and global attention, unpadded training, and so on. It also has an 8K context. I truncate at 215 tokens, because most iMessage chunks are not that long, but the flexibility is nice.

2. **asymmetric retrieval fine-tuning**

Nomic fine-tuned this puppy with the Nomic-embed recipe, so it literally has separate document and query prefixes. We prefix `search_document:` or `search_query:`. The fine-tuned model learned that these live in slightly different subspaces of the embedding space, and the prefix helps route into the right one.

3. **8-bit quantized, mlx friendly**

The `mlx-community` fork is 8-bit quantized and packaged for Apple's hardware. This means we get roughly ~2x the throughput of the fp16 version on an M-series GPU chip.

4. **768 dim tradeoff**

Vector search cost scales with dimension count. We search by scanning every embedding in memory, so at ~245K chunks (my current corpus) 768-dim embeddings are ~750MB of RAM. 1024 dim would be ~1GB, and the scan gets a third slower. At higher dims and larger corpora the working set blows past available RAM fast. I don't really think the recall difference is impactful beyond the 768 dim threshold.

> [!NOTE]
> I still need to compare `bge-small-en-v1.5` and `all-MiniLM-L6-v2` against `nomicai-modernbert`. For now, I'm happy with retrieval from ModernBERT.

### Why Sentence Level Transformer?

Sentence-level transformers have become pretty standard for RAG.

A plain language model (GPT, Opus, Sonnet) outputs one hidden state per token. These hidden states DO carry semantic meaning — they have to, otherwise next-token prediction wouldn't work — BUT the meaning is encoded in the wrong shape. They're operating in a latent space optimized to be useful for the prediction head sitting at the end of the network. The geometry got sculpted for "what tokens help me guess the next token," not for "vectors of similar-meaning text should point in similar directions."

That distinction matters because the entire RAG setup is built on cosine similarity. We turn ~245K chunks into points in space, turn the query into a point in the same space, and ask "which chunk points are closest in direction to the query point?" For that to work, the space has to have a very specific property: **semantic closeness has to correspond to directional closeness.** That property is not free. It only exists if the model was trained to produce it.

And we still need a single vector per chunk, which means we have to pool the per-token hidden states somehow — mean-pool, take `[CLS]`, take the last token, whatever. None of those pooling strategies were in the training objective of a chat model. The model was never told "the mean of your token vectors should be close to the mean of a semantically similar chunk." So even if we pool, the result lands in a space whose geometry was shaped for a different task. Vanilla BERT's `[CLS]` embedding is famously terrible at semantic similarity out of the box for exactly this reason.

**Sentence transformers fix this directly.** They're BERT-family encoders that were additionally fine-tuned with :term[contrastive learning]. The training loop looks roughly like: show the model two sentences that mean similar things, compute their embeddings, compute the cosine similarity, and define a loss that says _"this number should be high."_ Show it two dissimilar sentences and the loss says _"this number should be low."_ Run that over millions of pairs and the network's weights get adjusted until the output geometry literally has the property we need - direction equals meaning.

Practically, this shows up in three places:

1. **One vector per chunk.** The model takes the full chunk (up to 512 tokens) and emits a single 768-dim vector. No reducer, no "which token do I pick," no guessing.
2. **Cosine is meaningful.** Because of the contrastive training objective, two chunks about "dinner plans" land near each other in embedding space. That's the only reason hybrid search works.
3. **Cheap enough to run on ~245K chunks.** `nomicai-modernbert-embed-base-8bit` is ~150M params. Using a 9B chat model as an embedder (pool the last hidden state, last-token style, à la GritLM / E5-Mistral) would be ~60x the FLOPs per chunk for a marginal quality bump. Not worth it at this scale.

You can see the pooling logic in [`ml/embeddings.py:68`][mlx-embed-batch]. When the model doesn't return `text_embeds` directly, I fall back to `mean_pooling` and then `normalize_embeddings` (L2). This is the canonical sentence-transformer recipe.

> [!NOTE]
> If you're not familiar with the `[CLS]` token, it's the special token that BERT prepends to every input for sentence-level classification. `[CLS]` is TRAINED, but on next sentence prediction (NSP), not semantic similarity.

### Why sort?

This was truly one of my biggest performance wins. It drastically cut VRAM usage.

It's this line in `pipelines/embedding.py:390`:

```python
chunks.sort(key=lambda c: len(c.get("text", "")))
```

To **really** understand this, we need to talk about transformers. At a high level, a transformer is a long stack of matrix operations. Per batch, we have $$N$$ tensors of `[batch_size, seq_len, hidden_dim]`. That `seq_len` has to be **one number** for the whole batch. When lengths differ, our code pads the shorter sequences with a `[PAD]` token so all tensors share one shape. The model computes everything, then masks out the `PAD` contributions at the end.

What this means in reality is that **in terms of FLOPs, batches cost the max length of their longest tensor seq_len, applied to every tensor**.

So when we _don't sort_, a short chunk like "yeah" can land in a batch with a very long one. With high variance in `seq_len`, we get burned: we insert a ton of PAD tokens and do a ton of useless compute.

Sorting shrinks the padding cost from the length variance of the whole dataset to the variance within a single batch.

**In addition**, sorting cuts VRAM. It makes sense that it's faster, but it's also a nice memory win.

VRAM during the forward pass is dominated by activations. Activations are basically the intermediate tensors each layer produces and keeps around. They scale like: `batch_size * seq_len * hidden_dim * num_layers`, and attention layers add a quadratic term on top: `batch_size * seq_len**2 * num_heads`. So without sorting, every batch has the chance to contain those outlier tokens, and the whole batch pays the quadratic cost of the longest sequence in it.

The natural follow-up here is **dynamic batch size by token budget** — instead of a fixed `batch_size=128`, you'd target a constant token count per batch (e.g. `batch_size * seq_len ≈ 16K`), so short-sequence batches pack more rows. I haven't implemented this yet; sorting alone got the win I needed, and dynamic batching is sitting on the follow-up list.

## Stage 5: Saving

Saving basically boils down to "write the pertinent data to the databases", both DuckDB and SQLite. A few foundational decisions give us a solid win here.

### Foundation 1: Parquet as a middle ground

It's hilarious, but Parquet keeps coming up as a win. I've written about the [Parquet][parquet] file format [on my blog][parquet-blog], so I won't repeat it here. Feel free to download the [Walk in the Parquet][walk-in-the-parquet] macOS app.

One big win for writes was loading through temporary Parquet files. This bit of code:

```python
def _write_parquet_to_duckdb(
    conn: duckdb.DuckDBPyConnection, table: pa.Table, target_table: str
) -> int:
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
        parquet_path = f.name
        pq.write_table(table, parquet_path)
    try:
        conn.execute(f"COPY {target_table} FROM '{parquet_path}'")
        return table.num_rows
    finally:
        Path(parquet_path).unlink(missing_ok=True)
```

gave us a considerable speedup when writing.

I [benchmarked this][embedding-bench] across four strategies on a 10K-message sample, on my lovely M-series Mac with MLX on the GPU. Here's the comparison at `batch_size=128`:

| strategy             |   total |   embed |   **write** |   chunks/sec |
| -------------------- | ------: | ------: | ----------: | -----------: |
| `parquet_buffered`   |  9.12 s |  8.96 s | **0.124 s** |        365.7 |
| `parquet_bulk`       | 13.53 s | 12.73 s |     0.762 s |        246.3 |
| `pandas_insert`      | 16.79 s | 14.55 s |     2.197 s |        198.6 |
| `direct_executemany` | 16.88 s |  9.94 s |     6.902 s |        197.6 |


Here is what each method does:

- **`direct_executemany`**
  - the simplest approach
  - we're building a list of Python tuples
  - then we call `conn.executemany("INSERT INTO message_chunks VALUES (?, ?, ?, ...)", rows)`
  - DuckDB binds parameters and executes the insert row-by-row
  - There is no intermediate file and no Arrow buffer, just Python objects straight to SQL
  - Crucially, every 768-float embedding gets shipped through the parameter binding path one row at a time.
- **`pandas_insert`** 
  - Here we're building a `pandas.DataFrame` from the same rows
  - then we run `INSERT INTO message_chunks SELECT * FROM df`
  - DuckDB's Python integration sees `df` in the calling scope and reads it as a :term[virtual table] via Arrow under the hood
  - The df buys us a bit but we still pay for the Python dict -> df -> Arrow conversion on the write
- **`parquet_bulk`**
  - we skip pandas entirely. As many people online point out, it's not always the best tool
  - here's what we do:
    - Build a `pyarrow.Table` directly (with explicit Arrow types — `pa.list_(pa.float32())` for embeddings, `pa.timestamp("us", tz="UTC")` for timestamps, etc.)
    - write it to a temp `.parquet` file
    - `COPY message_chunks FROM '/tmp/xxx.parquet'`
  - DuckDB's Parquet reader is a vectorized columnar scanner that reads straight into its execution engine
  - one Parquet write per call to `write_chunks_bulk_parquet()`, which means once per embed batch.
- **`parquet_buffered`**
  - Same machinery as `parquet_bulk`, but the strategy accumulates chunks in memory and only flushes a Parquet file when the buffer hits 5K rows (or the run ends)
  - At `batch_size=128`, this is roughly one Parquet write per ~40 batches instead of one per batch.

A few things that are helpful to note:

- **`parquet_buffered` writes are ~55x faster than `direct_executemany`** at the same batch size
  - i.e. `0.124 s vs 6.9 s`
  - Going through DuckDB's SQL parser and parameter binding per row is brutal once each row carries a 768-element float array
  - `executemany` doesn't actually batch on the wire
  - it's a Python convenience that loops `execute()` under the hood, so the engine sees N independent statements, each re-validating types and re-allocating the embedding list.
- **`pandas_insert` is ~18x slower on the write step.**
  - Pandas pushes into DuckDB via Arrow under the hood, but the Python object -> DataFrame -> Arrow round-trip eats most of the win
  - Building the PyArrow table directly skips that.
- **Writes are 1.4% of total time on the parquet path, vs 40.9% on the `executemany` path.**
  - Once writes are essentially free, the bottleneck shifts back to the GPU (embedding), which is exactly where you want it.
  - The embedder stays fed instead of stalling on the DB.

So writing isn't free, but on the Parquet path it's close enough that we can stop thinking about it. The whole point of the temp-Parquet dance is to push the bottleneck back onto the GPU, where it belongs. Our case is far simpler, but (unsurprisingly) Jane Street has a great YouTube talk on GPU optimization:

<div style="width: 50%; margin: 1.5rem auto;">
  <div style="position: relative; width: 100%; padding-bottom: 56.25%; height: 0;">
    <iframe
      src="https://www.youtube-nocookie.com/embed/pHqcHzxx6I8"
      title="GPU Programming - Jane Street"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  </div>
</div>

### Foundation 2: Indexes are built after

This one is probably a bit more obvious. 

We're building an [FTS][fts] index, which maintains an inverted index from terms to doc_ids. We used to build an [HNSW][hnsw] vector index here too. We deleted it after measuring its recall; see [Why we deleted the HNSW index][hnsw-removal].

We do this at the end because of the cost of indexing. FTS for DuckDB (based on my understanding) does not have a way to recompute on the fly, it's a static index.

The punchline: building the index once at the end, over the final set of chunks, is fundamentally cheaper than maintaining it incrementally across N inserts, because each incremental insert pays for an index rewrite on top of the actual write.

### Foundation 3: Two kinds of search (semantic and FTS)

We're going to address this a lot more in the next section, but we want both because they fail in opposite ways. 

* Semantic search finds meaning matches: "you wanna get dinner?" potentially linking to "meals"
  - if you search for someone's exact phone number though, semantic search might miss it because that individual token doesn't mean shit to the embedding
* FTS finds the exact word match

We're using a classic approach for handling these hybrid search results with Reciprocal Rank Fusion. I'll discuss this more in the next section as well.

## Stage 6: Analyzing

Alright! So this part covers _how_ we use the embeddings we just generated and saved.

An important distinction: the output of this stage **is not for search**. It feeds the Insights page, which shows a clustered 2D/3D map of your conversational landscape.

This stage also breaks down into a few foundations.

### Foundation 1: Dimensionality Jumps (768 -> 50 -> 2)

So we basically shrink the dimensions into something our feeble human minds can visualize, using three separate techniques.

1. **PCA**: 768 -> 50 dims through :term[PCA]. Hover for more info.
2. **UMAP**: 50 -> 2 as well as 50 -> 3 for the 3D view
3. **HDBSCAN**: clustering in 2D

A reasonable question: why three steps? Why not just UMAP straight from 768 to 2, or cluster directly in 768D? Two reasons.

**The curse of dimensionality breaks density.** In high dimensions, the ratio of (distance to nearest neighbor) / (distance to farthest neighbor) approaches 1 — every point becomes roughly equidistant from every other point. Density-based clustering relies on "this region is denser than that region," which is meaningless when distances don't separate. So we have to reduce dimensions before HDBSCAN sees anything. This is the formal Beyer et al. (1999) result, _"When Is Nearest Neighbor Meaningful?"_

**PCA is cheap, UMAP is expensive.** PCA is linear — pure eigendecomposition, runs in seconds on ~1M × 768. UMAP is nonlinear and iterative — minutes to hours. Doing UMAP on the full 768 dims wastes compute on dimensions PCA could have stripped first. So PCA cheaply trims 768 → 50 (keeping ~80–90% of explained variance), then UMAP does the expensive nonlinear projection on the surviving 50D, then HDBSCAN clusters on the 2D output. Each step uses the right tool for what's expensive about it.

I'll cover each below, with a focus on UMAP and HDBSCAN.


#### PCA - Principal Component Analysis

If you've gotten this far, you're probably familiar with PCA, since it's a core tool of linear algebra. TL;DR: PCA finds the directions in which your data varies most, and lets you reduce dimensionality by keeping only those top directions. 50 dimensions keep the vast majority of the variance.

It's technically the eigendecomposition of the covariance matrix. I spent a while reading [__The Little Book of Linear Algebra__][little-book], which you can check out [here][little-book-pca] for PCA.

You:

1. compute the covariance matrix
2. compute the eigenvectors and eigenvalues
3. sort by eigenvalue
4. top $k$ are your first $k$ components 
5. project existing data onto those $k$ components 

#### UMAP - Uniform Manifold Approximation and Projection (for Dimension Reduction)

Sadly, I don't yet understand this one as well as I'd like. Check out the [main website][umap-main]. Its modeling rests on Riemannian manifolds, which I'm not familiar with.

At a high level, UMAP finds a 2D or 3D layout where points that were close in the high-dimensional space stay close, and points that were far apart stay far apart.

The mechanism is as follows:

1. build a graph that captures the high dimensional structure
   1. for every point, we find $k$ nearest neighbors
   2. we connect them with weighted edges
   3. weighting is calibrated locally (this is what gives it the uniform bit)
      1. It's basically asking: __how close is this neighbor **relative** to the typical neighbor distance for this point__
      2. yes, I know this is kind of handwavy
   4. the output is a weighted graph whose edges approximate the high-dimensional manifold
2. build a matching graph in the lower dimension
   1. this typically uses a :term[spectral embedding] to generate a 2D point cloud
   2. we optimize the 2D edge weights to match the high-dimensional graph, usually with a cross-entropy loss
   3. two main controls - `n_neighbors` and `min_dist` 

My first instinct was t-SNE, which is apparently old-school. UMAP is apparently what the kids use these days, because it preserves more of the global structure (t-SNE is great at local neighborhoods but tends to scatter the macro layout), scales better empirically to larger point clouds, and is more deterministic across runs given the same seed and parameters.

If you want to go deeper, Leland McInnes (UMAP's author) gave a great talk at SciPy 2018 that explains the intuition way better than I can:

<div style="width: 50%; margin: 1.5rem auto;">
  <div style="position: relative; width: 100%; padding-bottom: 56.25%; height: 0;">
    <iframe
      src="https://www.youtube-nocookie.com/embed/nq6iPZVUxZU"
      title="UMAP: Uniform Manifold Approximation and Projection for Dimension Reduction - SciPy 2018"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  </div>
</div>

#### HDBSCAN - Hierarchical Density-Based Spatial Clustering of Applications with Noise

And you thought UMAP was a mouthful, eh?

HDBSCAN finds clusters by looking for regions of high point density separated by regions of low point density.

Like a classic rookie, I first thought "oh, what about k-means?" BUT that doesn't work, because we don't know $k$. I also want control over noise, where chunks don't cluster cleanly.

Here's a framing Claude gave me: imagine the 2D/3D point cloud as a topographic map. Dense points are kinda like high elevation. A "cluster" is basically a peak: a connected region above some density threshold. Noise is everything in the valleys.

There's an obvious balance to strike, which is why [Be Right Back][be-right-back] lets you adjust these thresholds and parameters.

John Healy (one of HDBSCAN's authors) has a great walkthrough of the how and the why here:

<div style="width: 50%; margin: 1.5rem auto;">
  <div style="position: relative; width: 100%; padding-bottom: 56.25%; height: 0;">
    <iframe
      src="https://www.youtube-nocookie.com/embed/dGsxd67IFiU"
      title="HDBSCAN, Fast Density Based Clustering, the How and the Why - John Healy"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
      loading="lazy"
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
    ></iframe>
  </div>
</div>

Ok, so the mechanics:

1. compute mutual reachability distance
   1. for each pair of points, we find a modified distance that says "how hard is it to walk from point A to point B without leaving dense regions"
   2. this inherently penalizes points in sparse regions  
   3. so basically `mutual_reachability(A, B) = max(core_dist(A), core_dist(B), dist(A, B))`
2. build a minimum spanning tree (MST)
   1. we build this graph with mutual reachability distances as edge weights 
   2. the MST keeps the smallest edge weights that connect every point
3. build a cluster hierarchy
   1. This is really just building a dendrogram. As the note below explains, this is a BIT similar to [HAC][larkin-hac]
4. pick stable clusters
   1. this is the magic sauce
   2. we compute a stability score for each candidate cluster
      1. basically, how much of the density-threshold-range did this cluster survive
   3. and then we pick the set of clusters that maximize total stability 
5. (kinda cleanup task) label noise clusters
   1. points that did not fit into any cluster get the label -1, so we know to ignore them
   
This final step is how we get $k$ automatically. $k$ is whatever number of stable clusters exist in the data.

> [!NOTE]
> This overlaps with some of my previous projects in really cool ways. For example, the first part of HDBSCAN resembles hierarchical agglomerative clustering, which I wrote about [here][larkin-hac] (a really cool take-home for Arena).
> Both produce a dendrogram as a first step. HDBSCAN uses single linkage, and HAC can use single linkage among others.
> HDBSCAN walks the whole dendrogram and asks every cluster "how stable are you across density thresholds?"
>
> As far as I can understand the two main differences are: 1) HDBSCAN picks clusters from different levels of the dendrogram (HAC cannot), and 2) HDBSCAN edge weights use **mutual reachability distance** instead of raw pairwise distance — that's the key conceptual difference, and it's independent of which underlying distance function you start from (Euclidean, Levenshtein, whatever). You could in principle rerun HAC with mutual reachability and it'd still be HAC.

### Foundation 2: Why HDBSCAN, not k-means

K-means is the default clustering algorithm for most people, but it's wrong for this task in two specific ways:

1. **K-means requires you to pre-specify K.** You don't know how many topics are in someone's iMessage history. 5? 50? 500? The algorithm forces you to guess. HDBSCAN figures it out from the data via a `min_cluster_size` parameter, which is a much more meaningful knob ("clusters smaller than this aren't real topics, they're noise").
2. **K-means assumes round, equally-sized clusters.** It minimizes within-cluster variance under a Euclidean assumption, which means every point gets assigned to _some_ cluster, even outliers. iMessage data has natural noise — one-off conversations that don't belong to any topic. K-means would distort real clusters by pulling outliers in. HDBSCAN labels them as `-1` (noise) explicitly, which is what you want.

The "H" in HDBSCAN is for **Hierarchical** — it builds a cluster tree at varying density thresholds and picks the most stable level automatically. The "DB" is for **Density-Based** — it defines a cluster as a region of high point density separated by regions of low density. Together: an algorithm that finds variable-shape clusters, handles noise gracefully, and picks K for you.

The code also has some interesting post-processing: `merge_similar_clusters` (combine clusters that are semantically close) and `reassign_noise_points` (give noise points their nearest cluster if it's close enough). These are practical compromises — HDBSCAN over-fragments and over-flags noise on real data, so we reel it back in.

### Foundation 3: Why the clustering is in 2D instead of 50D

This is a subtle one and it's worth getting right because it sounds wrong at first.

The "pure" approach would be: cluster in 50D PCA space (because density estimation is more meaningful there than in 2D), then project the cluster labels onto the 2D UMAP for visualization. This is what some pipelines do.

But it has a problem: **UMAP doesn't preserve global structure perfectly.** Two points that are close in 50D might be far apart in the 2D UMAP (and vice versa). If you cluster in 50D and visualize in 2D, you'll see clusters that look incoherent — points labeled the same color but spread across the 2D map.

By clustering in 2D directly, the cluster labels match the visual structure the user sees on the Insights page. Every visible "blob" gets a label; every "hole" is noise. The visualization is consistent with the clustering, not just decorated by it.

The tradeoff: you're trusting UMAP's 2D layout to reflect real structure. UMAP is well-validated for this — it preserves local neighborhood structure by design — but it can produce occasional artifacts (spurious clusters from layout noise). For a UI that's communicating "here are your conversational themes," visual coherence is more important than mathematical purity.

### Foundation 4: The LLM labeling step

The clustering produces numeric cluster IDs (0, 1, 2, ...) but the UI shows human-readable labels like "Travel Plans" or "Work Projects". Where do those come from?

The pipeline takes a sample of chunks from each cluster, sends them to a local LLM with a prompt like _"what topic do these messages share?"_, and uses the LLM's response as the cluster label. This is a small but interesting design choice:

- It's a one-shot operation — runs once per cluster, ~12 clusters typically, so ~12 LLM calls
- It's the slowest part of the analytics pipeline (the progress bar weights labeling at ~25% of total time)
- It happens **after** clustering, so the LLM doesn't influence which chunks go in which cluster — only what the cluster is named

This separation matters: the _what_ of clustering (which chunks go together) is determined by the embedding geometry, which is reproducible and deterministic. The _naming_ is determined by the LLM, which is fuzzy and nondeterministic. If the LLM hallucinates a bad name, the clustering itself is still correct.

## Conclusion

And thus! Concludes our main pipeline. We start with the raw `chat.db` and end with two distinct artifacts: a DuckDB full of 768-dim chunks with an FTS index, and 2D cluster map with LLM-generated labels. There are two pretty different down stream consumers. 

The first artifact is what feeds [Casper][search-pipeline], which I'll talk about in the next portion. It covers the fun parts: query planning, RRF, MMR, and cross-encoder reranking.

The main takeaway from this section is that mundane, simple tricks deliver huge wins: sort chunks before batching, write through Parquet, build indexes once at the end. Together, they make 1M messages searchable within minutes on your laptop.


[comment]: <> (Bibliography)
[data-foundation]: /how-its-built/data-foundation
[search-pipeline]: /how-its-built/vector-search-rag
[mlx-embed-batch]: https://github.com/johnlarkin1/be-right-back/blob/main/mlx/src/ml/embeddings.py
[mlx-embed-config]: https://github.com/johnlarkin1/be-right-back/blob/main/mlx/src/config/embedding.py
[mlx-pipeline]: https://github.com/johnlarkin1/be-right-back/blob/main/mlx/src/pipelines/embedding.py
[ab-initio]: https://www.abinitio.com/
[nomicai]: https://huggingface.co/mlx-community/nomicai-modernbert-embed-base-8bit]
[sqlite-vector]: https://github.com/sqliteai/sqlite-vector
[parquet]: https://en.wikipedia.org/wiki/Apache_Parquet
[parquet-blog]: https://johnlarkin1.github.io/2025/walk-in-the-parquet/
[walk-in-the-parquet]: https://www.walkintheparquet.com/
[embedding-bench]: https://github.com/johnlarkin1/be-right-back/tree/main/benchmarks/embedding
[hnsw-removal]: /how-its-built/vector-search-rag#why-we-deleted-the-hnsw-index
[hnsw]: https://www.pinecone.io/learn/series/faiss/hnsw/ 
[fts]: https://docs.lancedb.com/indexing/fts-index
[umap]: https://umap-learn.readthedocs.io/en/latest/
[riemannian]: https://en.wikipedia.org/wiki/Riemannian_manifold
[zucker]: https://mzucker.github.io/swarthmore/
[little-book]: https://little-book-of.github.io/linear-algebra/
[little-book-pca]: https://little-book-of.github.io/linear-algebra/books/en-US/lab.html#chapter-9.-svd-pca-and-conditioning
[be-right-back]: https://www.berightback.xyz/
[larkin-hac]: https://johnlarkin1.github.io/2024/into-the-arena/
[search-pipeline]: /how-its-built/vector-search-rag
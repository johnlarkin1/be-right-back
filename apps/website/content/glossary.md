<!-- Data Foundation -->

## FFI

Foreign Function Interface - a mechanism that lets code written in one programming language call functions written in another. We use it in this app for Rust to FFI into Apple's Objective-C runtime (`objc_msgSend`) to decode iMessage binary blobs.

[Rust FFI docs](https://doc.rust-lang.org/nomicon/ffi.html)

## NSAttributedString

Apple's rich text type that pairs a string with a dictionary of attributes (font, color, paragraph style, links). iMessage stores most message content as serialized `NSAttributedString` blobs in the `attributedBody` column rather than plain text.

[Apple docs](https://developer.apple.com/documentation/foundation/nsattributedstring)

## plist

Property List - Apple's XML (or binary) configuration format used for app metadata, preferences, and entitlements. Most commonly seen as `Info.plist` bundled inside macOS/iOS apps.

[Apple docs](https://developer.apple.com/documentation/bundleresources/information_property_list)

## TCC

Transparency, Consent, and Control - Apple's privacy framework (macOS 10.14+) that gates access to sensitive directories like `~/Library/Messages`. Apps must be granted Full Disk Access in System Settings before they can read protected locations.

[Apple TCC docs](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_personal-information_photos-library)

## WAL

Write-Ahead Logging - a SQLite journaling mode where changes are written to a separate `-wal` file before being checkpointed into the main database. The `-shm` (shared memory) file coordinates concurrent readers. When snapshotting `chat.db`, you must copy all three files (`.db`, `-wal`, `-shm`) or you'll lose uncommitted transactions.

[SQLite WAL docs](https://www.sqlite.org/wal.html)

<!-- Ingestion Pipeline -->

## OS pipes

A kernel-provided one-way byte stream used for interprocess communication. When a parent process spawns a child, the OS wires the child's `stdout`/`stderr` file descriptors to pipes the parent can read from. No sockets, no shared memory, no serialization framework - just bytes flowing through a buffer the kernel manages. In this app, Rust spawns the Python embedding subprocess and reads JSON progress lines from its stdout pipe, one line per progress update.

[pipe(2) man page](https://man7.org/linux/man-pages/man2/pipe.2.html)

## RSS

Resident Set Size - the portion of a process's memory that is currently held in physical RAM (as opposed to swapped to disk or never paged in). It's what you see in Activity Monitor's "Memory" column and `ps -o rss`, and it's the most practical number to watch when tuning batch sizes: if peak RSS creeps up with dataset size, you're accumulating state instead of freeing it between batches.

[Linux proc(5) docs](https://man7.org/linux/man-pages/man5/proc.5.html)

## Virtual Table

A table that doesn't actually store rows itself - the database engine calls back into a "module" (some external code) to produce rows on demand when you query it. The query planner treats it like any other table: you can `SELECT`, `JOIN`, or `INSERT ... SELECT FROM` against it, but under the hood the engine is iterating over whatever the module exposes. DuckDB's Python integration registers in-scope objects (pandas DataFrames, PyArrow Tables, Polars DataFrames) as virtual tables via [replacement scans](https://duckdb.org/docs/current/clients/c/replacement_scans), so when you write `SELECT * FROM df`, DuckDB doesn't copy the DataFrame into the database - it scans it in place via the Arrow C Data Interface. SQLite has the same concept (`CREATE VIRTUAL TABLE ... USING fts5`), and FTS5 / R-Tree are both implemented this way.

[DuckDB replacement scans](https://duckdb.org/docs/current/clients/c/replacement_scans) · [SQLite virtual table docs](https://www.sqlite.org/vtab.html)

<!-- Embedding & Retrieval -->

## Contrastive Learning

A training objective that teaches an embedding space to respect semantic similarity: pull anchors and their positives together, push them away from negatives. The canonical loss is kinda like this: given a batch of (query, positive-document) pairs, every other document in the batch is treated as a negative, and the model optimizes a softmax over cosine similarities so the true positive wins. This is how sentence transformers, CLIP, and Nomic-embed learned that "dinner plans" and "what are we eating tonight" should land near each other in vector space even when they share no tokens. Without a contrastive objective, a plain language model's hidden states have no reason to be useful for cosine similarity - the geometry just isn't trained for it. Contrastive learning is what makes a [late fusion](#late-fusion) bi-encoder actually work.

[InfoNCE paper (van den Oord et al.)](https://arxiv.org/abs/1807.03748)

## Early Fusion

An architecture where multiple inputs are concatenated into one sequence and fed to a single model, letting its attention see every input jointly. In retrieval this looks like `[CLS] query [SEP] document [SEP]` passed through one BERT that emits a single relevance score - also called a **cross-encoder**. Quality is high because any query token can attend to any document token, but it doesn't scale: a document's representation depends on the query, so you can't pre-compute document vectors and you pay `O(N)` model calls per search. Production RAG stacks use early fusion only over the top-K candidates from a cheaper retriever. Be Right Back does this with `ms-marco-MiniLM-L-6-v2` reranking ~30 candidates from the hybrid search pipeline.

## Late Fusion

An architecture where each input is encoded independently and the outputs are combined only at the end - usually by cosine similarity between two vectors. In retrieval this is a **bi-encoder** (or dual-encoder): embed the query once, embed each document once, compare vectors. Because a document's embedding doesn't depend on the query, you can pre-compute all of them offline and store them in an HNSW index, turning query time from `O(N)` into `O(log N)`. The tradeoff is expressiveness - the model never sees query and document together - which is why production pipelines typically pair a fast late-fusion retriever with a slow [early fusion](#early-fusion) reranker over the top-K. Late-fusion encoders are almost always trained with [contrastive learning](#contrastive-learning) because that's what makes the cosine geometry meaningful.

<!-- Vector Search & Retrieval -->

## BM25

Best Matching 25 - a ranking function for full-text search that scores a document's relevance to a query as the sum, across each query term, of three signals: how often the term appears in the document (term frequency, with diminishing returns), how rare the term is across the corpus ([inverse document frequency](#inverse-document-frequency)), and how long the document is relative to the average (length normalization, so short documents don't get drowned by sheer word count). It's been the default scoring function in Lucene, Elasticsearch, Postgres FTS, and SQLite FTS5 for two decades, and embeddings haven't replaced it - in practice production search runs both and merges the rankings (see [reciprocal rank fusion](#rrf)). Tunable via `k_1` (term-frequency saturation, default 1.2) and `b` (length penalty, default 0.75).

[Elasticsearch's BM25 explainer](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables) · [Robertson & Zaragoza's BM25 review (PDF)](https://www.staff.city.ac.uk/~sb317/papers/foundations_bm25_review.pdf)

## HNSW

Hierarchical Navigable Small World - a graph-based approximate nearest neighbor (ANN) index that makes vector search fast at the cost of perfect recall. Vectors are inserted as nodes in a multi-layer graph where each layer is a sparser subset of the layer below; search starts at the top layer (long-range hops over few nodes) and greedily descends, refining the candidate set at each level. Query time is roughly `O(log N)` instead of the `O(N)` brute-force scan you'd otherwise need to compare against every vector. DuckDB's VSS extension uses HNSW under the hood; so do pgvector, Qdrant, Weaviate, and most production vector databases. Tunable via `M` (graph connectivity) and `ef_construction` / `ef_search` (build/query effort vs. recall).

Be Right Back used HNSW (via DuckDB's VSS extension) and then removed it: on a 229k-chunk corpus it recalled 24% of the true top-10 for question-style queries. Most of that loss came from dead index entries our pipeline left behind; a clean index at default settings recalls about 56%, because questions look unlike the chunks the graph links together. At that size an exact scan takes ~11ms and is never wrong. See [vector search & RAG](/how-its-built/vector-search-rag#why-we-deleted-the-hnsw-index).

[HNSW paper (Malkov & Yashunin)](https://arxiv.org/abs/1603.09320) · [Pinecone HNSW explainer](https://www.pinecone.io/learn/series/faiss/hnsw/)

## Inverse Document Frequency

A rarity weight that boosts the contribution of terms appearing in few documents and shrinks the contribution of ubiquitous ones. Formally `idf(t) = log((N - n(t) + 0.5) / (n(t) + 0.5) + 1)`, where `N` is the total number of documents and `n(t)` is how many of them contain term `t`. The intuition: matching on "thanksgiving" is way more informative than matching on "the", because almost every document contains "the". IDF is the rarity multiplier inside the [BM25](#bm25) formula and the "IDF" in classic TF-IDF retrieval.

[Wikipedia: tf-idf](https://en.wikipedia.org/wiki/Tf%E2%80%93idf)

## Inverted Index

The core data structure behind full-text search: a map from each term to the list of documents (and usually positions within them) that contain it. The name is literally an inversion of how documents are normally stored - instead of "document → words it contains", you get "word → documents that contain it", so a query like "thanksgiving turkey" becomes a fast set-intersection over two posting lists rather than a scan over every document. Once you have an inverted index, [BM25](#bm25) becomes a scoring function on top - it walks the posting lists and accumulates per-document scores. Every mainstream search engine (Lucene/Elasticsearch, Postgres FTS, SQLite FTS5, DuckDB FTS) is built around an inverted index.

[Wikipedia: inverted index](https://en.wikipedia.org/wiki/Inverted_index)

## RRF

Reciprocal Rank Fusion - an algorithm for merging multiple ranked lists into a single ranking without needing to normalize their scores. For each document, you sum `1 / (k + rank)` across every list it appears in (with `k = 60` as the classic smoothing constant); a document that lands at rank 3 in one ranker and rank 5 in another tends to beat a document that ranks 1 in just one ranker and is absent from the others. The trick is that you compare _ranks_ (always comparable: 1st is 1st whether the underlying score is a cosine similarity or a [BM25](#bm25) logit) rather than _scores_ (incomparable across systems). RRF is the standard glue for hybrid search: dense semantic retrieval + BM25 + any other ranker you want to throw in, all merged into one list.

[Cormack et al. original paper (PDF)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)

<!-- Dimensionality Reduction & Clustering -->

## PCA

Principal Component Analysis - a linear dimensionality reduction technique that finds the orthogonal axes (principal components) along which the data varies the most, then projects the data onto the top-K of them. Mechanically it's an eigendecomposition of the covariance matrix (or, equivalently, an SVD of the centered data matrix): the eigenvectors give you the directions, and the eigenvalues tell you how much variance each one captures. Pure linear algebra, no iterative optimization, no hyperparameters beyond "how many components" - which is why it runs in seconds on data that would take UMAP minutes to hours. In this app it's the first stage of the 768 → 50 → 2 dimensionality dance: PCA cheaply throws away the directions that don't carry much variance (the `explained_variance_ratio_` typically sums to 80-90% on the first 50 components), then UMAP does the expensive nonlinear embedding on the surviving 50D. PCA assumes the structure you care about is captured by linear axes of variance - that assumption breaks for visualization (curved manifolds get flattened weirdly) which is exactly why we hand off to UMAP after.

[Shlens tutorial (arXiv)](https://arxiv.org/abs/1404.1100) · [scikit-learn PCA docs](https://scikit-learn.org/stable/modules/decomposition.html#pca) · [StatQuest: PCA Step-by-Step](https://www.youtube.com/watch?v=FgakZw6K1QQ)

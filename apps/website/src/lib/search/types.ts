/**
 * Shared types for the Cmd+K search feature.
 *
 * The same `SearchChunk` shape is produced by the build-time indexer
 * (`scripts/build-search-index.mts`) and consumed by the client
 * (`src/components/search/*`). Embedding vectors are shipped separately as a
 * flat Float32 binary (`public/search-vectors.bin`) whose row order matches
 * `SearchIndex.chunks`.
 */

export type SearchDocType = "article" | "section" | "glossary" | "demo" | "page";

export interface SearchChunk {
  /** Stable unique id (e.g. `vector-search-rag#reranking`). */
  id: string;
  type: SearchDocType;
  /** Display title, e.g. "Vector Search & RAG". */
  title: string;
  /** Optional sub-title / breadcrumb, e.g. the heading within an article. */
  subtitle?: string;
  /** Plain-text body used for keyword matching, snippet display, and embedding. */
  text: string;
  /** Where this chunk links to, e.g. `/how-its-built/vector-search-rag#reranking`. */
  url: string;
}

export interface SearchIndex {
  /** The embedding model id the vectors were produced with. */
  model: string;
  /** Embedding dimensionality (e.g. 384 for all-MiniLM-L6-v2). */
  dim: number;
  /** Number of chunks (== rows in search-vectors.bin). */
  count: number;
  chunks: SearchChunk[];
}

/** A chunk plus its runtime relevance score. */
export interface SearchResult extends SearchChunk {
  score: number;
  /** Which ranking layer produced/boosted this result. */
  kind: "keyword" | "semantic";
}

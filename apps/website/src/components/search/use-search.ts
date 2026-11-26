"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchChunk, SearchIndex, SearchResult } from "@/lib/search/types";
import { embedQuery } from "./embedder";

interface IndexData {
  chunks: SearchChunk[];
  vectors: Float32Array;
  dim: number;
}

/** Whether the semantic layer (in-browser embeddings) is usable yet. */
export type SemanticState = "off" | "loading" | "ready" | "error";

const KEYWORD_ONLY_SCORE = 0.2; // keyword hit that semantic didn't surface
const KEYWORD_BOOST = 0.1; // bonus when a semantic hit also matches keywords
const ANSWER_THRESHOLD = 0.32; // min cosine to show the "Ask" answer card
const MAX_RESULTS = 8;

export function tokenize(q: string): string[] {
  return q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function keywordSearch(chunks: SearchChunk[], terms: string[]): SearchResult[] {
  if (terms.length === 0) return [];
  const scored: SearchResult[] = [];
  for (const c of chunks) {
    const title = c.title.toLowerCase();
    const sub = (c.subtitle ?? "").toLowerCase();
    const body = c.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 3;
      else if (sub.includes(t)) score += 2;
      else if (body.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ ...c, score, kind: "keyword" });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** Cosine similarity (vectors are pre-normalized, so this is a dot product). */
function semanticRank(
  data: IndexData,
  qVec: Float32Array,
): { idx: number; score: number }[] {
  const { vectors, dim, chunks } = data;
  const out: { idx: number; score: number }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * qVec[d];
    out.push({ idx: i, score: dot });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface UseSearch {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  answer: SearchResult | null;
  terms: string[];
  semanticState: SemanticState;
  indexAvailable: boolean;
}

/**
 * Loads the static search index (once, when first `active`), then ranks the
 * current query with an instant keyword pass plus a debounced semantic pass.
 */
export function useSearch(active: boolean): UseSearch {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState<SearchResult | null>(null);
  const [semanticState, setSemanticState] = useState<SemanticState>("off");
  const [indexAvailable, setIndexAvailable] = useState(false);

  const dataRef = useRef<IndexData | null>(null);

  // Lazy-load the index the first time the palette opens.
  useEffect(() => {
    if (!active || dataRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [idxRes, vecRes] = await Promise.all([
          fetch("/search-index.json"),
          fetch("/search-vectors.bin"),
        ]);
        if (!idxRes.ok || !vecRes.ok) throw new Error("search index not found");
        const index: SearchIndex = await idxRes.json();
        const buf = await vecRes.arrayBuffer();
        if (cancelled) return;
        dataRef.current = {
          chunks: index.chunks,
          vectors: new Float32Array(buf),
          dim: index.dim,
        };
        setIndexAvailable(true);
      } catch {
        if (!cancelled) setIndexAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Rank on every query change: instant keyword now, semantic shortly after.
  useEffect(() => {
    const data = dataRef.current;
    const q = query.trim();
    if (!active || !data || !q) {
      setResults([]);
      setAnswer(null);
      return;
    }

    const terms = tokenize(q);
    const keyword = keywordSearch(data.chunks, terms);
    setResults(keyword.slice(0, MAX_RESULTS));

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        setSemanticState((s) => (s === "ready" ? s : "loading"));
        const qVec = await embedQuery(q);
        if (cancelled) return;
        setSemanticState("ready");

        const ranked = semanticRank(data, qVec).slice(0, 30);
        const byId = new Map<string, SearchResult>();
        for (const { idx, score } of ranked) {
          const c = data.chunks[idx];
          byId.set(c.id, { ...c, score, kind: "semantic" });
        }
        for (const kw of keyword) {
          const existing = byId.get(kw.id);
          if (existing) existing.score += KEYWORD_BOOST;
          else byId.set(kw.id, { ...kw, score: KEYWORD_ONLY_SCORE });
        }

        const merged = [...byId.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RESULTS);
        setResults(merged);

        const best = ranked[0];
        setAnswer(
          best && best.score >= ANSWER_THRESHOLD
            ? { ...data.chunks[best.idx], score: best.score, kind: "semantic" }
            : null,
        );
      } catch {
        if (!cancelled) setSemanticState("error");
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, active, indexAvailable]);

  return {
    query,
    setQuery,
    results,
    answer,
    terms: tokenize(query),
    semanticState,
    indexAvailable,
  };
}

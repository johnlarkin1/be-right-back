/**
 * Build-time search indexer for the Cmd+K palette.
 *
 * Reads all site content (how-its-built articles, glossary, demos, key pages),
 * splits it into heading-anchored chunks, embeds each chunk with a small
 * sentence-transformer, and writes two static artifacts consumed by the client:
 *
 *   public/search-index.json   — chunk metadata (title, snippet, deep-link url)
 *   public/search-vectors.bin  — flat Float32 embeddings, row order == chunks[]
 *
 * Run via `npm run build:search` (wired as `prebuild`).
 *
 * NOTE: the embedding step needs network access to huggingface.co to download
 * the model (cached locally after the first run). The browser loads the same
 * model at query time, so MODEL + DTYPE here MUST match
 * src/components/search/embedder.ts or the vectors won't be comparable.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "@huggingface/transformers";
import { DEMOS } from "../src/lib/demos";
import {
  getArticleIndex,
  getGlossarySections,
  splitHeadingSections,
  stripInline,
  toPlainText,
} from "../src/lib/content";
import type { SearchChunk, SearchIndex } from "../src/lib/search/types";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;
const DTYPE = "q8" as const; // quantized (~23MB); MUST match the browser side

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const PUBLIC = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const SNIPPET_LEN = 320;
const EMBED_LEN = 1200; // ~ MiniLM's token window

function snippet(text: string): string {
  return text.length > SNIPPET_LEN ? text.slice(0, SNIPPET_LEN).trimEnd() + "…" : text;
}

/**
 * Split one article into heading-anchored chunks (intro + one per heading).
 * Section ids come from the shared splitter, so anchors match rehype-slug's
 * ids on the rendered article. An article with no text (a placeholder whose
 * outline is an HTML comment) gets one chunk from its description, so it can
 * still be found.
 */
function chunkArticle(
  slug: string,
  title: string,
  body: string,
  description?: string,
): SearchChunk[] {
  const chunks: SearchChunk[] = [];

  const push = (heading: string | null, anchor: string, md: string) => {
    const text = toPlainText(md);
    const headingText = heading ? stripInline(heading) : "";
    const combined = [headingText, text].filter(Boolean).join(". ").trim();
    if (!combined) return;
    const url = anchor
      ? `/how-its-built/${slug}#${anchor}`
      : `/how-its-built/${slug}`;
    chunks.push({
      id: anchor ? `${slug}#${anchor}` : slug,
      type: heading ? "section" : "article",
      title,
      subtitle: headingText || undefined,
      text: combined.slice(0, EMBED_LEN),
      url,
    });
  };

  const { intro, sections } = splitHeadingSections(body);
  push(null, "", intro);
  for (const section of sections) push(section.heading, section.id, section.body);
  if (chunks.length === 0 && description) push(null, "", description);
  return chunks;
}

function gatherChunks(): SearchChunk[] {
  const chunks: SearchChunk[] = [];

  // 1. How-it's-built articles (technical + shared).
  for (const file of getArticleIndex(ROOT).files) {
    if (file.variant === "simple") continue;
    const { slug, title, description } = file.frontmatter;
    if (!slug || !title) continue;
    chunks.push(...chunkArticle(slug, title, file.body, description));
  }

  // 2. Glossary — one chunk per `## term`, deep-linked into the resources page.
  for (const { heading: term, id: anchor, body: md } of getGlossarySections(ROOT)) {
    const body = toPlainText(md);
    if (!term || !body) continue;
    chunks.push({
      id: `glossary#${anchor}`,
      type: "glossary",
      title: term,
      subtitle: "Glossary",
      text: `${term}. ${body}`.slice(0, EMBED_LEN),
      url: `/how-its-built/resources#${anchor}`,
    });
  }

  // 3. Interactive demos.
  for (const demo of DEMOS) {
    chunks.push({
      id: `demo#${demo.slug}`,
      type: "demo",
      title: demo.title,
      subtitle: "Playground",
      text: `${demo.title}. ${demo.description}`,
      url: `/playground/${demo.slug}`,
    });
  }

  // The old /about Q&A now lives in the preface article, so step 1 already
  // indexes each question as a preface section.

  // 4. Other key pages.
  const staticPages: SearchChunk[] = [
    { id: "page#home", type: "page", title: "Home", subtitle: "Page", url: "/", text: "Be Right Back. A local-first macOS app that creates AI personas from your iMessage history. All processing on-device with Apple Silicon." },
    { id: "page#download", type: "page", title: "Download", subtitle: "Page", url: "/download", text: "Download Be Right Back for macOS. Install and setup instructions for Apple Silicon Macs." },
    { id: "page#how-its-built", type: "page", title: "How It's Built", subtitle: "Page", url: "/how-its-built", text: "Technical deep dives into how Be Right Back works: data foundation, ingestion pipeline, vector search and RAG, the Casper agent, training, inference, desktop architecture, and privacy." },
    { id: "page#playground", type: "page", title: "Playground", subtitle: "Page", url: "/playground", text: "Interactive demos: inverted index, attributedBody decoding, sliding-window chunking, BM25 scorer, and the agent loop." },
  ];
  // These entries are hand-written, so they can outlive their route. Fail the
  // build rather than ship a search result that lands on the 404 page.
  for (const page of staticPages) {
    const routeFile = path.join(ROOT, "src", "app", ...page.url.split("/").filter(Boolean), "page.tsx");
    if (!fs.existsSync(routeFile)) {
      throw new Error(`search entry ${page.id} links to ${page.url}, but ${path.relative(ROOT, routeFile)} doesn't exist`);
    }
  }
  chunks.push(...staticPages);

  return chunks;
}

// ---------------------------------------------------------------------------
// Embed + write
// ---------------------------------------------------------------------------

async function main() {
  console.log("[search] gathering content…");
  const chunks = gatherChunks();
  console.log(`[search] ${chunks.length} chunks`);

  console.log(`[search] loading embedding model ${MODEL} (${DTYPE})…`);
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: DTYPE });

  const vectors = new Float32Array(chunks.length * DIM);
  for (let i = 0; i < chunks.length; i++) {
    const out = await extractor(chunks[i].text, { pooling: "mean", normalize: true });
    vectors.set(out.data as Float32Array, i * DIM);
    if ((i + 1) % 25 === 0 || i === chunks.length - 1) {
      console.log(`[search] embedded ${i + 1}/${chunks.length}`);
    }
  }

  // Ship a lean index (snippet, not the full embed text) + the raw vectors.
  const index: SearchIndex = {
    model: MODEL,
    dim: DIM,
    count: chunks.length,
    chunks: chunks.map((c) => ({ ...c, text: snippet(c.text) })),
  };

  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC, "search-index.json"), JSON.stringify(index));
  fs.writeFileSync(path.join(PUBLIC, "search-vectors.bin"), Buffer.from(vectors.buffer));

  const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`;
  console.log(
    `[search] wrote search-index.json (${kb(JSON.stringify(index).length)}) ` +
      `+ search-vectors.bin (${kb(vectors.byteLength)})`,
  );
}

main().catch((err) => {
  console.error("[search] indexing failed:", err);
  process.exit(1);
});

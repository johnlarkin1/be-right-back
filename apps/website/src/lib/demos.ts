/**
 * Interactive demo registry.
 *
 * Each entry maps a slug → a self-contained HTML demo file in `public/demos/`
 * plus the article it accompanies (used for the "back to article" link on the
 * demo page).
 *
 * To add a new demo:
 *   1. Drop a self-contained HTML file in `public/demos/<slug>.html`
 *   2. Add an entry to the DEMOS array below
 *   3. Reference it in an article with `::playground[<slug>]{label="..." preview="..."}`
 */

import { getArticleMeta, type HeaderDropdownItem } from "./articles";

export interface DemoMeta {
  slug: string;
  title: string;
  description: string;
  htmlPath: string;
  fromArticle: string;
}

export const DEMOS: DemoMeta[] = [
  {
    slug: "inverted-index",
    title: "Inverted index",
    description:
      "Click terms to highlight matching documents. Type queries to see AND/OR postings-list intersection.",
    htmlPath: "/demos/inverted-index.html",
    fromArticle: "vector-search-rag",
  },
  {
    slug: "attributed-body",
    title: "Inside an attributedBody blob",
    description:
      "Type a message and watch it become the NSArchiver 'streamtyped' bytes Apple writes to disk, then watch the decoder pull the text back out.",
    htmlPath: "/demos/attributed-body.html",
    fromArticle: "data-foundation",
  },
  {
    slug: "chunking",
    title: "Sliding-window chunking",
    description:
      "Drag the window and stride sliders and watch overlapping chunks form over a real conversation, with live overlap and coverage stats.",
    htmlPath: "/demos/chunking.html",
    fromArticle: "ingestion-pipeline",
  },
  {
    slug: "bm25-scorer",
    title: "BM25, one knob at a time",
    description:
      "Drag tf, k1, b, and document length and watch the BM25 score - and its saturation and length-penalty curves - respond live.",
    htmlPath: "/demos/bm25-scorer.html",
    fromArticle: "vector-search-rag",
  },
  {
    slug: "agent-loop",
    title: "Casper's agent loop, step by step",
    description:
      "Step or replay real-shaped agent traces: think -> tool call -> tool result -> answer, with the anti-loop guards (duplicate-call detection, narrated-intent nudge) firing live.",
    htmlPath: "/demos/agent-loop.html",
    fromArticle: "casper-agent",
  },
];

export function getDemoBySlug(slug: string): DemoMeta | undefined {
  return DEMOS.find((d) => d.slug === slug);
}

/** Items for the header's Playground menu: the index, then each demo in article order. */
export function getPlaygroundDropdownItems(): HeaderDropdownItem[] {
  const order = (slug: string) =>
    getArticleMeta(slug)?.order ?? Number.MAX_SAFE_INTEGER;
  const demos = [...DEMOS].sort(
    (a, b) => order(a.fromArticle) - order(b.fromArticle),
  );
  return [
    {
      href: "/playground",
      label: "All playgrounds",
      description: "Hands-on demos of the tech behind Be Right Back",
      group: "top",
    },
    ...demos.map((demo) => ({
      href: `/playground/${demo.slug}`,
      label: demo.title,
      description: demo.description,
      group: "deep" as const,
    })),
  ];
}

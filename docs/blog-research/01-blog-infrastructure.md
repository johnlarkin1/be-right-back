# Blog Infrastructure Research Report

> What's needed to add a blog to the existing website?
> Generated: 2026-04-03

---

## Current State

The website already has a markdown content pipeline for the "How It's Built" articles:

### Existing Content Pipeline
- **Markdown processing**: `gray-matter` (frontmatter) + `remark` + `remark-gfm` + `remark-rehype` + `rehype-slug` + `rehype-highlight` + `rehype-stringify`
- **Content location**: `apps/website/content/how-its-built/{technical,simple}/`
- **Article metadata**: `apps/website/src/lib/articles.ts` — `ARTICLES` array with slug, title, description, order
- **Rendering**: Server-side markdown-to-HTML in `src/lib/markdown.ts`, client-side toggle between technical/simple
- **Layout**: Three-column (sidebar nav | content | sticky ToC) at `apps/website/src/app/how-its-built/layout.tsx`

### Existing Tech Stack
- Next.js 16 (App Router, `generateStaticParams()` for SSG)
- React 19
- Tailwind CSS 4 (CSS variables in globals.css, no tailwind.config.ts)
- Turbopack
- Vercel deployment
- PostHog analytics (already integrated)

---

## What You Need to Build

### Option A: Extend the existing markdown pipeline (Simplest)

Since you already have gray-matter + remark + rehype, you can reuse it:

1. **Content directory**: `apps/website/content/blog/` — one `.md` file per post
2. **Frontmatter schema**: title, slug, date, description, tags, draft (boolean)
3. **Blog metadata**: `src/lib/blog.ts` — similar to `articles.ts` but reads from filesystem or has a `POSTS` array
4. **Routes**:
   - `/blog` — index page with post list (newest first)
   - `/blog/[slug]` — individual post page via `generateStaticParams()`
5. **Layout**: Reuse the prose styling (`.prose-brb` class already defined in `globals.css`)
6. **RSS**: Generate `/blog/rss.xml` as a route handler (`route.ts`)

**Key files to reference/extend**:
- `src/lib/markdown.ts` — reuse `renderMarkdown()` function
- `src/app/how-its-built/[slug]/page.tsx` — pattern for dynamic markdown pages
- `src/app/how-its-built/[slug]/client.tsx` — client component for interactivity
- `src/app/globals.css` — `.prose-brb` styling class

### Option B: MDX (More flexibility, slightly more setup)

Swap `.md` for `.mdx` to embed React components in blog posts:

- Add `@next/mdx` + `@mdx-js/react` to deps
- Allows inline code demos, interactive diagrams, custom components
- More complex but good if you want rich technical posts with embedded demos

### Option C: CMS-backed (Overkill for now)

Contentlayer, Sanity, or similar. Not recommended — you're one person and already have a markdown pipeline.

---

## Recommended Approach

**Option A** — extend what exists. Your markdown pipeline is already solid. You'd need:

1. Create `content/blog/` directory
2. Create `src/lib/blog.ts` (metadata + filesystem reading)
3. Create `src/app/blog/page.tsx` (index)
4. Create `src/app/blog/[slug]/page.tsx` (post detail)
5. Create `src/app/blog/rss.xml/route.ts` (RSS feed)
6. Add blog link to site navigation

**Estimated effort**: Half a day to scaffold, then it's just writing posts.

---

## Blog Post Candidates (from your existing work)

You already have 8 "How It's Built" articles (thin, 33-88 lines each). A blog could complement these with:

### Deep Technical Posts (unique things you built)
1. Gated DeltaNet / Qwen3.5 architecture — you have a 200+ line research doc already
2. Hybrid RAG with DuckDB HNSW + BM25 + RRF — 1,184 lines of implementation in `search.rs`
3. iMessage ObjC FFI — 339 lines of unsafe Rust in `attributed_body.rs`
4. Python-inside-Rust bundling — release script handles signing embedded Python/uv
5. Tool-calling agent on small local models — 1,240 lines in `agent/mod.rs`
6. TurboQuant spike (what you tried, why it didn't work) — existing spike doc

### Building-in-Public Posts
7. Why local-first AI (privacy angle, differentiation from cloud services)
8. The 85% problem — what's hard about the last 15% of shipping
9. Eval framework design — measuring "does it sound like me?"
10. Apple Silicon ML landscape (MLX ecosystem maturity, what works, what doesn't)
11. DuckDB as a vector database (vs. Pinecone, Qdrant, etc.)

### War Stories
12. Version pinning hell (DuckDB 1.4.4, mlx-lm 0.28+ sampler API break, numba/llvmlite)
13. The `make_sampler()` API break — lost hours to `temp=` vs `sampler=`
14. Cross-language DuckDB index compatibility (the assumption that was wrong)

---

## Content You Already Have as Source Material

| Existing Doc | Lines | Blog Potential |
|-------------|-------|---------------|
| `docs/research/2026-03-04-qwen3.5-architecture-report.md` | 200+ | Direct post material |
| `docs/research/2026-03-28-turboquant-kv-cache-compression.md` | 200+ | Spike/failure story |
| `docs/research/MLX_RS_PROJECT.md` | 200+ | MLX ecosystem analysis |
| `docs/spikes/2026-03-28-turboquant-integration-spike.md` | 200+ | "What didn't work" post |
| `docs/feature-plans/ai-evals-and-quality-strategy.md` | 200+ | Eval design post |
| `docs/feature-plans/casper-agent-improvement-strategy.md` | 200+ | Agent debugging post |
| `docs/archive/casper-improvements/` (15+ files) | 1000+ | RAG evolution story |
| 8 "How It's Built" articles | 369 total | Thin — can be expanded as full blog posts |

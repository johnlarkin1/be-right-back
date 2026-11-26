# website

Marketing site for Be Right Back at berightback.xyz, deployed on Vercel.

## Stack

- Next.js 16 (App Router, React Compiler enabled, Turbopack)
- React 19
- Tailwind CSS 4 (v4 `@import "tailwindcss"` syntax, no `tailwind.config.ts` for theme -- all in `globals.css` via `@theme inline`)
- framer-motion for animations
- next-themes for dark/light mode
- Markdown pipeline: gray-matter + remark + remark-gfm + remark-rehype + rehype-slug + rehype-highlight + rehype-stringify

## Routes

| Path | Type | Notes |
|------|------|-------|
| `/` | Server (dynamic) | Kill switch: resolves the `website-holding-page` PostHog flag server-side -- `ComingSoon` when enabled, `Landing` otherwise |
| `/about` | Redirect | Permanent redirect to `/how-its-built/preface` (in `next.config.ts`), which now holds the project background. The header `./about` link points there too |
| `/download` | Page | macOS download + setup instructions |
| `/download/dmg` | Route handler | Adds one to the `dmg_downloads` counter in Neon, then 302s to the GitHub release DMG. The hero button and `/download` link here |
| `/privacy` | Page | What the app and the site collect. Update `LAST_UPDATED` when it changes |
| `/unfurl` | Page | Interactive unfurl canvas |
| `/how-its-built` | Layout + Page | Article index with sidebar nav, 8 articles |
| `/how-its-built/[slug]` | Dynamic (SSG) | `generateStaticParams()` from `ARTICLES` (generated from frontmatter). Loads both technical + simple mode content server-side, toggles client-side |

## Key Architectural Patterns

**Homepage kill switch**: `page.tsx` is an async server component that calls `shouldShowHoldingPage()` from `src/lib/feature-flags.ts`, which resolves the `website-holding-page` boolean flag via `posthog-node`. Enabling the flag pulls the site behind `ComingSoon`; otherwise visitors get `Landing`. Evaluating server-side (rather than with `posthog-js`) keeps `Landing` markup off the wire while the switch is pulled and avoids a flash of the wrong page. Only the public `NEXT_PUBLIC_POSTHOG_KEY` is needed -- remote evaluation works without a personal API key, so there is no server secret and no flag-definition poller.

**The switch fails open, and that polarity is load-bearing.** PostHog omits inactive flags from its response, so a flag switched off in the dashboard reads here as `undefined` -- indistinguishable from the flag being deleted or PostHog being unreachable. Treating all of those as "site is up" is what makes the dashboard's on/off toggle work the obvious way, and means a PostHog outage can never take the marketing site down. It also means this module can simply be deleted at cleanup time without changing what visitors see. The inverse polarity (a `website-release` flag that must be *on* to serve the site) was rejected for exactly these reasons.

The lookup is wrapped in `unstable_cache` with a 30s revalidate, so pulling the switch takes effect without a redeploy while the ~200ms PostHog round trip stays out of visitor TTFB. Route-level `revalidate` would not work here: `generateMetadata` in the root `layout.tsx` reads `headers()` for platform-specific unfurls, which opts every route in the app into dynamic rendering.

`unstable_cache` is stale-while-revalidate, so a flip is not visible on the very next request -- the first request past the 30s window serves the stale page and triggers the refresh in the background, and the request after that sees the new one. Verified against a production build: flipping the flag took two requests to show up, not one. Budget "a few seconds and a couple of requests", not "instant", and don't chase this as a bug.

The switch only ever covered `/` -- `/download`, `/how-its-built`, and friends are public regardless, and `sitemap.ts` lists them. It is not a security boundary. Once it is no longer wanted, delete the flag in PostHog along with `ComingSoon` and `feature-flags.ts`.

**How It's Built articles**: Two parallel content trees under `content/how-its-built/technical/` and `content/how-its-built/simple/`, plus `content/how-its-built/shared/` for single-mode articles. Frontmatter is the only source of article metadata. Each technical/shared file declares `title`, `shortTitle`, `slug`, `order`, and `description`. Simple files declare only `slug`, which must match a technical article. `scripts/generate-articles.mts` validates that frontmatter and writes `src/lib/articles.generated.ts`. `src/lib/articles.ts` re-exports it as `ARTICLES` for nav, routing, and the header dropdown. Client components import `ARTICLES`, which is why the metadata is generated at build time and not read from disk. The generated file is committed. `predev` regenerates it. `prebuild` runs `npm run check:articles` and fails if the file is stale, so after you edit frontmatter, run `npm run generate:articles` and commit the result. A dev server that is already running picks the change up through HMR. Markdown is processed to HTML server-side in `src/lib/markdown.ts`. The `[slug]/client.tsx` component handles the technical/simple toggle with `useArticleMode()` hook.

**Article prose style**: Before you edit article prose, read `WRITING_STYLE.md`. Polish JL's existing prose; do not write new chapters or sections.

**Content module**: `src/lib/content/` is the one place markdown under `content/` gets loaded and parsed. The pages and `scripts/build-search-index.mts` both use it, so it must stay free of Next-only imports (the script runs under `tsx`).
- `sections.ts`: `splitHeadingSections()` splits markdown at its headings, skipping `#` lines inside code fences and HTML comments (the placeholder articles keep their outlines in `<!-- -->`). Each section has `heading` (raw), `text` (plain), `id`, `level`, and `body`. Every heading goes through one GithubSlugger in document order, so ids match what rehype-slug renders. The TOC, search anchors, and glossary terms all come from it.
- `plain-text.ts`: `headingText()`, `stripInline()`, `toPlainText()`. The last two strip `*`, `_` and `~` only where they act as emphasis delimiters, so code spans and snake_case keep their characters. Don't add another regex strip elsewhere.
- `article-index.ts`: `getArticleIndex()` walks `technical/`, `simple/`, and `shared/` (articles with no simple/technical split) once. It returns every file and a `slug → { technical, simple, shared }` map.
- `glossary.ts`: `getGlossarySections()` and `loadGlossary()` (tooltip HTML).
- Loaders are memoized for the life of the process (`cache.ts`), because every route renders per request and content only changes on deploy. Under `next dev` (`NODE_ENV=development`) the cache is skipped, so markdown edits show up on reload. In production, a content change needs a redeploy or restart.

**Three-column layout for articles**: `how-its-built/layout.tsx` provides sidebar nav (left, `lg+`), main content (center), and `[slug]/client.tsx` adds a sticky table of contents (right, `xl+`).

**Platform-specific unfurls**: `src/app/metadata.ts` detects user-agent to serve different OG media: mp4 for iMessage, gif for Discord/Slack/LinkedIn, static PNG for Twitter/Facebook. `generateMetadata()` in `layout.tsx` is async and reads `headers()`.

**Download counter**: `src/lib/downloads.ts` owns the counter and the DMG URL. `src/lib/db.ts` is the shared Neon client (`@neondatabase/serverless`). It returns `null` when `DATABASE_URL` is unset, so local dev needs no database and the hero hides the count. `recordDownload()` never throws, so a database outage cannot block a download. The count is cached 60s. The hero shows 100 with a note while the real count is under `MIN_SHOWN_DOWNLOADS` (`intro-sequence.tsx`). Apply `db/schema.sql` once to a new database. `DATABASE_URL` is set on Production only, so preview deploys never write to the production counter.

**Shared cursors**: with `NEXT_PUBLIC_COLLAB_URL` set (for example `wss://brb-collab.fly.dev`, or `ws://localhost:8787` with `cargo run` in `apps/collab`), the homepage ghost field joins the collab server's `ghosts` room (`ghost-field/presence.ts`). Pointers travel as Yjs awareness in hero fractions, at most 15 updates a second. Every pointer in the room acts on every visitor's ghosts. Phones do not share their roaming spotlight. They see other pointers, and their own stays local. Each browser still runs its own ghosts, so ghost positions differ per screen. Unset, the field is single player and never loads Yjs.

**Custom cursor**: `globals.css` sets `cursor: none` on `body` globally. `CursorSpotlight` component renders a custom glow effect. Interactive elements keep `cursor: pointer`.

## Design System

All theming lives in `src/app/globals.css` using CSS custom properties (not a Tailwind config file). Key token families:
- `--crt-*`: Terminal/retro green theme (`--crt-bg: #0a0e0a`, `--crt-text: #00ff41`, `--crt-accent: #ffb000`)
- `--text-*`: Content readability (`--text-primary`, `--text-secondary`, `--text-muted`)
- `--surface*`, `--border-subtle`: Surface layers

Fonts are self-hosted with `next/font/local` in `layout.tsx` (latin subset files in `src/app/fonts/`, from Google Fonts, all SIL OFL 1.1). Do not switch back to `next/font/google`: Turbopack fails the whole build when the build machine cannot download a font. Fonts: Geist, Geist Mono, VT323, IBM Plex Mono, JetBrains Mono, Inter. Exposed as CSS variables and used via Tailwind classes (`font-jetbrains`, `font-ibm-plex-mono`, `font-inter`, `font-vt323`).

Shared chrome lives in `src/components/shared/`: `Header`, `SiteFooter` (`full` on the landing page, `compact` elsewhere), and `GhostMark` (the pixel ghost logo). Page sections use the same card recipe: `rounded-[14px] border border-border-subtle bg-surface`, a `$ command` prompt in `text-crt-text`, and an Inter heading.

Article prose uses the custom `.prose-brb` utility class (defined in `globals.css`), not Tailwind Typography plugin.

## File Conventions

- All component files use kebab-case (`ghost-manager.tsx`, not `GhostManager.tsx`)
- Component exports use PascalCase (`export function GhostManager()`)
- Pages follow Next.js conventions (`page.tsx`, `layout.tsx`, `client.tsx` for client components)
- `src/components/ui/` contains shadcn/ui primitives
- `src/components/how-its-built/index.ts` barrel exports all how-its-built components (including `useArticleMode` hook)

## Dev Commands

```bash
npm run dev                # localhost:3000, uses Turbopack (regenerates article metadata first)
npm run build              # Production build (fails if src/lib/articles.generated.ts is stale)
npm run lint               # ESLint
npm run generate:articles  # Rewrite src/lib/articles.generated.ts from article frontmatter
```

`npm run dev` shows the real `Landing` page with no PostHog keys set -- the kill switch fails open, so nothing is needed to work on the marketing pages. To exercise the `ComingSoon` path, run with `NEXT_PUBLIC_POSTHOG_KEY` set and `website-holding-page` enabled in PostHog.

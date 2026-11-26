# Unfurl & Link Preview System

> Complete documentation of how Be Right Back handles social media link unfurling (iMessage, Discord, Slack, LinkedIn, Twitter, Facebook, WhatsApp). Covers the architecture, platform-specific logic, animated canvas, asset generation pipeline, and the recording workflow.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Platform Detection & Routing](#platform-detection--routing)
- [The Unfurl Canvas (Animated Preview)](#the-unfurl-canvas-animated-preview)
- [Asset Pipeline](#asset-pipeline)
- [Recording Workflow (How to Capture the GIF/MP4)](#recording-workflow-how-to-capture-the-gifmp4)
- [Asset Generation Script](#asset-generation-script)
- [File Inventory](#file-inventory)
- [Platform-Specific Behavior Matrix](#platform-specific-behavior-matrix)
- [Testing Unfurls](#testing-unfurls)
- [Troubleshooting](#troubleshooting)

---

## Overview

When someone shares a `berightback.xyz` link on iMessage, Discord, Slack, LinkedIn, Twitter, or any other platform, that platform's crawler fetches our page and reads Open Graph (`og:`) meta tags to build the preview card.

We serve **different media formats depending on who's asking**:

| Crawler | Format Served | Why |
|---------|--------------|-----|
| Discord | Animated GIF + `og:video` GIF | Discord renders GIF natively in embeds |
| Slack | Animated GIF | Slack supports animated OG images |
| LinkedIn | Animated GIF + custom `linkedin:image` | LinkedIn renders GIF in feed cards |
| iMessage/iOS | Static PNG + `og:video` MP4 | iMessage plays `og:video` MP4 inline |
| Twitter/X | Static PNG | Twitter only supports static `summary_large_image` |
| Facebook | Static PNG | Facebook prefers static images |
| WhatsApp | Static PNG | WhatsApp doesn't support animated previews |
| Default (unknown) | Animated GIF | We prefer the animated version |

All assets are **1200x630 pixels** (the Open Graph standard).

---

## Architecture

The system has four components:

```
                                   +--------------------------+
  Platform crawler hits            |  layout.tsx              |
  berightback.xyz                  |  generateMetadata()      |
         |                         |  (async, reads headers)  |
         v                         +------+-------------------+
  +------+----------+                     |
  | Next.js Server  |                     | calls
  | (App Router)    +---------------------v-----------+
  +------+----------+              metadata.ts         |
         |                   getPlatformSpecificImage() |
         |                   isIMessageUserAgent()      |
         |                   +-------------------------+
         |                              |
         v                              | returns platform-specific
  +------+---------+                    | { url, type } for og:image
  | HTML Response  |                    |
  | with <meta>    |<-------------------+
  | og:image       |
  | og:video       |
  | twitter:card   |
  +------+---------+
         |
         |  crawler fetches asset URL
         v
  +------+---------+
  | /public/unfurls/|
  | main.gif       |  <-- Discord, Slack, LinkedIn
  | main.mp4       |  <-- iMessage og:video
  | main-static.png|  <-- Twitter, Facebook, WhatsApp
  +----------------+
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/website/src/app/layout.tsx` | Root layout with `generateMetadata()` — the async metadata generator that reads user-agent headers |
| `apps/website/src/app/metadata.ts` | Platform detection utilities (`getPlatformSpecificImage`, `isIMessageUserAgent`) |
| `apps/website/src/app/unfurl/page.tsx` | Dev-only page for recording the animated preview at 1200x630 |
| `apps/website/src/components/unfurl/unfurl-canvas.tsx` | HTML5 Canvas component that renders the animated ghost scene |
| `apps/website/scripts/generate-unfurl-assets.js` | ffmpeg script to convert raw recordings into all output formats |
| `apps/website/public/unfurls/` | All generated assets (GIF, MP4, PNG, JPG, WebP) |

---

## Platform Detection & Routing

### `metadata.ts` — Platform Detection

`apps/website/src/app/metadata.ts` exports `getPlatformSpecificImage(userAgent)` and `isIMessageUserAgent(userAgent)`. Both lowercase the user-agent and match substrings: `discordbot`/`discord`/`slackbot`/`linkedin` return the GIF immediately; `twitterbot`/`facebookexternalhit`/`whatsapp` and Apple agents (`iphone`, `ipad`, or `applewebkit` combined with `mobile` or Safari-without-Chrome) select the static PNG; everything else falls through to the GIF default.

**Key design decisions:**
- iMessage detection checks for iPhone, iPad, or Safari-without-Chrome (Apple's link preview crawler uses a WebKit user-agent)
- iMessage gets a **static PNG** as the `og:image` but an **MP4** as `og:video` — iMessage plays the video inline in the chat bubble
- Discord gets the GIF served as both `og:image` and `og:video` (Discord treats GIF in `og:video` as animated)

### `layout.tsx` — Async Metadata Generation

`generateMetadata()` in `apps/website/src/app/layout.tsx` reads the `user-agent` header, calls both helpers, and sets `openGraph.type` to `video.other` for iMessage. Conditional `og:video` tags go in the `other` field because Next.js's typed `openGraph` field cannot express them.

**Why `other`?** Next.js's typed `openGraph` field doesn't directly support conditional `og:video` tags. The `other` field lets us inject arbitrary `<meta>` tags. The spread with conditional objects (`...(condition ? { tags } : {})`) keeps it clean.

**Why `og:type: "video.other"` for iMessage?** Apple's link preview engine only processes `og:video` when `og:type` is a video type. Setting `"video.other"` triggers iMessage to fetch and inline-play the MP4.

---

## The Unfurl Canvas (Animated Preview)

The actual visual content of the unfurl is rendered by an HTML5 Canvas component. This is what gets screen-recorded to produce the GIF and MP4.

### `/unfurl` Route — Dev-Only Recording Page

`apps/website/src/app/unfurl/page.tsx` renders `<UnfurlCanvas />` inside a 1200x630 bordered box, injects `* { cursor: none }` so recordings are clean, and returns a "development only" notice when `NODE_ENV === "production"`.

**Key details:**
- Hides cursor globally via injected `<style>` so the recording is clean
- Returns a "not available" message in production (never rendered to end users)
- Canvas is wrapped in a `1200x630` container with a border for easy screen-recording alignment

### `UnfurlCanvas` — The Animated Scene

The canvas renders a retro-themed scene with:

- **~30 pixel ghosts** in 24 vibrant colors with 12 different face expressions (happy, surprised, sleepy, wink, excited, worried, mischievous, cool, squint, derpy, angry, cat)
- **25 twinkling stars** with sinusoidal brightness
- **Floating particles** that rise from the bottom and fade in/out
- **Subtle animated grid** background (terminal aesthetic)
- **CRT scanlines** at 8% opacity
- **Vignette** darkening at edges
- **Center glow** in terminal green
- **Title**: "Be Right Back" in VT323 (terminal font) with green glow
- **Tagline**: "AI-powered search for your iMessages" in IBM Plex Mono with amber glow

`apps/website/src/components/unfurl/unfurl-canvas.tsx` draws the scene on a 1200x630 canvas: ~30 pixel ghosts in 24 colors with 12 face types, 25 twinkling stars, rising particles, an animated grid, scanlines, a vignette, and the VT323 title. Ghosts inside 1.4x the `AVOID_ZONE` ellipse get pushed outward so the title stays legible.

**Ghost avoidance physics:** Each frame, ghosts within 1.4x the text ellipse radius get a repulsion force pushing them outward. This keeps the title area clear while ghosts drift naturally around the edges.

**Ghost rendering:** Each ghost is drawn as pixel art using `fillRect` calls — a body (head + torso), wavy bottom edge (4 segments), and face features. The 12 face types create visual variety.

---

## Asset Pipeline

### Overview

```
1. Run dev server (localhost:3000/unfurl)
2. Screen-record the canvas (3-5 sec loop) → main_input.mov (2400x1260)
3. Screenshot for static image → main_input.png (2400x1260)
4. Run generate-unfurl-assets.js
5. ffmpeg converts inputs → 5 output formats (1200x630)
```

### Why 2400x1260 Input?

The inputs are recorded at **2x resolution** (2400x1260) and then downscaled to 1200x630. This gives crisper text and sharper pixel art in the final assets (similar to Retina display rendering). The lanczos filter in ffmpeg handles the high-quality downscale.

### `generate-unfurl-assets.js`

```javascript
// apps/website/scripts/generate-unfurl-assets.js
#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNFURLS_DIR = path.join(__dirname, "../public/unfurls");

const INPUTS = {
  mov: path.join(UNFURLS_DIR, "main_input.mov"),
  png: path.join(UNFURLS_DIR, "main_input.png"),  // 2400x1260
};

const OUTPUTS = {
  mp4: path.join(UNFURLS_DIR, "main.mp4"),
  gif: path.join(UNFURLS_DIR, "main.gif"),
  png: path.join(UNFURLS_DIR, "main-static.png"),
  jpg: path.join(UNFURLS_DIR, "main-static.jpg"),
  webp: path.join(UNFURLS_DIR, "main-static.webp"),
};

// --- ffmpeg commands ---

// 1. MOV → MP4 (h.264, yuv420p, faststart for web streaming)
// ffmpeg -y -i main_input.mov \
//   -c:v libx264 -preset medium -crf 23 \
//   -pix_fmt yuv420p -movflags +faststart \
//   -vf "scale=1200:630:flags=lanczos" -an main.mp4

// 2. MOV → GIF (two-pass: palette generation, then dithered GIF)
// Pass 1: Generate optimal color palette
// ffmpeg -y -i main_input.mov \
//   -vf "fps=15,scale=1200:630:flags=lanczos,palettegen=stats_mode=diff" \
//   palette.png
// Pass 2: Apply palette with bayer dithering
// ffmpeg -y -i main_input.mov -i palette.png \
//   -lavfi "fps=15,scale=1200:630:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
//   main.gif

// 3. PNG → PNG (downscale 2400x1260 → 1200x630)
// ffmpeg -y -i main_input.png -vf "scale=1200:630:flags=lanczos" main-static.png

// 4. PNG → JPG
// ffmpeg -y -i main-static.png -q:v 2 main-static.jpg

// 5. PNG → WebP
// ffmpeg -y -i main-static.png -quality 90 main-static.webp
```

**ffmpeg details:**
- `-crf 23`: Visually lossless for h.264 — good quality/size balance
- `-movflags +faststart`: Moves MP4 metadata to front of file for progressive web playback
- `palettegen=stats_mode=diff`: Generates GIF palette from frame differences (better for animation)
- `dither=bayer:bayer_scale=5`: Ordered dithering for cleaner GIF output
- `fps=15`: 15 frames/sec for GIF (good balance of smoothness vs file size)
- `flags=lanczos`: High-quality downscaling algorithm

---

## Recording Workflow (How to Capture the GIF/MP4)

This is the actual process used to create the unfurl assets. The canvas animation is rendered locally and screen-recorded.

### Step 1: Start the Dev Server

```bash
cd apps/website
npm run dev
# → http://localhost:3000
```

### Step 2: Navigate to the Unfurl Page

Open `http://localhost:3000/unfurl` in your browser.

You'll see:
- Instructions at the top
- The 1200x630 canvas rendering the animated ghost scene
- Size indicator at the bottom

The page automatically hides the cursor (injected CSS `cursor: none`) so it doesn't appear in recordings.

### Step 3: Record with Cap (or Kap / QuickTime)

We used **[Cap](https://cap.so)** (formerly referenced as Kap in some comments) — a macOS screen recording app. macOS built-in screen recording also works.

**Recording approach:**
1. Open Cap (or use `Cmd+Shift+5` for macOS screen recording)
2. Select a capture region that exactly covers the 1200x630 canvas
   - The border around the canvas helps with alignment
   - If using a Retina display, the actual pixel capture will be 2400x1260 (2x) — this is what we want
3. Record for **3-5 seconds** (the animation loops naturally)
4. Stop recording
5. Export/save as `.mov` to `apps/website/public/unfurls/main_input.mov`

**For the static screenshot:**
1. Take a screenshot of the canvas at a nice moment (ghosts well-distributed)
2. Save as `apps/website/public/unfurls/main_input.png`

> **Note on Retina:** On a Retina Mac, screen recordings and screenshots capture at 2x resolution (2400x1260 for a 1200x630 canvas). The generation script expects this and downscales to 1200x630 with lanczos filtering for crisp output.

### Step 4: Generate All Formats

```bash
# Prerequisites
brew install ffmpeg

# Run the generator
node apps/website/scripts/generate-unfurl-assets.js
```

This produces all 5 output files from the 2 inputs.

### Step 5: Deploy

The generated files in `public/unfurls/` are committed to the repo and deployed with the Next.js site. Vercel serves them as static assets.

### Iteration History

The `archived/` directory contains previous recording attempts:

| File | Size | Notes |
|------|------|-------|
| `main_v0.mov` | 8.2 MB | First attempt |
| `main_v1.mp4` | 771 KB | Early MP4 conversion |
| `main_v2.mov` | 20 MB | Longer recording |
| `main_v3.mov` | 20 MB | Another take |
| `main_v4.mov` | 9.8 MB | Refined timing |
| `main2.mp4` | 457 KB | Alternate conversion |
| `main3.mp4` | 630 KB | Final candidate before current |

---

## File Inventory

### Active Assets (`apps/website/public/unfurls/`)

| File | Size | Format | Served To |
|------|------|--------|-----------|
| `main.gif` | 3.1 MB | Animated GIF, 15fps | Discord, Slack, LinkedIn, default |
| `main.mp4` | 307 KB | H.264 MP4, yuv420p | iMessage (via `og:video`) |
| `main-static.png` | 434 KB | PNG | Twitter, Facebook, WhatsApp, iMessage (fallback) |
| `main-static.jpg` | 91 KB | JPEG | Available but not currently served |
| `main-static.webp` | 34 KB | WebP | Available but not currently served |

### Source Code

| File | Purpose |
|------|---------|
| `apps/website/src/app/metadata.ts` | Platform detection (`getPlatformSpecificImage`, `isIMessageUserAgent`) |
| `apps/website/src/app/layout.tsx` | Root layout with `generateMetadata()` |
| `apps/website/src/app/unfurl/page.tsx` | Dev-only recording page |
| `apps/website/src/components/unfurl/unfurl-canvas.tsx` | HTML5 Canvas animated scene |
| `apps/website/scripts/generate-unfurl-assets.js` | ffmpeg asset generation script |

---

## Platform-Specific Behavior Matrix

### What Each Platform's Crawler Sees

| Platform | User-Agent Contains | `og:image` | `og:video` | `og:type` | Result |
|----------|-------------------|------------|------------|-----------|--------|
| iMessage | `iPhone`, `iPad`, or `AppleWebKit+Mobile/Safari` | `main-static.png` | `main.mp4` (video/mp4) | `video.other` | Static image with inline video playback |
| Discord | `Discordbot` or `discord` | `main.gif` | `main.gif` (image/gif) | `website` | Animated GIF embed |
| Slack | `Slackbot` | `main.gif` | — | `website` | Animated GIF in unfurl card |
| LinkedIn | `LinkedIn` | `main.gif` | — | `website` | Animated GIF + custom `linkedin:image` tags |
| Twitter/X | `Twitterbot` | `main-static.png` | — | `website` | Large image card (`summary_large_image`) |
| Facebook | `facebookexternalhit` | `main-static.png` | — | `website` | Static image in share card |
| WhatsApp | `WhatsApp` | `main-static.png` | — | `website` | Static image preview |
| Unknown | anything else | `main.gif` | — | `website` | Animated GIF (default) |

### iMessage-Specific Details

iMessage is the most complex case because it requires:

1. `og:type` = `"video.other"` (not `"website"`) — this signals to Apple's crawler that there's video content
2. `og:image` = static PNG — the fallback/thumbnail before the video loads
3. `og:video` = MP4 URL — the actual video that plays inline in the chat bubble
4. `og:video:type` = `"video/mp4"` — explicit MIME type
5. `og:video:secure_url` = same MP4 URL over HTTPS — required by Apple

Without `og:type: "video.other"`, iMessage ignores the `og:video` tags entirely and only shows the static image.

---

## Testing Unfurls

### Validator Tools

| Platform | Validator URL |
|----------|--------------|
| Twitter/X | https://cards-dev.twitter.com/validator |
| Facebook | https://developers.facebook.com/tools/debug/ |
| LinkedIn | https://www.linkedin.com/post-inspector/ |
| Discord | Paste URL in a test server channel |
| iMessage | Send the URL to yourself in Messages |

### Cache Busting

Platforms cache unfurl previews aggressively. If you update assets:

1. **Add a query param**: Share `berightback.xyz?v=2` to bust cache
2. **Use platform tools**: Facebook and LinkedIn debuggers have "scrape again" buttons
3. **Wait**: Some platforms (Discord, iMessage) have TTLs that expire on their own

### Local Testing

To test the metadata output locally without deploying:

```bash
# Start dev server
cd apps/website && npm run dev

# Fetch with a fake user-agent to see what metadata is returned
curl -A "Discordbot/2.0" http://localhost:3000 | grep '<meta'
curl -A "iPhone" http://localhost:3000 | grep '<meta'
curl -A "Twitterbot/1.0" http://localhost:3000 | grep '<meta'
```

---

## Troubleshooting

### iMessage Not Showing Video Preview

- Verify `og:type` is `"video.other"` (not `"website"`)
- Ensure the MP4 is served over HTTPS
- Check MP4 is h.264 with yuv420p pixel format (Apple requirement)
- MP4 must have `faststart` flag (metadata at start of file)
- Try sending the link in iMessage to yourself — it may take a few seconds to load

### Discord Not Showing Animated GIF

- Discord has a file size limit for embed images (~8 MB)
- Current GIF is 3.1 MB which is well within limits
- Ensure `og:video` with `image/gif` type is present for Discord user-agents

### GIF Too Large

- Reduce FPS in the generation script (currently 15fps)
- Shorten the recording (3 seconds instead of 5)
- Increase `bayer_scale` for more aggressive dithering
- Reduce color count in `palettegen`

### Fonts Not Rendering in Canvas

The canvas uses `VT323` and `IBM Plex Mono` which are loaded by Next.js's `next/font/google` in the root layout. If fonts aren't rendering in the canvas:

- The fonts need to be loaded before the canvas starts drawing
- VT323 and IBM Plex Mono are specified by name in `ctx.font` — they must match the loaded font family names exactly

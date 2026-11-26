# Insights Page Implementation Guide

## Overview

This document provides implementation guidance for building the **Insights Page** in the Be Right Back desktop application. The insights page displays aggregate analytics across all message history, helping users explore patterns in their conversations.

**Target:** `apps/desktop/src/components/Insights.tsx` (or similar)

---

## Project Context

**Be Right Back** is a local-first macOS application that creates personalized AI chatbot personas from iMessage conversation history. The app uses:

- **Frontend:** React + Tailwind CSS (via Tauri desktop app)
- **Backend:** Rust (Tauri commands)
- **Data Storage:** DuckDB with vector embeddings, JSONL training data
- **Data Location:** `~/.be-right-back/data/`

### Existing Data Available

The app already computes and stores:

1. **Daily message counts** - `daily_message_counts` with `date`, `from_me`, `from_them`, `total`
2. **Message length stats** - averages, percentiles, histograms
3. **Response time stats** - avg response times for both parties
4. **Vector embeddings** - 256-dim embeddings in DuckDB for RAG
5. **Temporal stats** - conversation density, gaps, active days

Reference: `crates/common/src/models.rs` for data structures.

---

## Design Requirements

### Visual Aesthetic: "CRT Retro Terminal"

The design follows a dark, terminal-inspired aesthetic with glowing green accents. Key design tokens:

```css
/* Core colors */
--bg-primary: #09090b; /* zinc-950 */
--bg-card: rgba(24, 24, 27, 0.4); /* zinc-900/40 */
--border: rgba(39, 39, 42, 0.8); /* zinc-800/80 */
--text-primary: #fafafa; /* zinc-50 */
--text-secondary: #a1a1aa; /* zinc-400 */
--text-muted: #71717a; /* zinc-500 */

/* Accent - CRT Green */
--accent: #00ff41;
--accent-glow: rgba(0, 255, 65, 0.6);
--accent-subtle: rgba(0, 255, 65, 0.1);

/* Cluster colors (for embeddings) */
--cluster-daily: #00ff41; /* Green */
--cluster-work: #00d4ff; /* Cyan */
--cluster-emotions: #ff6b9d; /* Pink */
--cluster-plans: #ffb000; /* Amber */
--cluster-entertainment: #a855f7; /* Purple */
```

### Visual Effects

1. **Glow effects** on accent elements: `box-shadow: 0 0 Xpx rgba(0, 255, 65, 0.6)`
2. **Backdrop blur** on cards: `backdrop-blur-sm` or `backdrop-blur-md`
3. **Gradient backgrounds**: Subtle radial gradients from accent colors
4. **Pulsing status indicator** in header

---

## Page Components

### 1. Header

```
[●] INSIGHTS (pulsing green dot + uppercase label)
Conversation Analytics  (gradient text: emerald → cyan)
Exploring patterns across your message history
```

### 2. Stats Row (4 cards)

| Stat     | Icon | Data Source                                                            |
| -------- | ---- | ---------------------------------------------------------------------- |
| Messages | 💬   | `message_counts.total`                                                 |
| Response | ⚡   | `response_time_stats.avg_their_response_time_secs` (format as minutes) |
| Active   | 📅   | `temporal_stats.days_with_messages`                                    |
| Topics   | 🏷️   | Count of embedding clusters (hardcoded to 5 for now)                   |

### 3. Message Timeline (Bar Chart)

**Purpose:** Show daily message volume over time with brush selection for filtering.

**Requirements:**

- Bar chart (NOT area chart) for clear daily granularity
- Gradient fill: `#00ff41` at 95% opacity → 30% opacity
- Brush component at bottom for time range selection
- Selected range highlighted, unselected bars dimmed (gray)
- When brush changes → update word cloud data

**Library:** Recharts (`BarChart`, `Bar`, `Brush`, `XAxis`, `YAxis`, `Tooltip`, `Cell`)

**Data shape:**

```typescript
interface DailyData {
  date: string; // "2023-01-15"
  displayDate: string; // "Jan 15"
  volume: number; // total messages that day
}
```

### 4. Word Cloud (2D Spiral Layout)

**Purpose:** Show most common words, filtered by selected time range.

**Requirements:**

- Position words in a spiral pattern (not random scatter)
- Size words by frequency (weight)
- Color: `#00ff41` on hover, `#a1a1aa` default
- Glow effect on hover: `text-shadow: 0 0 16px rgba(0, 255, 65, 0.6)`
- Responds to brush selection on timeline

**Implementation approach:**

```typescript
// Position calculation for spiral
const positioned = words.slice(0, 18).map((word, idx) => {
  const angle = idx * 0.7;
  const radius = 25 + idx * 7;
  return {
    ...word,
    x: 50 + Math.cos(angle) * (radius / 4), // percentage
    y: 50 + Math.sin(angle) * (radius / 5), // percentage
  };
});
```

**Data source:** Compute from message text - count word frequencies, filter stopwords.

### 5. Activity Heatmap

**Purpose:** Show message frequency by day-of-week and hour-of-day.

**Requirements:**

- 7 rows (S M T W T F S) × 24 columns (hours)
- Cell color intensity based on message count
- Hover: scale up cell (1.4x), show tooltip with count
- Glow effect on high-intensity cells

**Data shape:**

```typescript
interface HeatmapCell {
  dayIdx: number; // 0-6 (Sunday-Saturday)
  hour: number; // 0-23
  value: number; // message count
}
```

### 6. Semantic Space (3D t-SNE Visualization)

**Purpose:** Visualize message embeddings in 3D space, clustered by topic.

**Requirements:**

- 3D scatter plot using **Plotly.js**
- Points colored by cluster
- Constellation lines connecting nearby points within clusters
- Glow halos behind points (larger, transparent markers)
- Click cluster buttons to filter/isolate
- Hover points to see message preview
- Auto-rotation (subtle, slow orbit)
- Drag to rotate, scroll to zoom

**Cluster buttons:** Positioned top-left, toggle to isolate clusters

**Library:** Plotly.js (`scatter3d` trace type)

**Data shape:**

```typescript
interface EmbeddingPoint {
  x: number;
  y: number;
  z: number;
  cluster: string;
  color: string;
  message: string; // preview text
  date: string;
}

interface Cluster {
  name: string;
  color: string;
  cx: number; // center x
  cy: number; // center y
  cz: number; // center z
}
```

**Generating clusters:** Run t-SNE/UMAP on embeddings, then k-means clustering. For MVP, can use mock data.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri Backend                           │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ DuckDB          │  │ Stats JSON      │                  │
│  │ (embeddings)    │  │ (precomputed)   │                  │
│  └────────┬────────┘  └────────┬────────┘                  │
│           │                    │                            │
│           └────────┬───────────┘                            │
│                    │                                        │
│           ┌────────▼────────┐                              │
│           │ Tauri Commands  │                              │
│           │ get_insights()  │                              │
│           └────────┬────────┘                              │
└────────────────────┼────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   React Frontend                            │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │ Timeline    │───▶│ Word Cloud  │    │ Heatmap     │    │
│  │ (Bar Chart) │    │ (filtered)  │    │             │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│         │                                                   │
│         │ brushRange                                        │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              3D Embedding Visualization              │   │
│  │                    (Plotly.js)                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Tauri Commands Needed

### `get_insights_data`

Returns aggregate statistics for the insights page.

```rust
#[tauri::command]
pub async fn get_insights_data() -> Result<InsightsData, String> {
    // Load from ~/.be-right-back/data/stats/
    // Aggregate across all contacts (or filter by selected)
}

#[derive(Serialize)]
pub struct InsightsData {
    pub daily_counts: Vec<DailyCount>,
    pub word_frequencies: Vec<WordFrequency>,
    pub heatmap_data: Vec<HeatmapCell>,
    pub total_messages: usize,
    pub avg_response_time_mins: f64,
    pub active_days: usize,
}
```

### `get_embeddings_for_viz`

Returns dimensionality-reduced embeddings for 3D visualization.

```rust
#[tauri::command]
pub async fn get_embeddings_for_viz(
    limit: Option<usize>,  // default 500
) -> Result<Vec<EmbeddingPoint>, String> {
    // 1. Load embeddings from DuckDB
    // 2. Run t-SNE or UMAP to reduce to 3D
    // 3. Run k-means clustering
    // 4. Return points with cluster assignments
}
```

---

## Dependencies

Add to `apps/desktop/package.json`:

```json
{
  "dependencies": {
    "recharts": "^2.10.0",
    "plotly.js-dist-min": "^2.27.0",
    "react-plotly.js": "^2.6.0"
  }
}
```

Or use CDN imports in the artifact pattern if preferred.

---

## Component Structure

```
src/components/
├── Insights/
│   ├── index.tsx              # Main insights page
│   ├── StatsRow.tsx           # 4 stat cards
│   ├── MessageTimeline.tsx    # Bar chart with brush
│   ├── WordCloud.tsx          # 2D spiral word cloud
│   ├── ActivityHeatmap.tsx    # Day/hour heatmap
│   ├── SemanticSpace.tsx      # 3D Plotly visualization
│   └── hooks/
│       └── useInsightsData.ts # Data fetching hook
```

---

## Implementation Phases

### Phase 1: Static Layout ✅ COMPLETE

- [x] Create page structure with placeholder data
- [x] Implement all visual components with mock data
- [x] Match the design aesthetic exactly

### Phase 2: Timeline + Word Cloud Interaction ✅ COMPLETE

- [x] Implement brush selection on bar chart
- [x] Wire brush state to word cloud filtering
- [x] Add hover interactions

### Phase 3: 3D Visualization ✅ COMPLETE

- [x] Integrate Plotly.js
- [x] Implement cluster filtering
- [x] Add auto-rotation (removed - user-controlled rotation only)
- [ ] Add constellation lines (deferred)

### Phase 4: Backend Integration ⏳ NOT STARTED

- [ ] Create Tauri commands (stubs ready in `src-tauri/src/commands/insights.rs`)
- [ ] Compute real word frequencies from messages
- [ ] Generate heatmap from timestamps
- [ ] Run t-SNE + HDBSCAN on real embeddings (script skeleton in `scripts/compute_viz_clusters.py`)

### Phase 5: Polish 🚧 PARTIAL

- [x] Loading states (skeleton loaders for all components)
- [x] Error handling (Ghost component with retry button)
- [ ] Performance optimization (virtualization if needed)
- [ ] Responsive layout

---

## Implementation Progress (as of 2025-12-07)

### Frontend Components ✅ Complete

| Component | File | Status |
|-----------|------|--------|
| InsightsLayout | `src/components/insights/InsightsLayout.tsx` | ✅ |
| InsightsHeader | `src/components/insights/InsightsHeader.tsx` | ✅ |
| StatsRow | `src/components/insights/StatsRow.tsx` | ✅ |
| MessageTimeline | `src/components/insights/MessageTimeline.tsx` | ✅ |
| WordCloud | `src/components/insights/WordCloud.tsx` | ✅ |
| ActivityHeatmap | `src/components/insights/ActivityHeatmap.tsx` | ✅ |
| SemanticSpace | `src/components/insights/SemanticSpace.tsx` | ✅ |
| useInsightsData | `src/components/insights/useInsightsData.ts` | ✅ |
| mockData | `src/components/insights/mockData.ts` | ✅ |
| TypeScript types | `src/types.ts` | ✅ |
| CSS styles | `src/styles/globals.css` | ✅ |

### Backend Commands ⏳ TODO

| Command | File | Status |
|---------|------|--------|
| get_insights_data | `src-tauri/src/commands/insights.rs` | Stub with TODOs |
| get_word_frequencies_for_range | `src-tauri/src/commands/insights.rs` | Stub with TODOs |
| get_embeddings_for_viz | `src-tauri/src/commands/insights.rs` | Stub with TODOs |

### Clustering Pipeline ⏳ TODO

| Step | File | Status |
|------|------|--------|
| t-SNE dimensionality reduction | `scripts/compute_viz_clusters.py` | Skeleton with TODOs |
| HDBSCAN clustering | `scripts/compute_viz_clusters.py` | Skeleton with TODOs |
| Post-ingestion hook | `src-tauri/src/commands/system.rs` | TODO comment added |

### Key Design Decisions Made

1. **HDBSCAN over k-means**: Auto-determines cluster count, handles noise
2. **t-SNE for 3D**: Better local structure preservation than PCA
3. **Hybrid Python/Rust**: Python for ML (t-SNE, HDBSCAN), Rust for queries
4. **Post-ingestion clustering**: Run after embeddings are saved, cache results in DuckDB

### Next Steps to Wire Up Real Data

1. Implement `scripts/compute_viz_clusters.py` (Python script for t-SNE + HDBSCAN)
2. Add `embedding_viz_cache` table to DuckDB schema during ingestion
3. Implement the 3 Tauri commands in `insights.rs`
4. Call Python script from `run_ingestion` after embeddings are saved
5. Uncomment invoke calls in `useInsightsData.ts`

---

## Reference Implementation

See the attached `prototype-b-v2-preview.jsx` file for a complete working prototype. This can be adapted to your component structure.

Key patterns from the prototype:

1. **Brush handling:**

```typescript
const handleBrushChange = useCallback(
  (range) => {
    if (range?.startIndex !== undefined) {
      setBrushRange({
        start: dailyData[range.startIndex]?.date,
        end: dailyData[range.endIndex]?.date,
        startIdx: range.startIndex,
        endIdx: range.endIndex,
      });
    } else {
      setBrushRange(null);
    }
  },
  [dailyData]
);
```

2. **Conditional cell coloring:**

```tsx
<Bar dataKey="volume" radius={[2, 2, 0, 0]} maxBarSize={6}>
  {daily.map((_, i) => {
    const inRange = brush && i >= brush.startIdx && i <= brush.endIdx;
    return (
      <Cell
        key={i}
        fill={inRange || !brush ? "url(#activeGradient)" : "url(#dimGradient)"}
      />
    );
  })}
</Bar>
```

3. **Plotly 3D setup:**

```typescript
const layout = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  scene: {
    xaxis: {
      showgrid: true,
      gridcolor: "rgba(0,255,65,0.06)",
      showticklabels: false,
    },
    // ... same for y, z
    camera: { eye: { x: 1.6, y: 1.6, z: 1.0 } },
  },
};
```

---

## Future Considerations

### Dual Theme Support

The app will eventually support two modes:

1. **Clean mode** - Light, minimal, professional aesthetic
2. **Retro/CRT mode** - Current dark terminal aesthetic

Structure CSS with theme tokens to enable easy switching:

```tsx
// Theme context
const themes = {
  retro: {
    bg: "#09090b",
    accent: "#00ff41",
    // ...
  },
  clean: {
    bg: "#ffffff",
    accent: "#10b981",
    // ...
  },
};
```

### Per-Contact Filtering

Current implementation shows aggregate data. Future version should allow filtering by specific contact/persona from a separate page.

---

## Questions?

If anything is unclear, refer to:

- `scripts/visualize.py` - Existing Python visualization logic
- `crates/common/src/models.rs` - Data structures
- `claude/phase-6-ui-polish.md` - UI phase documentation


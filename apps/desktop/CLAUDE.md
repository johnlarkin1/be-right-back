# React + Tauri frontend for the Be Right Back desktop app.

## Architecture

**Tab routing**: `App.tsx` holds a `useState<TabId>` ("insights" | "casper" | "personas") and renders the matching `*Layout` component inside `AppShell`. Insights maps to `InsightsLayout`, Casper to `HomeLayout`, and Personas to `ChatLayout`. The app opens on Insights, or on Casper until ingestion finishes. No React Router is used for top-level navigation -- tabs switch via a simple `setActiveTab` callback passed down as `onNavigate`. Framer Motion `AnimatePresence` handles tab transitions.

**Component tree**: `App` -> `ThemeProvider` -> `AppShell` (TopBar with the tab bar + VisualEffects + content) -> `{Home,Chat,Insights}Layout`. Each Layout is the root for its tab and lives in `src/components/{home,chat,insights}/`. Shared components live directly in `src/components/`. Barrel `index.ts` files exist in `effects/`, `theme/`, `insights/`, `home/`, `casper/`.

**HomeLayout routing**: Uses an internal `InitializationStatus` check (via `invoke("get_initialization_status")`) to decide between `WelcomeView` (onboarding/setup) and `DashboardView` (post-setup dashboard). Falls back to mock data in dev if the backend call fails.

## Dual UI Mode (Retro / Modern)

Two complete visual themes controlled by a single Zustand store (`themeStore.ts`):

- **State**: `useThemeStore` persists `mode: "retro" | "modern"` to localStorage key `"brb-ui-mode"`. Default is retro.
- **CSS**: Theme applies via `data-theme` attribute on `<html>`. Semantic CSS variables (`--color-surface`, `--color-accent`, `--font-body`, `--radius-*`) are defined in `styles/tokens/semantic.css` with defaults, then overridden per-theme in `styles/themes/retro.css` and `styles/themes/modern.css`.
- **Components**: Use `useUIMode()` hook which returns `{ mode, isRetro, isModern }`. Pattern is conditional rendering:
  ```tsx
  const { isRetro } = useUIMode();
  // Then: isRetro ? <Ghost .../> : <Loader2 .../>;
  // Or:  isRetro ? "font-terminal text-[var(--color-text-muted)]" : "text-sm text-[var(--color-text-secondary)]"
  ```
- **ThemedIcon**: Shows ASCII text in retro (`"[>_]"`) vs Lucide icons in modern.
- **VisualEffects**: Renders `CRTEffect` (scanlines/vignette/glow overlays) in retro, `ModernEffect` (subtle gradient + noise) in modern.

## State Management

Zustand stores in `src/stores/`:
- **themeStore**: UI mode (retro/modern) with localStorage persistence via `zustand/persist`.
- **insightsStore**: Granular insights data cache (stats, timeline, heatmap, calendar, words, embeddings). NOT persisted. Uses `useShallow` selectors to prevent re-render loops. Has `needsXFetch()` helpers and per-section `invalidateX()` methods.

## Custom Hooks (`src/hooks/`)

All hooks follow the pattern: local `useState` + `invoke()` calls + `listen()` for streaming events.

- **useIngestion**: 6-stage progress tracking (snapshot -> parsing -> chunking -> embedding -> saving -> analyzing). Listens to `"ingestion-progress"` events. Converts snake_case backend payloads to camelCase state. Returns `{stages, stats, startIngestion, cancelIngestion}`.
- **useCasperAgent**: AI agent interaction with real-time progress. Listens to `"casper-progress"` events (started/thinking/tool_start/tool_complete/token/token_reset/complete/cancelled/error). Streams answer tokens into `progress.streamingAnswer`; `token_reset` clears it. `cancelRequest()` calls `cancel_casper`. Manages conversation message history. Deduplicates events for React strict mode.
- **useContacts / useContactDetail**: Fetch contact lists and per-contact stats.
- **useOnboarding**: Multi-step onboarding state machine persisted to localStorage (`"brb-onboarding-state"`). Steps: welcome -> privacy_intro -> permissions -> first_snapshot -> ingestion_ready -> ingestion_running -> complete. Syncs with backend `InitializationStatus` as source of truth.
- **useIngestionSettings, useSnapshots, useChatMessages, useConversationAnalysis**: Data-fetching hooks wrapping specific `invoke()` commands.

## Tauri IPC Pattern

```tsx
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Request-response (commands defined in src-tauri/src/commands/)
const result = await invoke<TypedResponse>("command_name", { argName: value });

// Streaming events (backend emits via AppHandle::emit)
useEffect(() => {
  let unlisten: UnlistenFn | null = null;
  const setup = async () => {
    unlisten = await listen<PayloadType>("event-name", (event) => {
      // event.payload is the typed data
    });
  };
  setup();
  return () => { unlisten?.(); };
}, []);
```

Backend payloads arrive in snake_case; hooks manually convert to camelCase. Key event channels: `"ingestion-progress"`, `"casper-progress"`.

## Types

All types live in a single `src/types.ts` file (not a directory). Includes types for chat, contacts, initialization, pipeline, ingestion stages, insights, Casper agent events, and ingestion settings. Also exports display-oriented constants like `STAGE_LABELS`, `STAGE_COLORS`, and `CASPER_STATE_MESSAGES`.

## Styling

Tailwind CSS v4 via `@tailwindcss/vite` plugin. CSS architecture in `src/styles/`:
- `globals.css` - imports everything; base styles
- `tokens/primitives.css` - raw color values
- `tokens/semantic.css` - semantic variables (component-facing API)
- `themes/retro.css` - `[data-theme="retro"]` overrides (also `:root` default)
- `themes/modern.css` - `[data-theme="modern"]` overrides
- `utilities/shared.css` + `utilities/retro.css` - utility classes

Components use `var(--color-*)` CSS variables in Tailwind arbitrary values: `text-[var(--color-accent)]`, `bg-[var(--color-surface)]`.

## Dev Server

- Vite dev server is fixed to **port 1420** (`strictPort: true`) -- Tauri expects this exact port.
- HMR port is 1421 when `TAURI_DEV_HOST` is set.
- File watcher ignores `src-tauri/` to avoid Rust recompilation triggering frontend rebuilds.
- Path alias: `@/` maps to `./src/` (configured in `vite.config.js`).
- Rust backend changes require full `tauri dev` restart; React changes hot-reload instantly.

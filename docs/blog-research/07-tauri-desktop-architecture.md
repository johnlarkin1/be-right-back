# Research Report: Tauri Desktop App Architecture

> Reference material for writing about the Tauri + React + Zustand desktop app
> Generated: 2026-04-03

---

## What You Built

A macOS desktop app using Tauri v2 (Rust backend) + React 19 (frontend) with Zustand state management, dual theme system (retro CRT vs modern clean), tab-based navigation, 24+ Tauri IPC commands, 6 streaming event channels, and a custom onboarding flow.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand (4 stores) |
| Backend | Rust (6 crates) |
| Build | Turbopack (dev), Vite (prod) |
| Target | macOS 12.0+, Apple Silicon only |
| Category | Social Networking |
| Bundle | DMG + .app |

---

## IPC Architecture

### Commands (Frontend → Backend)

24+ Tauri commands registered in `apps/desktop/src-tauri/src/lib.rs` via `generate_handler![]`:

```rust
// apps/desktop/src-tauri/src/lib.rs
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        get_all_contacts,
        get_contact_messages,
        start_ingestion,
        cancel_ingestion,
        get_ingestion_state,
        start_training,
        send_chat_message,
        // ... 20+ more
    ])
```

Frontend calls:
```tsx
const contacts = await invoke<Contact[]>('get_all_contacts');
const result = await invoke('start_training', { contactId, config });
```

### Events (Backend → Frontend, streaming)

6 event channels for async progress updates:

| Event | Purpose | Data |
|-------|---------|------|
| `ingestion-progress` | 6-stage pipeline progress | stage, percent, stats, current contact |
| `training-status` | LoRA training progress | epoch, loss, checkpoint |
| `chat-token` | Persona chat streaming | token text, is_complete |
| `analysis-progress` | Analytics pipeline | stage, percent |
| `casper-progress` | Agent tool-calling progress | status, tool calls |
| `casper-token` | Agent response streaming | token text (currently simulated) |

Backend emits:
```rust
app_handle.emit("ingestion-progress", &progress)?;
```

Frontend listens:
```tsx
const unlisten = await listen('ingestion-progress', (event) => {
    setProgress(event.payload);
});
return () => { unlisten(); };
```

---

## State Management

### 4 Zustand Stores

| Store | File | Purpose | Persistence |
|-------|------|---------|-------------|
| `themeStore` | `stores/themeStore.ts` | UI mode (retro/modern) | localStorage |
| `insightsStore` | `stores/insightsStore.ts` | Insights data cache | None (memory only) |
| `chatStore` | (in hooks) | Chat messages, active persona | None |
| `appStore` | (in hooks) | App state, ingestion status | None |

### The `useShallow` Pattern
Critical for preventing re-render loops with Zustand:

```tsx
// BAD — creates new object reference every render, triggers infinite re-renders
const { data, isLoading } = useInsightsStore(state => ({
    data: state.data,
    isLoading: state.isLoading
}));

// GOOD — useShallow does shallow comparison of the extracted values
const { data, isLoading } = useInsightsStore(useShallow(state => ({
    data: state.data,
    isLoading: state.isLoading
})));
```

---

## Dual Theme System

### Two Modes
- **Retro**: CRT scanlines, green phosphor glow, monospace fonts, terminal aesthetic
- **Modern**: Clean gradients, subtle noise, system fonts, minimal

### Implementation
```tsx
const { isRetro } = useUIMode();

return (
    <div className={isRetro ? 'font-mono text-crt-green' : 'font-sans text-gray-900'}>
        {isRetro ? <ScanlineOverlay /> : null}
        {/* content */}
    </div>
);
```

### CSS Token System
Design tokens in `globals.css`:
- `--crt-*`: Terminal theme (`--crt-bg: #0a0e0a`, `--crt-text: #00ff41`, `--crt-accent: #ffb000`)
- `--surface-*`: Surface layers
- `--border-*`: Border colors
- `--text-*`: Content readability

---

## Backend State

### AppState
```rust
pub struct AppState {
    pub db_dir: PathBuf,
    pub metadata_db: Mutex<MetadataDb>,    // SQLite
    pub vector_db: Mutex<Option<VectorDb>>, // DuckDB
}
```

### IngestionState
```rust
pub struct IngestionState {
    pub is_running: AtomicBool,
    pub cancel_flag: Arc<AtomicBool>,
    pub progress: Mutex<IngestionProgressState>,
}
```

### Concurrency Pattern
- `Mutex<T>` for shared mutable state
- `AtomicBool` for cancellation flags
- `Arc<AtomicBool>` passed to Python subprocess spawning code
- Cancellation checked between pipeline stages (not mid-stage)

---

## Tab-Based Navigation (No React Router)

```tsx
type Tab = 'home' | 'chat' | 'insights';
const [activeTab, setActiveTab] = useState<Tab>('home');

// Render based on state, not URL
{activeTab === 'home' && <HomeView />}
{activeTab === 'chat' && <ChatView />}
{activeTab === 'insights' && <InsightsView />}
```

Why no router: Single-window desktop app with no URL bar. State-based switching is simpler and avoids route management overhead.

---

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `useIngestion` | Wraps `invoke('start_ingestion')` + `listen('ingestion-progress')` |
| `useCasperAgent` | Agent queries + tool-calling progress |
| `useOnboarding` | First-run flow state machine |
| `useUIMode` | Returns `isRetro` boolean from themeStore |
| `useArticleMode` | Technical/simple toggle for website articles |

---

## Key Numbers

| Metric | Value |
|--------|-------|
| TypeScript lines (desktop) | 24,161 |
| Tauri commands | 24+ registered |
| Event channels | 6 streaming channels |
| Zustand stores | 4 |
| Frontend tests | 300+ Vitest component tests |
| E2E tests | 33 Playwright tests |
| Views | 3 main tabs (home, chat, insights) |
| Modals | CommandPalette, AboutModal, ShortcutsModal, TrainingModal |

---

## Code Locations

| Component | Path |
|-----------|------|
| Tauri config | `apps/desktop/src-tauri/tauri.conf.json` |
| Command registration | `apps/desktop/src-tauri/src/lib.rs` |
| Backend commands | `apps/desktop/src-tauri/src/commands/` |
| Backend state | `apps/desktop/src-tauri/src/state.rs` |
| Frontend stores | `apps/desktop/src/stores/` |
| Frontend hooks | `apps/desktop/src/hooks/` |
| Frontend components | `apps/desktop/src/components/` |
| Theme system | `apps/desktop/src/stores/themeStore.ts` |

---

## Narrative Angles

1. **"Why Tauri over Electron"** — Rust backend (not Node.js), smaller bundle size, native macOS integration (entitlements, codesigning), direct access to system APIs (ObjC FFI, filesystem).

2. **"Zustand > Redux for desktop apps"** — Minimal boilerplate, `useShallow` for performance, localStorage persistence for themes, no actions/reducers ceremony.

3. **"No router, no problem"** — Tab-based navigation via state, not URLs. Simpler mental model for a desktop app that has no concept of "back" or "forward."

4. **"6 event channels for ML pipeline feedback"** — Streaming progress from Rust→React for long-running operations (ingestion can take minutes, training can take hours). The UX challenge of making users wait.

5. **"The dual personality UI"** — Retro terminal aesthetic vs modern clean, switchable at runtime. How CSS tokens + a single `isRetro` boolean propagate through 50+ components.

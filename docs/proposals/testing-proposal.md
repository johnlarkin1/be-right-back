# Testing Proposal: Be Right Back Desktop App

## Current State (Updated 2026-03-15)

**Implemented infrastructure:**
- **311 Vitest tests** across 37 test files (unit + component + integration)
- **21 Playwright E2E tests** across 7 spec files (browser-level)
- **278 Rust tests** across all crates
- **5 Python test modules** via pytest
- **332 total frontend tests**

**What's been built:**
- Centralized Tauri IPC mock layer (`src/test/mocks/tauri.ts`) with `configureInvoke` pattern
- Mock data fixtures (`src/test/fixtures/`) for contacts, personas, insights, init status
- Custom render helper (`renderWithProviders`) with ThemeProvider
- Playwright Tauri mock (`e2e/fixtures/tauri-mock.js`) — full `__TAURI_INTERNALS__` mock with 18 commands
- Playwright test fixtures with `overrideResponsePersistent()` for reload-safe mock overrides
- Makefile targets: `test-desktop`, `test-e2e`, `test-e2e-ui`, `test-all`

---

## Proposed Testing Architecture

```
┌─────────────────────────────────────────────────────────┐
│  E2E Tests (Playwright)                                 │
│  Full app flows with mocked Tauri backend               │
├─────────────────────────────────────────────────────────┤
│  Integration Tests (Vitest + React Testing Library)     │
│  Multi-component flows with mocked IPC                  │
├─────────────────────────────────────────────────────────┤
│  Unit Tests (Vitest)                                    │
│  Individual components, hooks, stores, utils            │
├─────────────────────────────────────────────────────────┤
│  Rust Tests (cargo test) — already robust               │
│  Python Tests (pytest) — already solid                  │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Mock Data & Test Infrastructure

### 1.1 Tauri IPC Mock Layer

Create `apps/desktop/src/test/mocks/tauri.ts` — a centralized mock for all `invoke()` and `listen()` calls.

```typescript
// Mock all Tauri IPC commands with realistic fake data
export const mockInvoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case 'get_initialization_status':
      return mockInitStatus();
    case 'get_all_contacts':
      return mockContacts();
    case 'get_contact_detail_stats':
      return mockContactDetailStats(args?.contactId as string);
    case 'list_personas':
      return mockPersonas();
    case 'get_insights_stats':
      return mockInsightsStats();
    case 'get_insights_timeline':
      return mockTimelineData(args?.aggregationType as string);
    case 'get_insights_heatmap':
      return mockHeatmapData();
    case 'get_word_frequencies':
      return mockWordFrequencies();
    case 'get_embeddings_for_viz':
      return mockEmbeddingsData(args?.use3d as boolean);
    case 'get_conversation_analysis':
      return mockConversationAnalysis(args?.contactId as string);
    // ... all other commands
  }
});
```

### 1.2 Mock Data Fixtures

Create `apps/desktop/src/test/fixtures/` with realistic mock data:

| File | Data | Purpose |
|------|------|---------|
| `contacts.ts` | 10+ contacts with varied states (trained, locked, untrained) | Chat sidebar, contact detail |
| `personas.ts` | 3-4 trained personas with adapter metadata | Persona list, chat |
| `messages.ts` | Chat message histories (user + assistant turns) | Message display, streaming |
| `insights.ts` | Stats, timeline, heatmap, word frequencies, embeddings | All insights visualizations |
| `analysis.ts` | Full personality analysis markdown (6 sections) | Analysis modal |
| `ingestion.ts` | Ingestion progress event sequences (all 5 stages) | Progress tracking |
| `training.ts` | Training progress event sequences (all 4 phases) | Training modal |
| `casper.ts` | Casper agent event sequences (thinking, tools, tokens) | Casper chat |

### 1.3 Event Emitter Mock

Mock Tauri's `listen()` for testing streaming/event-driven flows:

```typescript
export class MockEventEmitter {
  private listeners = new Map<string, Function[]>();

  listen(event: string, handler: Function) {
    this.listeners.get(event)?.push(handler) ?? this.listeners.set(event, [handler]);
    return () => { /* unlisten */ };
  }

  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.forEach(fn => fn({ payload }));
  }

  async emitSequence(event: string, payloads: unknown[], delayMs = 50) {
    for (const payload of payloads) {
      this.emit(event, payload);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
```

---

## Phase 2: Unit Tests (Vitest)

### 2.1 Stores

| Store | Tests |
|-------|-------|
| `themeStore` | Already has 7 tests (keep) |
| `insightsStore` | Cache invalidation, per-section loading states, `needsFetch` logic, selector hooks |

### 2.2 Hooks

| Hook | Key Test Cases |
|------|----------------|
| `useInitStatus` | Loading → success, loading → error → retry, caching |
| `useOnboarding` | Step progression, localStorage persistence, backend reconciliation |
| `useIngestion` | 5-stage progress tracking, cancel, stage transitions, stats accumulation |
| `useIngestionSettings` | Load/save roundtrip, date range defaults, analytics config |
| `useContacts` | Fetch contacts, filter by training status, locked contacts |
| `useContactDetail` | Fetch stats, contactId change triggers refetch |
| `useChatMessages` | Send message, token streaming, think-tag stripping, MSG_BREAK splitting, auto-scroll |
| `useCasperAgent` | Event sequence: started → thinking → tool_start → tool_complete → token → complete |
| `useConversationAnalysis` | Load cached, generate new, progress phases, force refresh |
| `useGlobalShortcuts` | Keyboard shortcut registration and handler invocation |

### 2.3 Components (Isolated)

| Component | Key Test Cases |
|-----------|----------------|
| `MessageBubble` | User vs assistant styling, streaming cursor, retro vs modern labels |
| `ChatInput` | Enter sends, empty doesn't send, input clears after send |
| `ChatSidebar` | Tab switching, contact list rendering, persona list rendering, status badges |
| `ContactDetailPanel` | Stats display, train/retrain buttons on "You" only |
| `TrainingModal` | Confirm view, progress phases, loss display, success/error states |
| `ConversationAnalysisModal` | Section rendering, accordion expand/collapse, TOC navigation, re-analyze |
| `IngestionProgress` | 5-stage bars, ghost parade, elapsed time, cancel button |
| `CompactStatsBar` | Number formatting (1M, 1.5k), date formatting per mode, refresh confirmation |
| `StatsRow` | 4 stat cards, loading skeletons, tooltip content |
| `MessageTimeline` | Bar chart renders, aggregation toggle, brush range selection |
| `ActivityHeatmap` | Grid rendering, year/rolling view toggle, color intensity levels |
| `WordCloud` | Word positioning, font sizing, date range filtering |
| `TopBar` | Tab navigation, active tab indicator, ghost menu, theme toggle |
| `CommandPalette` | Open/close, search filtering, action execution |
| `ErrorBoundary` | Already has 9 tests (keep) |

### 2.4 Utilities

| Utility | Tests |
|---------|-------|
| `analysisParser.ts` | Markdown section parsing, edge cases (missing sections, empty content) |
| `tauri.ts` | Service layer function signatures, error handling |

---

## Phase 3: Integration Tests (Vitest + RTL)

Multi-component flows tested with mocked Tauri backend:

### 3.1 Chat Tab Integration

| Flow | Steps |
|------|-------|
| **Contact → Train → Chat** | Select contact → open training modal → confirm → simulate progress events → complete → switch to personas tab → select persona → send message → receive streamed response |
| **Contact → Analyze** | Select contact → click analyze → simulate analysis-progress events → modal opens with sections → accordion navigation → re-analyze |
| **Persona Chat Flow** | Select persona → type message → send → stream tokens → display bubbles → send another → verify history |

### 3.2 Home Tab Integration

| Flow | Steps |
|------|-------|
| **First-Time Onboarding** | WelcomeView → privacy → permissions → snapshot → ingestion → complete → dashboard |
| **Dashboard → Casper Chat** | Dashboard loads → stats bar visible → type question → enable thinking → send → tool calls → thinking blocks → answer streams |
| **Re-Ingestion** | Dashboard → refresh button → confirmation modal → confirm → ingestion progress → complete → stats update |

### 3.3 Insights Tab Integration

| Flow | Steps |
|------|-------|
| **Full Load** | Navigate to insights → all components load (stats, timeline, heatmap, word cloud, semantic space) |
| **Timeline Brush → Word Cloud** | Change aggregation → drag brush range → word cloud updates with filtered words |
| **Re-Analyze** | Click re-analyze → settings modal → confirm → progress bar → complete → data refreshes |
| **Semantic Space** | Toggle 2D/3D → filter clusters → change point density → interact with chart |

### 3.4 Cross-Tab Navigation

| Flow | Steps |
|------|-------|
| **Keyboard Navigation** | Cmd+1/2/3 switches tabs, state preserved across switches |
| **Quick Actions** | Home dashboard quick action cards navigate to Chat and Insights |
| **Theme Toggle** | Toggle theme → all visible components re-render in correct mode |
| **Command Palette** | Cmd+K → search → execute action → correct result |

---

## Phase 4: E2E Tests (Playwright)

### 4.1 Setup

Since this is a Tauri app, E2E tests target the **React dev server** (port 1420) with Tauri IPC fully mocked at the module level.

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run dev',  // Vite dev server only (no Tauri)
    port: 1420,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:1420',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'small-window', use: { viewport: { width: 900, height: 600 } } },
  ],
});
```

**Tauri Mock Strategy**: Inject mock `window.__TAURI__` before page loads via `page.addInitScript()`:

```typescript
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => { /* return mock data */ },
    // ... event listeners
  };
});
```

### 4.2 E2E Test Suites

#### Chat Tab E2E

```
e2e/chat/
  ├── contact-browsing.spec.ts     # Browse contacts, view details, search
  ├── training-flow.spec.ts        # Full training: select → confirm → progress → complete
  ├── persona-chat.spec.ts         # Send messages, receive responses, clear chat
  ├── analysis-modal.spec.ts       # Generate analysis, browse sections, re-analyze
  └── sidebar-tabs.spec.ts         # Switch contacts/personas tabs, selection state
```

#### Home Tab E2E

```
e2e/home/
  ├── onboarding-wizard.spec.ts    # Complete first-time setup flow
  ├── dashboard.spec.ts            # Stats bar, quick actions, privacy badge
  ├── casper-chat.spec.ts          # Q&A with thinking mode, tool calls, streaming
  ├── ingestion-progress.spec.ts   # Full ingestion with progress tracking + cancel
  └── re-ingestion.spec.ts         # Update snapshot from dashboard
```

#### Insights Tab E2E

```
e2e/insights/
  ├── stats-loading.spec.ts        # All stats cards load with data
  ├── timeline-interaction.spec.ts # Aggregation toggle, brush selection
  ├── heatmap.spec.ts              # Year toggle, hover tooltips
  ├── word-cloud.spec.ts           # Rendering, date range filtering
  ├── semantic-space.spec.ts       # 2D/3D toggle, cluster filtering
  └── re-analyze.spec.ts           # Settings modal → progress → data refresh
```

#### Cross-Cutting E2E

```
e2e/
  ├── navigation.spec.ts           # Tab switching, keyboard shortcuts, URL state
  ├── theme-switching.spec.ts      # Retro ↔ Modern toggle, visual consistency
  ├── command-palette.spec.ts      # Open, search, execute actions
  ├── error-states.spec.ts         # Network errors, missing data, recovery
  └── responsive.spec.ts           # Small window handling, component layout
```

### 4.3 Visual Regression (Optional)

Use Playwright's screenshot comparison for dual-theme consistency:

```typescript
test('chat tab matches retro snapshot', async ({ page }) => {
  await page.click('[data-theme-toggle]');  // ensure retro
  await expect(page).toHaveScreenshot('chat-retro.png');
});

test('chat tab matches modern snapshot', async ({ page }) => {
  await page.click('[data-theme-toggle]');  // switch to modern
  await expect(page).toHaveScreenshot('chat-modern.png');
});
```

---

## Phase 5: CI Integration

### Makefile Additions

```makefile
test-unit-desktop:     # Vitest unit tests
	cd apps/desktop && npm test

test-e2e:              # Playwright E2E tests
	cd apps/desktop && npx playwright test

test-e2e-ui:           # Playwright with UI mode (local dev)
	cd apps/desktop && npx playwright test --ui

test-all:              # Everything
	make test && make test-python && make test-unit-desktop && make test-e2e
```

### GitHub Actions

```yaml
- name: Frontend Unit Tests
  run: cd apps/desktop && npm test

- name: Install Playwright
  run: cd apps/desktop && npx playwright install --with-deps chromium

- name: E2E Tests
  run: cd apps/desktop && npx playwright test
```

---

## File Structure (Actual)

```
apps/desktop/
├── e2e/                              # Playwright E2E tests (21 tests)
│   ├── fixtures/
│   │   ├── tauri-mock.js             # window.__TAURI_INTERNALS__ mock (18 commands)
│   │   └── test-fixtures.ts          # tauriPage fixture with helpers
│   ├── home.spec.ts                  # Dashboard, welcome view, stats (3 tests)
│   ├── chat.spec.ts                  # Contact list, selection, sidebar tabs (3 tests)
│   ├── navigation.spec.ts            # Tab clicks, keyboard shortcuts, command palette (3 tests)
│   ├── theme.spec.ts                 # Toggle, persistence across reload (2 tests)
│   ├── insights.spec.ts              # Analytics load, needs-setup, charts (4 tests)
│   ├── error-states.spec.ts          # NeedsSetup flows, recovery (3 tests)
│   ├── casper.spec.ts                # Search input, typing, example queries (3 tests)
│   └── tsconfig.json
├── playwright.config.ts
├── src/
│   ├── test/
│   │   ├── setup.ts                  # Vitest setup (Tauri + framer-motion mocks)
│   │   ├── mocks/
│   │   │   └── tauri.ts              # configureInvoke() + listen() mocks
│   │   ├── fixtures/
│   │   │   ├── contacts.ts           # Contact + persona factory data
│   │   │   ├── insights.ts           # Stats, timeline, heatmap fixtures
│   │   │   └── initialization.ts     # InitializationStatus factory
│   │   └── helpers/
│   │       └── render.tsx            # renderWithProviders (ThemeProvider wrapper)
│   ├── stores/
│   │   ├── themeStore.test.ts        # 7 tests
│   │   └── insightsStore.test.ts     # 10 tests
│   ├── hooks/
│   │   ├── useInitStatus.test.ts
│   │   ├── useContacts.test.ts
│   │   ├── useChatMessages.test.ts
│   │   ├── useCasperAgent.test.ts
│   │   ├── useIngestion.test.ts
│   │   ├── useOnboarding.test.ts
│   │   └── useGlobalShortcuts.test.ts
│   ├── __tests__/
│   │   └── theme-integration.test.tsx  # Theme store + component integration (6 tests)
│   ├── components/
│   │   ├── __tests__/
│   │   │   ├── ErrorBoundary.test.tsx
│   │   │   ├── TopBar.test.tsx
│   │   │   ├── CommandPalette.test.tsx
│   │   │   ├── Navigation.test.tsx
│   │   │   ├── ShortcutsModal.test.tsx
│   │   │   └── AboutModal.test.tsx
│   │   ├── chat/__tests__/
│   │   │   ├── ChatLayout.integration.test.tsx  # 9 integration tests
│   │   │   ├── ChatInput.test.tsx
│   │   │   ├── ChatSidebar.test.tsx
│   │   │   ├── ContactDetailPanel.test.tsx
│   │   │   ├── InlineChatPanel.test.tsx
│   │   │   ├── MessageBubble.test.tsx
│   │   │   ├── ConversationAnalysisModal.test.tsx
│   │   │   └── TrainingModal.test.tsx
│   │   ├── home/__tests__/
│   │   │   ├── HomeLayout.integration.test.tsx  # 8 integration tests
│   │   │   ├── CompactStatsBar.test.tsx
│   │   │   ├── IngestionCTA.test.tsx
│   │   │   ├── IngestionProgress.test.tsx
│   │   │   ├── NeedsSetup.test.tsx
│   │   │   ├── PrivacyBadge.test.tsx
│   │   │   ├── QuickActions.test.tsx
│   │   │   └── StatsOverview.test.tsx
│   │   └── insights/__tests__/
│   │       ├── InsightsLayout.integration.test.tsx  # 11 integration tests
│   │       ├── InsightsHeader.test.tsx
│   │       └── StatsRow.test.tsx
│   └── lib/
│       └── analysisParser.test.ts    # 9 tests
```

---

## Priority Order & Completion Status

| Priority | What | Status | Tests |
|----------|------|--------|-------|
| **P0** | Mock infrastructure (tauri mock, fixtures, event emitter) | ✅ Done | — |
| **P0** | Playwright setup + config | ✅ Done | — |
| **P1** | Hook unit tests (`useChatMessages`, `useCasperAgent`, `useIngestion`, etc.) | ✅ Done | 49 |
| **P1** | Chat E2E (contact browsing, sidebar tabs, selection) | ✅ Done (core flows) | 3 |
| **P2** | Home E2E (dashboard, welcome view, stats, casper search) | ✅ Done | 6 |
| **P2** | Component unit tests (MessageBubble, ChatInput, TrainingModal, etc.) | ✅ Done | 196 |
| **P3** | Insights E2E (stats loading, charts, needs-setup) | ✅ Done (core flows) | 4 |
| **P3** | Cross-cutting E2E (navigation, theme, command palette, error states) | ✅ Done | 8 |
| **P3** | Insights integration test (InsightsLayout routing, error, empty) | ✅ Done | 11 |
| **P4** | Visual regression snapshots | Not started | — |
| **P4** | GitHub Actions CI workflow | Not started (free tier) | — |
| **—** | Advanced E2E: training flow, persona chat, streaming, onboarding wizard | Future | — |

**Total delivered: 332 tests (311 Vitest + 21 Playwright)**

---

## Dependencies to Install

```bash
cd apps/desktop

# Playwright (E2E)
npm install -D @playwright/test
npx playwright install chromium

# Already installed (keep):
# vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom
```

---

## Key Design Decisions

1. **Mock at the Tauri IPC boundary** — not at the component prop level. This tests the real hooks and services while isolating from Rust/Python backends.

2. **E2E against Vite dev server** (not full Tauri app) — Playwright can't easily drive a Tauri window. Running against the React dev server with mocked `window.__TAURI_INTERNALS__` gives 95% of the value.

3. **Fixture-based mock data** — realistic, typed, reusable across unit and E2E tests. Each fixture file exports factory functions for easy customization.

4. **Event sequence testing** — critical for streaming flows (chat tokens, training progress, ingestion stages). The `MockEventEmitter` enables deterministic testing of async event-driven UIs.

5. **Dual-theme coverage** — every visual E2E test runs in both retro and modern modes to catch theme-specific regressions.

# Phase 6: Desktop App UI & Features

**Timeline:** Week 6-7
**Status:** 🟡 ~70-75% Complete (January 2025)
**Dependencies:** Phase 5 (Tauri integration must be complete)
**Priority:** High

---

## Overview

Build a polished, ominous CRT terminal-style interface for the desktop app. The UI should feel like a retro computer terminal with scanlines, phosphor glow, and wandering pixel art ghosts.

### Goals

1. Port CRT design system from marketing website
2. Build "Digital You" chat interface
3. Build Conversation Search with @mentions
4. Build Insights Dashboard (global + per-contact)
5. Create app navigation shell
6. Polish animations and micro-interactions

---

## Design System

### CRT Terminal Theme

Port from `apps/website/src/app/globals.css`:

```css
:root {
  /* Core CRT Colors */
  --crt-bg: #0a0e0a;           /* Very dark green-black */
  --crt-text: #00ff41;         /* Terminal green */
  --crt-glow: rgba(0, 255, 65, 0.5);  /* Green glow */
  --crt-accent: #ffb000;       /* Amber/orange accent */
  --crt-purple: #8b00ff;       /* Purple accent */
  --crt-cyan: rgba(0, 255, 255, 0.5); /* Cyan accent */
}
```

### Typography

- **VT323**: Pixel/terminal font for headings and UI elements
- **IBM Plex Mono**: Monospace font for body text and messages
- **Text shadows**: Green glow effect on important text

### Visual Effects

1. **Scanlines**: Subtle horizontal lines overlay
2. **Vignette**: Darkened edges
3. **Phosphor glow**: Subtle bloom on text
4. **Screen flicker**: Optional subtle animation

### Pixel Art Ghosts

Port ghost SVG components from website with variants:
- Standard (terminal green)
- Happy, sleepy, surprised, angry, sad, mischievous, worried, excited, bored
- Floating animation
- "Fleeing" state with motion lines

---

## Three Main Features

### Feature 1: "Digital You" Chat

The primary chat interface for talking to your trained persona.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ > ./digital-you                            👻   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Training Status: Ready (trained 2024-11-22) │ │
│ │ Model: qwen3-4b + your-lora              │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│     ┌───────────────────────────────────────┐   │
│     │ [USER] how would I respond to this?   │   │
│     └───────────────────────────────────────┘   │
│                                                 │
│     ┌───────────────────────────────────────┐   │
│     │ [DIGITAL-YOU] lol idk probably just   │   │
│     │ say "sounds good" and move on tbh     │   │
│     └───────────────────────────────────────┘   │
│                                                 │
│              👻 (wandering ghost)               │
│                                                 │
├─────────────────────────────────────────────────┤
│ > _                                      [SEND] │
└─────────────────────────────────────────────────┘
```

**Components:**
- `ChatLayout.jsx` - Main container with CRT overlay
- `MessageBubble.jsx` - Terminal-styled messages (user vs persona)
- `ChatInput.jsx` - Command-line style input with blinking cursor
- `PersonaHeader.jsx` - Shows training status, model info
- `StreamingText.jsx` - Character-by-character typing animation

**States:**
- No persona trained (show training prompt)
- Persona ready (show chat)
- Loading/streaming response
- Error state

---

### Feature 2: Conversation Search

RAG-powered Q&A about your message history with @mentions.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ > ./search                                 👻   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Type @name to filter to a specific contact  │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│     ┌───────────────────────────────────────┐   │
│     │ [USER] @Alice when did we last talk   │   │
│     │        about dinner plans?            │   │
│     └───────────────────────────────────────┘   │
│                                                 │
│     ┌───────────────────────────────────────┐   │
│     │ [SEARCH] Found 3 relevant messages:   │   │
│     │                                       │   │
│     │ Nov 15: "hey want to do dinner fri?"  │   │
│     │ Nov 16: "yeah Friday works! 7pm?"     │   │
│     │ Nov 17: "perfect, see you then"       │   │
│     │                                       │   │
│     │ Last dinner discussion: Nov 17, 2024  │   │
│     └───────────────────────────────────────┘   │
│                                                 │
├─────────────────────────────────────────────────┤
│ > @_                                     [SEND] │
└─────────────────────────────────────────────────┘
```

**Components:**
- `SearchLayout.jsx` - Search interface container
- `ContactMention.jsx` - @mention autocomplete dropdown
- `SearchResult.jsx` - Display retrieved messages
- `SearchInput.jsx` - Input with @mention detection

**Functionality:**
- @mention autocomplete (shows contacts as you type)
- RAG retrieval with similarity search
- Displays relevant message excerpts with dates
- Summarizes answer to question

---

### Feature 3: Insights Dashboard

Analytics about your messaging patterns.

**Layout - Global View:**
```
┌─────────────────────────────────────────────────┐
│ > ./insights                               👻   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Total Messages: 45,231                      │ │
│ │ Contacts: 127 | Active (30d): 23            │ │
│ │ Your messages: 22,456 | Received: 22,775    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Top Contacts ─────────────────────────────┐  │
│ │ 1. Alice         ████████████  4,521 msgs  │  │
│ │ 2. Bob           ████████      3,102 msgs  │  │
│ │ 3. Mom           ██████        2,341 msgs  │  │
│ │ 4. Work Group    █████         1,876 msgs  │  │
│ │ 5. David         ████          1,245 msgs  │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ ┌─ Message Frequency (30 days) ──────────────┐  │
│ │    ▄▄ ▄▄▄▄▄    ▄▄▄▄▄▄▄▄    ▄▄▄            │  │
│ │ ▄▄████████▄▄▄▄██████████▄▄████▄▄▄▄▄▄▄▄▄▄  │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ [Click a contact for detailed view]             │
└─────────────────────────────────────────────────┘
```

**Layout - Per-Contact Deep Dive:**
```
┌─────────────────────────────────────────────────┐
│ > ./insights/alice                         👻   │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ Conversation with: Alice                    │ │
│ │ Total messages: 4,521 | First: Jan 2019     │ │
│ │ Avg response time: 12 min (you) | 8 min     │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Message Balance ──────────────────────────┐  │
│ │ You:   █████████████████  52%  (2,351)     │  │
│ │ Alice: ███████████████    48%  (2,170)     │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ ┌─ Most Active Hours ────────────────────────┐  │
│ │ 9pm █████████████████████████  Peak        │  │
│ │ 8pm ███████████████████                    │  │
│ │ 10pm ██████████████                        │  │
│ └────────────────────────────────────────────┘  │
│                                                 │
│ [← Back to overview]         [Export stats]     │
└─────────────────────────────────────────────────┘
```

**Components:**
- `InsightsLayout.jsx` - Dashboard container
- `GlobalStats.jsx` - Overall statistics
- `ContactList.jsx` - Top contacts with message counts
- `MessageChart.jsx` - Terminal-style ASCII/simple charts
- `ContactDetail.jsx` - Per-contact analytics
- `StatCard.jsx` - Reusable stat display component

---

## App Navigation Shell

**Tab-based navigation with terminal styling:**

```jsx
// Three main routes
[./chat]     → "Digital You" chat interface
[./search]   → Conversation search with @mentions
[./insights] → Analytics dashboard
```

**Header:**
```
┌─────────────────────────────────────────────────┐
│ > Be Right Back                            👻   │
├─────────────────────────────────────────────────┤
│ [./chat]  [./search]  [./insights]  [./config]  │
└─────────────────────────────────────────────────┘
```

**Components:**
- `AppShell.jsx` - Main layout wrapper with CRT effect
- `Navigation.jsx` - Tab bar with terminal styling
- `Header.jsx` - App title with ghost mascot

---

## Implementation Tasks

### Task 1: Design System Setup (1 day) ✅
- [x] Install Tailwind CSS, PostCSS, autoprefixer
- [x] Create `globals.css` with CRT variables
- [x] Add VT323 and IBM Plex Mono fonts
- [x] Create utility classes for glow effects (`.text-glow`, `.text-glow-strong`, `.box-glow`)

### Task 2: Visual Components (1-2 days) ✅
- [x] Port `CRTEffect.tsx` (scanlines, vignette, glow overlays)
- [x] Port `Ghost.tsx` (pixel art with floating animation)
- [x] Create terminal text with glow effects
- [x] Create styled buttons with terminal aesthetic
- [x] Create command-line style inputs

### Task 3: App Shell (1 day) ✅
- [x] Create `AppShell.tsx` with CRT overlay
- [x] Create `TopBar.tsx` with terminal tabs (Home, Chat, Insights)
- [x] Create header with ghost mascot
- [x] Set up React Router for navigation

### Task 4: "Digital You" Chat (2-3 days) 🟡
- [x] Create `ChatLayout.tsx` with two-panel design
- [x] Create `MessageBubble.tsx` with user/persona styling (`[USER]`/`[DIGITAL-YOU]`)
- [x] Create `ChatInput.tsx` with blinking cursor and `>` prompt
- [x] Create streaming text support in MessageBubble
- [x] Create `InlineChatPanel.tsx` with persona header
- [x] Wire up to Tauri inference command (with demo fallback)
- [ ] Connect backend streaming responses (blocked by Phase 3 daemon)

### Task 5: Conversation Search (2-3 days) 🔴
- [x] Create `SearchLayout.tsx` with Casper Q&A hero
- [ ] Create `ContactMention.tsx` with autocomplete (NOT STARTED)
- [ ] Create `SearchResult.tsx` for displaying matches (PLACEHOLDER ONLY)
- [ ] Create `SearchInput.tsx` with @mention detection (INPUT DISABLED)
- [ ] Wire up to Tauri RAG commands (BLOCKED - RAG not integrated)

### Task 6: Insights Dashboard (2-3 days) ✅
- [x] Create `InsightsLayout.tsx` with prerequisite checks
- [x] Create `StatsRow.tsx` with four stat cards
- [x] Create `MessageTimeline.tsx` with brush selection
- [x] Create `ActivityHeatmap.tsx` with year selector
- [x] Create `WordCloud.tsx` with spiral positioning
- [x] Create `SemanticSpace.tsx` for 2D/3D embeddings
- [x] Wire up to Tauri stats commands

### Task 7: Polish & Animation (1-2 days) 🟡
- [x] Add framer-motion animations (MessageBubble, navigation)
- [x] Smooth transitions between views
- [x] Loading states with skeleton components
- [x] Error states with appropriate messaging
- [ ] Keyboard shortcuts (PARTIAL)

---

## Tauri Commands Needed

```rust
// Chat (Phase 3 integration)
#[tauri::command]
fn chat_with_persona(message: String, history: Vec<Message>) -> Result<String>

// Search (Phase 4 integration)
#[tauri::command]
fn search_messages(query: String, contact_filter: Option<String>) -> Result<Vec<SearchResult>>

#[tauri::command]
fn list_contacts() -> Result<Vec<Contact>>

// Insights
#[tauri::command]
fn get_global_stats() -> Result<GlobalStats>

#[tauri::command]
fn get_contact_stats(contact_id: String) -> Result<ContactStats>

#[tauri::command]
fn get_message_frequency(days: u32) -> Result<Vec<FrequencyData>>
```

---

## File Structure

```
apps/desktop/src/
├── App.jsx
├── main.jsx
├── styles/
│   └── globals.css              # CRT design system
├── components/
│   ├── AppShell.jsx
│   ├── Navigation.jsx
│   ├── Header.jsx
│   ├── CRTEffect.jsx
│   ├── Ghost.jsx
│   ├── ui/
│   │   ├── TerminalText.jsx
│   │   ├── TerminalButton.jsx
│   │   └── TerminalInput.jsx
│   ├── chat/
│   │   ├── ChatLayout.jsx
│   │   ├── MessageBubble.jsx
│   │   ├── ChatInput.jsx
│   │   ├── StreamingText.jsx
│   │   └── PersonaHeader.jsx
│   ├── search/
│   │   ├── SearchLayout.jsx
│   │   ├── ContactMention.jsx
│   │   ├── SearchResult.jsx
│   │   └── SearchInput.jsx
│   └── insights/
│       ├── InsightsLayout.jsx
│       ├── GlobalStats.jsx
│       ├── ContactList.jsx
│       ├── MessageChart.jsx
│       └── ContactDetail.jsx
├── hooks/
│   ├── useChat.js
│   ├── useSearch.js
│   └── useInsights.js
└── stores/
    └── appStore.js              # Zustand store
```

---

## Testing Checkpoints

Before moving to Phase 7, verify:

1. **Design System:** ✅
   - [x] CRT effect renders correctly (scanlines, vignette, glow)
   - [x] Fonts load (VT323, IBM Plex Mono)
   - [x] Glow effects work (`.text-glow`, `.box-glow`)
   - [x] Ghost animations are smooth (floating, wandering)

2. **Chat Feature:** 🟡
   - [x] Can send messages
   - [ ] Responses stream character-by-character (blocked by inference daemon)
   - [x] Message history preserved
   - [x] Empty state shows ghost mascot

3. **Search Feature:** 🔴
   - [ ] @mention autocomplete works (NOT IMPLEMENTED)
   - [ ] Search returns relevant results (DISABLED)
   - [ ] Results display with context (PLACEHOLDER)
   - [x] Empty state handled (shows "Coming Soon")

4. **Insights Feature:** ✅
   - [x] Global stats load correctly
   - [x] Timeline with brush selection working
   - [x] Charts render with data (heatmap, word cloud, semantic space)
   - [x] Filtering cascades between visualizations

5. **Navigation:** ✅
   - [x] Tabs switch views correctly
   - [x] URL routing works
   - [x] State preserved between views

---

## Success Criteria

Phase 6 is complete when:

1. ✅ CRT terminal aesthetic is fully implemented
2. 🟡 All three features (Chat, Search, Insights) are functional
   - Chat: 75% (streaming blocked)
   - Search: 20% (RAG not integrated)
   - Insights: 85% (fully functional)
3. ✅ Navigation between features is smooth
4. ✅ Ghost mascot appears throughout the app
5. ✅ Loading and error states are handled gracefully
6. ✅ App feels cohesive and polished

**Phase 6 is ~70-75% complete.**

---

## Remaining Work (~25-30%)

### Critical (to complete Phase 6)

1. **Connect streaming inference to chat** - Requires Phase 3 inference daemon reimplementation
2. **Implement RAG search** - Wire Casper Q&A to RAG backend (Phase 4 integration)
3. **Add @mention autocomplete** - ContactMention component with search-as-you-type
4. **Create SearchResult component** - Display ranked results with context snippets

### Nice-to-have

5. **Add keyboard shortcuts** - Cmd+K for search, Cmd+Enter to send
6. **Complete TopBar menu actions** - Settings, help, about (about works)
7. **Add persona typing indicator** - Show when model is generating

### Blocked by other phases

- Search feature blocked by **Phase 4** RAG integration gap
- Chat streaming blocked by **Phase 3** inference daemon deletion

**Next phase:** [Phase 7: Optimization & Testing](./phase-7-optimization.md)

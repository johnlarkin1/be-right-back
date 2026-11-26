# Dual UI Mode System: Master Orchestration Guide

## 🎯 Project Goal

Transform the Be Right Back desktop application to support two distinct UI modes:

1. **Retro Terminal Mode** (existing) - CRT aesthetic with scanlines, green glow, pixel fonts
2. **Modern Sleek Mode** (new) - Clean, minimal, professional aesthetic inspired by Notion/Linear

This is NOT just CSS theming—it includes different icons, component variants, animations, and data presentation patterns.

---

## 📁 Project Documents

| Document | Purpose |
|----------|---------|
| `00-MASTER-ORCHESTRATION.md` | This file - overall project guide |
| `01-PHASE1-REFACTORING.md` | Codebase preparation and token architecture |
| `02-MODERN-UI-AESTHETICS.md` | Design specification for Modern mode |
| `03-TOGGLE-IMPLEMENTATION.md` | Master toggle and state management |
| `04-SUBAGENT-TASKS/` | Individual component conversion tasks |
| `05-MASTER-PROMPT.md` | Prompt for orchestrating sub-agents |

---

## 🏗️ Architecture Overview

### Theme System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ThemeProvider                             │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │  useThemeStore  │───▶│  localStorage   │ (persistence)       │
│  │  (Zustand)      │    │  'brb-ui-mode'  │                     │
│  └────────┬────────┘    └─────────────────┘                     │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐                                            │
│  │ data-theme attr │  <html data-theme="retro|modern">          │
│  └────────┬────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    CSS Token Layer                       │    │
│  │  ┌──────────────────┐    ┌──────────────────┐           │    │
│  │  │  tokens/base.css │    │ tokens/semantic.css │         │    │
│  │  │  (primitives)    │    │ (--surface, --accent)│        │    │
│  │  └──────────────────┘    └──────────────────┘           │    │
│  │                                                          │    │
│  │  ┌──────────────────┐    ┌──────────────────┐           │    │
│  │  │ themes/retro.css │    │ themes/modern.css │           │    │
│  │  │ [data-theme=     │    │ [data-theme=      │           │    │
│  │  │   "retro"]       │    │   "modern"]       │           │    │
│  │  └──────────────────┘    └──────────────────┘           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│           ▼                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Component Layer                        │    │
│  │                                                          │    │
│  │  ┌────────────────┐  ┌────────────────┐                 │    │
│  │  │ Mode-Agnostic  │  │ Mode-Specific  │                 │    │
│  │  │ Components     │  │ Components     │                 │    │
│  │  │ (use tokens)   │  │ (conditional)  │                 │    │
│  │  └────────────────┘  └────────────────┘                 │    │
│  │                                                          │    │
│  │  ┌────────────────┐  ┌────────────────┐                 │    │
│  │  │ useTheme()     │  │ <ThemeSwitch/> │                 │    │
│  │  │ hook           │  │ component      │                 │    │
│  │  └────────────────┘  └────────────────┘                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure (Post-Refactor)

```
apps/desktop/src/
├── styles/
│   ├── globals.css           # Base styles + imports
│   ├── tokens/
│   │   ├── primitives.css    # Raw values (colors, spacing)
│   │   └── semantic.css      # Semantic tokens (--surface, --accent)
│   ├── themes/
│   │   ├── retro.css         # Retro mode overrides
│   │   └── modern.css        # Modern mode overrides
│   └── utilities/
│       ├── shared.css        # Mode-agnostic utilities
│       ├── retro.css         # Retro-only utilities (.text-glow, etc)
│       └── modern.css        # Modern-only utilities
├── components/
│   ├── theme/
│   │   ├── ThemeProvider.tsx # Context + HTML attribute
│   │   ├── ThemeToggle.tsx   # Toggle button component
│   │   └── useTheme.ts       # Hook for accessing theme
│   ├── effects/
│   │   ├── CRTEffect.tsx     # Retro-only (unchanged)
│   │   └── ModernEffect.tsx  # Modern-only (subtle gradients)
│   ├── shared/               # Mode-agnostic base components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   └── ...
│   └── [feature]/            # Feature components (chat/, home/, etc)
│       └── ...
├── assets/
│   ├── icons/
│   │   ├── retro/            # Pixel art / terminal icons
│   │   └── modern/           # Lucide or custom clean icons
│   └── images/
│       ├── retro/
│       └── modern/
└── stores/
    └── themeStore.ts         # Zustand store for theme state
```

---

## 📅 Implementation Phases

### Phase 1: Refactoring (Prep Work)
**Duration:** 2-3 days  
**Goal:** Prepare codebase for dual-mode support

1. **Token Architecture Setup** (Day 1)
   - Create `tokens/primitives.css` with raw color/spacing values
   - Create `tokens/semantic.css` with semantic token mappings
   - Extract current CRT values into `themes/retro.css`

2. **CSS Refactoring** (Day 1-2)
   - Replace hardcoded CRT values with token references
   - Move CRT-specific utilities to `utilities/retro.css`
   - Create `utilities/shared.css` for mode-agnostic styles

3. **Component Audit** (Day 2-3)
   - Identify components needing mode-specific variants
   - Create abstraction layer for icon system
   - Document component-specific theming needs

**Deliverable:** Refactored codebase with token architecture, no visible changes

### Phase 2: Implementation (Feature Work)
**Duration:** 5-7 days  
**Goal:** Implement dual-mode functionality

1. **Toggle Implementation** (Day 1)
   - Create `themeStore.ts` with Zustand
   - Build `ThemeProvider.tsx` and `ThemeToggle.tsx`
   - Add toggle to TopBar and Settings

2. **Modern Theme CSS** (Day 2)
   - Create `themes/modern.css` with all token overrides
   - Create `utilities/modern.css` with modern-specific styles
   - Build `ModernEffect.tsx` as alternative to `CRTEffect`

3. **Component Conversion** (Day 3-7)
   - Execute sub-agent tasks for each component group
   - Create mode-specific icon mappings
   - Add conditional rendering where needed

**Deliverable:** Fully functional dual-mode application

### Phase 3: Polish & QA
**Duration:** 2-3 days  
**Goal:** Refine and test

1. Test all views in both modes
2. Ensure smooth transitions
3. Handle edge cases (loading states, errors, empty states)
4. Performance optimization

---

## 🔧 Component Categories

### Category A: CSS-Only Theming
Components that only need token swaps—no structural changes.

| Component | Token Changes |
|-----------|---------------|
| `StatsCard` | Background, border, text colors |
| `MessageBubble` | Background gradient, text color |
| `Navigation` | Tab styling, active states |
| `Header` | Background, text glow removal |

### Category B: Conditional Rendering
Components that show different content/structure per mode.

| Component | Retro | Modern |
|-----------|-------|--------|
| `Ghost` | Pixel art mascot | Simplified/hidden or emoji |
| `CRTEffect` | Scanlines, vignette | Subtle gradient backdrop |
| `ChatInput` | Blinking cursor, `> ` prompt | Clean input field |
| `TopBar` | Terminal command style | App title bar |

### Category C: Icon/Asset Swaps
Components using different icons per mode.

| Location | Retro | Modern |
|----------|-------|--------|
| Navigation tabs | ASCII/pixel icons | Lucide icons |
| Action buttons | Terminal symbols | Clean outline icons |
| Status indicators | `[●]` text | Colored dot |
| Empty states | Ghost mascot | Illustration or simple icon |

---

## 📊 Progress Tracking

### Phase 1 Checklist
- [ ] Create token architecture files
- [ ] Extract retro theme to separate file
- [ ] Refactor `globals.css` to use tokens
- [ ] Audit all components for theming needs
- [ ] Document mode-specific requirements per component
- [ ] Create icon abstraction system

### Phase 2 Checklist
- [ ] Implement `themeStore.ts`
- [ ] Build `ThemeProvider.tsx`
- [ ] Build `ThemeToggle.tsx`
- [ ] Create `themes/modern.css`
- [ ] Create `ModernEffect.tsx`
- [ ] Convert: Shell components (AppShell, Header, Navigation)
- [ ] Convert: Home components
- [ ] Convert: Chat components
- [ ] Convert: Search components
- [ ] Convert: Insights components
- [ ] Convert: Shared UI components
- [ ] Set up modern icon set

### Phase 3 Checklist
- [ ] Full QA pass in retro mode
- [ ] Full QA pass in modern mode
- [ ] Mode switching animation
- [ ] Accessibility review
- [ ] Performance profiling

---

## 🚀 Getting Started

1. **Read Phase 1 doc:** `01-PHASE1-REFACTORING.md`
2. **Create branch:** `git checkout -b feature/dual-ui-mode`
3. **Start with tokens:** Create the token architecture files
4. **Commit incrementally:** Each logical unit gets its own commit

```bash
# Example commit flow
git commit -m "feat(theme): add token architecture files"
git commit -m "refactor(css): extract retro theme to separate file"
git commit -m "refactor(css): update globals.css to use semantic tokens"
git commit -m "feat(theme): implement ThemeProvider and toggle"
git commit -m "feat(theme): add modern theme CSS"
git commit -m "feat(theme): convert AppShell to dual-mode"
# ... continue for each component group
```

---

## 🤖 Sub-Agent Orchestration

See `05-MASTER-PROMPT.md` for the prompt to spawn Claude Code sub-agents that will handle individual component conversions.

Each sub-agent task in `04-SUBAGENT-TASKS/` includes:
- Specific files to modify
- Expected changes
- Testing criteria
- Commit message format

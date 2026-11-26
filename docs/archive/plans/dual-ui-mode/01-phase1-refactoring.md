# Phase 1: Codebase Refactoring for Dual-Mode Support

## 🎯 Goal

Prepare the existing codebase to support dual UI modes without breaking current functionality. After this phase, the app should look and behave exactly the same—but the architecture will be ready for mode switching.

---

## 📐 Token Architecture

### Design Token Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMITIVES (tokens/primitives.css)                         │
│  Raw values - never used directly in components             │
│                                                             │
│  --primitive-green-500: #00ff41;                           │
│  --primitive-zinc-950: #09090b;                            │
│  --primitive-spacing-4: 16px;                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SEMANTIC TOKENS (tokens/semantic.css)                      │
│  Meaningful names - used in components                      │
│                                                             │
│  --color-surface: var(--primitive-zinc-950);               │
│  --color-surface-elevated: var(--primitive-zinc-900);      │
│  --color-accent: var(--primitive-green-500);               │
│  --color-text-primary: var(--primitive-zinc-50);           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  THEME OVERRIDES (themes/retro.css, themes/modern.css)      │
│  Mode-specific semantic token values                        │
│                                                             │
│  [data-theme="retro"] {                                    │
│    --color-accent: var(--primitive-green-500);             │
│    --font-display: var(--font-vt323);                      │
│  }                                                          │
│                                                             │
│  [data-theme="modern"] {                                   │
│    --color-accent: var(--primitive-emerald-500);           │
│    --font-display: var(--font-inter);                      │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 File Creation Tasks

### Task 1.1: Create `tokens/primitives.css`

This file contains ALL raw values used anywhere in the design system.

```css
/* apps/desktop/src/styles/tokens/primitives.css */

@theme inline {
  /* ============================================
     PRIMITIVE TOKENS
     Raw values - NEVER use directly in components
     ============================================ */

  /* === COLORS === */
  
  /* Zinc Scale (neutrals) */
  --primitive-zinc-50: #fafafa;
  --primitive-zinc-100: #f4f4f5;
  --primitive-zinc-200: #e4e4e7;
  --primitive-zinc-300: #d4d4d8;
  --primitive-zinc-400: #a1a1aa;
  --primitive-zinc-500: #71717a;
  --primitive-zinc-600: #52525b;
  --primitive-zinc-700: #3f3f46;
  --primitive-zinc-800: #27272a;
  --primitive-zinc-900: #18181b;
  --primitive-zinc-950: #09090b;

  /* CRT Terminal Colors */
  --primitive-crt-bg: #0a0e0a;
  --primitive-crt-bg-light: #0f150f;
  --primitive-crt-green: #00ff41;
  --primitive-crt-green-dim: rgba(0, 255, 65, 0.6);
  --primitive-crt-green-glow: rgba(0, 255, 65, 0.5);
  --primitive-crt-amber: #ffb000;
  --primitive-crt-amber-dim: rgba(255, 176, 0, 0.6);
  --primitive-crt-purple: #8b00ff;
  --primitive-crt-cyan: rgba(0, 255, 255, 0.5);
  --primitive-crt-error: #ff4141;

  /* Modern Palette */
  --primitive-slate-50: #f8fafc;
  --primitive-slate-100: #f1f5f9;
  --primitive-slate-200: #e2e8f0;
  --primitive-slate-700: #334155;
  --primitive-slate-800: #1e293b;
  --primitive-slate-900: #0f172a;
  --primitive-slate-950: #020617;

  --primitive-emerald-400: #34d399;
  --primitive-emerald-500: #10b981;
  --primitive-emerald-600: #059669;
  
  --primitive-blue-500: #3b82f6;
  --primitive-blue-600: #2563eb;
  
  --primitive-violet-500: #8b5cf6;
  
  --primitive-rose-500: #f43f5e;

  /* === TYPOGRAPHY === */
  
  --primitive-font-vt323: "VT323", monospace;
  --primitive-font-ibm-plex: "IBM Plex Mono", monospace;
  --primitive-font-inter: "Inter", system-ui, sans-serif;
  --primitive-font-geist: "Geist Sans", system-ui, sans-serif;
  --primitive-font-geist-mono: "Geist Mono", monospace;

  /* Font Sizes */
  --primitive-text-xs: 0.75rem;
  --primitive-text-sm: 0.875rem;
  --primitive-text-base: 1rem;
  --primitive-text-lg: 1.125rem;
  --primitive-text-xl: 1.25rem;
  --primitive-text-2xl: 1.5rem;
  --primitive-text-3xl: 1.875rem;

  /* === SPACING === */
  
  --primitive-space-0: 0;
  --primitive-space-1: 0.25rem;
  --primitive-space-2: 0.5rem;
  --primitive-space-3: 0.75rem;
  --primitive-space-4: 1rem;
  --primitive-space-5: 1.25rem;
  --primitive-space-6: 1.5rem;
  --primitive-space-8: 2rem;
  --primitive-space-10: 2.5rem;
  --primitive-space-12: 3rem;
  --primitive-space-16: 4rem;

  /* === RADII === */
  
  --primitive-radius-none: 0;
  --primitive-radius-sm: 0.125rem;
  --primitive-radius-md: 0.375rem;
  --primitive-radius-lg: 0.5rem;
  --primitive-radius-xl: 0.75rem;
  --primitive-radius-2xl: 1rem;
  --primitive-radius-full: 9999px;

  /* === SHADOWS === */
  
  --primitive-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --primitive-shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --primitive-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  --primitive-shadow-glow-green: 0 0 8px rgba(0, 255, 65, 0.5);
  --primitive-shadow-glow-green-strong: 0 0 4px currentColor, 0 0 8px currentColor, 0 0 16px currentColor;

  /* === TRANSITIONS === */
  
  --primitive-duration-fast: 150ms;
  --primitive-duration-normal: 200ms;
  --primitive-duration-slow: 300ms;
  --primitive-ease-default: cubic-bezier(0.4, 0, 0.2, 1);
}
```

### Task 1.2: Create `tokens/semantic.css`

This file maps primitives to meaningful, context-aware names.

```css
/* apps/desktop/src/styles/tokens/semantic.css */

:root {
  /* ============================================
     SEMANTIC TOKENS
     Use these in components - they adapt to theme
     ============================================ */

  /* === SURFACES === */
  --color-surface: var(--primitive-crt-bg);
  --color-surface-elevated: var(--primitive-crt-bg-light);
  --color-surface-overlay: rgba(0, 0, 0, 0.8);
  --color-surface-card: rgba(24, 24, 27, 0.4);

  /* === TEXT === */
  --color-text-primary: var(--primitive-zinc-50);
  --color-text-secondary: var(--primitive-zinc-400);
  --color-text-muted: var(--primitive-zinc-500);
  --color-text-inverse: var(--primitive-zinc-950);

  /* === ACCENT === */
  --color-accent: var(--primitive-crt-green);
  --color-accent-dim: var(--primitive-crt-green-dim);
  --color-accent-subtle: rgba(0, 255, 65, 0.1);
  --color-accent-secondary: var(--primitive-crt-amber);

  /* === BORDERS === */
  --color-border: rgba(39, 39, 42, 0.8);
  --color-border-subtle: rgba(255, 255, 255, 0.08);
  --color-border-accent: rgba(0, 255, 65, 0.2);

  /* === STATUS === */
  --color-success: var(--primitive-crt-green);
  --color-warning: var(--primitive-crt-amber);
  --color-error: var(--primitive-crt-error);
  --color-info: var(--primitive-crt-cyan);

  /* === TYPOGRAPHY === */
  --font-display: var(--primitive-font-vt323);
  --font-body: var(--primitive-font-ibm-plex);
  --font-mono: var(--primitive-font-ibm-plex);

  /* === SPACING (semantic) === */
  --space-section: var(--primitive-space-8);
  --space-element: var(--primitive-space-4);
  --space-inline: var(--primitive-space-2);

  /* === RADII (semantic) === */
  --radius-card: var(--primitive-radius-lg);
  --radius-button: var(--primitive-radius-md);
  --radius-input: var(--primitive-radius-sm);
  --radius-badge: var(--primitive-radius-full);

  /* === EFFECTS === */
  --shadow-card: var(--primitive-shadow-md);
  --shadow-elevated: var(--primitive-shadow-lg);
  --shadow-glow: var(--primitive-shadow-glow-green);
  --text-glow: 0 0 8px currentColor;
  --text-glow-strong: 0 0 4px currentColor, 0 0 8px currentColor, 0 0 16px currentColor;

  /* === TRANSITIONS === */
  --transition-fast: var(--primitive-duration-fast) var(--primitive-ease-default);
  --transition-normal: var(--primitive-duration-normal) var(--primitive-ease-default);

  /* === COMPONENT-SPECIFIC === */
  
  /* Message bubbles */
  --message-user-bg: rgba(0, 255, 65, 0.1);
  --message-user-border: var(--color-border-accent);
  --message-persona-bg: rgba(255, 176, 0, 0.1);
  --message-persona-border: rgba(255, 176, 0, 0.2);
  
  /* Navigation */
  --nav-item-active-bg: rgba(0, 255, 65, 0.1);
  --nav-item-hover-bg: rgba(0, 255, 65, 0.05);
  
  /* Input fields */
  --input-bg: transparent;
  --input-border: var(--color-border);
  --input-focus-border: var(--color-accent);
  
  /* Cards */
  --card-bg: var(--color-surface-card);
  --card-border: var(--color-border);
}
```

### Task 1.3: Create `themes/retro.css`

This file contains retro-specific overrides (most values match defaults, but having the file structure is important).

```css
/* apps/desktop/src/styles/themes/retro.css */

[data-theme="retro"] {
  /* ============================================
     RETRO CRT TERMINAL THEME
     Glowing green, scanlines, pixel fonts
     ============================================ */

  /* Surfaces */
  --color-surface: var(--primitive-crt-bg);
  --color-surface-elevated: var(--primitive-crt-bg-light);
  --color-surface-card: rgba(24, 24, 27, 0.4);

  /* Accent - CRT Green */
  --color-accent: var(--primitive-crt-green);
  --color-accent-dim: var(--primitive-crt-green-dim);
  --color-accent-subtle: rgba(0, 255, 65, 0.1);
  --color-accent-secondary: var(--primitive-crt-amber);

  /* Typography */
  --font-display: var(--primitive-font-vt323);
  --font-body: var(--primitive-font-ibm-plex);

  /* Effects */
  --shadow-glow: var(--primitive-shadow-glow-green);
  --text-glow: 0 0 8px currentColor;

  /* Radii - sharper for terminal feel */
  --radius-card: var(--primitive-radius-sm);
  --radius-button: var(--primitive-radius-sm);
  --radius-input: var(--primitive-radius-none);

  /* Retro-specific tokens */
  --crt-scanline-opacity: 0.15;
  --crt-vignette-opacity: 0.4;
  --crt-glow-opacity: 0.03;
  --show-crt-effects: 1; /* Used in CSS to toggle CRT overlays */
}
```

### Task 1.4: Create `themes/modern.css`

This file defines the modern theme (placeholder values—will be refined in Phase 2).

```css
/* apps/desktop/src/styles/themes/modern.css */

[data-theme="modern"] {
  /* ============================================
     MODERN SLEEK THEME
     Clean, minimal, professional - inspired by Notion/Linear
     ============================================ */

  /* Surfaces - slightly warmer, less harsh */
  --color-surface: var(--primitive-slate-950);
  --color-surface-elevated: var(--primitive-slate-900);
  --color-surface-card: rgba(30, 41, 59, 0.5);

  /* Accent - softer emerald */
  --color-accent: var(--primitive-emerald-500);
  --color-accent-dim: var(--primitive-emerald-400);
  --color-accent-subtle: rgba(16, 185, 129, 0.1);
  --color-accent-secondary: var(--primitive-blue-500);

  /* Text - higher contrast, cleaner */
  --color-text-primary: var(--primitive-slate-50);
  --color-text-secondary: var(--primitive-slate-400);
  --color-text-muted: var(--primitive-slate-500);

  /* Borders - more subtle */
  --color-border: rgba(51, 65, 85, 0.5);
  --color-border-subtle: rgba(255, 255, 255, 0.05);
  --color-border-accent: rgba(16, 185, 129, 0.3);

  /* Typography - clean sans-serif */
  --font-display: var(--primitive-font-inter);
  --font-body: var(--primitive-font-inter);
  --font-mono: var(--primitive-font-geist-mono);

  /* Effects - no glow in modern mode */
  --shadow-glow: none;
  --text-glow: none;
  --text-glow-strong: none;
  --shadow-card: var(--primitive-shadow-md);

  /* Radii - softer, more rounded */
  --radius-card: var(--primitive-radius-xl);
  --radius-button: var(--primitive-radius-lg);
  --radius-input: var(--primitive-radius-md);

  /* Modern-specific tokens */
  --show-crt-effects: 0; /* Disable CRT overlays */
  --show-ghost-mascot: 0; /* Hide pixel ghost, show modern indicator */
}
```

---

## 🔄 CSS Migration Tasks

### Task 1.5: Update `globals.css`

Refactor the main CSS file to:
1. Import token files
2. Use semantic tokens instead of hardcoded values
3. Keep retro-specific utilities in a separate file

**Before (current):**
```css
@theme inline {
  --color-crt-bg: #0a0e0a;
  --color-crt-text: #00ff41;
  /* ... hardcoded values ... */
}

.text-glow {
  text-shadow: 0 0 8px currentColor;
}
```

**After:**
```css
/* Import token architecture */
@import "./tokens/primitives.css";
@import "./tokens/semantic.css";
@import "./themes/retro.css";
@import "./themes/modern.css";
@import "./utilities/shared.css";
@import "./utilities/retro.css";

/* Base styles using semantic tokens */
body {
  background-color: var(--color-surface);
  color: var(--color-text-primary);
  font-family: var(--font-body);
}
```

### Task 1.6: Create `utilities/shared.css`

Mode-agnostic utility classes.

```css
/* apps/desktop/src/styles/utilities/shared.css */

@layer utilities {
  /* Layout */
  .stack { display: flex; flex-direction: column; gap: var(--space-element); }
  .row { display: flex; gap: var(--space-element); }
  .center { display: flex; align-items: center; justify-content: center; }
  
  /* Typography */
  .font-display { font-family: var(--font-display); }
  .font-body { font-family: var(--font-body); }
  .font-mono { font-family: var(--font-mono); }
  
  /* Card patterns */
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-card);
  }
  
  /* Button base */
  .btn {
    padding: var(--primitive-space-2) var(--primitive-space-4);
    border-radius: var(--radius-button);
    font-family: var(--font-body);
    transition: var(--transition-fast);
  }
  
  /* Focus visible */
  .focus-ring:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
}
```

### Task 1.7: Create `utilities/retro.css`

Retro-only utility classes.

```css
/* apps/desktop/src/styles/utilities/retro.css */

@layer utilities {
  /* Only apply these when in retro mode */
  [data-theme="retro"] {
    .text-glow {
      text-shadow: var(--text-glow);
    }
    
    .text-glow-strong {
      text-shadow: var(--text-glow-strong);
    }
    
    .box-glow {
      box-shadow: var(--shadow-glow), inset 0 0 8px rgba(0, 255, 65, 0.1);
    }
    
    .cursor-blink {
      animation: cursor-blink 0.8s linear infinite;
    }
    
    .animate-flicker {
      animation: flicker 4s infinite;
    }
  }
  
  /* Hide these utilities in modern mode */
  [data-theme="modern"] {
    .text-glow,
    .text-glow-strong,
    .box-glow {
      text-shadow: none;
      box-shadow: none;
    }
  }
  
  @keyframes cursor-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  
  @keyframes flicker {
    0% { opacity: 1; }
    3% { opacity: 0.97; }
    6% { opacity: 1; }
    7% { opacity: 0.95; }
    8% { opacity: 1; }
    100% { opacity: 1; }
  }
}
```

---

## 📋 Component Audit Checklist

Review each component and categorize by theming needs:

### A. Token-Only Changes (CSS variables)
- [ ] `StatsCard` - background, border colors
- [ ] `MessageBubble` - user/persona backgrounds
- [ ] `ChatInput` - border, focus states
- [ ] `InsightsHeader` - text colors
- [ ] `Navigation` - active tab styling
- [ ] `Header` - background color
- [ ] `Accordion` - borders, backgrounds

### B. Conditional Rendering Needed
- [ ] `CRTEffect` - only show in retro mode
- [ ] `Ghost` - pixel ghost vs modern indicator
- [ ] `WanderingGhost` - retro only
- [ ] `TerminalInput` - prompt prefix in retro only

### C. Icon Swaps Needed
- [ ] `Navigation` - tab icons
- [ ] `QuickActions` - action icons
- [ ] `StatsRow` - stat icons
- [ ] `TopBar` - menu icons

### D. Animation Changes
- [ ] Scanline animation - retro only
- [ ] Float animation - retro only
- [ ] Pulse glow - retro only
- [ ] Modern: subtle fade/slide transitions

---

## ✅ Phase 1 Completion Criteria

- [ ] Token files created and structured correctly
- [ ] `globals.css` refactored to import tokens
- [ ] All hardcoded CRT color values replaced with tokens
- [ ] CRT-specific utilities moved to `utilities/retro.css`
- [ ] Component audit completed and documented
- [ ] App looks identical to before (no visual changes)
- [ ] Build succeeds without errors
- [ ] All existing functionality works

---

## 🔜 Next: Phase 2

Once Phase 1 is complete, proceed to:
- `02-MODERN-UI-AESTHETICS.md` - Design specification
- `03-TOGGLE-IMPLEMENTATION.md` - State management setup

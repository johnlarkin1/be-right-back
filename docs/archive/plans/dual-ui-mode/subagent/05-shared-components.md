# Sub-Agent Task: Shared UI Components

## 🎯 Scope

Convert shared/reusable UI components to support dual UI modes:
- `Ghost.tsx` / `WanderingGhost.tsx`
- `CRTEffect.tsx` + new `ModernEffect.tsx`
- `Accordion.tsx`
- `MarkdownRenderer.tsx`
- Any `ui/` components

---

## 📁 Files to Modify/Create

```
apps/desktop/src/components/
├── Ghost.tsx
├── WanderingGhost.tsx
├── CRTEffect.tsx
├── effects/
│   ├── CRTEffect.tsx (move here)
│   ├── ModernEffect.tsx (create)
│   └── VisualEffects.tsx (create - wrapper)
├── ui/
│   ├── Accordion.tsx
│   ├── Button.tsx (if exists)
│   ├── Card.tsx (if exists)
│   ├── Input.tsx (if exists)
│   └── MarkdownRenderer.tsx
└── theme/
    ├── ThemeProvider.tsx
    ├── ThemeToggle.tsx
    ├── ThemedIcon.tsx
    └── index.ts
```

---

## 🔧 Task Breakdown

### 1. Visual Effects Wrapper

Create a wrapper that renders the appropriate effect layer:

```tsx
// components/effects/VisualEffects.tsx

import { useUIMode } from "@/stores/themeStore";
import { CRTEffect } from "./CRTEffect";
import { ModernEffect } from "./ModernEffect";

export function VisualEffects() {
  const { isRetro } = useUIMode();
  
  return isRetro ? <CRTEffect /> : <ModernEffect />;
}
```

### 2. ModernEffect.tsx (Create New)

A subtle ambient effect for modern mode:

```tsx
// components/effects/ModernEffect.tsx

export function ModernEffect() {
  return (
    <>
      {/* Subtle top gradient */}
      <div 
        className="fixed inset-0 pointer-events-none z-[-1]"
        style={{
          background: `
            radial-gradient(
              ellipse 100% 40% at 50% -10%,
              rgba(16, 185, 129, 0.04),
              transparent 60%
            )
          `,
        }}
      />
      
      {/* Very subtle noise texture (optional) */}
      <div 
        className="fixed inset-0 pointer-events-none z-[-1] opacity-[0.015]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />
    </>
  );
}
```

### 3. CRTEffect.tsx (Update)

Ensure CRT effect respects the theme token for visibility:

```tsx
// components/effects/CRTEffect.tsx

export function CRTEffect() {
  return (
    <>
      {/* Scanlines */}
      <div className="crt-scanlines" />
      
      {/* Vignette */}
      <div className="crt-vignette" />
      
      {/* Phosphor glow */}
      <div className="crt-glow" />
    </>
  );
}
```

No changes needed if it already works—just ensure it's ONLY rendered in retro mode.

---

### 4. Ghost.tsx

The Ghost component should remain unchanged but only be used in retro mode contexts. Create a helper:

```tsx
// components/ModeAwareMascot.tsx

import { useUIMode } from "@/stores/themeStore";
import { Ghost, type GhostEmotion } from "./Ghost";
import { Bot, Sparkles, MessageCircle } from "lucide-react";

interface ModeAwareMascotProps {
  emotion?: GhostEmotion;
  size?: number;
  /** What to show in modern mode */
  modernVariant?: "bot" | "sparkles" | "message" | "none";
  className?: string;
}

export function ModeAwareMascot({ 
  emotion = "neutral",
  size = 32,
  modernVariant = "bot",
  className = ""
}: ModeAwareMascotProps) {
  const { isRetro } = useUIMode();
  
  if (isRetro) {
    return <Ghost emotion={emotion} size={size} className={className} />;
  }
  
  if (modernVariant === "none") {
    return null;
  }
  
  const IconMap = {
    bot: Bot,
    sparkles: Sparkles,
    message: MessageCircle,
  };
  
  const Icon = IconMap[modernVariant];
  const iconSize = Math.round(size * 0.6);
  
  return (
    <div 
      className={`
        rounded-xl bg-[var(--color-accent-subtle)]
        flex items-center justify-center
        ${className}
      `}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} className="text-[var(--color-accent)]" />
    </div>
  );
}
```

---

### 5. WanderingGhost.tsx

This should ONLY render in retro mode:

```tsx
// components/WanderingGhost.tsx

import { useUIMode } from "@/stores/themeStore";
// ... existing imports

export function WanderingGhost(props: WanderingGhostProps) {
  const { isRetro } = useUIMode();
  
  // Don't render in modern mode
  if (!isRetro) {
    return null;
  }
  
  // ... existing implementation
}
```

---

### 6. Accordion.tsx

Update to use semantic tokens:

```tsx
// components/ui/Accordion.tsx

import { useUIMode } from "@/stores/themeStore";

function Accordion({ items }) {
  const { isRetro } = useUIMode();
  
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <AccordionItem
          key={item.id}
          {...item}
          isRetro={isRetro}
        />
      ))}
    </div>
  );
}

function AccordionItem({ title, content, isExpanded, onToggle, isRetro }) {
  return (
    <div className={`
      border border-[var(--color-border)]
      rounded-[var(--radius-card)]
      overflow-hidden
    `}>
      <button
        onClick={onToggle}
        className={`
          w-full flex items-center justify-between p-3
          bg-[var(--color-surface-elevated)]
          hover:bg-[var(--color-surface-hover)]
          transition-colors
        `}
      >
        <span className={`
          font-medium text-[var(--color-text-primary)]
          ${isRetro ? "font-terminal" : ""}
        `}>
          {title}
        </span>
        <span className="text-[var(--color-text-muted)]">
          {isRetro 
            ? (isExpanded ? "[-]" : "[+]")
            : (isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />)
          }
        </span>
      </button>
      
      {isExpanded && (
        <div className="p-3 border-t border-[var(--color-border)]">
          {content}
        </div>
      )}
    </div>
  );
}
```

---

### 7. MarkdownRenderer.tsx

Ensure code blocks and styling adapt:

```tsx
// Inline code styling per mode
const inlineCodeClass = isRetro
  ? "px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-mono text-sm"
  : "px-1.5 py-0.5 bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] rounded font-mono text-sm";

// Code block styling per mode
const codeBlockClass = isRetro
  ? "p-3 bg-black border border-[var(--color-accent-dim)] font-mono text-sm overflow-x-auto"
  : "p-4 bg-[var(--color-surface)] rounded-lg font-mono text-sm overflow-x-auto";
```

---

### 8. Generic UI Components

If you have generic Button, Card, Input components, ensure they use tokens:

```tsx
// components/ui/Button.tsx

const variants = {
  primary: `
    bg-[var(--color-accent)]
    text-white
    hover:brightness-110
  `,
  secondary: `
    bg-transparent
    border border-[var(--color-border)]
    text-[var(--color-text-secondary)]
    hover:bg-[var(--color-surface-hover)]
    hover:text-[var(--color-text-primary)]
  `,
  ghost: `
    bg-transparent
    text-[var(--color-text-secondary)]
    hover:bg-[var(--color-surface-hover)]
  `,
};

// Card.tsx
function Card({ children, className }) {
  return (
    <div className={`
      bg-[var(--card-bg)]
      border border-[var(--card-border)]
      rounded-[var(--radius-card)]
      shadow-[var(--shadow-card)]
      ${className}
    `}>
      {children}
    </div>
  );
}
```

---

## ✅ Acceptance Criteria

- [ ] VisualEffects wrapper switches between CRT/Modern
- [ ] ModernEffect provides subtle ambient styling
- [ ] WanderingGhost only renders in retro mode
- [ ] ModeAwareMascot helper created and works
- [ ] Accordion uses correct icons per mode
- [ ] MarkdownRenderer code blocks adapt
- [ ] All UI components use CSS tokens
- [ ] No hardcoded colors remain

---

## 🔖 Commit Message

```
feat(theme): convert shared UI components to dual-mode

- Create VisualEffects wrapper for CRT/Modern
- Add ModernEffect with subtle ambient gradient
- Create ModeAwareMascot helper
- Update Accordion with themed icons
- Ensure all UI components use CSS tokens

Closes #XXX
```

---

## 🧪 Testing

1. Verify CRT effects only show in retro mode
2. Check modern ambient effect is subtle but visible
3. Test ModeAwareMascot in various contexts
4. Verify accordion expand/collapse icons switch
5. Check markdown rendering in both modes
6. Ensure no visual glitches during mode toggle

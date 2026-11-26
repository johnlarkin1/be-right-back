# Sub-Agent Task: Shell Components

## 🎯 Scope

Convert the application shell components to support dual UI modes:
- `AppShell.tsx`
- `Header.tsx` / `TopBar.tsx`
- `Navigation.tsx`

---

## 📁 Files to Modify

```
apps/desktop/src/components/
├── AppShell.tsx
├── Header.tsx (or TopBar.tsx)
├── Navigation.tsx
└── theme/
    └── ThemeToggle.tsx (add to Header)
```

---

## 🔧 Task Breakdown

### 1. AppShell.tsx

**Current State:**
- Contains CRT effect wrapper
- Dark terminal background
- Fixed layout structure

**Changes Needed:**

```tsx
// Import mode hook
import { useUIMode } from "@/stores/themeStore";
import { CRTEffect } from "@/components/CRTEffect";
import { ModernEffect } from "@/components/ModernEffect";

function AppShell({ children }) {
  const { isRetro } = useUIMode();
  
  return (
    <div className="h-screen flex flex-col bg-[var(--color-surface)]">
      {/* Conditional effects */}
      {isRetro ? <CRTEffect /> : <ModernEffect />}
      
      {/* Rest of layout */}
      <Header />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
```

**CSS Token Updates:**
- Replace `bg-crt-bg` → `bg-[var(--color-surface)]`
- Replace hardcoded colors with tokens

---

### 2. Header.tsx

**Current State:**
- Terminal-style title with `> ` prefix
- Ghost mascot icon
- Possibly CRT glow effects

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Ghost } from "@/components/Ghost";

function Header() {
  const { isRetro } = useUIMode();
  
  return (
    <header className="flex items-center justify-between px-4 py-2 
                       border-b border-[var(--color-border)]
                       bg-[var(--color-surface)]">
      {/* Title */}
      <h1 className="font-[var(--font-display)] text-[var(--color-text-primary)]">
        {isRetro ? "> Be Right Back" : "Be Right Back"}
      </h1>
      
      {/* Right side controls */}
      <div className="flex items-center gap-3">
        <ThemeToggle compact showLabel={false} />
        {isRetro && <Ghost emotion="neutral" size={24} />}
      </div>
    </header>
  );
}
```

**Style Changes:**
| Element | Retro | Modern |
|---------|-------|--------|
| Title prefix | `"> "` | None |
| Font | VT323 | Inter |
| Text glow | Yes | No |
| Ghost | Visible | Hidden |
| Border | Green tint | Neutral |

---

### 3. Navigation.tsx

**Current State:**
- Tab-style navigation
- ASCII-style icons or text
- Terminal brackets `[./tab]`
- Green glow on active

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";
import { ThemedIcon } from "@/components/theme/ThemedIcon";
import { MessageSquare, Search, BarChart3, Settings } from "lucide-react";

const tabs = [
  { id: "chat", label: "Chat", retroLabel: "./chat", 
    icon: <ThemedIcon modernIcon={MessageSquare} retroElement="[>_]" /> },
  { id: "search", label: "Search", retroLabel: "./search",
    icon: <ThemedIcon modernIcon={Search} retroElement="[@]" /> },
  { id: "insights", label: "Insights", retroLabel: "./insights",
    icon: <ThemedIcon modernIcon={BarChart3} retroElement="[#]" /> },
];

function Navigation({ activeTab, onTabChange }) {
  const { isRetro } = useUIMode();
  
  return (
    <nav className="flex gap-1 px-4 py-2 border-b border-[var(--color-border)]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex items-center gap-2 px-3 py-1.5
            rounded-[var(--radius-button)]
            font-[var(--font-body)] text-sm
            transition-colors duration-150
            ${activeTab === tab.id
              ? "bg-[var(--nav-item-active-bg)] text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--nav-item-hover-bg)]"
            }
          `}
        >
          {tab.icon}
          <span>{isRetro ? tab.retroLabel : tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

**Style Changes:**
| Element | Retro | Modern |
|---------|-------|--------|
| Tab format | `[./chat]` | Icon + "Chat" |
| Active style | Green glow | Accent bg tint |
| Font | Terminal | Sans-serif |
| Radius | Sharp | Rounded |

---

## ✅ Acceptance Criteria

- [ ] AppShell uses correct effect layer per mode
- [ ] Header shows/hides prompt prefix correctly
- [ ] Header includes theme toggle button
- [ ] Ghost only shows in retro mode
- [ ] Navigation uses correct icons per mode
- [ ] Navigation labels switch format
- [ ] All colors use CSS tokens
- [ ] No hardcoded CRT values remain
- [ ] Smooth visual transition when toggling

---

## 🔖 Commit Message

```
feat(theme): convert shell components to dual-mode

- AppShell: conditional CRT/Modern effects
- Header: add theme toggle, mode-aware title
- Navigation: themed icons, mode-specific labels

Closes #XXX
```

---

## 🧪 Testing

1. Toggle mode via button - verify immediate visual change
2. Refresh page - verify mode persists
3. Check all navigation states (hover, active)
4. Verify no layout shifts during toggle
5. Confirm CRT effects only show in retro mode

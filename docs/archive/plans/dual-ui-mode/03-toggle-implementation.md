# Toggle Implementation Guide

## 🎯 Overview

This document details how to implement the master UI mode toggle, including:
- Zustand store for state management
- ThemeProvider component for applying theme
- ThemeToggle component for user interaction
- Integration points (TopBar, Settings)

---

## 📦 State Management

### File: `stores/themeStore.ts`

```typescript
// apps/desktop/src/stores/themeStore.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UIMode = "retro" | "modern";

interface ThemeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "retro", // Default to existing experience
      
      setMode: (mode) => {
        set({ mode });
        // Apply to document immediately
        document.documentElement.setAttribute("data-theme", mode);
      },
      
      toggleMode: () => {
        set((state) => {
          const newMode = state.mode === "retro" ? "modern" : "retro";
          document.documentElement.setAttribute("data-theme", newMode);
          return { mode: newMode };
        });
      },
    }),
    {
      name: "brb-ui-mode", // localStorage key
      onRehydrate: () => {
        // Called when store is rehydrated from storage
        return (state) => {
          if (state?.mode) {
            document.documentElement.setAttribute("data-theme", state.mode);
          }
        };
      },
    }
  )
);

// Hook for conditional rendering based on mode
export const useUIMode = () => {
  const mode = useThemeStore((state) => state.mode);
  return {
    mode,
    isRetro: mode === "retro",
    isModern: mode === "modern",
  };
};

// Hook for components that need mode-specific logic
export const useThemeAwareValue = <T>(retro: T, modern: T): T => {
  const { isRetro } = useUIMode();
  return isRetro ? retro : modern;
};
```

---

## 🎨 Theme Provider

### File: `components/theme/ThemeProvider.tsx`

```typescript
// apps/desktop/src/components/theme/ThemeProvider.tsx

import { useEffect, type ReactNode } from "react";
import { useThemeStore } from "@/stores/themeStore";

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const mode = useThemeStore((state) => state.mode);

  // Apply theme on mount and mode change
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    
    // Optional: Also update color-scheme for native elements
    document.documentElement.style.colorScheme = "dark";
  }, [mode]);

  return <>{children}</>;
}
```

### Update `App.tsx`

```typescript
// apps/desktop/src/App.tsx

import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "@/components/AppShell";
// ... other imports

function App() {
  return (
    <ThemeProvider>
      <AppShell>
        {/* ... existing app content */}
      </AppShell>
    </ThemeProvider>
  );
}

export default App;
```

---

## 🔘 Theme Toggle Component

### File: `components/theme/ThemeToggle.tsx`

```typescript
// apps/desktop/src/components/theme/ThemeToggle.tsx

import { motion } from "framer-motion";
import { Monitor, Terminal } from "lucide-react";
import { useThemeStore, useUIMode } from "@/stores/themeStore";

interface ThemeToggleProps {
  /** Compact mode for TopBar */
  compact?: boolean;
  /** Show labels */
  showLabel?: boolean;
}

export function ThemeToggle({ compact = false, showLabel = true }: ThemeToggleProps) {
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const { mode, isRetro } = useUIMode();

  if (compact) {
    return (
      <button
        onClick={toggleMode}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md
                   text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
                   hover:bg-[var(--color-surface-hover)] transition-colors"
        title={`Switch to ${isRetro ? "Modern" : "Retro"} mode`}
      >
        <motion.div
          key={mode}
          initial={{ rotate: -180, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 180, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {isRetro ? <Terminal size={16} /> : <Monitor size={16} />}
        </motion.div>
        {showLabel && (
          <span className="text-xs font-medium uppercase tracking-wide">
            {mode}
          </span>
        )}
      </button>
    );
  }

  // Full toggle for Settings page
  return (
    <div className="flex items-center gap-4">
      <span className="text-[var(--color-text-secondary)] text-sm">
        UI Mode
      </span>
      
      <div className="flex p-1 rounded-lg bg-[var(--color-surface)]">
        <ToggleOption
          active={isRetro}
          onClick={() => useThemeStore.getState().setMode("retro")}
          icon={<Terminal size={16} />}
          label="Retro"
        />
        <ToggleOption
          active={!isRetro}
          onClick={() => useThemeStore.getState().setMode("modern")}
          icon={<Monitor size={16} />}
          label="Modern"
        />
      </div>
    </div>
  );
}

interface ToggleOptionProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function ToggleOption({ active, onClick, icon, label }: ToggleOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
        transition-all duration-200
        ${active 
          ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]" 
          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }
      `}
    >
      {icon}
      {label}
    </button>
  );
}
```

---

## 🔌 Integration Points

### 1. TopBar Integration

```typescript
// In TopBar.tsx or Header.tsx

import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function TopBar() {
  return (
    <header className="...">
      <div className="flex items-center gap-2">
        {/* ... other controls */}
        <ThemeToggle compact showLabel={false} />
      </div>
    </header>
  );
}
```

### 2. Settings Page Integration

```typescript
// In Settings.tsx or SettingsLayout.tsx

import { ThemeToggle } from "@/components/theme/ThemeToggle";

export function SettingsPage() {
  return (
    <div className="...">
      <section>
        <h2>Appearance</h2>
        <div className="space-y-4">
          <ThemeToggle showLabel />
        </div>
      </section>
    </div>
  );
}
```

### 3. Keyboard Shortcut (Optional)

```typescript
// In a useEffect in App.tsx or a dedicated useKeyboardShortcuts hook

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+Shift+T to toggle theme
    if (e.metaKey && e.shiftKey && e.key === "t") {
      e.preventDefault();
      useThemeStore.getState().toggleMode();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, []);
```

---

## 🎭 Mode-Aware Components

### Pattern 1: CSS-Only (Most Components)

Most components need no code changes—they just use CSS custom properties that change per theme.

```tsx
// This component automatically adapts via CSS tokens
function StatCard({ title, value }: Props) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-[var(--radius-card)]">
      <h3 className="text-[var(--color-text-secondary)]">{title}</h3>
      <p className="text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}
```

### Pattern 2: Conditional Rendering

For components with structural differences:

```tsx
import { useUIMode } from "@/stores/themeStore";
import { Ghost } from "@/components/Ghost";
import { User } from "lucide-react";

function UserIndicator() {
  const { isRetro } = useUIMode();

  if (isRetro) {
    return <Ghost emotion="happy" size={24} />;
  }

  return (
    <div className="w-6 h-6 rounded-full bg-[var(--color-accent-subtle)] flex items-center justify-center">
      <User size={14} className="text-[var(--color-accent)]" />
    </div>
  );
}
```

### Pattern 3: Mode-Aware Hook

For complex conditional logic:

```tsx
import { useThemeAwareValue } from "@/stores/themeStore";

function ChatInput() {
  const placeholder = useThemeAwareValue(
    "> Type your message...",  // Retro
    "Type a message..."         // Modern
  );

  const InputIcon = useThemeAwareValue(
    () => <span className="text-[var(--color-accent)]">{">"}</span>,
    () => null
  );

  return (
    <div className="flex items-center gap-2">
      {InputIcon && <InputIcon />}
      <input placeholder={placeholder} className="..." />
    </div>
  );
}
```

### Pattern 4: Mode-Specific Components

For components that are entirely different:

```tsx
// components/effects/VisualEffects.tsx
import { useUIMode } from "@/stores/themeStore";
import { CRTEffect } from "./CRTEffect";
import { ModernEffect } from "./ModernEffect";

export function VisualEffects() {
  const { isRetro } = useUIMode();

  if (isRetro) {
    return <CRTEffect />;
  }

  return <ModernEffect />;
}

// ModernEffect.tsx - Subtle ambient gradient
export function ModernEffect() {
  return (
    <div 
      className="fixed inset-0 pointer-events-none z-[-1]"
      style={{
        background: `
          radial-gradient(
            ellipse 80% 50% at 50% -20%,
            rgba(16, 185, 129, 0.05),
            transparent
          )
        `,
      }}
    />
  );
}
```

---

## 🖼️ Icon System

### File: `components/theme/ThemedIcon.tsx`

```typescript
// apps/desktop/src/components/theme/ThemedIcon.tsx

import { useUIMode } from "@/stores/themeStore";
import type { LucideIcon } from "lucide-react";

interface ThemedIconProps {
  /** Icon to show in modern mode */
  modernIcon: LucideIcon;
  /** Text/element to show in retro mode */
  retroElement: React.ReactNode;
  /** Size for Lucide icon */
  size?: number;
  /** Additional className */
  className?: string;
}

export function ThemedIcon({
  modernIcon: ModernIcon,
  retroElement,
  size = 18,
  className = "",
}: ThemedIconProps) {
  const { isRetro } = useUIMode();

  if (isRetro) {
    return <span className={className}>{retroElement}</span>;
  }

  return <ModernIcon size={size} className={className} />;
}

// Usage example:
// <ThemedIcon modernIcon={MessageSquare} retroElement="[>_]" />
```

### Navigation Icons

```typescript
// components/Navigation.tsx

import { MessageSquare, Search, BarChart3, Settings } from "lucide-react";
import { ThemedIcon } from "@/components/theme/ThemedIcon";

const navItems = [
  { 
    id: "chat", 
    icon: <ThemedIcon modernIcon={MessageSquare} retroElement="[>_]" />,
    label: "Chat" 
  },
  { 
    id: "search", 
    icon: <ThemedIcon modernIcon={Search} retroElement="[@]" />,
    label: "Search" 
  },
  { 
    id: "insights", 
    icon: <ThemedIcon modernIcon={BarChart3} retroElement="[#]" />,
    label: "Insights" 
  },
  { 
    id: "settings", 
    icon: <ThemedIcon modernIcon={Settings} retroElement="[*]" />,
    label: "Settings" 
  },
];
```

---

## 🧪 Testing the Toggle

### Manual Testing Checklist

1. **Initial Load**
   - [ ] Default mode is "retro"
   - [ ] Mode persists after refresh
   - [ ] No flash of wrong theme on load

2. **Toggle Interaction**
   - [ ] Toggle button is accessible
   - [ ] Mode changes immediately
   - [ ] Animation is smooth
   - [ ] All components update together

3. **Component Updates**
   - [ ] Colors change correctly
   - [ ] Fonts change correctly
   - [ ] Icons swap appropriately
   - [ ] Effects enable/disable
   - [ ] No layout shifts

4. **Persistence**
   - [ ] Mode saved to localStorage
   - [ ] Mode restored on app restart
   - [ ] Works after clearing other storage

### Automated Test Example

```typescript
// __tests__/themeStore.test.ts

import { renderHook, act } from "@testing-library/react";
import { useThemeStore } from "@/stores/themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ mode: "retro" });
  });

  it("defaults to retro mode", () => {
    const { result } = renderHook(() => useThemeStore());
    expect(result.current.mode).toBe("retro");
  });

  it("toggles between modes", () => {
    const { result } = renderHook(() => useThemeStore());
    
    act(() => result.current.toggleMode());
    expect(result.current.mode).toBe("modern");
    
    act(() => result.current.toggleMode());
    expect(result.current.mode).toBe("retro");
  });

  it("persists mode to localStorage", () => {
    const { result } = renderHook(() => useThemeStore());
    
    act(() => result.current.setMode("modern"));
    
    const stored = JSON.parse(localStorage.getItem("brb-ui-mode") || "{}");
    expect(stored.state.mode).toBe("modern");
  });
});
```

---

## 📋 Implementation Checklist

- [ ] Create `stores/themeStore.ts`
- [ ] Create `components/theme/ThemeProvider.tsx`
- [ ] Create `components/theme/ThemeToggle.tsx`
- [ ] Create `components/theme/ThemedIcon.tsx`
- [ ] Wrap App in ThemeProvider
- [ ] Add ThemeToggle to TopBar
- [ ] Add ThemeToggle to Settings (if exists)
- [ ] Add keyboard shortcut (optional)
- [ ] Test persistence
- [ ] Test visual switching
- [ ] Update index exports

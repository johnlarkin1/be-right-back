# Sub-Agent Task: Insights Components

## 🎯 Scope

Convert analytics/insights dashboard components to support dual UI modes:
- `InsightsLayout.tsx`
- `InsightsHeader.tsx`
- `StatsRow.tsx`
- `MessageTimeline.tsx`
- `WordCloud.tsx`
- `ActivityHeatmap.tsx`
- `SemanticSpace.tsx`

---

## 📁 Files to Modify

```
apps/desktop/src/components/insights/
├── InsightsLayout.tsx
├── InsightsHeader.tsx
├── StatsRow.tsx
├── MessageTimeline.tsx
├── WordCloud.tsx
├── ActivityHeatmap.tsx
├── SemanticSpace.tsx
└── useInsightsData.ts (if mode-specific data formatting needed)
```

---

## 🔧 Task Breakdown

### 1. InsightsHeader.tsx

**Current State:**
- Pulsing green status dot `[●]`
- Gradient title text
- Terminal-style uppercase labels

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";
import { Activity } from "lucide-react";

function InsightsHeader() {
  const { isRetro } = useUIMode();
  
  return (
    <header className="mb-6">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-2">
        {isRetro ? (
          <span className="text-[var(--color-accent)] animate-pulse-glow">[●]</span>
        ) : (
          <Activity size={16} className="text-[var(--color-accent)]" />
        )}
        <span className={`
          text-xs tracking-wider
          ${isRetro ? "uppercase text-[var(--color-accent)] font-terminal" : "text-[var(--color-text-muted)]"}
        `}>
          {isRetro ? "INSIGHTS" : "Analytics"}
        </span>
      </div>
      
      {/* Title */}
      <h1 className={`
        text-2xl font-semibold
        ${isRetro 
          ? "font-terminal text-glow bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent"
          : "font-[var(--font-display)] text-[var(--color-text-primary)]"
        }
      `}>
        {isRetro ? "Conversation Analytics" : "Your Conversation Insights"}
      </h1>
      
      {/* Subtitle */}
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {isRetro 
          ? "Exploring patterns across your message history"
          : "Discover patterns in your conversations"
        }
      </p>
    </header>
  );
}
```

---

### 2. StatsRow.tsx

**Current State:**
- Stat cards with glow effects
- Terminal-style labels
- ASCII decorations

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";
import { MessageCircle, Clock, Calendar, Hash } from "lucide-react";

const statIcons = {
  messages: { retro: "[#]", modern: MessageCircle },
  responseTime: { retro: "[⏱]", modern: Clock },
  activeDays: { retro: "[📅]", modern: Calendar },
  topics: { retro: "[*]", modern: Hash },
};

function StatCard({ label, value, icon, trend }) {
  const { isRetro } = useUIMode();
  const Icon = statIcons[icon].modern;
  
  return (
    <div className={`
      p-4 rounded-[var(--radius-card)]
      bg-[var(--card-bg)] border border-[var(--card-border)]
      ${isRetro ? "box-glow" : "shadow-[var(--shadow-card)]"}
    `}>
      {/* Icon */}
      <div className="flex items-center gap-2 mb-2">
        {isRetro ? (
          <span className="text-[var(--color-accent)] font-terminal">
            {statIcons[icon].retro}
          </span>
        ) : (
          <Icon size={18} className="text-[var(--color-accent)]" />
        )}
        <span className={`
          text-xs
          ${isRetro 
            ? "uppercase tracking-wider text-[var(--color-accent-dim)]"
            : "text-[var(--color-text-muted)]"
          }
        `}>
          {label}
        </span>
      </div>
      
      {/* Value */}
      <div className={`
        text-2xl font-semibold text-[var(--color-text-primary)]
        ${isRetro ? "font-terminal text-glow" : ""}
      `}>
        {value}
      </div>
      
      {/* Trend indicator */}
      {trend && (
        <span className="text-xs text-[var(--color-success)]">
          {trend}
        </span>
      )}
    </div>
  );
}
```

---

### 3. MessageTimeline.tsx (Recharts)

**Current State:**
- Recharts BarChart with CRT gradient colors
- Brush component with glow
- Green/amber color scheme

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";

function MessageTimeline({ data, onBrushChange }) {
  const { isRetro } = useUIMode();
  
  // Chart colors per mode
  const chartColors = {
    retro: {
      bar: "#00ff41",
      barDim: "rgba(0, 255, 65, 0.3)",
      grid: "rgba(0, 255, 65, 0.1)",
      axis: "rgba(0, 255, 65, 0.5)",
      brush: "rgba(0, 255, 65, 0.2)",
    },
    modern: {
      bar: "#10b981",
      barDim: "rgba(16, 185, 129, 0.3)",
      grid: "rgba(148, 163, 184, 0.1)",
      axis: "#64748b",
      brush: "rgba(16, 185, 129, 0.15)",
    },
  };
  
  const colors = isRetro ? chartColors.retro : chartColors.modern;
  
  return (
    <div className={`
      p-4 rounded-[var(--radius-card)]
      bg-[var(--card-bg)] border border-[var(--card-border)]
    `}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis 
            dataKey="date" 
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={{ stroke: colors.grid }}
          />
          <YAxis 
            tick={{ fill: colors.axis, fontSize: 11 }}
            axisLine={{ stroke: colors.grid }}
          />
          <Bar 
            dataKey="count" 
            fill={colors.bar}
            radius={isRetro ? [0, 0, 0, 0] : [4, 4, 0, 0]}
          />
          <Brush 
            dataKey="date"
            height={30}
            stroke={colors.bar}
            fill={colors.brush}
            onChange={onBrushChange}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

### 4. WordCloud.tsx

**Current State:**
- Spiral layout
- Green glow on words
- Monospace font

**Changes Needed:**
- Remove glow in modern mode
- Use sans-serif font in modern mode
- Softer color transitions

---

### 5. ActivityHeatmap.tsx

**Current State:**
- 7x24 grid
- Green intensity scale
- Terminal-style labels

**Changes Needed:**
- Use emerald scale in modern mode
- Clean axis labels (no brackets)
- Softer cell styling

---

### 6. SemanticSpace.tsx (Plotly 3D)

**Current State:**
- Plotly 3D scatter
- Neon cluster colors
- Dark background with green grid

**Changes Needed:**

```tsx
const plotlyColors = {
  retro: {
    paper: "rgba(0,0,0,0)",
    gridColor: "rgba(0,255,65,0.06)",
    clusters: ["#00ff41", "#00d4ff", "#ff6b9d", "#ffb000", "#a855f7"],
  },
  modern: {
    paper: "rgba(0,0,0,0)",
    gridColor: "rgba(148,163,184,0.08)",
    clusters: ["#10b981", "#3b82f6", "#f472b6", "#f59e0b", "#8b5cf6"],
  },
};
```

---

## ✅ Acceptance Criteria

- [ ] Header status indicator changes (pulse vs icon)
- [ ] Stat cards lose glow in modern mode
- [ ] Chart colors use correct palette per mode
- [ ] Fonts switch appropriately
- [ ] No gradient text in modern mode
- [ ] Recharts styling is mode-aware
- [ ] Plotly colors update correctly
- [ ] All axis labels are mode-appropriate

---

## 🔖 Commit Message

```
feat(theme): convert insights components to dual-mode

- InsightsHeader: mode-aware status, title styling
- StatsRow: icon/glow handling per mode
- Charts: color palette switching
- Remove CRT-specific effects in modern mode

Closes #XXX
```

---

## 🧪 Testing

1. Toggle mode on insights page - verify all components update
2. Check chart readability in both modes
3. Verify stat cards have correct effects
4. Test brush interaction in both modes
5. Confirm 3D plot colors update

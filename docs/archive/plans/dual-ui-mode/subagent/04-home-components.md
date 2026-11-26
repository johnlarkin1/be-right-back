# Sub-Agent Task: Home Components

## 🎯 Scope

Convert home/dashboard components to support dual UI modes:
- `HomeLayout.tsx`
- `WelcomeView.tsx`
- `DashboardView.tsx`
- `CommandCenter.tsx`
- `SetupWizard.tsx`
- `NeedsSetup.tsx`
- `IngestionCTA.tsx`
- `StatsOverview.tsx`

---

## 📁 Files to Modify

```
apps/desktop/src/components/home/
├── HomeLayout.tsx
├── WelcomeView.tsx
├── DashboardView.tsx
├── CommandCenter.tsx
├── SetupWizard.tsx
├── NeedsSetup.tsx
├── IngestionCTA.tsx
├── IngestionProgress.tsx
├── StatsOverview.tsx
├── QuickActions.tsx
├── PrivacyBadge.tsx
└── index.ts
```

---

## 🔧 Task Breakdown

### 1. WelcomeView.tsx / NeedsSetup.tsx

**Current State:**
- Ghost mascot prominently displayed
- Terminal-style welcome messages
- Green glow on CTA buttons
- ASCII art or terminal decorations

**Changes Needed:**

```tsx
import { useUIMode } from "@/stores/themeStore";
import { Ghost } from "@/components/Ghost";
import { Sparkles, ArrowRight } from "lucide-react";

function WelcomeView() {
  const { isRetro } = useUIMode();
  
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      {/* Mascot / Icon */}
      {isRetro ? (
        <Ghost emotion="wave" size={96} className="mb-6" />
      ) : (
        <div className="mb-6 w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)]
                        flex items-center justify-center">
          <Sparkles size={32} className="text-[var(--color-accent)]" />
        </div>
      )}
      
      {/* Welcome text */}
      <h1 className={`
        text-3xl font-semibold mb-3
        ${isRetro 
          ? "font-terminal text-glow text-[var(--color-accent)]"
          : "text-[var(--color-text-primary)]"
        }
      `}>
        {isRetro ? "> Welcome to Be Right Back" : "Welcome to Be Right Back"}
      </h1>
      
      <p className="text-[var(--color-text-secondary)] max-w-md mb-8">
        {isRetro 
          ? "Your local-first AI companion. Let's get started."
          : "Create AI personas from your conversations. Private, local, and personal."
        }
      </p>
      
      {/* CTA Button */}
      <button className={`
        flex items-center gap-2 px-6 py-3
        rounded-[var(--radius-button)]
        font-medium transition-all
        ${isRetro 
          ? "bg-transparent border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] text-glow"
          : "bg-[var(--color-accent)] text-white hover:brightness-110 shadow-lg shadow-[var(--color-accent)]/20"
        }
      `}>
        {isRetro ? "[" : null}
        <span>Get Started</span>
        {isRetro ? "]" : <ArrowRight size={18} />}
      </button>
    </div>
  );
}
```

---

### 2. CommandCenter.tsx / DashboardView.tsx

**Current State:**
- Pipeline status visualization
- Terminal command-style cards
- ASCII progress indicators
- Green/amber status colors

**Changes Needed:**

```tsx
function PipelineCard({ title, status, progress }) {
  const { isRetro } = useUIMode();
  
  return (
    <div className={`
      p-4 rounded-[var(--radius-card)]
      bg-[var(--card-bg)] border border-[var(--card-border)]
      ${isRetro ? "box-glow" : "shadow-sm"}
    `}>
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-2">
        {isRetro ? (
          <span className={`font-terminal ${status === 'complete' ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>
            {status === 'complete' ? '[✓]' : '[○]'}
          </span>
        ) : (
          <div className={`
            w-2 h-2 rounded-full
            ${status === 'complete' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'}
          `} />
        )}
        
        <span className={`
          ${isRetro ? "font-terminal uppercase tracking-wide" : "font-medium"}
          text-[var(--color-text-primary)]
        `}>
          {isRetro ? `$ brb ${title}` : title}
        </span>
      </div>
      
      {/* Progress bar */}
      {progress !== undefined && (
        <div className={`
          h-1 rounded-full overflow-hidden
          bg-[var(--color-surface)]
        `}>
          <div 
            className="h-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

---

### 3. SetupWizard.tsx

**Current State:**
- Step-by-step wizard
- Terminal-style step numbers
- Progress dots or ASCII

**Changes Needed:**

```tsx
function StepIndicator({ step, total, currentStep }) {
  const { isRetro } = useUIMode();
  const isActive = step === currentStep;
  const isComplete = step < currentStep;
  
  if (isRetro) {
    return (
      <span className={`
        font-terminal
        ${isComplete ? "text-[var(--color-success)]" : ""}
        ${isActive ? "text-[var(--color-accent)] text-glow" : ""}
        ${!isComplete && !isActive ? "text-[var(--color-text-muted)]" : ""}
      `}>
        {isComplete ? "[✓]" : `[${step}]`}
      </span>
    );
  }
  
  return (
    <div className={`
      w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
      ${isComplete ? "bg-[var(--color-success)] text-white" : ""}
      ${isActive ? "bg-[var(--color-accent)] text-white" : ""}
      ${!isComplete && !isActive ? "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]" : ""}
    `}>
      {isComplete ? <Check size={16} /> : step}
    </div>
  );
}
```

---

### 4. IngestionProgress.tsx

**Current State:**
- ASCII progress bar
- Terminal output style
- Scrolling log text

**Changes Needed:**
- Keep terminal log in retro mode
- Use clean progress UI in modern mode
- Mode-aware status messages

---

### 5. StatsOverview.tsx / QuickActions.tsx

**Changes:**
- Follow same patterns as StatsRow
- Icon treatment per mode
- Button styling per mode

---

### 6. PrivacyBadge.tsx

**Current State:**
- Terminal-style badge
- Lock icon or ASCII

**Changes Needed:**

```tsx
function PrivacyBadge() {
  const { isRetro } = useUIMode();
  
  return (
    <div className={`
      inline-flex items-center gap-1.5 px-2 py-1
      rounded-[var(--radius-badge)]
      ${isRetro 
        ? "border border-[var(--color-accent-dim)] text-[var(--color-accent)]"
        : "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
      }
    `}>
      {isRetro ? (
        <span className="font-terminal text-xs">[🔒]</span>
      ) : (
        <Shield size={12} />
      )}
      <span className="text-xs font-medium">
        {isRetro ? "LOCAL_ONLY" : "Private & Local"}
      </span>
    </div>
  );
}
```

---

## ✅ Acceptance Criteria

- [ ] Welcome view shows correct mascot/icon per mode
- [ ] CTA buttons use correct styling per mode
- [ ] Pipeline cards adapt appearance
- [ ] Setup wizard steps use correct indicators
- [ ] Progress bars are mode-appropriate
- [ ] Privacy badge shows correct format
- [ ] All command-style text (`$ brb`) only in retro mode
- [ ] No glow effects in modern mode

---

## 🔖 Commit Message

```
feat(theme): convert home components to dual-mode

- WelcomeView: ghost vs modern icon, button styling
- CommandCenter: pipeline cards mode-aware
- SetupWizard: step indicators per mode
- PrivacyBadge: terminal vs clean styling

Closes #XXX
```

---

## 🧪 Testing

1. View welcome screen in both modes
2. Run through setup wizard in both modes
3. Check dashboard pipeline cards
4. Verify progress indicators during ingestion
5. Confirm privacy badge appearance
6. Test all button hover/active states

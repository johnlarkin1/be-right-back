# Master Orchestration Prompt

## 🎯 Purpose

This document provides the master prompt for orchestrating Claude Code sub-agents to convert components to dual UI mode support.

---

## 📋 Pre-Requisites Checklist

Before running sub-agents, ensure:

- [ ] Phase 1 refactoring is complete
- [ ] Token architecture files exist:
  - `src/styles/tokens/primitives.css`
  - `src/styles/tokens/semantic.css`
  - `src/styles/themes/retro.css`
  - `src/styles/themes/modern.css`
- [ ] Theme store exists: `src/stores/themeStore.ts`
- [ ] ThemeProvider wraps App
- [ ] Basic toggle component exists
- [ ] Branch created: `feature/dual-ui-mode`

---

## 🤖 Master Orchestration Prompt

Use this prompt to spawn Claude Code agents for each component group:

```
You are a senior frontend engineer working on the Be Right Back desktop application. Your task is to convert a specific set of components to support dual UI modes: "retro" (CRT terminal aesthetic) and "modern" (clean, Notion/Linear-style).

## Project Context

Be Right Back is a Tauri desktop app (React + TypeScript + Tailwind CSS v4) that creates AI personas from iMessage conversations. The app currently has a CRT terminal theme and we're adding a modern theme option.

## Architecture

The dual-mode system works as follows:

1. **Theme Store** (`src/stores/themeStore.ts`):
   - Zustand store with `mode: "retro" | "modern"`
   - Persists to localStorage
   - Sets `data-theme` attribute on `<html>`

2. **CSS Tokens** (`src/styles/tokens/`):
   - `primitives.css` - Raw color/spacing values
   - `semantic.css` - Meaningful token names
   - Theme files override tokens via `[data-theme="retro"]` / `[data-theme="modern"]`

3. **Component Patterns**:
   - **CSS-only**: Use `var(--token-name)` - auto-switches with theme
   - **Conditional**: Use `useUIMode()` hook for structural differences
   - **Icons**: Use `ThemedIcon` component for icon swaps

## Your Task

Read the task specification file and implement the changes described. Follow these rules:

1. **Use semantic tokens** - Never hardcode colors like `#00ff41`
2. **Preserve functionality** - Only change appearance, not behavior
3. **Test both modes** - Ensure components work in retro AND modern
4. **Incremental commits** - Commit each logical change separately
5. **Follow existing patterns** - Match the code style of the codebase

## Available Hooks

```typescript
// Get current mode
const { mode, isRetro, isModern } = useUIMode();

// Get mode-specific value
const value = useThemeAwareValue(retroValue, modernValue);
```

## Commit Format

```
feat(theme): [component-group] - [brief description]

- Bullet point changes
- Another change

Closes #XXX
```

## Task Specification

[INSERT TASK FILE CONTENT HERE]

---

Begin by reading the task specification, then implement the changes one component at a time. After each component, verify it works in both modes before moving to the next.
```

---

## 🚀 Execution Workflow

### Step 1: Spawn Sub-Agent for Shell Components

```bash
# In Claude Code / terminal
claude "$(cat 05-MASTER-PROMPT.md | sed 's/\[INSERT TASK FILE CONTENT HERE\]/$(cat 04-SUBAGENT-TASKS\/01-shell-components.md)/g')"
```

Or manually paste the master prompt with the task content.

### Step 2: Verify and Commit

After sub-agent completes:
1. Test the changes manually in both modes
2. Review the diff
3. Commit with appropriate message:
   ```bash
   git add -A
   git commit -m "feat(theme): convert shell components to dual-mode"
   ```

### Step 3: Repeat for Each Task

Execute in order:
1. `01-shell-components.md` - AppShell, Header, Navigation
2. `02-chat-components.md` - Chat interface
3. `03-insights-components.md` - Analytics dashboard
4. `04-home-components.md` - Home/dashboard views
5. `05-shared-ui-components.md` - Shared components

### Step 4: Final Integration

After all sub-agents complete:
1. Full regression test in both modes
2. Check for any missed components
3. Performance audit
4. Merge to main branch

---

## 📝 Task Tracking Template

Use this to track progress:

```markdown
## Dual UI Mode - Component Conversion Progress

### Shell Components
- [ ] AppShell.tsx
- [ ] Header.tsx
- [ ] Navigation.tsx
- [ ] ThemeToggle integration

### Chat Components
- [ ] ChatLayout.tsx
- [ ] ChatInput.tsx
- [ ] MessageBubble.tsx
- [ ] ChatSidebar.tsx
- [ ] InlineChatPanel.tsx

### Insights Components
- [ ] InsightsLayout.tsx
- [ ] InsightsHeader.tsx
- [ ] StatsRow.tsx
- [ ] MessageTimeline.tsx
- [ ] WordCloud.tsx
- [ ] ActivityHeatmap.tsx
- [ ] SemanticSpace.tsx

### Home Components
- [ ] HomeLayout.tsx
- [ ] WelcomeView.tsx
- [ ] DashboardView.tsx
- [ ] CommandCenter.tsx
- [ ] SetupWizard.tsx
- [ ] NeedsSetup.tsx

### Shared Components
- [ ] CRTEffect.tsx
- [ ] ModernEffect.tsx (create)
- [ ] Ghost.tsx
- [ ] ModeAwareMascot.tsx (create)
- [ ] Accordion.tsx
- [ ] MarkdownRenderer.tsx
```

---

## 🔄 Iteration Pattern

For each sub-agent session:

```
┌─────────────────────────────────────────────────────────────┐
│  1. LOAD TASK                                               │
│     - Read task specification                               │
│     - Understand scope and requirements                     │
│                                                             │
│  2. ANALYZE CURRENT STATE                                   │
│     - Read existing component code                          │
│     - Identify hardcoded values                             │
│     - Note mode-specific requirements                       │
│                                                             │
│  3. IMPLEMENT CHANGES                                       │
│     - Update imports (add useUIMode, ThemedIcon)           │
│     - Replace hardcoded colors with tokens                  │
│     - Add conditional rendering where needed                │
│     - Update className strings                              │
│                                                             │
│  4. VERIFY                                                  │
│     - Build succeeds                                        │
│     - No TypeScript errors                                  │
│     - Visual check in both modes                            │
│                                                             │
│  5. COMMIT                                                  │
│     - Stage changes                                         │
│     - Write descriptive commit message                      │
│     - Push to branch                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚨 Common Issues & Solutions

### Issue: Component doesn't update on toggle
**Solution**: Ensure component uses `useUIMode()` hook, not cached values

### Issue: Flash of wrong theme on load
**Solution**: Check ThemeProvider applies theme before first render

### Issue: Missing CSS tokens
**Solution**: Verify token is defined in both `semantic.css` and theme files

### Issue: Glow effects persist in modern mode
**Solution**: Use conditional class: `${isRetro ? "text-glow" : ""}`

### Issue: Icons don't switch
**Solution**: Use `ThemedIcon` component, not direct icon imports

---

## 📊 Quality Gates

Before marking a task complete:

- [ ] No TypeScript errors
- [ ] No console errors
- [ ] Builds successfully
- [ ] Works in retro mode (existing behavior preserved)
- [ ] Works in modern mode (new styling applied)
- [ ] Toggle switches cleanly (no flicker/flash)
- [ ] Responsive at different window sizes
- [ ] Accessible (focus states, contrast)
- [ ] Code follows project conventions
- [ ] Changes are committed with proper message

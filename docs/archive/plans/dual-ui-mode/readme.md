# 🎨 Dual UI Mode Project

> Transform Be Right Back to support Retro Terminal and Modern Sleek UI modes

---

## 📁 Project Files

| File | Description |
|------|-------------|
| `00-MASTER-ORCHESTRATION.md` | Overall project guide, architecture, phases |
| `01-PHASE1-REFACTORING.md` | Token architecture, CSS migration tasks |
| `02-MODERN-UI-AESTHETICS.md` | Design spec for Modern mode (colors, typography, components) |
| `03-TOGGLE-IMPLEMENTATION.md` | Zustand store, ThemeProvider, toggle components |
| `04-SUBAGENT-TASKS/` | Individual component conversion tasks |
| `05-MASTER-PROMPT.md` | Prompt template for spawning Claude Code sub-agents |

### Sub-Agent Tasks

| Task | Scope |
|------|-------|
| `01-shell-components.md` | AppShell, Header, Navigation |
| `02-chat-components.md` | Chat interface, messages, input |
| `03-insights-components.md` | Analytics dashboard, charts |
| `04-home-components.md` | Welcome, dashboard, setup wizard |
| `05-shared-ui-components.md` | Effects, Ghost, Accordion, UI primitives |

---

## 🚀 Quick Start

### Phase 1: Refactoring (Prep)

```bash
# Create branch
git checkout -b feature/dual-ui-mode

# Create token files
# Follow 01-PHASE1-REFACTORING.md

# Commit
git commit -m "feat(theme): add token architecture files"
```

### Phase 2: Implementation

```bash
# 1. Implement toggle (03-TOGGLE-IMPLEMENTATION.md)
# 2. Create modern theme CSS
# 3. Run sub-agents for each component group
# 4. Test thoroughly in both modes
```

---

## 📊 Progress Tracker

```
Phase 1: Refactoring
├── [ ] Token primitives
├── [ ] Semantic tokens
├── [ ] Retro theme file
├── [ ] Modern theme file
├── [ ] CSS migration
└── [ ] Component audit

Phase 2: Implementation
├── [ ] Theme store
├── [ ] ThemeProvider
├── [ ] ThemeToggle
├── [ ] Shell components
├── [ ] Chat components
├── [ ] Insights components
├── [ ] Home components
└── [ ] Shared components

Phase 3: Polish
├── [ ] Full QA pass
├── [ ] Transition animations
├── [ ] Accessibility review
└── [ ] Performance check
```

---

## 🎯 Success Criteria

- [ ] Toggle switches modes instantly
- [ ] Mode persists across sessions
- [ ] No visual artifacts during switch
- [ ] Both modes fully functional
- [ ] All components follow design specs
- [ ] Accessible in both modes

---

## 📚 Key References

- **Retro Theme**: CRT terminal, green glow, VT323 font, scanlines
- **Modern Theme**: Clean, Notion/Linear-style, Inter font, subtle shadows
- **Design Tokens**: Semantic naming, CSS custom properties
- **State Management**: Zustand with localStorage persistence

---

*Generated for Be Right Back desktop application*

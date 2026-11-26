The top bar holds the app name, the three tabs, the theme toggle and the ghost menu. It is 52px high.

The tab order is fixed: chat, home, insights. Home sits in the center.

Props: `activeTab` (`"home"`, `"chat"` or `"insights"`), `onTabChange`, and the optional `onAboutClick` and `onShortcutsClick` for the ghost menu. The component reads the UI mode itself.

| Part | Retro | Modern |
| --- | --- | --- |
| Brand | `> Be Right Back` in VT323, green glow | `Be Right Back` in Geist Sans 16px, weight 600 |
| Tab label | Lowercase: `chat`, `home`, `insights` | Title case: `Chat`, `Home`, `Insights` |
| Tab icon | `>` for chat, a house icon for home, `#` for insights | Lucide `MessageSquare`, `Home`, `BarChart3` at 18px |
| Active tab | Green text on a 10% green fill | `emerald-400` text on a 12% emerald fill |
| Theme toggle | Lucide `Terminal` | Lucide `Monitor` |

Rules:

- Do not add a fourth tab.
- The active Lucide icon uses stroke width 2.5. Inactive icons use 2.
- Each tab has a tooltip with its name and keyboard shortcut.

Live React component. Source: `apps/desktop/src/components/TopBar.tsx` and the TopBar sections of `globals.css`.

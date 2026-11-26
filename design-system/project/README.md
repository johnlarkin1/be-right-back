Be Right Back is a local-first macOS app. It builds AI chat personas from iMessage history. The desktop app has two modes: a retro CRT terminal and a modern clean look. The marketing website has a third look that mixes both.

## Principles

- **One system, three themes.** Retro is the default. Modern is the alternative in the app. Website is for the marketing site. Build each component once with semantic tokens.
- **Dark only.** Every theme uses a dark background. There is no light mode.
- **Private by design.** The product runs on the device. Say so plainly. Never suggest that data goes to a server.
- **The ghost belongs to retro.** Modern replaces the mascot with a Lucide icon.

## Themes

Set `data-theme` on the `<html>` element to `retro`, `modern` or `website`. With no attribute, the app shows retro.

| | Retro | Modern | Website |
| --- | --- | --- | --- |
| Background | `#0a0e0a` | `#020617` | `#0b0f0c` |
| `color-accent` | Phosphor green `#00ff41` | Emerald `#10b981` | Amber `#ffb000` |
| `color-accent-secondary` | Amber `#ffb000` | Blue `#3b82f6` | Green `#00ff41` |
| Text | Cool zinc | Cool slate | Warm off-white `#ede7d6` |
| Display font | VT323 | Inter | Inter |
| Body font | IBM Plex Mono | Inter | Inter |
| Mono font | IBM Plex Mono | Geist Mono | JetBrains Mono |
| Glow | Strong | Off | Subtle |
| Scanlines and vignette | On | Off | Off |
| Icons | ASCII glyphs and the ghost | Lucide icons | Lucide icons and the ghost |

## Color

- Use semantic tokens in components: `color-surface`, `color-text-primary`, `color-accent`, `color-border`. Never use a `primitive-*` token directly.
- Put the page on `color-surface`. Put raised content on `color-surface-elevated` or `color-surface-card`.
- Set body copy in `color-text-primary`. Set supporting copy in `color-text-secondary`.
- Do not use `color-text-muted` for text a user must read. Its contrast is below 4.5:1 in every theme.
- In the app, `color-accent` means the user and the active state. `color-accent-secondary` means the persona.
- Put `color-text-inverse` on a `color-accent` fill.
- Status colors are `color-success`, `color-warning`, `color-error` and `color-info`. Always add a word or an icon. In retro, success and the accent are the same green.
- Pink (`color-ghost-pink`) belongs to Casper, the helper agent. Violet marks model reasoning. Do not use them for other things.
- For chat, use the `message-user-*` and `message-persona-*` tokens. For charts, use `insights-you-color` and `insights-them-color`.

## Website

- Use the Website theme for marketing and documentation pages. Do not use it inside the app.
- Amber leads. Use `color-accent` for links, labels and borders. Use green (`color-accent-secondary`) for terminal text and inline code only.
- Neutrals are warm. Article body text is `web-crt-body`. Article headings and links are `web-crt-accent-soft`.
- Set UI chrome in JetBrains Mono (`--font-mono`). Set headings and long text in Inter. Keep VT323 (`--font-terminal`) for small retro moments such as the landing title.
- Borders are hairlines in `web-border-subtle`.
- Corners use `web-radius-sm` to `web-radius-xl`.
- For articles, follow the WebsiteProse card.
- App components in the Website theme keep their retro structure and take the website palette. Treat that as an approximation. The website has its own components, which are not in this system.

## Type

- Use the font roles, not the family names: `--font-display`, `--font-body`, `--font-mono`, `--font-terminal`. The component stylesheet maps each role per theme.
- Retro: VT323 for titles, tabs and labels in brackets. IBM Plex Mono for all other text.
- Modern: Inter for titles and body. Geist Sans for the top bar. Geist Mono for code and numbers.
- VT323 has one weight. Do not make it bold.
- Small text is common: 12px labels, 11px section titles, 10px hints. Do not go below 10px.
- The app loads only VT323 and IBM Plex Mono, from Google Fonts. In the app, Inter, Geist Sans and Geist Mono fall back to system fonts. The website loads Inter and JetBrains Mono.

## Voice

- Write short, plain sentences. Address the user as "you". Real copy: "Your data never leaves your device". "All processing happens locally on your Mac".
- Modern uses sentence case and title-case tab names: "Home", "Chat", "Insights".
- Retro uses terminal style. Tabs are lowercase: `home`, `chat`, `insights`. Status labels are uppercase in square brackets: `[USER]`, `[DIGITAL-YOU]`, `[CASPER]`, `[LOCK]`, `[SEND]`. The brand is `> Be Right Back`.
- Retro message text starts with `>` for the user and `<` for the persona.
- Do not use emoji. Do not use exclamation marks, except for a success message: "Permission granted!".
- The trained persona is "Digital You". The helper agent is "Casper".

## Shape and space

- Spacing follows a 4px scale: `primitive-space-1` to `primitive-space-24`. For layout, use `space-tight`, `space-inline`, `space-element` and `space-section`.
- Corners: `radius-input` for inputs, `radius-button` for buttons and tabs, `radius-card` for cards and tooltips, `radius-modal` for modals, `radius-badge` for pills.
- Borders are 1px. Use `color-border` by default and `color-border-accent` for interactive outlines.
- Layout helpers: `.stack`, `.stack-tight`, `.stack-section`, `.row`, `.row-tight`, `.center`, `.between`.

## Glow, shadow and effects

- Retro shows depth with glow. Use `.text-glow` on accent titles and `.box-glow` on focused controls. Both classes turn off in modern.
- Modern shows depth with shadow: `shadow-card`, `shadow-elevated` and `shadow-modal`.
- The CRT overlay has three fixed layers: `.crt-scanlines`, `.crt-vignette` and `.crt-glow`. They sit above all content and ignore pointer events. Do not put them inside a component.
- Do not add gradients. The source has two: the page title (`title-gradient-start` to `title-gradient-end`) and the Insights charts.

## Motion

- Transitions take 150ms (fast), 200ms (normal) or 300ms (slow). The easing is `cubic-bezier(0.4, 0, 0.2, 1)`.
- Retro animations: `.cursor-blink` (0.8s), `.animate-flicker` (4s), `.animate-pulse-glow` (2s) and `.animate-typing`. Modern stops the blink and the flicker.
- Shared animations: `.animate-fade-in`, `.animate-scale-in`, `.animate-skeleton`, `.animate-spin` and `.animate-float` (the ghost).
- Components enter with a short fade and a 10px rise (Framer Motion).

## Focus

- Add `.focus-ring` to each interactive element. It draws a 2px `color-accent` outline with a 2px offset.
- Inputs show `input-focus-border` on focus.

## Iconography

- Modern uses Lucide icons (`lucide-react` 0.562). Sizes are 16px to 20px. The stroke width is 2, or 2.5 for an active tab.
- Retro uses ASCII glyphs as icons: `>` for chat, `#` for insights, `[+]` and `[-]` for expand and collapse, `◈`, `⚙`, `⌨`.
- The ghost mascot is pixel art on a 19 by 21 grid. See the Ghost component and `assets/Logos/`.
- Do not use emoji as icons.

## Components

- Fifteen components are the app's own React code: Ghost, ModeAwareMascot, TopBar, ThemeToggle, Tooltip, Accordion, StepStatusIcon, MarkdownRenderer, MessageBubble, TypingIndicator, ChatInput, PrivacyBadge, CompactStatsBar, ThinkingBlock and ToolCallCard.
- Load `components/lib/react.js` and `components/lib/react-dom.js` (React 19), then `components/bundle.css`, then `components/bundle.js`. The components are on `window.BeRightBack`.
- Components read the mode with `useUIMode()`. It follows `data-theme`. The Website theme counts as retro.
- Button, Card and SettingsForm are CSS patterns. Write the markup yourself and use the classes.
- The stylesheet includes the Tailwind CSS utilities that the app uses, and the Tailwind reset.

## Not synced

- **Build.** `design-system/build.sh` in the repository builds the tokens, the stylesheet and the bundle from `apps/desktop`. React 19 ships in `components/lib/`, built from the app's own dependency.
- **Theme store.** The bundle replaces `stores/themeStore.ts` with a version that follows `data-theme` and does not write to localStorage.
- **Stylesheet changes.** Token declarations are removed from `bundle.css`, so the token file is their one source. The `body` overflow rule and the `#root` rule are removed. Retro-only selectors also match the Website theme.
- **Values kept in the stylesheet.** The token file cannot hold these: font roles per theme, `--text-glow` (it uses `currentColor`), `--input-bg` (`transparent`), `--topbar-bg` (a gradient), transition values, CRT effect opacities, and the modern `--radius-modal`.
- **Website.** The Website theme maps the site's palette onto the app's semantic tokens. That mapping is a design choice, not source code. The site's stock shadcn tokens and its own components are not included.
- **Skipped tokens.** The Tailwind aliases `--color-crt-*`. Also `--scrollbar-thumb-hover`: its modern value points to `--primitive-slate-600`, which the source does not define.
- **Undefined in the source.** `.topbar-theme-toggle:hover` uses `--color-surface-hover`. No file defines it.
- **Fonts.** No font files are in the repository. All faces come from Google Fonts. Geist Sans and Geist Mono are named but never loaded.
- **Components not built.** Components that call the Tauri backend: the settings and training modals, the Casper chat, the home dashboard, the chat layout and the Insights charts. Also CommandPalette and the CRT overlay.

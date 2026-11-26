Renders Markdown from the model as themed content. Casper answers and analysis text use it.

Props: `content` (a Markdown string) and `className`.

- It supports GitHub Flavored Markdown: lists, tables, strikethrough and code.
- Headings are uppercase in retro and sentence case in modern.
- Inline code takes `color-accent` in retro.
- Do not pass raw HTML. The renderer does not run it.

Live React component. Source: `apps/desktop/src/components/ui/MarkdownRenderer.tsx`.

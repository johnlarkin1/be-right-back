A card groups related content on the app background.

- **`.card`**: `card-bg` fill, `card-border` border, `radius-card` corners. Use it for content that sits flat on `color-surface`.
- **`.card-elevated`**: `color-surface-elevated` fill and `shadow-card`. Use it for content that floats, such as a stats panel.

You provide the element, the padding and the content. The classes set no padding. The source uses 16px.

Rules:

- Do not nest an elevated card inside an elevated card.
- Set titles in `.font-display` with `.text-accent`. Add `.text-glow` so the title glows in retro only.

CSS pattern. The source has no React component for it, so the preview is plain markup. Source: `apps/desktop/src/styles/utilities/shared.css`.

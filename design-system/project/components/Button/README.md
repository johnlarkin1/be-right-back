Buttons start, confirm and cancel actions. Three class families exist in the source.

- **`.btn` with `.btn-primary` or `.btn-secondary`**: the shared pattern. It works in both themes. Use one primary button per view.
- **`.terminal-button`**: an outlined button in the display font. Use it for inline retro actions such as `[Re-analyze]`. Its hover fill is a fixed green, so use it in retro only.
- **`.settings-btn` with `.settings-btn-primary` or `.settings-btn-secondary`**: the modal footer pair. Put both inside `.settings-actions`. Each button takes half the width.

You provide a `<button>` element, the label and the click handler. Add `.focus-ring` for the keyboard focus outline (`color-accent`, 2px, 2px offset).

Rules:

- Write labels in sentence case: "Start ingestion", "Save", "Cancel".
- In retro, wrap inline terminal actions in square brackets.
- Text on `.btn-primary` uses `color-text-inverse` on `color-accent`.
- The retro `.settings-btn-primary` label uses `color-accent-secondary` (amber) on a faint green fill. This is the source design.

CSS pattern. The source has no React component for it, so the preview is plain markup. Source: `apps/desktop/src/styles/utilities/shared.css` and `globals.css`.

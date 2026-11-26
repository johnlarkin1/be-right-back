Settings form controls: section, label, hint, text input, select, toggle and slider. The ingestion settings modal uses them.

You provide the markup and the state. The classes carry all styling.

- **`.settings-section`** groups rows. Give each section a `.settings-section-title`.
- **`.settings-row`** holds one control. Put a `.settings-label` above it and an optional `.settings-hint` below it.
- **`.settings-input`** and **`.settings-select`** fill the row. Add `.settings-input-small` for short numbers (80px).
- **`.settings-toggle`** is a 40px by 22px switch. Add `.enabled` when it is on. Put it in a `.settings-toggle-group` with its label.
- **`.settings-slider`** is a range input. Show its value in `.settings-slider-value`.

Rules:

- In retro, section titles are uppercase amber (`color-accent-secondary`) and labels are green (`color-accent`).
- In modern, section titles use sentence case and `color-text-secondary`. Labels use `color-text-primary`.
- Focus shows `input-focus-border`. Retro adds `box-glow`. Modern adds a 2px `color-accent-subtle` ring.
- A toggle shows its state by thumb position and by color. Keep both.
- Give each toggle and slider an accessible name.

CSS pattern. The source has no React component for it, so the preview is plain markup. Source: `apps/desktop/src/components/settings/IngestionSettingsModal.tsx` and the settings sections of `globals.css` and `themes/modern.css`.

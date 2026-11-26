The ghost is the pixel-art mascot. It appears in retro mode only.

Props: `variant` (the expression), `color`, `size` and animation options.

- **Colors**: `green` is the standard ghost. `pink` is Casper, the helper agent. `purple`, `cyan` and `amber` are accents. Use the `color-ghost-*` tokens.
- **Expressions**: `standard`, `happy`, `sleepy`, `surprised`, `angry`, `sad`, `mischievous`, `worried`, `excited`, `bored` and `thinking`.
- **Grid**: the ghost is drawn on a 19 by 21 pixel grid. Scale it by whole multiples so the pixels stay sharp.

Rules:

- Do not show the ghost in modern mode. Use `ModeAwareMascot`, which shows a Lucide icon there.
- Use pink only for Casper.
- Do not redraw the ghost. Copy the path from `assets/Logos/ghost.svg`.
- The eyes take the background color, `color-surface`.

Live React component. Source: `apps/desktop/src/components/Ghost.tsx` and `apps/desktop/public/ghost.svg`.

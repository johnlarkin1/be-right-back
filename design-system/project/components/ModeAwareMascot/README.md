The mascot slot. It shows the pixel ghost in retro and a Lucide icon in modern.

Props: `variant` (ghost expression, retro only), `size`, `modernVariant` (`"bot"`, `"sparkles"`, `"message"`, `"user"` or `"none"`), `animate` and `className`.

- Use it in place of `Ghost` wherever a screen must work in both modes.
- Set `modernVariant` to `"none"` to show nothing in modern.
- The preview shows the four modern icons. In retro, all four cells show the same ghost.

Live React component. Source: `apps/desktop/src/components/ModeAwareMascot.tsx`.

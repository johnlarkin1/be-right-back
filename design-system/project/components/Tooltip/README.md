A tooltip explains a term or shows a keyboard shortcut on hover or focus.

Props: `content`, `children`, `position` (default `"bottom"`), `delayMs` and `className`. The component moves the tooltip to stay inside the window.

You provide the trigger element as the child and a short text as the content.

| Part | Retro | Modern |
| --- | --- | --- |
| Text | Terminal font, 10px, uppercase, 0.05em tracking, green | Body font, 12px, `slate-50` |
| Surface | Near-black fill, green border at 40%, green glow | `slate-900` fill at 95%, `slate-700` border, `shadow-card` |

Rules:

- Keep the text to one sentence. The maximum width is 240px.
- For a shortcut, write the name, two spaces, then the keys.
- Do not put controls or links in a tooltip.

Live React component. Source: `apps/desktop/src/components/ui/Tooltip.tsx` and `utilities/shared.css`.

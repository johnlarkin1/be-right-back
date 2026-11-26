An accordion shows and hides one section of content.

Props: `title`, `icon` (optional Lucide icon), `isOpen`, `onToggle`, `children` and `id`. The parent holds the open state.

| Part | Retro | Modern |
| --- | --- | --- |
| Title | Uppercase, terminal style | Sentence case |
| Indicator | `[-]` when open, `[+]` when closed | A chevron that turns 90 degrees |

Rules:

- Keep titles to one or two words.
- To make a group where one section is open at a time, hold one open id in the parent.

Live React component. Source: `apps/desktop/src/components/ui/Accordion.tsx`.

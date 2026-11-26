A message bubble shows one chat message from the user or from the persona.

Props: `message` (string), `isUser` (boolean), `isStreaming` (optional boolean).

| Part | Retro | Modern |
| --- | --- | --- |
| Shape | 4px corners on all sides | 16px corners, 4px on the sender's bottom corner |
| Label | `[USER]` or `[DIGITAL-YOU]` in the terminal font, 60% opacity | None |
| Prefix | `>` for the user, `<` for the persona | None |
| Text | IBM Plex Mono 14px with `text-glow` | Body font 14px, no glow |
| Streaming cursor | `_` in `color-accent` | A vertical bar in `color-text-muted` |

Rules:

- User messages align right and use the `message-user-*` tokens.
- Persona messages align left and use the `message-persona-*` tokens.
- A bubble is at most 80% of the row width. Padding is 12px by 16px.
- Do not put other colors in a bubble. Green means you. Amber or blue means the persona.

Live React component. Source: `apps/desktop/src/components/chat/MessageBubble.tsx`.

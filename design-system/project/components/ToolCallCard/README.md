One row for each tool that Casper calls while it answers.

Props: `tool` (`toolName`, `arguments`, `status`, and the optional `durationMs`, `resultPreview` and `error`), `compact` and `defaultExpanded`.

| Part | Retro | Modern |
| --- | --- | --- |
| Name | The raw tool name: `search_messages` | A phrase: "Searching messages" |
| Status | `OK`, `...` or `ERR` | A check, a spinner or a cross |

Rules:

- Status is `"pending"`, `"running"`, `"success"` or `"error"`.
- Known tools are `list_contacts`, `search_messages`, `get_conversation_context` and `get_contact_stats`.
- The row expands to show the arguments and the result.
- Rows use Casper pink (`color-ghost-pink`).

Live React component. Source: `apps/desktop/src/components/casper/ToolCallCard.tsx`.

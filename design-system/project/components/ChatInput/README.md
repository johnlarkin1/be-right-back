The message composer at the bottom of a chat.

Props: `onSend` (receives the text), `disabled` and `placeholder`.

| Part | Retro | Modern |
| --- | --- | --- |
| Field | A `>` prompt and a borderless terminal input | A pill input with an accent border |
| Send | A `[SEND]` text button | A round button with the Lucide `Send` icon |

Rules:

- Enter sends the message. The field clears after a send.
- Set `disabled` while the persona replies.
- The send control stays dim until the field has text.

Live React component. Source: `apps/desktop/src/components/chat/ChatInput.tsx`.

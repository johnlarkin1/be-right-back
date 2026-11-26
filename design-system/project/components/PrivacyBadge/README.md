States that all data stays on the device.

Props: `variant` (`"inline"` or `"card"`) and `className`.

- **Inline**: a one-line badge. Retro reads `[LOCK] LOCAL_ONLY`. Modern reads "Private & Local".
- **Card**: a lock icon with "Your data never leaves your device" and "All processing happens locally on your Mac".
- Show it wherever the app asks for access to messages.
- Do not change the copy. It is a product promise.

Live React component. Source: `apps/desktop/src/components/home/PrivacyBadge.tsx`.

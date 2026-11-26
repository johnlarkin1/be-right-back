The theme toggle switches the app between retro and modern.

Props: `compact` (icon only, for the top bar) and `showLabel` (adds the text "UI Mode", for a settings page).

- The compact button is 36px square in retro and 38px square in modern.
- The icon shows the current mode: Lucide `Terminal` for retro, `Monitor` for modern. Icon size is 18px.
- The accessible name states the action: "Switch to Modern mode" or "Switch to Retro mode".
- The app stores the mode in localStorage under `brb-ui-mode`. It sets `data-theme` on the `<html>` element.
- In this bundle the store does not persist. It follows `data-theme`, so the page theme switch and the toggle stay in step.

Live React component. Source: `apps/desktop/src/components/theme/ThemeToggle.tsx`.

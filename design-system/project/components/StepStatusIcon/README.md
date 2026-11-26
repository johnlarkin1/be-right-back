A status icon for one step of a multi-step process, such as setup or ingestion.

Props: `status` (`"completed"`, `"active"` or `"pending"`), `size`, `color`, `isRetro`, and the optional `checkFg`, `pendingColor` and `checkSize`.

- Pass `isRetro` from `useUIMode()`. The component does not read the mode itself.
- Completed is a filled disc with a check in retro and an outlined check in modern.
- Active spins. Pending is an empty ring.
- Put a text label next to the icon. Do not show status by icon alone.

Live React component. Source: `apps/desktop/src/components/ui/StepStatusIcon.tsx`.

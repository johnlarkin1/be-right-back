export const NUM_GHOSTS = 32;
export const GHOST_SPEED = 3.0;
export const GHOST_SIZE = 50;
export const GHOST_OPACITY = 0.6;
export const GHOST_VARIANTS = [
  "standard",
  "happy",
  "sleepy",
  "surprised",
  "angry",
  "sad",
  "mischievous",
  "worried",
  "excited",
  "bored",
] as const;
export const GHOST_VARIANT_SCALES: Record<string, number> = {
  sleepy: 1.2,
  bored: 1.2,
  happy: 0.9,
  excited: 0.9,
  worried: 0.85,
  sad: 0.85,
};

// Ghost interaction constants
export const MAX_GHOSTS = 100;
export const ATTRACT_RADIUS = 400;
export const ATTRACT_FORCE = 0.4;

// ---------------------------------------------------------------------------
// Custom cursor configuration
// ---------------------------------------------------------------------------
// Controls what renders in place of the native cursor on desktop (pointer:fine).
// The native cursor is hidden via `body.cursor-spotlight-active` in globals.css.
//
//   "spotlight"        - only the green phosphor glow (current default)
//   "ghost"            - only a ghost sprite follows the cursor
//   "ghost-spotlight"  - ghost sprite riding on top of the glow
//
// Flip CURSOR_MODE to enable the ghost cursor; tweak the variant/size below.
import type { GhostVariant } from "./ghost-sprite";

export type CursorMode = "spotlight" | "ghost" | "ghost-spotlight";

export const CURSOR_MODE: CursorMode = "spotlight";

/** Which ghost emotion to use when the ghost cursor is enabled. */
export const CURSOR_GHOST_VARIANT: GhostVariant = "standard";

/** Pixel size of the ghost cursor sprite. */
export const CURSOR_GHOST_SIZE = 36;

/**
 * Ghost - Pixel art ghost mascot with various emotions and colors
 * Supports multiple color schemes for different contexts:
 * - Green: Standard UI/terminal ghost
 * - Pink: Casper (the helper ghost)
 * - Purple/Cyan/Amber: Accent variants
 */
import { motion } from "framer-motion";
import type { GhostVariant, GhostColor } from "@/types";

// Color palette for ghosts
const GHOST_COLOR_VALUES: Record<GhostColor, string> = {
  green: "#00ff41", // Terminal green - standard
  pink: "#ff69b4", // Hot pink - Casper
  purple: "#8b5cf6", // Purple - accent
  cyan: "#00ffff", // Cyan - accent
  amber: "#ffb000", // Amber/orange - accent
};

// Variant-specific colors (legacy, used when no color prop is provided)
const GHOST_VARIANT_COLORS: Record<GhostVariant, string> = {
  standard: "#00ff41", // Terminal green
  happy: "#00ff88", // Cyan-green
  sleepy: "#88ff00", // Lime
  surprised: "#ff4141", // Red
  angry: "#ff0000", // Bright red
  sad: "#4169ff", // Blue
  mischievous: "#ff00ff", // Magenta
  worried: "#ffb000", // Orange/amber
  excited: "#00ffff", // Cyan
  bored: "#888888", // Gray
  thinking: "#a78bfa", // Purple - contemplative
};

// SVG paths for different ghost expressions
const GHOST_FACES: Record<GhostVariant, React.ReactNode> = {
  standard: (
    <>
      {/* Eyes */}
      <rect
        x="6"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
    </>
  ),
  happy: (
    <>
      {/* Normal eyes */}
      <rect
        x="6"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Curved smile - U shape */}
      <rect
        x="6"
        y="10"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="7"
        y="11"
        width="5"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="12"
        y="10"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
    </>
  ),
  surprised: (
    <>
      {/* Wide eyes */}
      <rect
        x="5"
        y="5"
        width="3"
        height="4"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="5"
        width="3"
        height="4"
        fill="currentColor"
        opacity="0.9"
      />
      {/* O mouth */}
      <rect
        x="8"
        y="11"
        width="3"
        height="2"
        fill="currentColor"
        opacity="0.7"
      />
    </>
  ),
  sleepy: (
    <>
      {/* Closed eyes (lines) */}
      <rect
        x="5"
        y="7"
        width="4"
        height="1"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="10"
        y="7"
        width="4"
        height="1"
        fill="currentColor"
        opacity="0.9"
      />
    </>
  ),
  worried: (
    <>
      {/* Worried eyes */}
      <rect
        x="6"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Wavy mouth */}
      <rect
        x="7"
        y="11"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="9"
        y="12"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="11"
        y="11"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
    </>
  ),
  angry: (
    <>
      {/* Angry slanted eyes */}
      <rect
        x="5"
        y="7"
        width="3"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="7"
        width="3"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Angry brows */}
      <rect
        x="5"
        y="5"
        width="2"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
      <rect
        x="12"
        y="5"
        width="2"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
    </>
  ),
  sad: (
    <>
      {/* Sad droopy eyes */}
      <rect
        x="6"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="6"
        width="2"
        height="3"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Frown */}
      <rect
        x="7"
        y="12"
        width="5"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="6"
        y="11"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
      <rect
        x="12"
        y="11"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.6"
      />
    </>
  ),
  mischievous: (
    <>
      {/* Sly eyes */}
      <rect
        x="5"
        y="7"
        width="4"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="10"
        y="7"
        width="4"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Smirk */}
      <rect
        x="9"
        y="11"
        width="3"
        height="1"
        fill="currentColor"
        opacity="0.7"
      />
    </>
  ),
  excited: (
    <>
      {/* Wide excited eyes */}
      <rect
        x="5"
        y="5"
        width="3"
        height="4"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="11"
        y="5"
        width="3"
        height="4"
        fill="currentColor"
        opacity="0.9"
      />
      {/* O mouth - open/excited */}
      <rect
        x="8"
        y="10"
        width="3"
        height="3"
        fill="currentColor"
        opacity="0.7"
      />
    </>
  ),
  bored: (
    <>
      {/* Half-closed eyes */}
      <rect
        x="5"
        y="7"
        width="4"
        height="1"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="10"
        y="7"
        width="4"
        height="1"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Flat mouth */}
      <rect
        x="8"
        y="11"
        width="3"
        height="1"
        fill="currentColor"
        opacity="0.5"
      />
    </>
  ),
  thinking: (
    <>
      {/* Eyes looking up-right (pondering) */}
      <rect
        x="7"
        y="5"
        width="2"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      <rect
        x="12"
        y="5"
        width="2"
        height="2"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Small contemplative mouth */}
      <rect
        x="9"
        y="11"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.5"
      />
      {/* Thought dots floating above */}
      <rect
        x="15"
        y="2"
        width="1"
        height="1"
        fill="currentColor"
        opacity="0.4"
      />
      <rect
        x="16"
        y="0"
        width="2"
        height="2"
        fill="currentColor"
        opacity="0.6"
      />
    </>
  ),
};

interface GhostProps {
  variant?: GhostVariant;
  color?: GhostColor;
  size?: number;
  animate?: boolean;
  className?: string;
  glowIntensity?: "none" | "subtle" | "medium" | "strong";
}

export function Ghost({
  variant = "standard",
  color,
  size = 48,
  animate = true,
  className = "",
  glowIntensity = "medium",
}: GhostProps) {
  // Color prop overrides variant-based color
  const ghostColor = color
    ? GHOST_COLOR_VALUES[color]
    : GHOST_VARIANT_COLORS[variant] || GHOST_VARIANT_COLORS.standard;

  const face = GHOST_FACES[variant] || GHOST_FACES.standard;

  // Glow filter intensity
  const glowFilters: Record<string, string> = {
    none: "",
    subtle: `drop-shadow(0 0 2px ${ghostColor})`,
    medium: `drop-shadow(0 0 4px ${ghostColor})`,
    strong: `drop-shadow(0 0 6px ${ghostColor}) drop-shadow(0 0 12px ${ghostColor})`,
  };

  const ghostSvg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 19 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
      className={className}
    >
      {/* Ghost body */}
      <path
        d="M4 1H15V2H16V3H17V4H18V17H17V16H16V15H15V16H14V17H13V16H12V15H11V16H10V17H9V16H8V15H7V16H6V17H5V16H4V15H3V16H2V17H1V4H2V3H3V2H4V1Z"
        fill={ghostColor}
        style={{ filter: glowFilters[glowIntensity] }}
      />
      {/* Face */}
      <g style={{ color: "#0a0e0a" }}>{face}</g>
    </svg>
  );

  if (!animate) {
    return ghostSvg;
  }

  return (
    <motion.div
      animate={{
        y: [0, -8, 0],
      }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      className="inline-block"
    >
      {ghostSvg}
    </motion.div>
  );
}

interface WanderingGhostProps {
  size?: number;
  variant?: GhostVariant;
  color?: GhostColor;
}

// Wandering ghost that moves around the screen
export function WanderingGhost({
  size = 32,
  variant = "standard",
  color,
}: WanderingGhostProps) {
  return (
    <motion.div
      className="fixed pointer-events-none z-50"
      initial={{ x: "50vw", y: "50vh" }}
      animate={{
        x: ["30vw", "70vw", "50vw", "40vw", "60vw", "30vw"],
        y: ["30vh", "60vh", "40vh", "70vh", "35vh", "30vh"],
      }}
      transition={{
        duration: 30,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <Ghost size={size} variant={variant} color={color} animate={true} />
    </motion.div>
  );
}

// Casper - the pink helper ghost with a friendly personality
interface CasperProps {
  size?: number;
  variant?: GhostVariant;
  animate?: boolean;
  className?: string;
}

export function Casper({
  size = 48,
  variant = "happy",
  animate = true,
  className = "",
}: CasperProps) {
  return (
    <Ghost
      variant={variant}
      color="pink"
      size={size}
      animate={animate}
      className={className}
      glowIntensity="strong"
    />
  );
}

export default Ghost;

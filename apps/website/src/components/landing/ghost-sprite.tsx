import type { GHOST_VARIANTS } from "./constants";

export type GhostVariant = (typeof GHOST_VARIANTS)[number];

/** One filled cell run on the 16×16 sprite grid: [x, y, width, height]. */
type PixelRect = readonly [number, number, number, number];

const BODY: readonly PixelRect[] = [
  [4, 2, 8, 2], // head
  [3, 4, 10, 2],
  [3, 6, 10, 6], // body
  [3, 12, 2, 2], // wavy bottom
  [6, 13, 2, 2],
  [8, 13, 2, 2],
  [11, 12, 2, 2],
];

const EYES: Record<string, readonly PixelRect[]> = {
  sleepy: [[5, 7, 2, 1], [9, 7, 2, 1]],
  wide: [[5, 6, 2, 3], [9, 6, 2, 3]],
  angry: [[4, 6, 3, 1], [9, 6, 3, 1], [5, 7, 2, 2], [9, 7, 2, 2]],
  sad: [[5, 8, 2, 1], [9, 8, 2, 1], [5, 7, 1, 1], [10, 7, 1, 1]],
  wink: [[5, 7, 2, 1], [9, 7, 2, 2]],
  standard: [[5, 7, 2, 2], [9, 7, 2, 2]],
};

const MOUTHS: Record<string, readonly PixelRect[]> = {
  smile: [[6, 10, 4, 1], [5, 9, 1, 1], [10, 9, 1, 1]],
  open: [[7, 10, 2, 2]],
  frown: [[6, 11, 4, 1], [5, 10, 1, 1], [10, 10, 1, 1]],
  flat: [[6, 10, 4, 1]],
  smirk: [[7, 10, 3, 1], [10, 9, 1, 1]],
  yawn: [[6, 10, 4, 1], [7, 11, 2, 1]],
  small: [[7, 10, 2, 1]],
};

/** Face colour for every variant. Matches Tailwind's gray-900. */
export const GHOST_FACE_COLOR = "#111827";

export const GHOST_COLORS: Record<GhostVariant, string> = {
  standard: "#00ff41",
  happy: "#00ffaa",
  sleepy: "#88ff00",
  surprised: "#99ff33",
  angry: "#ff4444",
  sad: "#4488ff",
  mischievous: "#ff00ff",
  worried: "#ffaa00",
  excited: "#00ffff",
  bored: "#666666",
};

const FACES: Record<GhostVariant, { eyes: string; mouth: string }> = {
  standard: { eyes: "standard", mouth: "small" },
  happy: { eyes: "standard", mouth: "smile" },
  sleepy: { eyes: "sleepy", mouth: "yawn" },
  surprised: { eyes: "wide", mouth: "open" },
  angry: { eyes: "angry", mouth: "flat" },
  sad: { eyes: "sad", mouth: "frown" },
  mischievous: { eyes: "wink", mouth: "smirk" },
  worried: { eyes: "wide", mouth: "open" },
  excited: { eyes: "wide", mouth: "smile" },
  bored: { eyes: "sleepy", mouth: "small" },
};

/** The pixel art for one variant: body rects in the variant colour, then face rects. */
export function ghostPixels(variant: GhostVariant) {
  const face = FACES[variant];
  return {
    color: GHOST_COLORS[variant],
    body: BODY,
    face: [...EYES[face.eyes], ...MOUTHS[face.mouth]],
  };
}

interface GhostSpriteProps {
  variant: GhostVariant;
  /** Pixel size of the rendered sprite. Defaults to 40, the ghost field sprite size. */
  size?: number;
}

/** SVG ghost. The WebGL ghost field draws the same pixels from `ghostPixels()`. */
export function GhostSprite({ variant, size = 40 }: GhostSpriteProps) {
  const { color, body, face } = ghostPixels(variant);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="drop-shadow-lg"
      style={{ imageRendering: "pixelated" }}
    >
      {body.map(([x, y, w, h], i) => (
        <rect key={`b${i}`} x={x} y={y} width={w} height={h} fill={color} />
      ))}
      {face.map(([x, y, w, h], i) => (
        <rect key={`f${i}`} x={x} y={y} width={w} height={h} fill={GHOST_FACE_COLOR} />
      ))}
    </svg>
  );
}

/**
 * Geometry of the exploded stack, without three.js. The scene and the
 * static placeholder both use it, so the placeholder matches frame one.
 */

import { LAYERS, type Layer } from "./data";

/** Plate edges. The current layer's plate brightens toward its own color. */
export const NEUTRAL = "#3a4038";
/** Rim tint of a plate that is not current, as a mix toward its color. */
export const RIM_TINT = 0.4;

/** Step state colors, shared by the in-scene chips, the rail, and the list. */
export const STEP_STYLE = {
  current: { background: "#ffb000", color: "#0b0f0c", borderColor: "#ffb000" },
  done: { borderColor: "rgba(255,176,0,0.6)", color: "#ffb000" },
  upcoming: { borderColor: "#2a302b", color: "#6e685b" },
} as const;

export interface Dims {
  compact: boolean;
  plateW: number;
  plateD: number;
  plateT: number;
  spacing: number;
  pressed: number;
  xScale: number;
  foot: number;
  labelPad: number;
  /** Camera direction, from the target toward the camera. */
  view: [number, number, number];
}

const rad = (deg: number) => (deg * Math.PI) / 180;

function makeDims(compact: boolean): Dims {
  const az = rad(compact ? 30 : 20);
  const el = rad(compact ? 27 : 24);
  return {
    compact,
    plateW: compact ? 13.6 : 25,
    plateD: compact ? 4 : 5,
    plateT: 0.22,
    spacing: compact ? 4.3 : 4.2,
    pressed: 0.26,
    xScale: compact ? 0.52 : 1,
    foot: compact ? 0.7 : 1,
    labelPad: compact ? 1.2 : 4.5,
    view: [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ],
  };
}

export const WIDE = makeDims(false);
export const COMPACT = makeDims(true);
/** Canvas width below which the scene uses COMPACT. */
export const COMPACT_BELOW = 640;

/** 0 for the bottom layer (disk), 3 for the top (apps). */
export const DEPTH = Object.fromEntries(
  LAYERS.map((l, i) => [l.id, LAYERS.length - 1 - i]),
) as Record<Layer, number>;

/** The stack splits about its middle: A and D move most, B and C least. */
const MID = (LAYERS.length - 1) / 2;
export const explodedY = (layer: Layer, d: Dims) =>
  (DEPTH[layer] - MID) * d.spacing;
export const pressedY = (layer: Layer, d: Dims) =>
  (DEPTH[layer] - MID) * d.pressed;

/** The box the camera frames: the open stack plus room for labels. */
export function fitBox(d: Dims): { min: number[]; max: number[] } {
  return {
    min: [
      -d.plateW / 2 - d.labelPad,
      explodedY("disk", d) - d.plateT / 2 - 0.3,
      -d.plateD / 2,
    ],
    max: [
      d.plateW / 2,
      explodedY("apps", d) + d.plateT / 2 + 1.6,
      d.plateD / 2,
    ],
  };
}

/** Fraction of the canvas the fit box fills. */
export const FIT_MARGIN = 0.9;

/**
 * Orthographic screen axes for a camera that looks along -view with world
 * up. Returns right and up unit vectors.
 */
export function screenAxes(d: Dims): { right: number[]; up: number[] } {
  const [vx, vy, vz] = d.view;
  // right = normalize(up x view), with up = (0, 1, 0)
  const rl = Math.hypot(vz, vx);
  const right = [vz / rl, 0, -vx / rl];
  // up' = view x right
  const up = [
    vy * right[2] - vz * right[1],
    vz * right[0] - vx * right[2],
    vx * right[1] - vy * right[0],
  ];
  return { right, up };
}

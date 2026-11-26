/**
 * Pure data prep for the WebGL topic map: packs points into typed arrays
 * and picks the point under the cursor. No three.js or React here, so
 * the tests run in Node.
 */
import type { EmbeddingPoint } from "@/types";

/** Radius of the sphere the points are scaled into. */
export const SCENE_RADIUS = 1;

export interface TopicStyle {
  id: number;
  /** CSS colour, e.g. "#10b981". */
  color: string;
}

export interface PackedPoints {
  /** xyz per point, centred and scaled to SCENE_RADIUS. */
  positions: Float32Array;
  /** rgb per point, 0..1. */
  colors: Float32Array;
  /** Cluster id per point, as a float for the shader. */
  clusters: Float32Array;
  /** 0..1 per point, varies the sprite size. */
  seeds: Float32Array;
  /** Index into the source array for each packed point. */
  sourceIndex: Uint32Array;
  /** Maps raw UMAP coordinates into scene space. */
  transform: SceneTransform;
}

export interface SceneTransform {
  cx: number;
  cy: number;
  cz: number;
  scale: number;
}

/** Parse "#rgb" / "#rrggbb" / "rgb(r, g, b)" into 0..1 floats. */
export function parseColor(css: string): [number, number, number] {
  const s = css.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const n = Number.parseInt(hex.slice(0, 6), 16);
    if (Number.isFinite(n)) {
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return [0.6, 0.6, 0.6];
}

/**
 * Centre on the median and scale so the 98th percentile radius lands on
 * SCENE_RADIUS. UMAP leaves a few far outliers; a max-based scale would
 * squash the rest into a dot.
 */
export function fitTransform(all: readonly EmbeddingPoint[]): SceneTransform {
  if (all.length === 0) return { cx: 0, cy: 0, cz: 0, scale: 1 };
  // A strided sample of 20k is plenty for a median and a percentile.
  const stride = Math.max(1, Math.floor(all.length / 20000));
  const points = stride === 1 ? all : all.filter((_, i) => i % stride === 0);
  const median = (pick: (p: EmbeddingPoint) => number) => {
    const values = Float64Array.from(points, pick).sort();
    return values[values.length >> 1];
  };
  const cx = median((p) => p.x);
  const cy = median((p) => p.y);
  const cz = median((p) => p.z);
  const radii = Float64Array.from(points, (p) =>
    Math.hypot(p.x - cx, p.y - cy, p.z - cz),
  ).sort();
  const r98 =
    radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.98))];
  return { cx, cy, cz, scale: r98 > 0 ? SCENE_RADIUS / r98 : 1 };
}

export function toScene(
  t: SceneTransform,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  // UMAP z is "up" in the old Plotly view; three.js uses y-up.
  return [(x - t.cx) * t.scale, (z - t.cz) * t.scale, -(y - t.cy) * t.scale];
}

/**
 * Pack points into GPU-ready arrays. Points whose cluster has no style
 * (e.g. hidden uncategorized) are left out.
 */
export function packPoints(
  points: readonly EmbeddingPoint[],
  styles: readonly TopicStyle[],
): PackedPoints {
  const rgb = new Map<number, [number, number, number]>();
  for (const s of styles) rgb.set(s.id, parseColor(s.color));

  const keep: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (rgb.has(points[i].cluster)) keep.push(i);
  }
  const transform = fitTransform(keep.map((i) => points[i]));
  const n = keep.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const clusters = new Float32Array(n);
  const seeds = new Float32Array(n);
  const sourceIndex = new Uint32Array(n);

  for (let k = 0; k < n; k++) {
    const i = keep[k];
    const p = points[i];
    const [x, y, z] = toScene(transform, p.x, p.y, p.z);
    positions[k * 3] = x;
    positions[k * 3 + 1] = y;
    positions[k * 3 + 2] = z;
    const c = rgb.get(p.cluster)!;
    colors[k * 3] = c[0];
    colors[k * 3 + 1] = c[1];
    colors[k * 3 + 2] = c[2];
    clusters[k] = p.cluster;
    seeds[k] = hash01(i);
    sourceIndex[k] = i;
  }
  return { positions, colors, clusters, seeds, sourceIndex, transform };
}

/** Cheap stable 0..1 hash so sizes don't shimmer between renders. */
function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export interface Ray {
  origin: [number, number, number];
  /** Unit vector. */
  dir: [number, number, number];
}

/**
 * Index of the point nearest the ray within `tanAngle` (the pick cone,
 * so the hit area stays the same size in pixels at any depth). Ties go to
 * the point nearest the camera. Points of other clusters are skipped
 * when `onlyCluster` is set. Returns -1 when nothing is in the cone.
 */
export function pickPoint(
  positions: Float32Array,
  clusters: Float32Array,
  ray: Ray,
  tanAngle: number,
  onlyCluster: number | null,
): number {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  const tan2 = tanAngle * tanAngle;
  let best = -1;
  let bestScore = Infinity;
  const n = clusters.length;
  for (let i = 0; i < n; i++) {
    if (onlyCluster !== null && clusters[i] !== onlyCluster) continue;
    const vx = positions[i * 3] - ox;
    const vy = positions[i * 3 + 1] - oy;
    const vz = positions[i * 3 + 2] - oz;
    const along = vx * dx + vy * dy + vz * dz;
    if (along <= 0) continue;
    const perp2 = vx * vx + vy * vy + vz * vz - along * along;
    const ratio = perp2 / (along * along);
    if (ratio > tan2) continue;
    // Angular miss first, small depth bias so front points win ties.
    const score = ratio / tan2 + along * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * One label anchor per cluster: the member point nearest the cluster's
 * mean. A plain mean can land in empty space between two lobes.
 */
export function clusterAnchors(
  positions: Float32Array,
  clusters: Float32Array,
): Map<number, [number, number, number]> {
  const sums = new Map<number, [number, number, number, number]>();
  const n = clusters.length;
  for (let i = 0; i < n; i++) {
    const id = clusters[i];
    let acc = sums.get(id);
    if (!acc) sums.set(id, (acc = [0, 0, 0, 0]));
    acc[0] += positions[i * 3];
    acc[1] += positions[i * 3 + 1];
    acc[2] += positions[i * 3 + 2];
    acc[3] += 1;
  }
  const best = new Map<number, { d: number; i: number }>();
  for (let i = 0; i < n; i++) {
    const id = clusters[i];
    const [sx, sy, sz, c] = sums.get(id)!;
    const d =
      (positions[i * 3] - sx / c) ** 2 +
      (positions[i * 3 + 1] - sy / c) ** 2 +
      (positions[i * 3 + 2] - sz / c) ** 2;
    const b = best.get(id);
    if (!b || d < b.d) best.set(id, { d, i });
  }
  const out = new Map<number, [number, number, number]>();
  for (const [id, { i }] of best) {
    out.set(id, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  }
  return out;
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Greedy label placement: walk labels in priority order and hide any that
 * overlaps one already shown. Returns a visibility flag per label.
 */
export function placeLabels(
  boxes: readonly (LabelBox | null)[],
  pad = 4,
): boolean[] {
  const shown: LabelBox[] = [];
  return boxes.map((b) => {
    if (!b) return false;
    const hit = shown.some(
      (o) =>
        Math.abs(o.x - b.x) * 2 < o.w + b.w + pad * 2 &&
        Math.abs(o.y - b.y) * 2 < o.h + b.h + pad * 2,
    );
    if (!hit) shown.push(b);
    return !hit;
  });
}

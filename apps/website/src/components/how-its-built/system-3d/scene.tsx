"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Edges,
  Html,
  Line,
  OrbitControls,
  RoundedBox,
} from "@react-three/drei";
import * as THREE from "three";
import {
  LAYERS,
  LAYER_BY_ID,
  STATIONS,
  STATION_BY_ID,
  TOURS,
  type Kind,
  type Layer,
  type Station,
  type Tour,
} from "./data";
import {
  COMPACT,
  COMPACT_BELOW,
  FIT_MARGIN,
  NEUTRAL,
  RIM_TINT,
  STEP_STYLE,
  WIDE,
  explodedY,
  fitBox,
  pressedY,
  type Dims,
} from "./layout";

/** Shared state. The wrapper writes it; the scene only reads it. */
export interface Sim {
  playing: boolean;
  /** Bumped by the wrapper to ask the scene for a jump to `jumpTo`. */
  jumpSeq: number;
  jumpTo: number;
  /** Bumped by the wrapper to refit the camera. */
  fitSeq: number;
  /** Target: 0 = layers pressed together, 1 = layers pulled apart. */
  explode: number;
}

export interface SceneProps {
  /** False while offscreen: the render loop stops. */
  active: boolean;
  sim: RefObject<Sim>;
  tour: Tour;
  stopIndex: number;
  selectedId: string | null;
  /** The layer whose detail panel is open. Its label brightens. */
  openLayer: Layer | null;
  reducedMotion: boolean;
  coarse: boolean;
  /** Bumped by the wrapper to request a frame. */
  wake: number;
  /** The packet reached step `index` of tour `tourId`. */
  onArrive: (tourId: string, index: number) => void;
  onSelect: (id: string) => void;
  /** A layer label was clicked. */
  onLayer: (id: Layer) => void;
  onJump: (index: number) => void;
  onRevealed: () => void;
  onFinish: () => void;
}

type Phase = "pressed" | "opening" | "open" | "closing";
type StationState = "off" | "upcoming" | "visited" | "current";

/* ------------------------------------------------------------ constants */

const ACCENT = "#ffb000";
const BG = "#0b0f0c";
const INK = "#ede7d6";
const INK2 = "#a8a294";

const DT_MAX = 1 / 20;
const OFF_H = 0.08; // height of an off-tour footprint tile
const OFF_FILL = 0.12;
const LEG_SAMPLES = 64;
/** Fill of a tour station the packet has not reached yet. */
const UPCOMING_FILL = 0.45;
/** Height of the step chips above a station's top face. */
const CHIP_Y = 0.85;
/** Pause at each via pad, in seconds. */
const PAD_PAUSE = 0.15;
/** Pressed slab stays on screen at least this long, in ms. */
const FIRST_HOLD = 450;

/** Seconds at each stop while playing, scaled by caption length. */
const dwellFor = (caption: string) =>
  Math.min(6, Math.max(3, 2.5 + 0.06 * caption.length));

/** Station shapes at wide size. XZ scales by `foot`. */
const SHAPE: Record<Kind, { h: number; halfD: number }> = {
  call: { h: 0.4, halfD: 0.7 },
  daemon: { h: 0.4, halfD: 0.85 * Math.cos(Math.PI / 6) },
  store: { h: 0.46, halfD: 0.75 },
};

const LAYER_INDEX = Object.fromEntries(
  LAYERS.map((l, i) => [l.id, i]),
) as Record<string, number>;
const plateTop = (s: Station, d: Dims) => explodedY(s.layer, d) + d.plateT / 2;
const vec = (v: number[]) => new THREE.Vector3(v[0], v[1], v[2]);

/* --------------------------------------------------------------- timing */

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Frame-rate independent smoothing toward a target. */
function damp(x: number, target: number, lambda: number, dt: number): number {
  return x + (target - x) * (1 - Math.exp(-lambda * dt));
}

/** Stations extrude from the center of each plate outward. */
const RANK = new Map<string, number>();
for (const l of LAYERS) {
  STATIONS.filter((s) => s.layer === l.id)
    .sort((a, b) => Math.abs(a.x) - Math.abs(b.x))
    .forEach((s, i) => RANK.set(s.id, i));
}

// The plates split together, about the stack's middle. Stations rise
// top-down once their plate is most of the way out.
const OPEN_HOLD = 150;
const PLATE_OPEN = 1200;
const STATION_OPEN = 280;
const STATION_STAGGER = 22;
const STATION_LAYER_STAGGER = 70;
const OVERLAY_FADE = 150;

const stationOpenStart = (s: Station) =>
  OPEN_HOLD +
  0.65 * PLATE_OPEN +
  STATION_LAYER_STAGGER * LAYER_INDEX[s.layer] +
  STATION_STAGGER * (RANK.get(s.id) ?? 0);
const OPEN_END = Math.max(
  ...STATIONS.map((s) => stationOpenStart(s) + STATION_OPEN),
);

const STATION_CLOSE_START = 150;
const STATION_CLOSE = 200;
const PLATE_CLOSE_START = 350;
const PLATE_CLOSE = 900;
const CLOSE_END = PLATE_CLOSE_START + PLATE_CLOSE;

/* ---------------------------------------------------------- screen math */

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Area two boxes share, with `pad` px of breathing room around `b`. */
function overlap(a: Box, b: Box, pad = 3): number {
  const w = Math.min(a.x1, b.x1 + pad) - Math.max(a.x0, b.x0 - pad);
  const h = Math.min(a.y1, b.y1 + pad) - Math.max(a.y0, b.y0 - pad);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Cost of a label box: overlap with obstacles, plus leaving the canvas. */
function cost(b: Box, obstacles: Box[], w: number, h: number): number {
  let c = 0;
  for (const o of obstacles) c += overlap(b, o);
  if (b.x0 < 2 || b.y0 < 2 || b.x1 > w - 2 || b.y1 > h - 2) c += 1e5;
  return c;
}

function chipBox(x: number, y: number, k: number): Box {
  const w = 18 * k + 11 * (k - 1);
  return { x0: x - w / 2, x1: x + w / 2, y0: y - 9, y1: y + 9 };
}

/** Projects a world point to canvas pixels, into `out`. */
function toScreen(
  p: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
  tmp: THREE.Vector3,
  out: { x: number; y: number },
) {
  tmp.copy(p).project(camera);
  out.x = ((tmp.x + 1) / 2) * size.width;
  out.y = ((1 - tmp.y) / 2) * size.height;
}

/** Screen boxes of the plate labels left of each plate. */
function plateLabelBoxes(
  d: Dims,
  camera: THREE.Camera,
  size: { width: number; height: number },
  tmp: THREE.Vector3,
  out: { x: number; y: number },
): Box[] {
  const at = new THREE.Vector3();
  return LAYERS.map((l) => {
    at.set(-d.plateW / 2 - 0.4, explodedY(l.id, d), d.plateD / 2);
    toScreen(at, camera, size, tmp, out);
    const w = d.compact ? 16 : 22 + 7.6 * l.label.length;
    return { x0: out.x - w, x1: out.x, y0: out.y - 8, y1: out.y + 8 };
  });
}

type NameSide = "right" | "left" | "above";

/** Where the current station's name sits, relative to its chip row. */
const NAME_STYLE: Record<NameSide, React.CSSProperties> = {
  right: {
    left: "100%",
    right: "auto",
    top: "50%",
    bottom: "auto",
    margin: "0 0 0 8px",
    transform: "translateY(-50%)",
  },
  left: {
    left: "auto",
    right: "100%",
    top: "50%",
    bottom: "auto",
    margin: "0 8px 0 0",
    transform: "translateY(-50%)",
  },
  above: {
    left: "50%",
    right: "auto",
    top: "auto",
    bottom: "100%",
    margin: "0 0 5px 0",
    transform: "translateX(-50%)",
  },
};

function placeName(el: HTMLElement, side: NameSide) {
  Object.assign(el.style, NAME_STYLE[side]);
}

/** A tour station's chip row, at its place in the open stack. */
interface ChipSpot {
  id: string;
  steps: number;
  pos: THREE.Vector3;
}

/** Label boxes the frame placed, shared between station and packet. */
interface Labels {
  name: Box | null;
}

/* ---------------------------------------------------------------- route */

interface Pad {
  pos: THREE.Vector3;
  /** Arc fraction where the packet passes the pad. */
  at: number;
}

interface Segment {
  a0: number;
  a1: number;
  dur: number;
}

interface Leg {
  curve: THREE.CurvePath<THREE.Vector3>;
  points: THREE.Vector3[];
  length: number;
  pads: Pad[];
  /** Eased runs between via pads, with a short pause at each pad. */
  segs: Segment[];
  /** Travel time in seconds, pauses included. */
  total: number;
}

/** Joins straight runs with rounded corners, like traces on a board. */
function fillet(
  pts: THREE.Vector3[],
  rMax: number,
): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let cur = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const dIn = c.clone().sub(pts[i - 1]);
    const dOut = pts[i + 1].clone().sub(c);
    const r = Math.min(rMax, dIn.length() / 2, dOut.length() / 2);
    dIn.normalize();
    dOut.normalize();
    if (dIn.dot(dOut) > 0.999) continue;
    const a = c.clone().addScaledVector(dIn, -r);
    const b = c.clone().addScaledVector(dOut, r);
    if (cur.distanceTo(a) > 1e-4) path.add(new THREE.LineCurve3(cur, a));
    path.add(new THREE.QuadraticBezierCurve3(a, c.clone(), b));
    cur = b;
  }
  path.add(new THREE.LineCurve3(cur, pts[pts.length - 1].clone()));
  return path;
}

function stationAt(tour: Tour, i: number): Station {
  return STATION_BY_ID.get(tour.stops[i].station)!;
}

/** Arc fraction along `leg` after `elapsed` seconds of travel. */
function legU(leg: Leg, elapsed: number): number {
  let t = elapsed;
  for (let i = 0; i < leg.segs.length; i++) {
    const s = leg.segs[i];
    if (t < s.dur) return s.a0 + (s.a1 - s.a0) * easeInOutCubic(t / s.dur);
    t -= s.dur;
    if (i < leg.segs.length - 1) {
      if (t < PAD_PAUSE) return s.a1;
      t -= PAD_PAUSE;
    }
  }
  return 1;
}

/**
 * Legs between consecutive stops, from the exploded layout. A leg leaves its
 * station toward the front, runs sideways on the source plate in its own
 * lane, then drops or climbs at the target's x. Lanes cycle in threes, so
 * neighbouring legs never share a run.
 */
function buildLegs(tour: Tour, d: Dims): Leg[] {
  const n = tour.stops.length;
  const footZ = 0.7 * d.foot + 0.15;
  const laneStep = d.compact ? 0.28 : 0.32;
  const legs: Leg[] = [];
  for (let k = 0; k < n - 1; k++) {
    const a = stationAt(tour, k);
    const b = stationAt(tour, k + 1);
    const yA = plateTop(a, d) + 0.02;
    const yB = plateTop(b, d) + 0.02;
    const xa = a.x * d.xScale;
    const xb = b.x * d.xScale;
    const lane = footZ + laneStep * (1 + (k % 3));
    const raw = [
      new THREE.Vector3(xa, yA, footZ),
      new THREE.Vector3(xa, yA, lane),
      new THREE.Vector3(xb, yA, lane),
      new THREE.Vector3(xb, yB, lane),
      new THREE.Vector3(xb, yB, footZ),
    ];
    const pts = raw.filter(
      (p, i) => i === 0 || p.distanceTo(raw[i - 1]) >= 0.01,
    );
    const curve = fillet(pts, 0.35);
    const points = curve.getSpacedPoints(LEG_SAMPLES - 1);
    const lo = Math.min(yA, yB);
    const hi = Math.max(yA, yB);
    const pads: Pad[] = [];
    for (const l of LAYERS) {
      const y = explodedY(l.id, d) + d.plateT / 2 + 0.02;
      if (!(lo < y - 1e-6 && y <= hi + 1e-6)) continue;
      const pos = new THREE.Vector3(xb, y - 0.008, lane);
      let best = 0;
      points.forEach((p, j) => {
        if (p.distanceToSquared(pos) < points[best].distanceToSquared(pos))
          best = j;
      });
      pads.push({ pos, at: best / (LEG_SAMPLES - 1) });
    }
    const length = curve.getLength();
    const dur = Math.min(1.8, Math.max(0.8, length / 11));
    const stops = [
      0,
      ...pads
        .map((p) => p.at)
        .filter((at) => at > 0.03 && at < 0.97)
        .sort((x, y) => x - y),
      1,
    ];
    const segs: Segment[] = [];
    for (let i = 1; i < stops.length; i++) {
      const a0 = stops[i - 1];
      const a1 = stops[i];
      segs.push({ a0, a1, dur: Math.max(0.25, dur * (a1 - a0)) });
    }
    const total =
      segs.reduce((t, s) => t + s.dur, 0) + PAD_PAUSE * (segs.length - 1);
    legs.push({ curve, points, length, pads, segs, total });
  }
  return legs;
}

/* ----------------------------------------------------------- shared refs */

interface World {
  ready: boolean;
  /** performance.now() at the first frame, or 0. */
  firstAt: number;
  time: number;
  target: number;
  start: number;
  plate: number[];
  plateFrom: number[];
  station: Record<string, number>;
  stationFrom: Record<string, number>;
  /** Route, chips, and packet visibility, 0..1. */
  overlay: number;
  overlayFrom: number;
  phase: Phase;
  emitted: Phase;
}

interface Motion {
  tourId: string;
  /** Stop the packet sits at, or is leaving. */
  from: number;
  traveling: boolean;
  /** Seconds into the current leg. */
  t: number;
  dwell: number;
  /** The leg started from autoplay, so Pause freezes it. */
  auto: boolean;
  jumpSeq: number;
  finished: boolean;
  /** Stop a cut is heading to, or -1. */
  cut: number;
  cutT: number;
  /** Packet opacity from cuts, 0..1. */
  fade: number;
  /** Seconds since the last arrival, or -1. */
  flash: number;
  tag: string;
}

/* --------------------------------------------------------------- plates */

interface PlateProps {
  layer: (typeof LAYERS)[number];
  d: Dims;
  phase: Phase;
  active: boolean;
  open: boolean;
  overlays: boolean;
  reducedMotion: boolean;
  worldRef: RefObject<World>;
  onLayer: (id: Layer) => void;
  children: React.ReactNode;
}

function Plate({
  layer,
  d,
  phase,
  active,
  open: detailOpen,
  overlays,
  reducedMotion,
  worldRef,
  onLayer,
  children,
}: PlateProps) {
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const edges = useRef<ComponentRef<typeof Edges>>(null);
  const rimRef = useRef<ComponentRef<typeof Line>>(null);
  const v = useRef({ fill: 0.06, hi: 0 });
  const label = useRef<HTMLButtonElement>(null);
  const colors = useMemo(
    () => ({
      neutral: new THREE.Color(NEUTRAL),
      layer: new THREE.Color(layer.color),
    }),
    [layer.color],
  );
  const li = LAYER_INDEX[layer.id];
  const yPressed = pressedY(layer.id, d);
  const yOpen = explodedY(layer.id, d);

  useFrame((state, raw) => {
    const dt = Math.min(raw, DT_MAX);
    const w = worldRef.current;
    const s = v.current;
    const open = phase === "open";
    const fT = open ? (active ? 0.1 : 0.035) : 0.06;
    const hT = open && active ? 1 : 0;
    if (reducedMotion) {
      s.fill = fT;
      s.hi = hT;
    } else {
      s.fill = damp(s.fill, fT, 6, dt);
      s.hi = damp(s.hi, hT, 6, dt);
      if (Math.abs(s.fill - fT) > 0.002 || Math.abs(s.hi - hT) > 0.004)
        state.invalidate();
    }
    if (group.current)
      group.current.position.y = THREE.MathUtils.lerp(
        yPressed,
        yOpen,
        w.plate[li] ?? 0,
      );
    if (fill.current) fill.current.opacity = s.fill;
    if (edges.current)
      edges.current.material.color
        .copy(colors.neutral)
        .lerp(colors.layer, 0.85 * s.hi);
    if (rimRef.current)
      rimRef.current.material.color
        .copy(colors.neutral)
        .lerp(colors.layer, RIM_TINT + (1 - RIM_TINT) * s.hi);
    // Pressed labels would pile up. Each upper label fades in as its plate
    // moves out. The bottom label always shows.
    if (label.current) {
      const k =
        li === LAYERS.length - 1
          ? 1
          : clamp01(((w.plate[li] ?? 0) - 0.15) / 0.5);
      label.current.style.opacity = String(k);
      // A faded label takes no clicks.
      label.current.style.pointerEvents = k > 0.5 ? "auto" : "none";
    }
  });

  const rim = useMemo(
    () => [
      new THREE.Vector3(-d.plateW / 2, d.plateT / 2, d.plateD / 2),
      new THREE.Vector3(d.plateW / 2, d.plateT / 2, d.plateD / 2),
    ],
    [d],
  );

  return (
    <group ref={group} position={[0, yPressed, 0]}>
      <mesh raycast={() => null}>
        <boxGeometry args={[d.plateW, d.plateT, d.plateD]} />
        <meshBasicMaterial
          ref={fill}
          color={layer.color}
          transparent
          opacity={0.06}
          depthWrite={false}
        />
        <Edges ref={edges} color={NEUTRAL} />
      </mesh>
      <Line
        ref={rimRef}
        points={rim}
        color={layer.color}
        lineWidth={1.5}
        raycast={() => null}
      />
      {overlays && (
        <Html
          position={[-d.plateW / 2 - 0.4, 0, d.plateD / 2]}
          zIndexRange={[15, 10]}
        >
          {/* A pointer-only twin of the panel's layer switcher. It never
              takes focus, so the figure keeps its arrow keys. */}
          <button
            ref={label}
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onLayer(layer.id);
            }}
            style={{
              opacity: li === LAYERS.length - 1 ? 1 : 0,
              pointerEvents: li === LAYERS.length - 1 ? "auto" : "none",
            }}
            className="group -m-1.5 flex -translate-x-full -translate-y-1/2 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[3px] p-1.5 font-jetbrains"
          >
            <span
              className="flex h-4 w-4 items-center justify-center rounded-[2px] text-[10px] font-bold leading-none"
              style={{ background: layer.color, color: BG }}
            >
              {layer.letter}
            </span>
            {!d.compact && (
              <span
                className={`text-[10px] uppercase leading-none tracking-[0.16em] transition-colors group-hover:!text-[#ede7d6] ${
                  detailOpen ? "underline decoration-1 underline-offset-4" : ""
                }`}
                style={{ color: detailOpen ? INK : INK2 }}
              >
                {layer.label}
              </span>
            )}
          </button>
        </Html>
      )}
      <group position={[0, d.plateT / 2, 0]}>{children}</group>
    </group>
  );
}

/* ------------------------------------------------------------- stations */

interface StationProps {
  station: Station;
  d: Dims;
  state: StationState;
  /** Step indices where the tour stops here, or null when off tour. */
  steps: number[] | null;
  stopIndex: number;
  selected: boolean;
  phase: Phase;
  reducedMotion: boolean;
  fine: boolean;
  overlays: boolean;
  chips: ChipSpot[];
  worldRef: RefObject<World>;
  labelsRef: RefObject<Labels>;
  onSelect: (id: string) => void;
  onJump: (index: number) => void;
}

function StationNode({
  station,
  d,
  state,
  steps,
  stopIndex,
  selected,
  phase,
  reducedMotion,
  fine,
  overlays,
  chips,
  worldRef,
  labelsRef,
  onSelect,
  onJump,
}: StationProps) {
  const layer = LAYER_BY_ID.get(station.layer)!;
  const shape = SHAPE[station.kind];
  const f = d.foot;
  const lift = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const edges = useRef<ComponentRef<typeof Edges>>(null);
  const nameEl = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const offScale = OFF_H / shape.h;
  const fillFor = (st: StationState) =>
    st === "off" ? OFF_FILL : st === "upcoming" ? UPCOMING_FILL : 1;
  const v = useRef({
    h: state === "off" ? offScale : 1,
    fill: fillFor(state),
    edge: state === "off" ? 0 : 0.6,
    glow: 0,
    lift: 0,
    side: "" as NameSide | "",
  });
  const scratch = useMemo(
    () => ({ tmp: new THREE.Vector3(), a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }),
    [],
  );

  const box = useMemo(
    () => new THREE.BoxGeometry(1.6 * f, shape.h, 1.4 * f),
    [f, shape.h],
  );
  useEffect(() => () => box.dispose(), [box]);

  const shown = phase === "open";
  const isCurrent = state === "current";
  const preferRight = station.x * d.xScale < d.plateW / 2 - 3.5;

  useFrame((frame, raw) => {
    const dt = Math.min(raw, DT_MAX);
    const w = worldRef.current;
    const s = v.current;
    const t = w.station[station.id] ?? 0;
    const hT = state === "off" ? offScale : 1;
    const fT = fillFor(state);
    const eBase = state === "off" ? 0 : state === "upcoming" ? 0.6 : 0.9;
    const eT = Math.min(1, eBase + (hover && state !== "off" ? 0.2 : 0));
    const gT = isCurrent ? 0.45 : 0;
    const lT = (isCurrent ? 0.2 : 0) + (hover || selected ? 0.12 : 0);
    if (reducedMotion) {
      s.h = hT;
      s.fill = fT;
      s.edge = eT;
      s.glow = gT;
      s.lift = isCurrent ? 0.2 : 0;
    } else {
      s.h = damp(s.h, hT, 10, dt);
      s.fill = damp(s.fill, fT, 6, dt);
      s.edge = damp(s.edge, eT, 6, dt);
      s.glow = damp(s.glow, gT, 6, dt);
      s.lift = damp(s.lift, lT, 10, dt);
      if (
        Math.abs(s.h - hT) > 0.002 ||
        Math.abs(s.fill - fT) > 0.003 ||
        Math.abs(s.edge - eT) > 0.004 ||
        Math.abs(s.glow - gT) > 0.003 ||
        Math.abs(s.lift - lT) > 0.002
      ) {
        frame.invalidate();
      }
    }
    if (body.current) {
      body.current.visible = t > 0.001;
      body.current.scale.y = Math.max(1e-4, t * s.h);
    }
    if (lift.current) lift.current.position.y = s.lift;
    if (mat.current) {
      mat.current.opacity = s.fill;
      mat.current.depthWrite = s.fill > 0.5;
      mat.current.emissiveIntensity = s.glow;
    }
    if (edges.current) {
      edges.current.material.opacity = s.edge;
      edges.current.visible = s.edge > 0.01;
    }

    // Name: put it on the side away from other chips.
    const el = nameEl.current;
    if (!el || !isCurrent || !shown) {
      if (isCurrent) labelsRef.current.name = null;
      return;
    }
    const me = chips.find((c) => c.id === station.id);
    if (!me) return;
    const { camera, size } = frame;
    toScreen(me.pos, camera, size, scratch.tmp, scratch.a);
    const mine = chipBox(scratch.a.x, scratch.a.y, me.steps);
    const others = plateLabelBoxes(d, camera, size, scratch.tmp, scratch.b);
    for (const c of chips) {
      if (c.id === station.id) continue;
      toScreen(c.pos, camera, size, scratch.tmp, scratch.b);
      others.push(chipBox(scratch.b.x, scratch.b.y, c.steps));
    }
    const nameW = 6.8 * station.label.length;
    const right: Box = {
      x0: mine.x1 + 8,
      x1: mine.x1 + 8 + nameW,
      y0: scratch.a.y - 7,
      y1: scratch.a.y + 7,
    };
    const left: Box = {
      x0: mine.x0 - 8 - nameW,
      x1: mine.x0 - 8,
      y0: right.y0,
      y1: right.y1,
    };
    const above: Box = {
      x0: scratch.a.x - nameW / 2,
      x1: scratch.a.x + nameW / 2,
      y0: mine.y0 - 5 - 12,
      y1: mine.y0 - 5,
    };
    // Beside the chips first, on the preferred side. Above them as a last
    // resort, when both sides are crowded.
    const order: [NameSide, Box][] = preferRight
      ? [
          ["right", right],
          ["left", left],
          ["above", above],
        ]
      : [
          ["left", left],
          ["right", right],
          ["above", above],
        ];
    let side = order[0][0];
    let best = Infinity;
    for (const [name, b] of order) {
      const c = cost(b, others, size.width, size.height);
      if (c < best - 1) {
        best = c;
        side = name;
        labelsRef.current.name = b;
      }
      if (c === 0) break;
    }
    if (side !== s.side) {
      s.side = side;
      placeName(el, side);
    }
  });

  const material = (
    <meshStandardMaterial
      ref={mat}
      color={layer.color}
      emissive={ACCENT}
      emissiveIntensity={0}
      roughness={0.55}
      metalness={0.05}
      transparent
    />
  );
  const edgeColor = isCurrent ? ACCENT : layer.color;

  const pointer = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect(station.id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
      (e.nativeEvent.target as HTMLElement | null)?.style.setProperty(
        "cursor",
        "pointer",
      );
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      setHover(false);
      (e.nativeEvent.target as HTMLElement | null)?.style.removeProperty(
        "cursor",
      );
    },
  };

  return (
    <group position={[station.x * d.xScale, 0, 0]}>
      <group ref={lift}>
        <group ref={body} scale={[1, 1e-4, 1]} visible={false} {...pointer}>
          {station.kind === "call" ? (
            <RoundedBox
              args={[1.6 * f, shape.h, 1.4 * f]}
              radius={0.06}
              position={[0, shape.h / 2, 0]}
            >
              {material}
              <Edges ref={edges} geometry={box} color={edgeColor} transparent />
            </RoundedBox>
          ) : station.kind === "daemon" ? (
            <mesh position={[0, shape.h / 2, 0]} rotation={[0, Math.PI / 6, 0]}>
              <cylinderGeometry args={[0.85 * f, 0.85 * f, shape.h, 6]} />
              {material}
              <Edges ref={edges} color={edgeColor} transparent />
            </mesh>
          ) : (
            <mesh position={[0, shape.h / 2, 0]}>
              <cylinderGeometry args={[0.75 * f, 0.75 * f, shape.h, 32]} />
              {material}
              <Edges ref={edges} color={edgeColor} transparent />
            </mesh>
          )}
        </group>
      </group>

      {steps && overlays && (
        <Html position={[0, shape.h + CHIP_Y, 0]} center zIndexRange={[40, 20]}>
          <div
            className="pointer-events-none relative font-jetbrains"
            style={{
              opacity: shown ? 1 : 0,
              transform: `scale(${shown ? 1 : 0.6})`,
              transition: reducedMotion
                ? "none"
                : "opacity 180ms ease-out, transform 180ms ease-out",
              transitionDelay:
                shown && !reducedMotion ? `${40 * steps[0]}ms` : "0ms",
            }}
          >
            <div
              className="flex items-center gap-[3px] rounded-full"
              style={{ background: "rgba(11,15,12,0.75)" }}
            >
              {steps.map((i, j) => (
                <span key={i} className="flex items-center gap-[3px]">
                  {j > 0 && (
                    <span
                      className="text-[10px] leading-none"
                      style={{ color: INK2 }}
                    >
                      ·
                    </span>
                  )}
                  <ChipNumber
                    n={i + 1}
                    state={
                      i === stopIndex
                        ? "current"
                        : i < stopIndex
                          ? "done"
                          : "upcoming"
                    }
                    interactive={shown}
                    onClick={() => onJump(i)}
                  />
                </span>
              ))}
            </div>
            {isCurrent && (
              <div
                ref={nameEl}
                className="absolute whitespace-nowrap text-[11px] leading-none"
                style={{
                  ...NAME_STYLE[preferRight ? "right" : "left"],
                  color: INK,
                  fontWeight: 600,
                  textShadow: `0 0 4px ${BG}, 0 0 2px ${BG}`,
                }}
              >
                {station.label}
              </div>
            )}
          </div>
        </Html>
      )}

      {!steps && hover && fine && overlays && (
        <Html position={[0, 0.6, 0]} center zIndexRange={[70, 60]}>
          <div
            className="pointer-events-none whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-jetbrains text-[10px] leading-none"
            style={{
              color: INK,
              background: BG,
              borderColor: "rgba(237,231,214,0.2)",
            }}
          >
            {station.label}
          </div>
        </Html>
      )}
    </group>
  );
}

function ChipNumber({
  n,
  state,
  interactive,
  onClick,
}: {
  n: number;
  state: "current" | "done" | "upcoming";
  interactive: boolean;
  onClick: () => void;
}) {
  const style: React.CSSProperties = {
    ...STEP_STYLE[state],
    ...(state === "upcoming" ? { background: BG } : null),
    transform: state === "current" ? "scale(1.15)" : undefined,
  };
  // A pointer-only twin of the rail. It never takes focus, so the figure
  // keeps its arrow keys.
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-[9px] border px-1 text-[10px] font-semibold leading-none tabular-nums transition-[background-color,color,border-color,transform] duration-200 ${
        interactive ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={style}
    >
      {n}
    </button>
  );
}

/* ---------------------------------------------------------------- route */

interface RouteProps {
  legsByTour: Map<string, Leg[]>;
  tour: Tour;
  worldRef: RefObject<World>;
  motionRef: RefObject<Motion>;
}

const BG_COLOR = new THREE.Color(BG);
const ACCENT_COLOR = new THREE.Color(ACCENT);
const PAD_GEOMETRY = new THREE.RingGeometry(0.16, 0.26, 24);

/** Wire weight by age: the current leg, the one before, and older legs. */
const WIRE = { current: 1, previous: 0.55, older: 0.25 };

function Route({ legsByTour, tour, worldRef, motionRef }: RouteProps) {
  const lines = useRef<Record<string, ComponentRef<typeof Line> | null>>({});
  const pads = useRef<Record<string, THREE.MeshBasicMaterial | null>>({});
  const v = useRef<Record<string, number>>({});

  useFrame((state, raw) => {
    const dt = Math.min(raw, DT_MAX);
    const w = worldRef.current;
    const m = motionRef.current;
    const store = v.current;
    const moving = m.traveling && m.cut < 0;
    // The leg that is drawing now, or the one that just arrived.
    const cur = moving ? m.from : (m.cut >= 0 ? m.cut : m.from) - 1;
    for (const [tourId, legs] of legsByTour) {
      const mine = tourId === tour.id && m.tourId === tour.id;
      const u = mine && moving ? legU(legs[m.from], m.t) : 0;
      legs.forEach((leg, k) => {
        const key = `${tourId}:${k}`;
        const line = lines.current[key];
        const weight =
          k === cur
            ? WIRE.current
            : k === cur - 1
              ? WIRE.previous
              : k < cur - 1
                ? WIRE.older
                : 0;
        let opacity = store[key] ?? 0;
        if (mine) {
          opacity = weight * w.overlay;
        } else if (opacity > 0) {
          opacity = Math.max(0, opacity - dt / 0.25);
          state.invalidate();
        }
        store[key] = opacity;
        if (line) {
          // Opaque lines with a blended color. Transparent Line2 segments
          // overlap at the joints and show as beads.
          line.visible = opacity > 0.003;
          line.material.color.copy(BG_COLOR).lerp(ACCENT_COLOR, opacity);
          line.material.linewidth = mine && k === cur ? 2.5 : 1.5;
          line.geometry.instanceCount =
            mine && moving && k === m.from
              ? Math.round(u * (LEG_SAMPLES - 1))
              : LEG_SAMPLES - 1;
        }
        leg.pads.forEach((pad, j) => {
          const pk = `${key}:${j}`;
          const lit = !moving || k !== m.from || u >= pad.at;
          const target = mine && lit ? 0.9 * weight * w.overlay : 0;
          const prev = store[pk] ?? 0;
          const next = damp(prev, target, 8, dt);
          store[pk] = Math.abs(next - target) < 0.003 ? target : next;
          if (store[pk] !== target) state.invalidate();
          const mat = pads.current[pk];
          if (mat) {
            mat.opacity = store[pk];
            mat.visible = store[pk] > 0.003;
          }
        });
      });
    }
  });

  return (
    <group>
      {[...legsByTour].map(([tourId, legs]) =>
        legs.map((leg, k) => {
          const key = `${tourId}:${k}`;
          return (
            <group key={key}>
              <Line
                ref={(l) => {
                  lines.current[key] = l;
                }}
                points={leg.points}
                color={ACCENT}
                lineWidth={1.5}
                depthWrite={false}
                raycast={() => null}
              />
              {leg.pads.map((pad, j) => (
                <mesh
                  key={j}
                  position={pad.pos}
                  rotation={[-Math.PI / 2, 0, 0]}
                  geometry={PAD_GEOMETRY}
                  raycast={() => null}
                >
                  <meshBasicMaterial
                    ref={(mat) => {
                      pads.current[`${key}:${j}`] = mat;
                    }}
                    color={ACCENT}
                    transparent
                    opacity={0}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                    visible={false}
                  />
                </mesh>
              ))}
            </group>
          );
        }),
      )}
    </group>
  );
}

/* --------------------------------------------------------------- packet */

interface PacketProps {
  legs: Leg[];
  tour: Tour;
  d: Dims;
  overlays: boolean;
  reducedMotion: boolean;
  chips: ChipSpot[];
  worldRef: RefObject<World>;
  motionRef: RefObject<Motion>;
  labelsRef: RefObject<Labels>;
}

const FLASH_HALO = 0.38;
const FLASH_RING = 0.9;
const PILL_FADE = 0.15;

function Packet({
  legs,
  tour,
  d,
  overlays,
  reducedMotion,
  chips,
  worldRef,
  motionRef,
  labelsRef,
}: PacketProps) {
  const group = useRef<THREE.Group>(null);
  const ball = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const pill = useRef<HTMLDivElement>(null);
  const pillText = useRef<HTMLSpanElement>(null);
  const label = useRef({ shown: "", swapT: -1, place: "" });
  const scratch = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      p: { x: 0, y: 0 },
      q: { x: 0, y: 0 },
    }),
    [],
  );

  const glow = useMemo(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    g.addColorStop(0, "rgba(255,176,0,0.55)");
    g.addColorStop(1, "rgba(255,176,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => glow.dispose(), [glow]);

  useFrame((state, raw) => {
    const dt = Math.min(raw, DT_MAX);
    const w = worldRef.current;
    const m = motionRef.current;
    const n = tour.stops.length;
    if (m.tourId !== tour.id || !legs.length) return;
    const tmp = scratch.pos;

    // Position: on the current leg while traveling, else at the stop.
    if (m.traveling) {
      legs[m.from].curve.getPointAt(legU(legs[m.from], m.t), tmp);
    } else if (m.from < n - 1) {
      tmp.copy(legs[m.from].points[0]);
    } else {
      tmp.copy(legs[n - 2].points[LEG_SAMPLES - 1]);
    }
    const opacity = w.overlay * m.fade;
    const g = group.current;
    if (g) {
      g.position.set(tmp.x, tmp.y + 0.2, tmp.z);
      g.visible = opacity > 0.01;
    }
    if (ball.current) ball.current.opacity = opacity;
    if (halo.current) {
      const k =
        m.flash >= 0 && m.flash < FLASH_HALO
          ? Math.sin((Math.PI * m.flash) / FLASH_HALO)
          : 0;
      halo.current.scale.setScalar(1.2 + 0.8 * k);
      halo.current.material.opacity = opacity;
    }

    // Arrival ring under the station.
    const r = ring.current;
    if (r && ringMat.current) {
      const on = m.flash >= 0 && m.flash < FLASH_RING && !m.traveling;
      r.visible = on;
      if (on) {
        const s = stationAt(tour, m.from);
        const k = m.flash / FLASH_RING;
        r.position.set(s.x * d.xScale, plateTop(s, d) + 0.015, 0);
        r.scale.setScalar(d.foot * (1 + 0.6 * k));
        ringMat.current.opacity = 0.5 * (1 - k) * w.overlay;
      }
    }

    // Cargo pill: crossfade when the tag changes.
    const l = label.current;
    if (pill.current) pill.current.style.opacity = String(opacity);
    if (pillText.current) {
      if (l.shown === "" || pillText.current.textContent === "") {
        l.shown = m.tag;
        pillText.current.textContent = m.tag;
      } else if (m.tag !== l.shown && l.swapT < 0) {
        l.swapT = 0;
        pillText.current.style.opacity = "0";
      }
      if (l.swapT >= 0) {
        l.swapT += dt;
        state.invalidate();
        if (l.swapT >= PILL_FADE) {
          l.shown = m.tag;
          l.swapT = -1;
          pillText.current.textContent = m.tag;
          pillText.current.style.opacity = "1";
        }
      }
    }

    // Pill placement: below the packet, unless a chip or name is there.
    const el = pill.current;
    if (!el || !g) return;
    const { camera, size } = state;
    const P = scratch.p;
    toScreen(g.position, camera, size, scratch.tmp, P);
    const pw = 6.2 * m.tag.length + 14;
    const ph = 16;
    let place = "below";
    let box: Box = {
      x0: P.x - pw / 2,
      x1: P.x + pw / 2,
      y0: P.y + 11,
      y1: P.y + 11 + ph,
    };
    if (!m.traveling && m.cut < 0 && w.phase === "open") {
      const obstacles = plateLabelBoxes(
        d,
        camera,
        size,
        scratch.tmp,
        scratch.q,
      );
      let C: { x: number; y: number } | null = null;
      const here = tour.stops[m.from].station;
      for (const c of chips) {
        toScreen(c.pos, camera, size, scratch.tmp, scratch.q);
        obstacles.push(chipBox(scratch.q.x, scratch.q.y, c.steps));
        if (c.id === here) C = { x: scratch.q.x, y: scratch.q.y };
      }
      const name = labelsRef.current.name;
      if (name) obstacles.push(name);
      const cands: [string, Box][] = [["below", box]];
      if (C)
        cands.push([
          "above",
          {
            x0: C.x - pw / 2,
            x1: C.x + pw / 2,
            y0: C.y - 14 - ph,
            y1: C.y - 14,
          },
        ]);
      cands.push([
        "left",
        { x0: P.x - 12 - pw, x1: P.x - 12, y0: P.y - ph / 2, y1: P.y + ph / 2 },
      ]);
      cands.push([
        "right",
        { x0: P.x + 12, x1: P.x + 12 + pw, y0: P.y - ph / 2, y1: P.y + ph / 2 },
      ]);
      let best = Infinity;
      for (const [name, b] of cands) {
        const c = cost(b, obstacles, size.width, size.height);
        if (c < best - 1) {
          best = c;
          place = name;
          box = b;
        }
        if (c === 0) break;
      }
    }
    if (place !== l.place || place === "above") {
      l.place = place;
      el.style.transform = `translate(${Math.round(box.x0 - P.x)}px, ${Math.round(box.y0 - P.y)}px)`;
    }
  });

  return (
    <>
      <group ref={group} visible={false}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.2, 20, 16]} />
          <meshBasicMaterial
            ref={ball}
            color={ACCENT}
            toneMapped={false}
            transparent
          />
        </mesh>
        <sprite ref={halo} scale={1.2} raycast={() => null}>
          <spriteMaterial
            map={glow}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            transparent
            toneMapped={false}
          />
        </sprite>
        {overlays && (
          <Html zIndexRange={[60, 50]}>
            <div
              ref={pill}
              className="pointer-events-none whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-jetbrains text-[10px] leading-none"
              style={{
                color: ACCENT,
                borderColor: ACCENT,
                background: "rgba(11,15,12,0.9)",
                opacity: 0,
                transition: reducedMotion ? "none" : "transform 160ms ease-out",
              }}
            >
              <span
                ref={pillText}
                style={{ transition: `opacity ${PILL_FADE * 1000}ms linear` }}
              />
            </div>
          </Html>
        )}
      </group>
      <mesh
        ref={ring}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        raycast={() => null}
      >
        <ringGeometry args={[1, 1.06, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color={ACCENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

/* --------------------------------------------------------------- camera */

function CameraRig({
  d,
  sim,
  coarse,
}: {
  d: Dims;
  sim: RefObject<Sim>;
  coarse: boolean;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const seen = useRef("");
  const scratch = useMemo(
    () => ({ corner: new THREE.Vector3(), view: new THREE.Vector3() }),
    [],
  );

  useFrame(({ camera, size }) => {
    const c = controls.current;
    const key = `${size.width}x${size.height}:${sim.current.fitSeq}:${d.compact}`;
    if (!c || key === seen.current) return;
    seen.current = key;

    const box = fitBox(d);
    const min = vec(box.min);
    const max = vec(box.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    const view = scratch.view.set(d.view[0], d.view[1], d.view[2]);

    camera.position.copy(center).addScaledVector(view, 100);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const corner = scratch.corner;
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? max.x : min.x,
        i & 2 ? max.y : min.y,
        i & 4 ? max.z : min.z,
      );
      corner.applyMatrix4(camera.matrixWorldInverse);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom =
      FIT_MARGIN * Math.min(size.width / (x1 - x0), size.height / (y1 - y0));
    cam.updateProjectionMatrix();
    c.target.copy(center);
    c.update();
  });

  // Small turns only: the figure always reads as a stack.
  const az = Math.atan2(d.view[0], d.view[2]);
  const polar = Math.acos(d.view[1]);
  const azR = THREE.MathUtils.degToRad(10);
  const polR = THREE.MathUtils.degToRad(6);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      enableZoom={false}
      enableRotate={!coarse}
      minAzimuthAngle={az - azR}
      maxAzimuthAngle={az + azR}
      minPolarAngle={polar - polR}
      maxPolarAngle={polar + polR}
    />
  );
}

/* ---------------------------------------------------------------- stage */

function stationState(
  steps: number[] | undefined,
  stopIndex: number,
): StationState {
  if (!steps) return "off";
  if (steps.includes(stopIndex)) return "current";
  if (steps.some((i) => i < stopIndex)) return "visited";
  return "upcoming";
}

function Stage({
  sim,
  tour,
  stopIndex,
  selectedId,
  openLayer,
  reducedMotion,
  coarse,
  wake,
  onArrive,
  onSelect,
  onLayer,
  onJump,
  onRevealed,
  onFinish,
}: Omit<SceneProps, "active">) {
  const width = useThree((s) => s.size.width);
  const invalidate = useThree((s) => s.invalidate);
  const compact = width < COMPACT_BELOW;
  const d = compact ? COMPACT : WIDE;
  const [phase, setPhase] = useState<Phase>("pressed");
  /**
   * Html overlays mount after the first frame. Before that, drei's Html can
   * swap its portal target and drop the first overlay's content.
   */
  const [overlays, setOverlays] = useState(false);
  const si = Math.min(stopIndex, tour.stops.length - 1);

  const worldRef = useRef<World>({
    ready: false,
    firstAt: 0,
    time: 0,
    target: 0,
    start: 0,
    plate: LAYERS.map(() => 0),
    plateFrom: LAYERS.map(() => 0),
    station: {},
    stationFrom: {},
    overlay: 0,
    overlayFrom: 0,
    phase: "pressed",
    emitted: "pressed",
  });
  const motionRef = useRef<Motion>({
    tourId: "",
    from: 0,
    traveling: false,
    t: 0,
    dwell: 3,
    auto: false,
    jumpSeq: 0,
    finished: false,
    cut: -1,
    cutT: 0,
    fade: 0,
    flash: -1,
    tag: "",
  });
  const labelsRef = useRef<Labels>({ name: null });

  const legsByTour = useMemo(() => {
    const dims = compact ? COMPACT : WIDE;
    return new Map(TOURS.map((t) => [t.id, buildLegs(t, dims)]));
  }, [compact]);
  const legs = legsByTour.get(tour.id) ?? [];

  const stepsById = useMemo(() => {
    const map = new Map<string, number[]>();
    tour.stops.forEach((s, i) =>
      map.set(s.station, [...(map.get(s.station) ?? []), i]),
    );
    return map;
  }, [tour]);

  const chips = useMemo<ChipSpot[]>(() => {
    const dims = compact ? COMPACT : WIDE;
    return [...stepsById].map(([id, steps]) => {
      const s = STATION_BY_ID.get(id)!;
      return {
        id,
        steps: steps.length,
        pos: new THREE.Vector3(
          s.x * dims.xScale,
          plateTop(s, dims) + SHAPE[s.kind].h + CHIP_Y,
          0,
        ),
      };
    });
  }, [stepsById, compact]);

  useEffect(() => {
    invalidate();
  }, [wake, tour, stopIndex, selectedId, compact, invalidate]);

  // Conductor: the reveal timeline and the packet's motion. Runs first.
  useFrame((state, raw) => {
    const dt = Math.min(raw, DT_MAX);
    const w = worldRef.current;
    const m = motionRef.current;
    w.time += dt;

    const now = performance.now();
    if (!w.firstAt) w.firstAt = now;
    const wantOpen = sim.current.explode >= 0.5;
    // Readers always see the closed slab first, then the split.
    const holding = !reducedMotion && now - w.firstAt < FIRST_HOLD;
    if (wantOpen && holding && w.target === 0) state.invalidate();
    const target = wantOpen && !(holding && w.target === 0) ? 1 : 0;
    const snap = (t: number) => {
      w.plate = LAYERS.map(() => t);
      for (const s of STATIONS) w.station[s.id] = t;
      w.overlay = t;
      w.phase = t ? "open" : "pressed";
    };

    if (!w.ready) {
      w.ready = true;
      if (reducedMotion) {
        w.target = target;
        snap(target);
      } else {
        snap(0);
      }
    }

    if (target !== w.target) {
      w.target = target;
      w.start = w.time;
      w.plateFrom = [...w.plate];
      w.stationFrom = { ...w.station };
      w.overlayFrom = w.overlay;
      w.phase = target ? "opening" : "closing";
      if (reducedMotion) snap(target);
    }

    if (
      w.phase === "opening" ||
      w.phase === "closing" ||
      (w.phase === "open" && w.overlay < 1)
    ) {
      const e = (w.time - w.start) * 1000;
      state.invalidate();
      if (w.target === 1) {
        const r = easeOutQuint(clamp01((e - OPEN_HOLD) / PLATE_OPEN));
        LAYERS.forEach((_, i) => {
          w.plate[i] = THREE.MathUtils.lerp(w.plateFrom[i], 1, r);
        });
        for (const s of STATIONS) {
          const k = clamp01((e - stationOpenStart(s)) / STATION_OPEN);
          w.station[s.id] = THREE.MathUtils.lerp(
            w.stationFrom[s.id] ?? 0,
            1,
            easeOutCubic(k),
          );
        }
        if (e >= OPEN_END) {
          w.phase = "open";
          w.overlay = THREE.MathUtils.lerp(
            w.overlayFrom,
            1,
            clamp01((e - OPEN_END) / OVERLAY_FADE),
          );
        }
      } else {
        w.overlay = THREE.MathUtils.lerp(
          w.overlayFrom,
          0,
          clamp01(e / OVERLAY_FADE),
        );
        for (const s of STATIONS) {
          const k = clamp01((e - STATION_CLOSE_START) / STATION_CLOSE);
          w.station[s.id] = THREE.MathUtils.lerp(
            w.stationFrom[s.id] ?? 0,
            0,
            easeInOutCubic(k),
          );
        }
        const r = easeInOutCubic(
          clamp01((e - PLATE_CLOSE_START) / PLATE_CLOSE),
        );
        LAYERS.forEach((_, i) => {
          w.plate[i] = THREE.MathUtils.lerp(w.plateFrom[i], 0, r);
        });
        if (e >= CLOSE_END) w.phase = "pressed";
      }
    }

    if (!overlays) setOverlays(true);
    if (w.phase !== w.emitted) {
      w.emitted = w.phase;
      setPhase(w.phase);
      if (w.phase === "open") onRevealed();
    }

    // ---- packet motion
    const n = tour.stops.length;
    const tourLegs = legsByTour.get(tour.id);
    if (!tourLegs) return;
    const dwell = (i: number) => dwellFor(tour.stops[i].caption);
    if (m.tourId !== tour.id) {
      m.tourId = tour.id;
      m.from = si;
      m.traveling = false;
      m.t = 0;
      m.dwell = dwell(m.from);
      m.auto = false;
      m.jumpSeq = sim.current.jumpSeq;
      m.finished = false;
      m.cut = -1;
      m.fade = reducedMotion ? 1 : 0;
      m.flash = -1;
      m.tag = tour.stops[m.from].tag;
    }
    const open = w.phase === "open";
    const playing = sim.current.playing;

    const arrive = (i: number) => onArrive(tour.id, i);
    const arriveAt = (i: number) => {
      m.from = i;
      m.traveling = false;
      m.t = 0;
      m.dwell = dwell(i);
      m.finished = false;
      m.tag = tour.stops[i].tag;
      arrive(i);
    };
    const cutTo = (i: number) => {
      m.traveling = false;
      m.finished = false;
      m.tag = tour.stops[i].tag;
      arrive(i);
      if (reducedMotion) {
        arriveAt(i);
        m.cut = -1;
        m.fade = 1;
      } else {
        m.cut = i;
        m.cutT = 0;
      }
    };
    const depart = (auto: boolean) => {
      if (reducedMotion) {
        cutTo(m.from + 1);
        return;
      }
      m.traveling = true;
      m.auto = auto;
      m.t = 0;
      m.flash = -1;
      m.tag = tour.stops[m.from + 1].tag;
    };

    if (sim.current.jumpSeq !== m.jumpSeq) {
      m.jumpSeq = sim.current.jumpSeq;
      const j = Math.min(n - 1, Math.max(0, sim.current.jumpTo));
      const base = m.cut >= 0 ? m.cut : m.from;
      if (m.traveling && m.cut < 0 && j === m.from + 1) {
        // Already on the way there. A manual step never freezes.
        m.auto = false;
      } else if (
        !m.traveling &&
        m.cut < 0 &&
        j === m.from + 1 &&
        open &&
        !reducedMotion
      ) {
        depart(false);
      } else if (j !== base || m.traveling) {
        cutTo(j);
      } else {
        m.dwell = dwell(j);
        m.finished = false;
      }
    }

    if (m.cut >= 0) {
      m.cutT += dt;
      m.fade = Math.max(0, 1 - m.cutT / 0.12);
      if (m.cutT >= 0.12) {
        const i = m.cut;
        m.cut = -1;
        m.from = i;
        m.dwell = dwell(i);
        m.fade = 0;
      }
    } else if (m.fade < 1) {
      m.fade = Math.min(1, m.fade + dt / 0.12);
    }

    const frozen = m.traveling && m.auto && !playing;
    if (m.traveling && !frozen) {
      m.t += dt;
      if (m.t >= tourLegs[m.from].total) {
        arriveAt(m.from + 1);
        m.flash = 0;
      }
    } else if (!m.traveling && open && m.cut < 0 && playing && !m.finished) {
      m.dwell -= dt;
      if (m.dwell <= 0) {
        if (m.from >= n - 1) {
          m.finished = true;
          onFinish();
        } else {
          depart(true);
        }
      }
    }

    if (m.flash >= 0) {
      m.flash += dt;
      if (m.flash > FLASH_RING) m.flash = -1;
    }

    if (
      (m.traveling && !frozen) ||
      m.cut >= 0 ||
      m.fade < 1 ||
      m.flash >= 0 ||
      (open && playing && !m.finished)
    ) {
      state.invalidate();
    }
  }, -1);

  const currentId = tour.stops[si]?.station;
  const activeLayer = currentId
    ? STATION_BY_ID.get(currentId)?.layer
    : undefined;
  const fine = !coarse;

  return (
    <>
      <color attach="background" args={[BG]} />
      <hemisphereLight args={["#dfe6f0", BG, 0.65]} />
      <directionalLight
        position={[-6, 14, 10]}
        intensity={1.1}
        color="#fff6e6"
      />
      <directionalLight
        position={[5, 6, -14]}
        intensity={0.9}
        color="#9fb6d6"
      />

      {LAYERS.map((l) => (
        <Plate
          key={l.id}
          layer={l}
          d={d}
          phase={phase}
          active={l.id === activeLayer}
          open={l.id === openLayer}
          overlays={overlays}
          reducedMotion={reducedMotion}
          worldRef={worldRef}
          onLayer={onLayer}
        >
          {STATIONS.filter((s) => s.layer === l.id).map((s) => {
            const steps = stepsById.get(s.id);
            return (
              <StationNode
                key={s.id}
                station={s}
                d={d}
                state={stationState(steps, si)}
                steps={steps ?? null}
                stopIndex={si}
                selected={s.id === selectedId}
                phase={phase}
                reducedMotion={reducedMotion}
                fine={fine}
                overlays={overlays}
                chips={chips}
                worldRef={worldRef}
                labelsRef={labelsRef}
                onSelect={onSelect}
                onJump={onJump}
              />
            );
          })}
        </Plate>
      ))}

      <Route
        legsByTour={legsByTour}
        tour={tour}
        worldRef={worldRef}
        motionRef={motionRef}
      />
      <Packet
        legs={legs}
        tour={tour}
        d={d}
        overlays={overlays}
        reducedMotion={reducedMotion}
        chips={chips}
        worldRef={worldRef}
        motionRef={motionRef}
        labelsRef={labelsRef}
      />
      <CameraRig d={d} sim={sim} coarse={coarse} />
    </>
  );
}

/* ---------------------------------------------------------------- scene */

export default function SystemScene({ active, ...rest }: SceneProps) {
  return (
    <Canvas
      orthographic
      flat
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      frameloop={active ? "demand" : "never"}
      camera={{
        near: 0.1,
        far: 400,
        zoom: 20,
        position: [WIDE.view[0] * 100, WIDE.view[1] * 100, WIDE.view[2] * 100],
      }}
      onPointerMissed={() => rest.onSelect("")}
      style={{ touchAction: "pan-y" }}
      aria-hidden="true"
    >
      <Stage {...rest} />
    </Canvas>
  );
}

/**
 * Ghost physics as a pure, seeded, fixed-step simulation.
 *
 * The sim owns no DOM, no clock and no Math.random. Two sims with the same
 * seed, size and inputs produce the same ghosts, step for step. That is the
 * property a shared, server-owned ghost room needs later.
 *
 * Units are CSS pixels of the ghost field. Forces are per step, and one step
 * is one 60 Hz frame, so the feel matches the old per-frame React loop.
 * A ghost's (x, y) is the top-left corner of its 40 px sprite, as before.
 *
 * Any number of pointers can act on the field: the visitor's own, plus one per
 * other visitor in the room. Each pointer has its own flee, panic and attract
 * zones, and the forces add up.
 */
import {
  ATTRACT_FORCE,
  ATTRACT_RADIUS,
  GHOST_OPACITY,
  GHOST_SPEED,
  GHOST_VARIANTS,
  GHOST_VARIANT_SCALES,
  MAX_GHOSTS,
} from "../constants";
import { mulberry32 } from "./rng";

export const STEP_MS = 1000 / 60;

const SPEED_FACTOR = 0.05 * (GHOST_SPEED / 2);
const SPEED_MULTIPLIER = GHOST_SPEED / 2;
const OFF_SCREEN_MARGIN = 300;
const PANIC_RADIUS = 120;
const FLEE_RADIUS = 250;
const EDGE_FADE = 100;
const TARGET_SPEED = 0.6;
const DAMPING = 0.98;
const PHASE_RADIUS = 80;
const RIPPLE_RADIUS = 50;
const RIPPLE_GAP_MS = 200;
const MAX_RIPPLES = 5;
export const RIPPLE_LIFE_MS = 1200;
const SPAWN_HOLD_MS = 90;
const TAP_SPAWN_GAP_MS = 100;

export const FLAG_FLEE = 1;
export const FLAG_PANIC = 2;
export const FLAG_ATTRACT = 4;

export interface Pointer {
  /** Stable per visitor. Keys the hold-to-spawn timer. */
  id: string | number;
  /** Position in field pixels. */
  x: number;
  y: number;
  /** Left button held: ghosts within ATTRACT_RADIUS drift toward the pointer. */
  attracting: boolean;
  /** Right button held: spawn at the pointer now, then every 90 ms. */
  spawning: boolean;
}

export interface SimInput {
  pointers: readonly Pointer[];
}

export interface Ripple {
  x: number;
  y: number;
  bornMs: number;
  /** Three static glitch marks: [x, y, angle] with x, y in 0..1 of a 50 px box. */
  glitch: readonly [number, number, number][];
}

const BASE_OPACITY: Record<string, number> = {
  bored: 0.5,
  excited: 0.8,
  happy: 0.8,
  worried: 0.55,
  sad: 0.55,
};

export class GhostSim {
  /** Ghosts alive this step, in slots 0..count-1. */
  count = 0;
  readonly id = new Uint32Array(MAX_GHOSTS);
  /** Index into GHOST_VARIANTS. */
  readonly variant = new Uint8Array(MAX_GHOSTS);
  /** 1 for ghosts a visitor spawned, 0 for the ambient ones. */
  readonly spawned = new Uint8Array(MAX_GHOSTS);
  readonly x = new Float64Array(MAX_GHOSTS);
  readonly y = new Float64Array(MAX_GHOSTS);
  /** Position before the last step, for render interpolation. */
  readonly prevX = new Float64Array(MAX_GHOSTS);
  readonly prevY = new Float64Array(MAX_GHOSTS);
  readonly vx = new Float64Array(MAX_GHOSTS);
  readonly vy = new Float64Array(MAX_GHOSTS);
  readonly opacity = new Float32Array(MAX_GHOSTS);
  readonly scale = new Float32Array(MAX_GHOSTS);
  readonly flags = new Uint8Array(MAX_GHOSTS);
  readonly ripples: Ripple[] = [];

  timeMs = 0;
  private nextId = 0;
  private readonly random: () => number;
  private lastRippleMs = -Infinity;
  private lastTapSpawnMs = -Infinity;
  /** Hold-to-spawn timers, per pointer id. */
  private readonly spawnTimers = new Map<string | number, number>();
  private readonly tapSpawns: [number, number][] = [];

  constructor(
    seed: number,
    public width: number,
    public height: number,
    private readonly targetCount: number,
  ) {
    this.random = mulberry32(seed);
    for (let i = 0; i < targetCount; i++) this.addAmbient();
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Queue a spawn from a double tap. It lands on the next step. */
  queueSpawn(x: number, y: number) {
    this.tapSpawns.push([x, y]);
  }

  step(raw: SimInput) {
    // Remote pointers come from other browsers. A non-finite one would make NaN ghosts that never leave.
    const input = { pointers: raw.pointers.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) };
    this.timeMs += STEP_MS;
    this.handleSpawns(input);
    this.moveGhosts(input);
    this.phaseThrough();
    this.respawn();
    while (this.ripples.length && this.timeMs - this.ripples[0].bornMs >= RIPPLE_LIFE_MS) {
      this.ripples.shift();
    }
  }

  private handleSpawns(input: SimInput) {
    for (const [x, y] of this.tapSpawns) {
      if (this.timeMs - this.lastTapSpawnMs < TAP_SPAWN_GAP_MS) continue;
      this.lastTapSpawnMs = this.timeMs;
      this.addSpawned(x, y);
    }
    this.tapSpawns.length = 0;

    const held = new Set<string | number>();
    for (const p of input.pointers) {
      if (!p.spawning) continue;
      held.add(p.id);
      const timer = this.spawnTimers.get(p.id);
      if (timer === undefined) {
        // Just pressed: spawn now.
        this.spawnTimers.set(p.id, 0);
        this.addSpawned(p.x, p.y);
      } else if (timer + STEP_MS >= SPAWN_HOLD_MS) {
        this.spawnTimers.set(p.id, timer + STEP_MS - SPAWN_HOLD_MS);
        this.addSpawned(p.x, p.y);
      } else {
        this.spawnTimers.set(p.id, timer + STEP_MS);
      }
    }
    for (const id of this.spawnTimers.keys()) {
      if (!held.has(id)) this.spawnTimers.delete(id);
    }
  }

  private moveGhosts(input: SimInput) {
    const { width, height, random } = this;
    let keep = 0;
    for (let i = 0; i < this.count; i++) {
      let x = this.x[i];
      let y = this.y[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      this.prevX[i] = x;
      this.prevY[i] = y;

      x += vx * STEP_MS * SPEED_FACTOR;
      y += vy * STEP_MS * SPEED_FACTOR;

      // A ghost that wanders far off the field is dropped and replaced.
      if (
        x < -OFF_SCREEN_MARGIN ||
        x > width + OFF_SCREEN_MARGIN ||
        y < -OFF_SCREEN_MARGIN ||
        y > height + OFF_SCREEN_MARGIN
      ) {
        continue;
      }

      let flags = 0;
      let maxSpeed = 0;
      // Closest pointer that scares this ghost. It sets how visible the fear is.
      let fearDistance = Infinity;

      for (const p of input.pointers) {
        const mdx = x - p.x;
        const mdy = y - p.y;
        const distance = Math.sqrt(mdx * mdx + mdy * mdy);

        if (p.attracting && distance < ATTRACT_RADIUS) {
          flags |= FLAG_ATTRACT;
          const angle = Math.atan2(-mdy, -mdx);
          // Stronger when further, gentler close in to stop jitter.
          let force = Math.min(distance / ATTRACT_RADIUS, 1) * ATTRACT_FORCE;
          if (distance < 50) force *= distance / 50;
          vx += Math.cos(angle) * force;
          vy += Math.sin(angle) * force;
          maxSpeed = Math.max(maxSpeed, 2.5);
        } else if (distance < FLEE_RADIUS) {
          flags |= FLAG_FLEE;
          fearDistance = Math.min(fearDistance, distance);
          const angle = Math.atan2(mdy, mdx);
          let force: number;
          if (distance < PANIC_RADIUS) {
            flags |= FLAG_PANIC;
            force = Math.pow((PANIC_RADIUS - distance) / PANIC_RADIUS, 1.5) * 1.8;
          } else {
            force = ((FLEE_RADIUS - distance) / FLEE_RADIUS) * 0.8;
          }
          vx += Math.cos(angle) * force;
          vy += Math.sin(angle) * force;
          maxSpeed = Math.max(maxSpeed, distance < PANIC_RADIUS ? 3.0 : 2.0);
        }
      }
      if (maxSpeed > 0) [vx, vy] = clampSpeed(vx, vy, maxSpeed);

      // Occasional drift.
      if (random() < 0.01) {
        vx += (random() - 0.5) * 0.3;
        vy += (random() - 0.5) * 0.3;
      }

      if (Math.sqrt(vx * vx + vy * vy) > TARGET_SPEED) {
        vx *= DAMPING;
        vy *= DAMPING;
      }

      const variant = GHOST_VARIANTS[this.variant[i]];
      let opacity = BASE_OPACITY[variant] ?? 0.65;
      const edgeDistance = Math.min(x, width - x, y, height - y);
      if (edgeDistance < EDGE_FADE) opacity *= edgeDistance / EDGE_FADE;
      // Fear makes a ghost more visible.
      if (flags & FLAG_PANIC) {
        opacity *= 1.3 + (1 - fearDistance / PANIC_RADIUS) * 0.4;
      } else if (flags & FLAG_FLEE) {
        opacity *= 1.15;
      }

      this.copySlot(i, keep);
      this.x[keep] = x;
      this.y[keep] = y;
      this.vx[keep] = vx;
      this.vy[keep] = vy;
      this.opacity[keep] = opacity;
      this.scale[keep] = GHOST_VARIANT_SCALES[variant] ?? 1;
      this.flags[keep] = flags;
      keep++;
    }
    this.count = keep;
  }

  /** Overlapping ghosts fade, swell, and now and then throw off a ripple. */
  private phaseThrough() {
    const canRipple =
      this.timeMs - this.lastRippleMs > RIPPLE_GAP_MS && this.ripples.length < MAX_RIPPLES;
    let rippled = false;

    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        const dx = this.x[i] - this.x[j];
        const dy = this.y[i] - this.y[j];
        if (Math.abs(dx) > PHASE_RADIUS || Math.abs(dy) > PHASE_RADIUS) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > PHASE_RADIUS * PHASE_RADIUS) continue;
        const distance = Math.sqrt(d2);
        const phase = 1 - distance / PHASE_RADIUS;

        for (const k of [i, j]) {
          this.opacity[k] = Math.max(0.3, (1 - phase * 0.5) * this.opacity[k]);
          const base = GHOST_VARIANT_SCALES[GHOST_VARIANTS[this.variant[k]]] ?? 1;
          this.scale[k] = base * (1 + phase * 0.3);
        }

        if (distance < RIPPLE_RADIUS && canRipple && !rippled && this.random() < 0.3) {
          rippled = true;
          this.lastRippleMs = this.timeMs;
          this.ripples.push({
            x: (this.x[i] + this.x[j]) / 2,
            y: (this.y[i] + this.y[j]) / 2,
            bornMs: this.timeMs,
            glitch: [0, 1, 2].map(() => [
              this.random(),
              this.random(),
              this.random() * Math.PI * 2,
            ]),
          });
        }

        // A faint nudge apart when nearly on top of each other.
        if (distance < 40) {
          const angle = Math.atan2(dy, dx);
          const push = ((40 - distance) / 40) * 0.08;
          this.vx[i] += Math.cos(angle) * push;
          this.vy[i] += Math.sin(angle) * push;
          this.vx[j] -= Math.cos(angle) * push;
          this.vy[j] -= Math.sin(angle) * push;
        }
      }
    }
  }

  private respawn() {
    while (this.count < this.targetCount) this.addAmbient();
  }

  private addAmbient() {
    const i = this.addSlot(this.random() * this.width, this.random() * this.height, 0);
    this.vx[i] = (this.random() - 0.5) * SPEED_MULTIPLIER;
    this.vy[i] = (this.random() - 0.5) * SPEED_MULTIPLIER;
  }

  private addSpawned(x: number, y: number) {
    if (this.count >= MAX_GHOSTS || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const i = this.addSlot(x, y, 1);
    const angle = this.random() * Math.PI * 2;
    const speed = this.random() * 0.5 + 0.3;
    this.vx[i] = Math.cos(angle) * speed * SPEED_MULTIPLIER;
    this.vy[i] = Math.sin(angle) * speed * SPEED_MULTIPLIER;
  }

  private addSlot(x: number, y: number, spawned: number) {
    const i = this.count++;
    const variant = Math.floor(this.random() * GHOST_VARIANTS.length);
    this.id[i] = this.nextId++;
    this.variant[i] = variant;
    this.spawned[i] = spawned;
    this.x[i] = this.prevX[i] = x;
    this.y[i] = this.prevY[i] = y;
    this.opacity[i] = GHOST_OPACITY + this.random() * 0.2;
    this.scale[i] = GHOST_VARIANT_SCALES[GHOST_VARIANTS[variant]] ?? 1;
    this.flags[i] = 0;
    return i;
  }

  private copySlot(from: number, to: number) {
    if (from === to) return;
    this.id[to] = this.id[from];
    this.variant[to] = this.variant[from];
    this.spawned[to] = this.spawned[from];
    this.prevX[to] = this.prevX[from];
    this.prevY[to] = this.prevY[from];
  }
}

function clampSpeed(vx: number, vy: number, max: number): [number, number] {
  const speed = Math.sqrt(vx * vx + vy * vy);
  return speed > max ? [(vx / speed) * max, (vy / speed) * max] : [vx, vy];
}

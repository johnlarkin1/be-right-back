/**
 * WebGL2 renderer for the ghost field.
 *
 * Every image is an instanced, rotated quad that samples one atlas
 * (atlas.ts), so a frame is one buffer upload and one draw call. The sim
 * says where ghosts are and how they feel. This file owns only the look:
 * fade-ins, eased opacity and scale, the bob, motion lines, the panic "!!!",
 * ripples, and the spotlights (the phone's roaming one and other visitors').
 */
import {
  CELL_GLOW,
  CELL_LINE,
  CELL_PANIC,
  CELL_RING,
  CELL_SOLID,
  PANIC_BOX,
  RING_BOX,
  buildAtlas,
  cellUv,
  spriteUv,
  type UvRect,
} from "./atlas";
import { FLAG_FLEE, FLAG_PANIC, RIPPLE_LIFE_MS, STEP_MS, type GhostSim } from "./sim";

/** Sprite edge in CSS px. The sim's (x, y) is the sprite's top-left corner. */
const SPRITE = 40;
const HALF = SPRITE / 2;

/** Floats per instance: center xy, size wh, rotation, uv rect, rgba. */
const STRIDE = 13;
const MAX_INSTANCES = 1024;

const GREEN: readonly [number, number, number] = [0, 1, 65 / 255];
const WHITE: readonly [number, number, number] = [1, 1, 1];

const VERTEX = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in float aRot;
layout(location = 3) in vec4 aUv;
layout(location = 4) in vec4 aColor;
uniform vec2 uView;
out vec2 vUv;
out vec4 vColor;
void main() {
  vec2 p = aCorner * aRect.zw;
  float c = cos(aRot);
  float s = sin(aRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + aRect.xy;
  vec2 clip = p / uView * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = mix(aUv.xy, aUv.zw, aCorner + 0.5);
  vColor = vec4(aColor.rgb * aColor.a, aColor.a);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUv;
in vec4 vColor;
out vec4 outColor;
void main() {
  outColor = texture(uAtlas, vUv) * vColor;
}`;

interface GhostLook {
  bornMs: number;
  delayMs: number;
  fadeMs: number;
  opacity: number;
  scale: number;
  bobPhase: number;
  bob: number;
  bobPeriod: number;
}

export interface Spotlight {
  x: number;
  y: number;
  /** Glow colour, 0..1 per channel. Defaults to phosphor green. */
  rgb?: readonly [number, number, number];
  /** Adds a bright centre dot, so another visitor's pointer reads as a cursor. */
  dot?: boolean;
}

export class GhostRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly corners: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly viewUniform: WebGLUniformLocation | null;
  private readonly data = new Float32Array(MAX_INSTANCES * STRIDE);
  private n = 0;
  private readonly looks = new Map<number, GhostLook>();
  /** Ghost ids drawn this frame. Reused so a frame allocates nothing. */
  private readonly seen = new Set<number>();
  private lastFrameMs = -1;
  private readonly uv = {
    panic: cellUv(CELL_PANIC),
    ring: cellUv(CELL_RING),
    glow: cellUv(CELL_GLOW),
    line: cellUv(CELL_LINE, 2),
    solid: cellUv(CELL_SOLID, 8),
  };

  /** Throws when WebGL2 or shader setup fails, so the caller can fall back. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    fontFamily: string,
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    this.program = linkProgram(gl, VERTEX, FRAGMENT);
    gl.useProgram(this.program);
    this.viewUniform = gl.getUniformLocation(this.program, "uView");
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);

    this.vao = orThrow(gl.createVertexArray(), "vertex array");
    gl.bindVertexArray(this.vao);

    this.corners = orThrow(gl.createBuffer(), "buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instances = orThrow(gl.createBuffer(), "buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const bytes = STRIDE * 4;
    const attrs: [number, number, number][] = [
      [1, 4, 0],
      [2, 1, 4],
      [3, 4, 5],
      [4, 4, 9],
    ];
    for (const [loc, size, offset] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.texture = orThrow(gl.createTexture(), "texture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas(fontFamily));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  /**
   * Frees the GPU objects. It does not lose the context, so a remount on the
   * same canvas can build a new renderer.
   */
  dispose() {
    const { gl } = this;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.instances);
    gl.deleteBuffer(this.corners);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  /**
   * Draws one frame. `alpha` (0..1) is how far real time sits between the
   * sim's last two steps. `nowMs` is the page clock, for purely visual motion.
   */
  draw(sim: GhostSim, alpha: number, nowMs: number, spotlights: readonly Spotlight[]) {
    const { gl, canvas } = this;
    const dt = this.lastFrameMs < 0 ? 0 : Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = nowMs;
    const width = sim.width;
    const height = sim.height;
    this.n = 0;

    this.drawGhosts(sim, alpha, nowMs, dt);
    this.drawRipples(sim, sim.timeMs + alpha * STEP_MS);
    for (const { x, y, rgb = GREEN, dot } of spotlights) {
      // Two soft glows, as the old CSS radial gradients drew them. Other
      // visitors' glows are a little stronger, so they read on a busy field.
      const k = dot ? 1.6 : 1;
      this.push(x, y, 230, 230, 0, this.uv.glow, rgb, 0.12 * k);
      this.push(x, y, 120, 120, 0, this.uv.glow, rgb, 0.2 * k);
      if (dot) this.push(x, y, 16, 16, 0, this.uv.glow, rgb, 0.9);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.n === 0) return;
    gl.uniform2f(this.viewUniform, width, height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.n * STRIDE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
  }

  private drawGhosts(sim: GhostSim, alpha: number, nowMs: number, dt: number) {
    const seen = this.seen;
    seen.clear();
    const ease = 1 - Math.exp(-dt / 0.1);
    const t = nowMs / 1000;

    for (let i = 0; i < sim.count; i++) {
      const id = sim.id[i];
      seen.add(id);
      let look = this.looks.get(id);
      if (!look) {
        const spawned = sim.spawned[i] === 1;
        look = {
          bornMs: nowMs,
          // Ambient ghosts fade in one after another. Spawned ghosts pop in fast.
          delayMs: spawned ? 0 : Math.min(i * 100, 2000),
          fadeMs: spawned ? 300 : 800,
          opacity: sim.opacity[i],
          scale: sim.scale[i],
          bobPhase: 0,
          bob: 0,
          bobPeriod: 2 + seededRandom(id),
        };
        this.looks.set(id, look);
      }

      const flags = sim.flags[i];
      const fleeing = (flags & FLAG_FLEE) !== 0;
      const panicking = (flags & FLAG_PANIC) !== 0;

      look.opacity += (sim.opacity[i] - look.opacity) * ease;
      look.scale += (sim.scale[i] - look.scale) * ease;
      const period = panicking ? 0.3 : fleeing ? 0.5 : look.bobPeriod;
      look.bobPhase = (look.bobPhase + dt / period) % 1;
      const wave = Math.cos(look.bobPhase * Math.PI * 2);
      const bobTarget = fleeing ? -4 + 2 * wave : -4 + 4 * wave;
      look.bob += (bobTarget - look.bob) * (1 - Math.exp(-dt / 0.05));

      const fadeT = clamp01((nowMs - look.bornMs - look.delayMs) / look.fadeMs);
      const a = (1 - (1 - fadeT) * (1 - fadeT)) * Math.min(look.opacity, 1);
      if (a <= 0.001) continue;

      const x = lerp(sim.prevX[i], sim.x[i], alpha);
      const y = lerp(sim.prevY[i], sim.y[i], alpha);
      const cx = x + HALF;
      const cy = y + HALF;
      const s = look.scale;

      if (fleeing) {
        const vx = sim.vx[i];
        const vy = sim.vy[i];
        const angle = vx !== 0 || vy !== 0 ? Math.atan2(vy, vx) : 0;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const lines = panicking ? 5 : 3;
        for (let k = 0; k < lines; k++) {
          const pulse = wave01((t - k * 0.05) / 0.3);
          const len = (panicking ? 20 + k * 8 : 15 + k * 5) * (0.7 + 0.3 * pulse);
          const back = 12 + k * (panicking ? 8 : 6);
          const side = (k - (lines - 1) / 2) * 5;
          // Lines trail behind the ghost, solid end nearest the ghost.
          const ex = cx - dx * back - dy * side;
          const ey = cy - dy * back + dx * side;
          const lineAlpha = (panicking ? 0.6 : 0.4) * (0.4 + 0.4 * pulse) * a;
          this.push(ex - (dx * len) / 2, ey - (dy * len) / 2, len, 2, angle, this.uv.line, GREEN, lineAlpha);
        }
      }

      if (panicking) {
        const pulse = wave01(t / 0.4);
        const ps = s * (1 + 0.1 * pulse);
        this.push(
          cx - 35 * s,
          cy - 35 * s - 2 * pulse,
          PANIC_BOX * ps,
          PANIC_BOX * ps,
          0,
          this.uv.panic,
          WHITE,
          (0.8 + 0.2 * pulse) * a,
        );
      }

      this.push(cx, cy + look.bob * s, SPRITE * s, SPRITE * s, 0, spriteUv(sim.variant[i]), WHITE, a);
    }

    for (const id of this.looks.keys()) {
      if (!seen.has(id)) this.looks.delete(id);
    }
  }

  private drawRipples(sim: GhostSim, simNowMs: number) {
    for (const r of sim.ripples) {
      const age = simNowMs - r.bornMs;
      if (age < 0 || age >= RIPPLE_LIFE_MS) continue;
      const e = easeOut(age / RIPPLE_LIFE_MS);
      const cx = r.x + HALF;
      const cy = r.y + HALF;

      const glow = 0.8 + 1.7 * e;
      this.push(cx, cy, 56 * glow, 56 * glow, 0, this.uv.glow, GREEN, 0.15 * (1 - e));
      const ring = 0.5 + 1.5 * e;
      this.push(cx, cy, RING_BOX * ring, RING_BOX * ring, 0, this.uv.ring, GREEN, 0.3 * (1 - e));

      if (age < 300) {
        const fade = 0.4 * (1 - easeOut(age / 300));
        for (const [gx, gy, angle] of r.glitch) {
          this.push(cx - 25 + gx * 50 + 1, cy - 25 + gy * 50 + 5, 2, 10, angle, this.uv.solid, GREEN, 0.5 * fade);
        }
      }
    }
  }

  private push(
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
    uv: UvRect,
    rgb: readonly [number, number, number],
    alpha: number,
  ) {
    if (this.n >= MAX_INSTANCES) return;
    const d = this.data;
    let o = this.n++ * STRIDE;
    d[o++] = x;
    d[o++] = y;
    d[o++] = w;
    d[o++] = h;
    d[o++] = rotation;
    d[o++] = uv[0];
    d[o++] = uv[1];
    d[o++] = uv[2];
    d[o++] = uv[3];
    d[o++] = rgb[0];
    d[o++] = rgb[1];
    d[o++] = rgb[2];
    d[o] = clamp01(alpha);
  }
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = orThrow(gl.createProgram(), "program");
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = orThrow(gl.createShader(type), "shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
    }
    gl.attachShader(program, shader);
    // The linked program keeps the compiled code; the shader object can go.
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  return program;
}

/** WebGL create calls return null when the GPU is out of memory or the context is lost. */
function orThrow<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`WebGL ${what} allocation failed`);
  return value;
}

/** Same hash the old SVG ghosts used for their bob period. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** 0 → 1 → 0 once per unit of `t`, eased like framer's keyframe loop. */
function wave01(t: number): number {
  return 0.5 - 0.5 * Math.cos((t - Math.floor(t)) * Math.PI * 2);
}

function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) * (1 - c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

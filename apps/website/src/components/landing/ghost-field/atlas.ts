/**
 * Builds the ghost field's texture atlas at runtime with a 2D canvas.
 *
 * One 1024×256 texture holds every image the renderer draws: the ten ghost
 * sprites, the panic "!!!", a ring, a soft glow, a fading line and a solid
 * block. One texture means one draw call per frame.
 */
import { GHOST_VARIANTS } from "../constants";
import { GHOST_FACE_COLOR, ghostPixels } from "../ghost-sprite";

const CELL = 128;
const COLS = 8;
const ROWS = 2;
export const ATLAS_WIDTH = CELL * COLS;
export const ATLAS_HEIGHT = CELL * ROWS;

/** Atlas pixels per sprite pixel. 16 × 7 = 112, inside a 128 cell. */
const SPRITE_PX = 7;
const SPRITE_INSET = (CELL - 16 * SPRITE_PX) / 2;

/** Cell indexes after the ten ghost variants. */
export const CELL_PANIC = GHOST_VARIANTS.length;
export const CELL_RING = CELL_PANIC + 1;
export const CELL_GLOW = CELL_PANIC + 2;
export const CELL_LINE = CELL_PANIC + 3;
export const CELL_SOLID = CELL_PANIC + 4;

/** Ring cell geometry, in CSS px at scale 1: a 60 px ring with a 15 px glow margin. */
export const RING_BOX = 90;
/** Panic cell geometry: a 32 px box around the "!!!". */
export const PANIC_BOX = 32;

export type UvRect = readonly [number, number, number, number];

/** UV rect for a cell. `inset` is in atlas pixels. */
export function cellUv(cell: number, inset = 0): UvRect {
  const x = (cell % COLS) * CELL;
  const y = Math.floor(cell / COLS) * CELL;
  return [
    (x + inset) / ATLAS_WIDTH,
    (y + inset) / ATLAS_HEIGHT,
    (x + CELL - inset) / ATLAS_WIDTH,
    (y + CELL - inset) / ATLAS_HEIGHT,
  ];
}

/** UV rect that covers exactly the 16×16 sprite grid of a ghost cell. */
export function spriteUv(variantIndex: number): UvRect {
  return cellUv(variantIndex, SPRITE_INSET);
}

/** Browser only: it draws on a DOM canvas. Call it from an effect, never at module scope. */
export function buildAtlas(fontFamily: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");

  const origin = (cell: number) => [(cell % COLS) * CELL, Math.floor(cell / COLS) * CELL];

  GHOST_VARIANTS.forEach((variant, cell) => {
    const [ox, oy] = origin(cell);
    const { color, body, face } = ghostPixels(variant);
    const fill = (rects: typeof body, style: string) => {
      ctx.fillStyle = style;
      for (const [x, y, w, h] of rects) {
        ctx.fillRect(
          ox + SPRITE_INSET + x * SPRITE_PX,
          oy + SPRITE_INSET + y * SPRITE_PX,
          w * SPRITE_PX,
          h * SPRITE_PX,
        );
      }
    };
    fill(body, color);
    fill(face, GHOST_FACE_COLOR);
  });

  {
    // "!!!" in CRT amber with a glow. The cell spans PANIC_BOX CSS px.
    const [ox, oy] = origin(CELL_PANIC);
    const k = CELL / PANIC_BOX;
    ctx.save();
    ctx.font = `bold ${16 * k}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffb000";
    ctx.shadowColor = "rgba(255, 176, 0, 0.8)";
    ctx.shadowBlur = 8 * k;
    ctx.fillText("!!!", ox + CELL / 2, oy + CELL / 2);
    ctx.shadowBlur = 4 * k;
    ctx.fillText("!!!", ox + CELL / 2, oy + CELL / 2);
    ctx.restore();
  }

  {
    // White ring with an outer and inner glow. The renderer tints it green.
    const [ox, oy] = origin(CELL_RING);
    const k = CELL / RING_BOX;
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5 * k;
    ctx.shadowColor = "rgba(255, 255, 255, 0.75)";
    ctx.shadowBlur = 10 * k;
    ctx.beginPath();
    ctx.arc(ox + CELL / 2, oy + CELL / 2, 30 * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.stroke();
    ctx.restore();
  }

  {
    // Soft round glow, fading to nothing at the cell edge.
    const [ox, oy] = origin(CELL_GLOW);
    const r = CELL / 2 - 1;
    const g = ctx.createRadialGradient(ox + CELL / 2, oy + CELL / 2, 0, ox + CELL / 2, oy + CELL / 2, r);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.6)");
    g.addColorStop(0.5, "rgba(255,255,255,0.25)");
    g.addColorStop(0.75, "rgba(255,255,255,0.06)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, CELL, CELL);
  }

  {
    // Horizontal line: clear on the left, solid on the right.
    const [ox, oy] = origin(CELL_LINE);
    const g = ctx.createLinearGradient(ox, 0, ox + CELL, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, CELL, CELL);
  }

  {
    const [ox, oy] = origin(CELL_SOLID);
    ctx.fillStyle = "#fff";
    ctx.fillRect(ox, oy, CELL, CELL);
  }

  return canvas;
}

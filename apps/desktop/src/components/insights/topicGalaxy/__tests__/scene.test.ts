import { describe, expect, it } from "vitest";
import type { EmbeddingPoint } from "@/types";
import { fitTransform, packPoints, parseColor, pickPoint } from "../scene";

function point(x: number, y: number, z: number, cluster = 0): EmbeddingPoint {
  return {
    x,
    y,
    z,
    cluster,
    cluster_label: "t",
    color: "",
    message_preview: "hi",
    contact_name: "A",
    date: "Jan 1",
  };
}

describe("parseColor", () => {
  it("reads hex and rgb()", () => {
    expect(parseColor("#ff0000")).toEqual([1, 0, 0]);
    expect(parseColor("#0f0")).toEqual([0, 1, 0]);
    expect(parseColor("rgb(0, 0, 255)")).toEqual([0, 0, 1]);
  });
});

describe("fitTransform", () => {
  it("ignores far outliers when scaling", () => {
    const pts = Array.from({ length: 200 }, (_, i) =>
      point(Math.cos(i), Math.sin(i), 0),
    );
    pts.push(point(1000, 0, 0));
    const t = fitTransform(pts);
    // The ring of radius ~1 should land near radius 1, not be squashed.
    expect(t.scale).toBeGreaterThan(0.5);
  });
});

describe("packPoints", () => {
  it("drops points of unstyled clusters and maps back to the source", () => {
    const pts = [point(0, 0, 0, 0), point(1, 1, 1, -1), point(2, 2, 2, 1)];
    const packed = packPoints(pts, [
      { id: 0, color: "#ffffff" },
      { id: 1, color: "#000000" },
    ]);
    expect(packed.clusters.length).toBe(2);
    expect(Array.from(packed.sourceIndex)).toEqual([0, 2]);
    expect(Array.from(packed.colors.slice(0, 3))).toEqual([1, 1, 1]);
  });
});

describe("pickPoint", () => {
  const positions = new Float32Array([0, 0, -5, 0.3, 0, -5, 0, 0, -2]);
  const clusters = new Float32Array([0, 1, 0]);
  const ray = {
    origin: [0, 0, 0] as [number, number, number],
    dir: [0, 0, -1] as [number, number, number],
  };

  it("prefers the nearer of two points on the ray", () => {
    expect(pickPoint(positions, clusters, ray, 0.01, null)).toBe(2);
  });

  it("returns -1 outside the pick cone", () => {
    const off = {
      origin: [5, 5, 0] as [number, number, number],
      dir: [0, 0, -1] as [number, number, number],
    };
    expect(pickPoint(positions, clusters, off, 0.01, null)).toBe(-1);
  });

  it("skips other clusters when one is focused", () => {
    const tilted = {
      origin: [0, 0, 0] as [number, number, number],
      dir: [0.06, 0, -1] as [number, number, number],
    };
    const len = Math.hypot(...tilted.dir);
    tilted.dir = tilted.dir.map((v) => v / len) as [number, number, number];
    expect(pickPoint(positions, clusters, tilted, 0.05, 1)).toBe(1);
  });

  it("scans 250k points quickly", () => {
    const n = 250_000;
    const pos = new Float32Array(n * 3).map(() => Math.random() * 2 - 1);
    const cl = new Float32Array(n);
    const r = {
      origin: [0, 0, 3] as [number, number, number],
      dir: [0, 0, -1] as [number, number, number],
    };
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) pickPoint(pos, cl, r, 0.004, null);
    const ms = (performance.now() - t0) / 10;
    expect(ms).toBeLessThan(50);
  });
});

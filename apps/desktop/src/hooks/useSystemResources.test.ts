import { renderHook, act, waitFor } from "@testing-library/react";
import { emitMockEvent, mockListen } from "@/test/mocks/tauriEvent";
import type { ResourceSample } from "@/types";

vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

import {
  MAX_SAMPLES,
  appendSample,
  stagePeaks,
  useSystemResources,
} from "./useSystemResources";

function sample(over: Partial<ResourceSample> = {}): ResourceSample {
  return {
    ts_ms: 0,
    cpu_pct: 10,
    cpu_cores: [10],
    mem_used: 1,
    mem_total: 2,
    swap_used: 0,
    swap_total: 0,
    pressure: "normal",
    gpu_pct: null,
    gpu_mem: null,
    procs: [],
    ...over,
  };
}

describe("appendSample", () => {
  it("caps the buffer at MAX_SAMPLES and keeps the newest", () => {
    let buf: ReturnType<typeof appendSample> = [];
    for (let i = 0; i < MAX_SAMPLES + 5; i++) {
      buf = appendSample(buf, sample({ ts_ms: i }), "embedding");
    }
    expect(buf).toHaveLength(MAX_SAMPLES);
    expect(buf[buf.length - 1].ts_ms).toBe(MAX_SAMPLES + 4);
    expect(buf[0].ts_ms).toBe(5);
  });
});

describe("stagePeaks", () => {
  it("takes the maximum per stage and ignores untagged samples", () => {
    const proc = { pid: 1, name: "python", cpu_pct: 0, rss: 100 };
    let buf = appendSample([], sample({ gpu_pct: 20 }), "embedding");
    buf = appendSample(
      buf,
      sample({ gpu_pct: 80, cpu_pct: 50, procs: [proc] }),
      "embedding",
    );
    buf = appendSample(buf, sample({ gpu_pct: 5 }), "saving");
    buf = appendSample(buf, sample({ gpu_pct: 99 }), null);

    const peaks = stagePeaks(buf);
    expect(peaks.map((p) => p.stage)).toEqual(["embedding", "saving"]);
    expect(peaks[0]).toMatchObject({ gpuPct: 80, cpuPct: 50, rss: 100 });
  });

  it("keeps gpuPct null when no sample has GPU data", () => {
    const buf = appendSample([], sample(), "parsing");
    expect(stagePeaks(buf)[0].gpuPct).toBeNull();
  });
});

describe("useSystemResources", () => {
  it("collects events with the current stage while active", async () => {
    const { result, rerender } = renderHook(
      ({ active, stage }) => useSystemResources(active, stage),
      { initialProps: { active: true, stage: "parsing" as const } },
    );
    await waitFor(() =>
      expect(mockListen).toHaveBeenCalledWith(
        "system-resources",
        expect.any(Function),
      ),
    );

    act(() => emitMockEvent("system-resources", sample({ ts_ms: 1 })));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].stage).toBe("parsing");

    rerender({ active: false, stage: "parsing" });
    act(() => emitMockEvent("system-resources", sample({ ts_ms: 2 })));
    expect(result.current).toHaveLength(1);
  });
});

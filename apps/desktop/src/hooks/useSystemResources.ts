import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { IngestionStage, ResourceSample } from "@/types";

/** One second per sample, so 120 samples is two minutes of history. */
export const MAX_SAMPLES = 120;

export interface TaggedSample extends ResourceSample {
  /** Ingestion stage running when the sample arrived. */
  stage: IngestionStage | null;
}

export interface StagePeak {
  stage: IngestionStage;
  gpuPct: number | null;
  cpuPct: number;
  /** Peak resident memory of the Be Right Back process tree, in bytes. */
  rss: number;
}

/** Append a sample and drop the oldest ones beyond `MAX_SAMPLES`. */
export function appendSample(
  buffer: TaggedSample[],
  sample: ResourceSample,
  stage: IngestionStage | null,
): TaggedSample[] {
  const next = [...buffer, { ...sample, stage }];
  return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
}

/** Highest GPU, CPU, and process memory seen in each stage, in stage order. */
export function stagePeaks(samples: TaggedSample[]): StagePeak[] {
  const peaks = new Map<IngestionStage, StagePeak>();
  for (const s of samples) {
    if (!s.stage) continue;
    const rss = s.procs.reduce((sum, p) => sum + p.rss, 0);
    const prev = peaks.get(s.stage);
    peaks.set(s.stage, {
      stage: s.stage,
      cpuPct: Math.max(prev?.cpuPct ?? 0, s.cpu_pct),
      gpuPct:
        s.gpu_pct === null
          ? (prev?.gpuPct ?? null)
          : Math.max(prev?.gpuPct ?? 0, s.gpu_pct),
      rss: Math.max(prev?.rss ?? 0, rss),
    });
  }
  return [...peaks.values()];
}

/**
 * Collect `system-resources` events while `active` is true.
 * The buffer resets each time `active` turns on.
 */
export function useSystemResources(
  active: boolean,
  stage: IngestionStage | null,
): TaggedSample[] {
  const [samples, setSamples] = useState<TaggedSample[]>([]);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    if (!active) return;
    setSamples([]);
    let unlisten: UnlistenFn | null = null;
    // The async listen() can resolve after cleanup, so guard with a flag.
    let cancelled = false;

    listen<ResourceSample>("system-resources", (event) => {
      if (cancelled) return;
      setSamples((prev) => appendSample(prev, event.payload, stageRef.current));
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active]);

  return samples;
}

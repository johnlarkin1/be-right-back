/**
 * ResourceMonitor - htop-style strip docked to the bottom of the window.
 * Shows CPU, memory, and GPU load during ingestion. Click to expand.
 */
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { MAX_SAMPLES, stagePeaks } from "@/hooks/useSystemResources";
import type { TaggedSample } from "@/hooks/useSystemResources";
import { useUIMode } from "@/stores/themeStore";
import type { IngestionStage, MemoryPressure } from "@/types";
import { STAGE_COLORS, STAGE_LABELS } from "@/types";

const GB = 1024 ** 3;
const RETRO_BAR_CELLS = 10;

const formatGB = (bytes: number) => `${(bytes / GB).toFixed(1)}G`;
const clampPct = (pct: number) => Math.max(0, Math.min(100, pct));

const PRESSURE_COLOR: Record<MemoryPressure, string> = {
  normal: "var(--color-accent, #00ff41)",
  warn: "#ffb000",
  critical: "var(--color-error, #ff4444)",
};

interface ResourceMonitorProps {
  samples: TaggedSample[];
}

/** Text bar in retro mode, rounded bar in modern mode. */
function Bar({
  pct,
  isRetro,
  color,
  className = "",
}: {
  pct: number;
  isRetro: boolean;
  color?: string;
  className?: string;
}) {
  const value = clampPct(pct);
  if (isRetro) {
    const filled = Math.round((value / 100) * RETRO_BAR_CELLS);
    return (
      <span
        className={`font-mono tracking-tighter ${className}`}
        style={{ color }}
        aria-hidden="true"
      >
        {"█".repeat(filled)}
        <span className="opacity-30">
          {"░".repeat(RETRO_BAR_CELLS - filled)}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`inline-block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)] align-middle ${className}`}
      aria-hidden="true"
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${value}%`,
          background: color ?? "var(--color-accent)",
        }}
      />
    </span>
  );
}

/** Line chart of 0-100 values, right-aligned. `bands` shades each stage. */
function Sparkline({
  series,
  bands,
  className = "h-4 w-20",
}: {
  series: { values: (number | null)[]; color: string }[];
  bands?: (IngestionStage | null)[];
  className?: string;
}) {
  const offset = MAX_SAMPLES - (series[0]?.values.length ?? 0);
  const x = (i: number) => i + offset;
  const runs: { stage: IngestionStage; start: number; end: number }[] = [];
  bands?.forEach((stage, i) => {
    if (!stage) return;
    const last = runs[runs.length - 1];
    if (last && last.stage === stage && last.end === i) last.end = i + 1;
    else runs.push({ stage, start: i, end: i + 1 });
  });

  return (
    <svg
      viewBox={`0 0 ${MAX_SAMPLES} 100`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {runs.map((r) => (
        <rect
          key={`${r.stage}-${r.start}`}
          x={x(r.start)}
          y={0}
          width={r.end - r.start}
          height={100}
          fill={STAGE_COLORS[r.stage]}
          opacity={0.12}
        />
      ))}
      {series.map((s, k) => {
        const points = s.values
          .map((v, i) => (v === null ? null : `${x(i)},${100 - clampPct(v)}`))
          .filter(Boolean)
          .join(" ");
        return (
          <polyline
            key={k}
            points={points}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

export function ResourceMonitor({ samples }: ResourceMonitorProps) {
  const { isRetro } = useUIMode();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const latest = samples[samples.length - 1];

  const text = isRetro
    ? "font-mono text-[var(--color-crt-text)]"
    : "text-[var(--color-text-primary)]";
  const dim = isRetro
    ? "font-mono text-[var(--color-crt-text-dim)]"
    : "text-[var(--color-text-muted)]";
  const accent = isRetro ? "var(--color-crt-text)" : "var(--color-accent)";
  const line2 = isRetro ? "var(--color-crt-text-dim)" : "#94a3b8";

  const memPct = latest ? (latest.mem_used / latest.mem_total) * 100 : 0;
  const swapPct =
    latest && latest.swap_total > 0
      ? (latest.swap_used / latest.swap_total) * 100
      : 0;
  const brbRss = latest?.procs.reduce((sum, p) => sum + p.rss, 0) ?? 0;
  const brbPct = latest ? (brbRss / latest.mem_total) * 100 : 0;
  const cpuSeries = samples.map((s) => s.cpu_pct);
  const gpuSeries = samples.map((s) => s.gpu_pct);
  const memSeries = samples.map((s) => (s.mem_used / s.mem_total) * 100);
  const peaks = stagePeaks(samples);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t ${
        isRetro
          ? "border-[var(--color-crt-border)] bg-[var(--color-crt-bg)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
      }`}
    >
      <AnimatePresence initial={false}>
        {open && latest && (
          <motion.div
            id="resource-monitor-detail"
            key="detail"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="overflow-hidden"
          >
            <div className="mx-auto max-h-[45vh] max-w-4xl space-y-4 overflow-y-auto p-4 text-xs">
              <section aria-label="CPU cores">
                <p className={`mb-1 ${dim}`}>
                  CPU · {latest.cpu_pct.toFixed(0)}% across{" "}
                  {latest.cpu_cores.length} cores
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                  {latest.cpu_cores.map((pct, i) => (
                    <div key={i} className={`flex items-center gap-2 ${text}`}>
                      <span className={`w-5 ${dim}`}>{i}</span>
                      <Bar pct={pct} isRetro={isRetro} color={accent} />
                      <span className="w-8 text-right tabular-nums">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Memory" className={`space-y-1 ${text}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-12 ${dim}`}>MEM</span>
                  <Bar pct={memPct} isRetro={isRetro} color={accent} />
                  <span className="tabular-nums">
                    {formatGB(latest.mem_used)} / {formatGB(latest.mem_total)}
                  </span>
                  <span className={dim}>
                    Be Right Back: {formatGB(brbRss)} ({brbPct.toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-12 ${dim}`}>SWAP</span>
                  <Bar pct={swapPct} isRetro={isRetro} color={line2} />
                  <span className="tabular-nums">
                    {formatGB(latest.swap_used)} / {formatGB(latest.swap_total)}
                  </span>
                </div>
              </section>

              <section aria-label="History">
                <p className={`mb-1 ${dim}`}>
                  Last {samples.length}s · shaded by stage ·{" "}
                  <span style={{ color: accent }}>GPU</span>{" "}
                  <span style={{ color: line2 }}>CPU</span>
                </p>
                <Sparkline
                  className="h-16 w-full"
                  bands={samples.map((s) => s.stage)}
                  series={[
                    { values: cpuSeries, color: line2 },
                    { values: gpuSeries, color: accent },
                  ]}
                />
              </section>

              <section aria-label="Processes">
                <table className={`w-full ${text}`}>
                  <thead className={dim}>
                    <tr className="text-left">
                      <th className="w-16 font-normal">PID</th>
                      <th className="font-normal">NAME</th>
                      <th className="w-16 text-right font-normal">CPU%</th>
                      <th className="w-20 text-right font-normal">RSS</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {latest.procs.map((p) => (
                      <tr key={p.pid}>
                        <td>{p.pid}</td>
                        <td className="truncate">{p.name}</td>
                        <td className="text-right">{p.cpu_pct.toFixed(0)}</td>
                        <td className="text-right">{formatGB(p.rss)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {peaks.length > 0 && (
                <section aria-label="Peaks by stage" className={dim}>
                  {peaks.map((p) => (
                    <p key={p.stage}>
                      <span style={{ color: STAGE_COLORS[p.stage] }}>
                        {STAGE_LABELS[p.stage]}
                      </span>
                      : CPU {p.cpuPct.toFixed(0)}%
                      {p.gpuPct !== null && `, GPU ${p.gpuPct.toFixed(0)}%`},
                      RSS {formatGB(p.rss)}
                    </p>
                  ))}
                </section>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="resource-monitor-detail"
        className={`mx-auto flex w-full max-w-4xl items-center gap-x-5 gap-y-1 px-4 py-2 text-xs ${text}`}
      >
        <ChevronUp
          size={14}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        {latest ? (
          <>
            <span className="flex items-center gap-2">
              <span className={dim}>CPU</span>
              <Bar pct={latest.cpu_pct} isRetro={isRetro} color={accent} />
              <span className="w-8 text-right tabular-nums">
                {latest.cpu_pct.toFixed(0)}%
              </span>
              <span className="hidden sm:inline">
                <Sparkline series={[{ values: cpuSeries, color: accent }]} />
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className={dim}>MEM</span>
              <Bar pct={memPct} isRetro={isRetro} color={accent} />
              <span className="tabular-nums">
                {formatGB(latest.mem_used)}/{formatGB(latest.mem_total)}
              </span>
              <span className="hidden sm:inline">
                <Sparkline series={[{ values: memSeries, color: accent }]} />
              </span>
            </span>
            {latest.gpu_pct !== null && (
              <span className="flex items-center gap-2">
                <span className={dim}>GPU</span>
                <Bar pct={latest.gpu_pct} isRetro={isRetro} color={accent} />
                <span className="w-8 text-right tabular-nums">
                  {latest.gpu_pct.toFixed(0)}%
                </span>
                <span className="hidden sm:inline">
                  <Sparkline series={[{ values: gpuSeries, color: accent }]} />
                </span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: PRESSURE_COLOR[latest.pressure] }}
                aria-hidden="true"
              />
              <span className={dim}>{latest.pressure} pressure</span>
            </span>
          </>
        ) : (
          <span className={dim}>Waiting for resource data...</span>
        )}
      </button>
    </div>
  );
}

export default ResourceMonitor;

/**
 * TopicMap - 3D/2D map of message embeddings, grouped into topics.
 * 3D draws with WebGL (topicGalaxy/); 2D still uses Plotly scattergl.
 * Dual-mode: CRT palette and bracket labels (retro) vs clean palette (modern)
 *
 * The 3D view rotates on its own until the user drags it. A topic list beside
 * the plot isolates one topic and hands it to Ask Casper.
 */
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { useUIMode } from "@/stores/themeStore";
import { useCasperDraftStore } from "@/stores/casperDraftStore";
import type { ClusterInfo } from "@/types";
import { useEmbeddingsData } from "./useEmbeddingsData";
import type { GalaxyTopic } from "./topicGalaxy/TopicGalaxy";

// three.js is ~1 MB; load it only when the 3D view opens.
const TopicGalaxy = lazy(() => import("./topicGalaxy/TopicGalaxy"));

type PlotlyModule = {
  newPlot: (
    el: HTMLElement,
    traces: unknown[],
    layout: unknown,
    config: unknown,
  ) => Promise<void>;
  relayout: (el: HTMLElement, update: Record<string, unknown>) => unknown;
  purge: (el: HTMLElement) => void;
  Plots: { resize: (el: HTMLElement) => void };
};

let Plotly: PlotlyModule | null = null;

/** Topics shown before "Show all topics". */
const TOP_TOPICS = 10;
/** Number of colors in the --chart-cat-N palette. */
const PALETTE_SIZE = 8;

const SAMPLE_OPTIONS = [4000, 10000, 25000, 100000, 0];
const GLOW_KEY = "brb-topic-map-glow";

function readGlow(): number {
  try {
    const v = Number(localStorage.getItem(GLOW_KEY));
    return localStorage.getItem(GLOW_KEY) !== null && Number.isFinite(v)
      ? Math.min(1, Math.max(0, v))
      : 0.5;
  } catch {
    return 0.5;
  }
}

/**
 * True when a topic label looks like leaked LLM prompt text, e.g.
 * "* Constraints" or "1. **Analyze the Request:**".
 */
export function isLeakedLabel(label: string): boolean {
  return /\*\*|^\s*[*#>-]\s|^\s*\d+\.\s/.test(label);
}

/** Read the categorical chart palette from the active theme. */
function readPalette(): {
  cats: string[];
  other: string;
  grid: string;
  surface: string;
} {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const cats = Array.from({ length: PALETTE_SIZE }, (_, i) =>
    read(`--chart-cat-${i + 1}`, "#10b981"),
  );
  return {
    cats,
    other: read("--chart-other", "#3f3f46"),
    grid: read("--chart-grid", "rgba(148,163,184,0.18)"),
    surface: read("--color-surface", "#020617"),
  };
}

interface TopicMapProps {
  use3d: boolean;
  onDimensionChange: (use3d: boolean) => void;
  showUncategorized: boolean;
  onShowUncategorizedChange: (show: boolean) => void;
  /** Plot height in px */
  plotHeight?: number;
  /** Opens the full-screen view. Omit to hide the button. */
  onExpand?: () => void;
  /** Switches to the Ask Casper tab after a topic is handed over. */
  onAskCasper?: () => void;
}

export const TopicMap = memo(function TopicMap({
  use3d,
  onDimensionChange,
  showUncategorized,
  onShowUncategorizedChange,
  plotHeight = 520,
  onExpand,
  onAskCasper,
}: TopicMapProps) {
  const { isRetro } = useUIMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [resetToken, setResetToken] = useState(0);
  const [glow, setGlow] = useState(readGlow);
  const changeGlow = (value: number) => {
    setGlow(value);
    try {
      localStorage.setItem(GLOW_KEY, String(value));
    } catch {
      // Storage can be unavailable; the slider still works this session.
    }
  };
  const [plotlyLoaded, setPlotlyLoaded] = useState(Plotly !== null);
  const [isRendered, setIsRendered] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [maxPoints, setMaxPoints] = useState<number>(25000);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const setCasperDraft = useCasperDraftStore((s) => s.setDraft);

  const {
    embeddingsData: data,
    isLoading,
    fetchEmbeddings,
    needsFetch,
  } = useEmbeddingsData(use3d, maxPoints);

  useEffect(() => {
    if (needsFetch) fetchEmbeddings();
  }, [fetchEmbeddings, needsFetch]);

  useEffect(() => {
    if (Plotly) return;
    // @ts-expect-error - plotly.js-dist-min doesn't have types
    import("plotly.js-dist-min").then(
      (mod: { default?: PlotlyModule } & PlotlyModule) => {
        Plotly = mod.default || mod;
        setPlotlyLoaded(true);
      },
    );
  }, []);

  // The palette lives in CSS; re-read it when the theme flips.
  const palette = useMemo(
    () => readPalette(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isRetro],
  );

  // Topics sorted by size. Colors follow rank so the biggest get the
  // most distinct hues.
  const topics = useMemo(() => {
    if (!data) return [];
    return [...data.clusters]
      .filter((c) => c.id >= 0)
      .sort((a, b) => b.count - a.count)
      .map((cluster, rank) => ({
        cluster,
        color: palette.cats[rank % PALETTE_SIZE],
        name: isLeakedLabel(cluster.label) ? "Unnamed topic" : cluster.label,
      }));
  }, [data, palette]);

  const leakedLabels = useMemo(
    () =>
      topics
        .filter((t) => isLeakedLabel(t.cluster.label))
        .map((t) => t.cluster),
    [topics],
  );

  const uncategorized: ClusterInfo | undefined = useMemo(
    () => data?.clusters.find((c) => c.id === -1),
    [data],
  );

  // The 3D view draws with WebGL (TopicGalaxy); Plotly only draws 2D.
  const traces = useMemo(() => {
    if (!data || use3d) return [];
    const series = topics.map((t) => ({ cluster: t.cluster, color: t.color }));
    if (showUncategorized && uncategorized) {
      series.push({ cluster: uncategorized, color: palette.other });
    }
    return series.map(({ cluster, color }) => {
      const points = data.points.filter((p) => p.cluster === cluster.id);
      const isActive =
        selectedCluster === null || selectedCluster === cluster.id;
      return {
        type: "scattergl" as const,
        mode: "markers" as const,
        name: cluster.label,
        x: points.map((p) => p.x),
        y: points.map((p) => p.y),
        text: points.map(
          (p) =>
            `"${p.message_preview}"<br><span style="font-size:10px">${p.date} - ${p.contact_name}</span>`,
        ),
        hovertemplate: "<b>%{text}</b><extra></extra>",
        marker: {
          size: 6,
          color,
          opacity: isActive ? 0.85 : 0.08,
        },
      };
    });
  }, [
    data,
    topics,
    uncategorized,
    showUncategorized,
    selectedCluster,
    use3d,
    palette,
  ]);

  const galaxyTopics: GalaxyTopic[] = useMemo(() => {
    const out: GalaxyTopic[] = topics.map((t) => ({
      id: t.cluster.id,
      color: t.color,
      name: t.name,
      count: t.cluster.count,
    }));
    if (showUncategorized && uncategorized) {
      out.push({
        id: uncategorized.id,
        color: palette.other,
        name: "Uncategorized",
        count: uncategorized.count,
      });
    }
    return out;
  }, [topics, showUncategorized, uncategorized, palette]);

  const layout = useMemo(() => {
    const axis = {
      showgrid: true,
      gridcolor: palette.grid,
      showticklabels: false,
      title: "",
      zeroline: false,
    };
    const base = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: isRetro ? "#a1a1aa" : "#94a3b8", size: 9 },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      showlegend: false,
      hoverlabel: {
        bgcolor: isRetro ? "rgba(24, 24, 27, 0.95)" : "rgba(15, 23, 42, 0.95)",
        bordercolor: isRetro ? "#3f3f46" : "#334155",
        font: { color: "#fafafa", size: 11 },
      },
    };
    return { ...base, xaxis: axis, yaxis: axis, dragmode: "pan" as const };
  }, [isRetro, palette]);

  // Keep the page from scrolling while the wheel zooms the plot.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const root = plotRef.current;
      if (root && root.contains(e.target as Node) && e.cancelable) {
        e.preventDefault();
      }
    };
    window.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      window.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!plotlyLoaded || !Plotly || !el || traces.length === 0) return;
    const plotly = Plotly;
    setIsRendered(false);
    plotly
      .newPlot(el, traces, layout, {
        displayModeBar: false,
        responsive: true,
        scrollZoom: true,
      })
      .then(() => setIsRendered(true))
      .catch((err: unknown) => console.error("Plotly render error:", err));
    return () => {
      plotly.purge(el);
      setIsRendered(false);
    };
  }, [plotlyLoaded, traces, layout]);

  // Plotly's `responsive` only follows window resizes. Follow the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!Plotly || !el || !isRendered) return;
    const plotly = Plotly;
    plotly.Plots.resize(el);
    const observer = new ResizeObserver(() => plotly.Plots.resize(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [isRendered]);

  const resetView = useCallback(() => {
    const el = containerRef.current;
    setSelectedCluster(null);
    if (use3d) {
      setResetToken((n) => n + 1);
      return;
    }
    if (!Plotly || !el || !isRendered) return;
    Plotly.relayout(el, {
      "xaxis.autorange": true,
      "yaxis.autorange": true,
    });
  }, [use3d, isRendered]);

  const ready = use3d ? Boolean(data) && !isLoading : isRendered;

  const selected = topics.find((t) => t.cluster.id === selectedCluster);
  const visibleTopics = showAllTopics ? topics : topics.slice(0, TOP_TOPICS);

  const askCasper = () => {
    if (!selected) return;
    setCasperDraft(`What do I talk about in my "${selected.name}" messages?`);
    onAskCasper?.();
  };

  const title = isRetro ? "[topic map]" : "Topic map";
  const label = (retro: string, modern: string) => (isRetro ? retro : modern);

  return (
    <section className="card topic-map">
      <div className="topic-map-header">
        <div className="flex flex-col gap-1">
          <h2 className="section-title">{title}</h2>
          <p className="m-0 text-xs text-[var(--color-text-secondary)]">
            Messages grouped by meaning. Closer dots talk about similar things.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="segmented" role="group" aria-label="View">
            <button
              className="segmented-item focus-ring"
              aria-pressed={use3d}
              onClick={() => onDimensionChange(true)}
            >
              {label("[3d]", "3D")}
            </button>
            <button
              className="segmented-item focus-ring"
              aria-pressed={!use3d}
              onClick={() => onDimensionChange(false)}
            >
              {label("[2d]", "2D")}
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            {label("sample", "Sample")}
            <select
              className="topic-map-select focus-ring"
              value={maxPoints}
              onChange={(e) => setMaxPoints(Number(e.target.value))}
            >
              {SAMPLE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0
                    ? `All ${(data?.total_points ?? 0).toLocaleString()}`
                    : `${n.toLocaleString()} points`}
                </option>
              ))}
            </select>
          </label>
          {onExpand && (
            <button className="btn btn-secondary focus-ring" onClick={onExpand}>
              {label("[full screen]", "Full screen")}
            </button>
          )}
        </div>
      </div>

      <div className="topic-map-body">
        <div
          ref={plotRef}
          className="topic-map-plot"
          style={{ height: plotHeight }}
          onPointerDown={() => use3d && setAutoRotate(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {use3d ? (
            data &&
            !isLoading && (
              <div
                role="img"
                aria-label="3D map of messages grouped by topic"
                className="absolute inset-0"
              >
                <Suspense fallback={null}>
                  <TopicGalaxy
                    points={data.points}
                    topics={galaxyTopics}
                    selectedCluster={selectedCluster}
                    onSelectCluster={setSelectedCluster}
                    autoRotate={autoRotate}
                    resetToken={resetToken}
                    isRetro={isRetro}
                    background={palette.surface}
                    glow={glow}
                  />
                </Suspense>
              </div>
            )
          ) : (
            <div
              ref={containerRef}
              role="img"
              aria-label="Scatter plot of messages grouped by topic"
              className="absolute inset-0"
              style={{ opacity: isRendered ? 1 : 0 }}
            />
          )}
          {(isLoading || !ready) && (
            <div className="topic-map-overlay">
              {isLoading || data ? (
                <>
                  <div className="insights-semantic-spinner-ring" />
                  <span>
                    {label("[loading map...]", "Loading topic map...")}
                  </span>
                </>
              ) : (
                <span>
                  {label(
                    "[no embeddings. run ingestion]",
                    "No embeddings yet. Run ingestion to build the map.",
                  )}
                </span>
              )}
            </div>
          )}
          <div className="topic-map-tools">
            {use3d && (
              <button
                className="btn btn-secondary focus-ring topic-map-tool"
                aria-pressed={autoRotate}
                onClick={() => setAutoRotate((on) => !on)}
              >
                {autoRotate
                  ? label("[pause]", "Pause rotation")
                  : label("[rotate]", "Auto-rotate")}
              </button>
            )}
            <button
              className="btn btn-secondary focus-ring topic-map-tool"
              onClick={resetView}
            >
              {label("[reset]", "Reset view")}
            </button>
            {use3d && (
              <label
                className="topic-map-tool topic-map-glow"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {label("glow", "Glow")}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={glow}
                  onChange={(e) => changeGlow(Number(e.target.value))}
                  className="focus-ring accent-[var(--color-accent)]"
                  aria-label="Glow"
                />
              </label>
            )}
          </div>
          <div className="topic-map-hint">
            {use3d
              ? "Drag to rotate · right-drag to pan · scroll to zoom · click a dot to focus its topic"
              : "Drag to pan · scroll to zoom"}
          </div>
        </div>

        <div className="topic-map-list">
          <div className="eyebrow flex justify-between px-2.5 pb-1.5">
            <span>Topic</span>
            <span>Msgs</span>
          </div>
          {visibleTopics.map((t) => {
            const on = selectedCluster === t.cluster.id;
            return (
              <button
                key={t.cluster.id}
                className="topic-map-row focus-ring"
                aria-pressed={on}
                onClick={() => setSelectedCluster(on ? null : t.cluster.id)}
              >
                <span
                  className="topic-map-dot"
                  style={{ background: t.color }}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0 truncate text-left">
                  {t.name}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                  {t.cluster.count.toLocaleString()}
                </span>
              </button>
            );
          })}
          {topics.length > TOP_TOPICS && (
            <button
              className="topic-map-more focus-ring"
              onClick={() => setShowAllTopics((all) => !all)}
            >
              {showAllTopics
                ? label("[-] top 10 topics", "Show top 10 topics")
                : label(
                    `[+] all ${topics.length} topics`,
                    `Show all ${topics.length} topics`,
                  )}
            </button>
          )}
          {uncategorized && uncategorized.count > 0 && (
            <label className="flex items-center gap-2 px-2.5 pt-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={showUncategorized}
                onChange={(e) => onShowUncategorizedChange(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Show uncategorized ({uncategorized.count.toLocaleString()})
            </label>
          )}
          {selected && (
            <div className="topic-map-selection">
              <div className="text-[13px] font-semibold">{selected.name}</div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                {selected.cluster.count.toLocaleString()} messages
              </div>
              <button
                className="btn btn-primary focus-ring"
                onClick={askCasper}
              >
                {label("[ask casper]", "Ask Casper about this")}
              </button>
            </div>
          )}
          {leakedLabels.length > 0 && (
            <div className="topic-map-warning">
              {isRetro
                ? `[WARN] ${leakedLabels.length} topic name${leakedLabels.length === 1 ? "" : "s"} look like leaked prompt text. Shown as "Unnamed topic". Re-analyze to relabel.`
                : `${leakedLabels.length} topic name${leakedLabels.length === 1 ? "" : "s"} look like leaked prompt text (${leakedLabels
                    .slice(0, 2)
                    .map((c) => `“${c.label.trim()}”`)
                    .join(
                      ", ",
                    )}). Shown as "Unnamed topic". Re-analyze to relabel.`}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

export default TopicMap;

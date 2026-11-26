/**
 * InsightsHeader - Page title, data summary, time range control, Re-analyze
 * Dual-mode: CRT terminal aesthetic (retro) vs clean minimal (modern)
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { saveIngestionSettings, runAnalyticsOnly } from "@/services/tauri";
import { useUIMode } from "@/stores/themeStore";
import { IngestionSettingsModal } from "@/components/settings/IngestionSettingsModal";
import { Tooltip } from "@/components/ui/Tooltip";
import { tooltipContent } from "@/components/ui/tooltipContent";
import type { IngestionSettings } from "@/types";

/** Map Python analytics sub-stage to overall 0-100 progress.
 * Weights are tuned to approximate wall-clock time per stage so the
 * progress bar doesn't stall on slow stages (UMAP, labeling). */
function mapAnalyticsProgress(subStage: string, subPercent: number): number {
  const p = Math.max(0, Math.min(100, subPercent));
  switch (subStage) {
    case "loading":
      return (p / 100) * 5; // 0-5%
    case "pca":
      return 5 + (p / 100) * 5; // 5-10%
    case "clustering":
      return 10 + (p / 100) * 10; // 10-20%
    case "umap_2d":
      return 20 + (p / 100) * 20; // 20-40%
    case "umap_3d":
      return 40 + (p / 100) * 15; // 40-55%
    case "labeling":
      return 55 + (p / 100) * 25; // 55-80% (LLM inference is slow)
    case "saving_clusters":
      return 80 + (p / 100) * 5; // 80-85%
    case "activity":
      return 85 + (p / 100) * 5; // 85-90%
    case "words":
      return 90 + (p / 100) * 10; // 90-100%
    case "complete":
      return 100;
    default:
      return p;
  }
}

const STAGE_DISPLAY_NAMES: Record<string, string> = {
  loading: "Loading embeddings",
  pca: "PCA reduction",
  clustering: "Clustering topics",
  umap_2d: "UMAP 2D projection",
  umap_3d: "UMAP 3D projection",
  labeling: "Labeling topics",
  saving_clusters: "Saving clusters",
  activity: "Activity analysis",
  words: "Word frequency",
  complete: "Complete",
};

interface AnalyticsProgress {
  stage: string;
  percent: number;
}

interface IngestionProgressPayload {
  stages: {
    stage: string;
    percent: number;
    status: string;
    message: string;
  }[];
  current_stage: string | null;
  is_complete: boolean;
  error: string | null;
}

/** Time range presets. "custom" means the user dragged the timeline brush. */
export type InsightsRange = "year" | "all" | "custom";

const RANGE_OPTIONS: { id: InsightsRange; modern: string; retro: string }[] = [
  { id: "year", modern: "Last 365 days", retro: "[last 365d]" },
  { id: "all", modern: "All time", retro: "[all time]" },
];

interface InsightsHeaderProps {
  /** One line on what the page covers, e.g. contact count and date span */
  subtitle?: string;
  range?: InsightsRange;
  onRangeChange?: (range: InsightsRange) => void;
  onReanalyzeStart?: () => void;
  onReanalyzeComplete?: () => void;
}

export function InsightsHeader({
  subtitle,
  range = "all",
  onRangeChange,
  onReanalyzeStart,
  onReanalyzeComplete,
}: InsightsHeaderProps) {
  const { isRetro } = useUIMode();
  const [showReEmbedModal, setShowReEmbedModal] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [progress, setProgress] = useState<AnalyticsProgress | null>(null);

  const handleReanalyze = async (settings: IngestionSettings) => {
    setShowReEmbedModal(false);
    setIsReanalyzing(true);
    setProgress(null);
    onReanalyzeStart?.();

    // Set up event listener BEFORE starting analytics — guarantees no missed events
    const unlisten = await listen<IngestionProgressPayload>(
      "ingestion-progress",
      (event) => {
        const payload = event.payload;

        if (payload.is_complete) {
          setProgress({ stage: "complete", percent: 100 });
          return;
        }

        if (payload.error) return;

        const analyzing = payload.stages.find((s) => s.stage === "analyzing");
        if (!analyzing) return;

        // Message format from Rust: "{sub_stage}: {detail}"
        const colonIdx = analyzing.message.indexOf(":");
        const subStage =
          colonIdx > 0
            ? analyzing.message.slice(0, colonIdx).trim()
            : "analyzing";

        const overallPercent = mapAnalyticsProgress(
          subStage,
          analyzing.percent,
        );

        setProgress({
          stage: subStage,
          percent: Math.round(overallPercent),
        });
      },
    );

    try {
      if (settings) {
        await saveIngestionSettings(settings);
      }
      await runAnalyticsOnly(settings.analytics);
      onReanalyzeComplete?.();
    } catch (err) {
      console.error("Re-analyze failed:", err);
    } finally {
      unlisten();
      setIsReanalyzing(false);
      setProgress(null);
    }
  };

  return (
    <>
      <header className="insights-header">
        <div className="flex flex-col gap-1.5">
          <h1 className="page-title">{isRetro ? "[insights]" : "Insights"}</h1>
          {subtitle && (
            <p className="m-0 text-sm text-[var(--color-text-secondary)]">
              {subtitle}
            </p>
          )}
        </div>

        {/* Re-analyze button + inline progress */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {onRangeChange && (
              <div className="segmented" role="group" aria-label="Time range">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className="segmented-item focus-ring"
                    aria-pressed={range === opt.id}
                    onClick={() => onRangeChange(opt.id)}
                  >
                    {isRetro ? opt.retro : opt.modern}
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn btn-secondary focus-ring"
              onClick={() => setShowReEmbedModal(true)}
              disabled={isReanalyzing}
            >
              {!isRetro && (
                <RefreshCw
                  size={14}
                  className={isReanalyzing ? "animate-spin" : ""}
                />
              )}
              {isReanalyzing ? (
                isRetro ? (
                  "[Analyzing...]"
                ) : (
                  "Analyzing..."
                )
              ) : (
                <Tooltip content={tooltipContent.reanalyze} position="bottom">
                  <span>{isRetro ? "[Re-analyze]" : "Re-analyze"}</span>
                </Tooltip>
              )}
            </button>
          </div>

          {/* Compact progress bar directly under button */}
          {isReanalyzing && (
            <div className="w-full">
              <div
                className={`h-1 w-full rounded-full overflow-hidden ${
                  isRetro
                    ? "bg-[rgba(0,255,65,0.1)]"
                    : "bg-[rgba(16,185,129,0.15)]"
                }`}
              >
                {progress ? (
                  <motion.div
                    className={`h-full rounded-full ${
                      isRetro
                        ? "bg-[var(--color-accent)] shadow-[0_0_6px_rgba(0,255,65,0.5)]"
                        : "bg-[var(--color-accent)]"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress.percent}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                ) : (
                  <motion.div
                    className={`h-full w-1/3 rounded-full ${
                      isRetro
                        ? "bg-[var(--color-accent)] shadow-[0_0_6px_rgba(0,255,65,0.5)]"
                        : "bg-[var(--color-accent)]"
                    }`}
                    animate={{ x: ["0%", "200%", "0%"] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                )}
              </div>
              <p
                className={`
                  mt-1 text-right
                  ${
                    isRetro
                      ? "font-terminal text-[10px] text-[var(--color-accent)] opacity-70"
                      : "text-[10px] text-[var(--color-text-muted)]"
                  }
                `}
              >
                {progress
                  ? `${STAGE_DISPLAY_NAMES[progress.stage] || progress.stage} · ${progress.percent}%`
                  : "Starting..."}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Re-embed settings modal */}
      <IngestionSettingsModal
        mode="re-embed"
        isOpen={showReEmbedModal}
        onConfirm={handleReanalyze}
        onCancel={() => setShowReEmbedModal(false)}
      />
    </>
  );
}

export default InsightsHeader;

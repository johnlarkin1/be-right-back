/**
 * InsightsLayout - Main analytics dashboard container
 * Order: header, stat tiles, topic map, timeline, words and activity.
 * Orchestrates all insights components with brush-based filtering
 * Dual-mode: CRT aesthetic (retro) vs clean layout (modern)
 *
 * Simplified: Each component fetches its own data via granular hooks.
 * InsightsLayout only manages:
 * - Prerequisite checking (snapshot, vector DB)
 * - Brush range coordination between Timeline and TopWords
 */
import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import { useInsightsStore, useStatsFromStore } from "@/stores/insightsStore";
import { useInitStatus } from "@/hooks/useInitStatus";
import type { TabId, InsightsDateRange } from "@/types";
import { Ghost } from "../Ghost";
import { NeedsSetup } from "../home/NeedsSetup";
import { getMessageDateRange } from "@/services/tauri";
import { formatDate } from "@/lib/format";
import { InsightsHeader, type InsightsRange } from "./InsightsHeader";
import { StatsRow } from "./StatsRow";
import { MessageTimeline } from "./MessageTimeline";
import { TopWords } from "./TopWords";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { DayPanel, dayPeriod, type PanelPeriod } from "./DayPanel";
import { TopicMap } from "./TopicMap";
import { TapbacksSection } from "./tapbacks/TapbacksSection";

interface InsightsLayoutProps {
  onNavigate?: (tab: TabId) => void;
}

export function InsightsLayout({ onNavigate }: InsightsLayoutProps) {
  const { isRetro } = useUIMode();
  const windowHeight = useWindowHeight();

  // Initialization status
  const { status: initStatus, isLoading: checkingPrereqs } = useInitStatus();

  // Date range from timeline brush selection (passed to TopWords)
  const [dateRange, setDateRange] = useState<InsightsDateRange | null>(null);

  // Header range preset; dragging the timeline brush makes it "custom"
  const [range, setRange] = useState<InsightsRange>("all");

  // Topic map controls: 3D by default, uncategorized points hidden
  const [use3d, setUse3d] = useState(true);
  const [showUncategorized, setShowUncategorized] = useState(false);
  const [topicMapFull, setTopicMapFull] = useState(false);
  // The day, week or month whose details are open in the side panel
  const [panelPeriod, setPanelPeriod] = useState<PanelPeriod | null>(null);
  const closeDayPanel = useCallback(() => setPanelPeriod(null), []);
  // A second click on the open period closes the panel
  const togglePeriod = useCallback(
    (next: PanelPeriod) =>
      setPanelPeriod((open) =>
        open?.start === next.start && open.end === next.end ? null : next,
      ),
    [],
  );

  // First and last message dates for the header line
  const [dateSpan, setDateSpan] = useState<string | null>(null);
  useEffect(() => {
    getMessageDateRange()
      .then((r) => {
        const opts = { year: "numeric", month: "short" } as const;
        setDateSpan(
          `${formatDate(r.earliest_date, opts)} to ${formatDate(r.latest_date, opts)}`,
        );
      })
      .catch(() => setDateSpan(null));
  }, []);

  // Get stats from store for empty state check
  const { stats, error } = useStatsFromStore();

  // Brush drag on the timeline: TopWords refetches for the new range
  const handleBrushChange = useCallback((brush: InsightsDateRange | null) => {
    setDateRange(brush);
    setRange("custom");
  }, []);

  // Refetch all data (invalidate store and let components refetch)
  const refetch = useCallback(() => {
    useInsightsStore.getState().invalidateAll();
  }, []);

  // Loading state while checking prerequisites
  if (checkingPrereqs) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Ghost size={48} variant="sleepy" animate={true} />
      </div>
    );
  }

  // Check if snapshot exists
  if (initStatus && !initStatus.has_snapshot) {
    return (
      <NeedsSetup
        title="Snapshot Required"
        description="Create a snapshot of your iMessage data first. This safely copies your messages for processing while keeping everything local on your device."
        actionLabel="Go to Setup"
        onAction={() => onNavigate?.("casper")}
        variant="green"
        ghostVariant="sleepy"
      />
    );
  }

  // Check if ingestion is complete (vector DB required for insights)
  if (initStatus && !initStatus.has_vector_db) {
    return (
      <NeedsSetup
        title="Ingestion Required"
        description="Run data ingestion to generate insights and analytics. This processes your messages and creates visualizations."
        actionLabel="Go to Setup"
        onAction={() => onNavigate?.("casper")}
        variant="green"
        ghostVariant="sleepy"
      />
    );
  }

  // Analytics not available state (run analytics pipeline)
  if (
    error?.includes("run analytics pipeline") ||
    error?.includes("No visualization data") ||
    error?.includes("No insights data")
  ) {
    return (
      <NeedsSetup
        title="Analytics Not Ready"
        description="Run ingestion from the Home tab to generate insights visualization."
        actionLabel="Go to Setup"
        onAction={() => onNavigate?.("casper")}
        variant="green"
        ghostVariant="sleepy"
      />
    );
  }

  // General error state (skip transient DB lock errors — DB is busy during re-analysis)
  const isTransientDbError = error?.includes("failed to open vector db");
  if (error && !isTransientDbError) {
    return (
      <div
        className={`
          flex-1 flex flex-col items-center justify-center gap-4
          ${isRetro ? "" : ""}
        `}
      >
        <Ghost size={64} variant="worried" animate={true} />
        <h2
          className={`
            text-lg font-semibold
            ${
              isRetro
                ? "font-terminal text-[var(--color-accent)] text-glow"
                : "text-[var(--color-text-primary)]"
            }
          `}
        >
          {isRetro ? "ERROR" : "Something went wrong"}
        </h2>
        <p
          className={`
            text-sm max-w-md text-center
            ${
              isRetro
                ? "text-[var(--color-text-muted)] font-terminal"
                : "text-[var(--color-text-secondary)]"
            }
          `}
        >
          {error}
        </p>
        <motion.button
          className={`
            px-4 py-2 rounded-[var(--radius-button)] flex items-center gap-2
            ${
              isRetro
                ? "bg-transparent border border-[var(--color-accent)] text-[var(--color-accent)] font-terminal hover:bg-[rgba(0,255,65,0.1)]"
                : "bg-[var(--color-accent-subtle)] text-[var(--color-accent)] hover:bg-[rgba(16,185,129,0.15)]"
            }
          `}
          onClick={refetch}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {!isRetro && <RefreshCw size={14} />}
          {isRetro ? "[Retry]" : "Retry"}
        </motion.button>
      </div>
    );
  }

  // Empty state - no data yet (stats loaded but totalMessages is 0)
  if (stats && stats.total_messages === 0) {
    return (
      <div
        className={`
          flex-1 flex flex-col items-center justify-center gap-4
          ${isRetro ? "" : ""}
        `}
      >
        <Ghost size={64} variant="surprised" animate={true} />
        <h2
          className={`
            text-lg font-semibold
            ${
              isRetro
                ? "font-terminal text-[var(--color-accent)] text-glow"
                : "text-[var(--color-text-primary)]"
            }
          `}
        >
          {isRetro ? "NO DATA YET" : "No data yet"}
        </h2>
        <p
          className={`
            text-sm max-w-md text-center
            ${
              isRetro
                ? "text-[var(--color-text-muted)] font-terminal"
                : "text-[var(--color-text-secondary)]"
            }
          `}
        >
          {isRetro
            ? "Run ingestion from the Home tab to see your conversation insights."
            : "Complete the setup process on the Home tab to generate insights."}
        </p>
      </div>
    );
  }

  const contactCount = initStatus?.snapshot_contact_count ?? 0;
  const subtitle = [
    contactCount > 0
      ? `Patterns across ${contactCount.toLocaleString()} contacts`
      : "Patterns across your messages",
    dateSpan ? `, ${dateSpan}` : "",
    ". Analyzed on this Mac.",
  ].join("");

  const topicMapProps = {
    use3d,
    onDimensionChange: setUse3d,
    showUncategorized,
    onShowUncategorizedChange: setShowUncategorized,
    onAskCasper: () => onNavigate?.("casper"),
  };

  if (topicMapFull) {
    return (
      <div className="insights-layout">
        <div className="page-column" style={{ maxWidth: 1360, gap: 16 }}>
          <button
            className="self-start min-h-8 inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-ring"
            onClick={() => setTopicMapFull(false)}
          >
            {isRetro ? "< cd ../insights" : "← Back to Insights"}
          </button>
          <TopicMap
            {...topicMapProps}
            plotHeight={Math.max(windowHeight - 260, 480)}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`insights-layout ${panelPeriod ? "insights-layout-with-panel" : ""}`}
    >
      <div className="page-column">
        <InsightsHeader
          subtitle={subtitle}
          range={range}
          onRangeChange={setRange}
          onReanalyzeComplete={refetch}
        />

        {/* Stats row - fetches its own data */}
        <StatsRow />

        {/* Topic map: the centerpiece, 3D by default */}
        <TopicMap {...topicMapProps} onExpand={() => setTopicMapFull(true)} />

        {/* Timeline with brush selection; the brush filters the word list */}
        <MessageTimeline
          brushRange={dateRange}
          onBrushChange={handleBrushChange}
          rangePreset={range}
          onPresetApplied={setDateRange}
          selectedPeriod={panelPeriod}
          onSelectPeriod={togglePeriod}
        />

        <div className="insights-bottom-row">
          <TopWords dateRange={dateRange} />
          <ActivityHeatmap
            selectedDate={
              panelPeriod?.kind === "day" ? panelPeriod.start : null
            }
            onSelectDay={(date) => togglePeriod(dayPeriod(date))}
          />
        </div>

        {/* Tapbacks: follows the timeline brush, like the word list */}
        <TapbacksSection dateRange={dateRange} />
      </div>

      <DayPanel
        period={panelPeriod}
        onClose={closeDayPanel}
        onAskCasper={() => onNavigate?.("casper")}
      />
    </div>
  );
}

export default InsightsLayout;

/** Tracks the window's inner height for the full-screen topic map. */
function useWindowHeight() {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

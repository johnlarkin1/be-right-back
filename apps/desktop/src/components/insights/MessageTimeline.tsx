/**
 * MessageTimeline - Bar chart with Brush for date range selection
 * Dual-mode: CRT neon colors (retro) vs muted palette (modern)
 *
 * Fetches its own data via useTimelineData hook - only refetches when aggregation changes.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Brush,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";
import { useUIMode } from "@/stores/themeStore";
import { useTimelineData } from "./useTimelineData";
import type { InsightsRange } from "./InsightsHeader";
import { timelinePeriod, type PanelPeriod } from "./DayPanel";
import type {
  AggregatedCount,
  InsightsDateRange,
  AggregationType,
} from "@/types";

// Recharts takes data keys as plain strings, so tsc cannot catch a key that
// no longer exists on the row. `satisfies` ties each key to AggregatedCount.
const KEYS = {
  period: "period",
  displayPeriod: "display_period",
  fromMe: "from_me",
  fromThem: "from_them",
  total: "total",
} as const satisfies Record<string, keyof AggregatedCount>;

// Chart color palettes for retro vs modern modes
const chartColors = {
  retro: {
    fromMe: "#00ff41", // CRT green
    fromMeDim: "#52525b", // Dimmed when not in range
    fromThem: "#00d4ff", // CRT cyan
    fromThemDim: "#52525b",
    axis: "#71717a",
    axisLine: "#27272a",
    brush: "#00ff41",
    brushFill: "#0a0e0a",
    cursorFill: "rgba(0, 255, 65, 0.05)",
    selected: "#e4ffe9",
  },
  modern: {
    fromMe: "#10b981", // Emerald
    fromMeDim: "#64748b", // Slate dimmed
    fromThem: "#3b82f6", // Blue
    fromThemDim: "#64748b",
    axis: "#94a3b8", // Slate-400
    axisLine: "#334155", // Slate-700
    brush: "#10b981",
    brushFill: "#0f172a", // Slate-900
    cursorFill: "rgba(16, 185, 129, 0.05)",
    selected: "#f8fafc",
  },
};

interface MessageTimelineProps {
  brushRange: InsightsDateRange | null;
  /** Called when the user drags the brush */
  onBrushChange: (range: InsightsDateRange | null) => void;
  /** "year" selects the last 365 days, "all" clears the brush */
  rangePreset?: InsightsRange;
  /** Called with the range a preset selects */
  onPresetApplied?: (range: InsightsDateRange | null) => void;
  /** The period open in the side panel, highlighted in the chart */
  selectedPeriod?: PanelPeriod | null;
  /** Opens the side panel for a clicked bar */
  onSelectPeriod?: (period: PanelPeriod) => void;
}

/** ISO date one year before today, e.g. "2025-11-23". */
function oneYearAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

const AGGREGATION_OPTIONS: AggregationType[] = ["daily", "weekly", "monthly"];

// Custom tooltip component with mode-aware styling
function CustomTooltip({
  active,
  payload,
  label,
  hasBreakdown,
  isRetro,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
  hasBreakdown?: boolean;
  isRetro?: boolean;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Get total - either from the total dataKey or sum of from_me/from_them
  const totalEntry = payload.find((p) => p.dataKey === KEYS.total);
  const total = totalEntry
    ? totalEntry.value
    : payload.reduce((sum, p) => sum + (p.value || 0), 0);

  const colors = isRetro ? chartColors.retro : chartColors.modern;

  return (
    <div className="insights-timeline-tooltip">
      <div className="insights-timeline-tooltip-date">{label}</div>
      <div className="insights-timeline-tooltip-total">{total} messages</div>
      {hasBreakdown && (
        <div className="insights-timeline-tooltip-breakdown">
          <span
            className="insights-timeline-tooltip-me"
            style={{ color: colors.fromMe }}
          >
            {isRetro ? "↑" : "Sent:"}{" "}
            {payload.find((p) => p.dataKey === KEYS.fromMe)?.value || 0}
          </span>
          <span
            className="insights-timeline-tooltip-them"
            style={{ color: colors.fromThem }}
          >
            {isRetro ? "↓" : "Received:"}{" "}
            {payload.find((p) => p.dataKey === KEYS.fromThem)?.value || 0}
          </span>
        </div>
      )}
    </div>
  );
}

export const MessageTimeline = memo(function MessageTimeline({
  brushRange,
  onBrushChange,
  rangePreset = "custom",
  onPresetApplied,
  selectedPeriod = null,
  onSelectPeriod,
}: MessageTimelineProps) {
  const { isRetro } = useUIMode();

  // Internal aggregation state - only this component cares about aggregation
  const [selectedAggregation, setSelectedAggregation] =
    useState<AggregationType>("monthly");

  // Fetch timeline data via own hook - only refetches when aggregation changes
  const { timelineData, isLoading } = useTimelineData(selectedAggregation);
  const data = timelineData || [];

  // Get colors based on mode
  const colors = useMemo(
    () => (isRetro ? chartColors.retro : chartColors.modern),
    [isRetro],
  );

  // Apply a header preset: select the last 365 days, or clear the brush.
  const presetRange = useMemo((): InsightsDateRange | null => {
    if (rangePreset !== "year" || data.length === 0) return null;
    const cutoff = oneYearAgo();
    const found = data.findIndex((d) => d.period >= cutoff);
    const start = found === -1 ? data.length - 1 : found;
    const end = data.length - 1;
    return {
      startDate: data[start].period,
      endDate: data[end].period,
      startIndex: start,
      endIndex: end,
    };
  }, [rangePreset, data]);

  useEffect(() => {
    if (rangePreset === "custom") return;
    onPresetApplied?.(presetRange);
  }, [rangePreset, presetRange, onPresetApplied]);

  // Handle brush change events
  const handleBrushChange = useCallback(
    (range: { startIndex?: number; endIndex?: number }) => {
      if (
        range.startIndex !== undefined &&
        range.endIndex !== undefined &&
        data.length > 0
      ) {
        // Normalize indices so start is always <= end (prevents handles crossing)
        const start = Math.min(range.startIndex, range.endIndex);
        const end = Math.max(range.startIndex, range.endIndex);

        onBrushChange({
          startDate: data[start].period,
          endDate: data[end].period,
          startIndex: start,
          endIndex: end,
        });
      } else {
        onBrushChange(null);
      }
    },
    [data, onBrushChange],
  );

  // Clicking a bar opens its day, week or month in the side panel.
  // Clicks on the brush below the chart only move the brush.
  const handleChartClick = useCallback(
    (
      state: { activeTooltipIndex?: number } | null,
      event?: { target?: EventTarget | null },
    ) => {
      const index = state?.activeTooltipIndex;
      if (!onSelectPeriod || index === undefined || !data[index]) return;
      const target = event?.target;
      if (target instanceof Element && target.closest(".recharts-brush")) {
        return;
      }
      onSelectPeriod(timelinePeriod(data[index].period, selectedAggregation));
    },
    [data, onSelectPeriod, selectedAggregation],
  );

  // The bar whose period is open in the side panel
  const selectedIndex = useMemo(() => {
    if (!selectedPeriod) return -1;
    return data.findIndex((d) => {
      const p = timelinePeriod(d.period, selectedAggregation);
      return p.start === selectedPeriod.start && p.end === selectedPeriod.end;
    });
  }, [data, selectedPeriod, selectedAggregation]);

  // Calculate max for consistent scaling
  const maxValue = useMemo(() => {
    return Math.max(...data.map((d) => d.total), 1);
  }, [data]);

  // Determine tick interval based on data length
  const tickInterval = useMemo(() => {
    if (data.length <= 30) return 4;
    if (data.length <= 90) return 14;
    if (data.length <= 365) return 30;
    return Math.floor(data.length / 12);
  }, [data.length]);

  if (isLoading) {
    return (
      <section className="insights-timeline-section">
        <div className="insights-timeline-header">
          <h2 className="section-title">
            {isRetro ? "[messages over time]" : "Messages over time"}
          </h2>
          <div className="insights-aggregation-toggle">
            {AGGREGATION_OPTIONS.map((type) => (
              <button
                key={type}
                className={selectedAggregation === type ? "active" : ""}
                disabled
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="insights-timeline-card insights-timeline-loading">
          <div className="insights-timeline-skeleton" />
        </div>
      </section>
    );
  }

  return (
    <section className="insights-timeline-section">
      <div className="insights-timeline-header">
        <div className="flex flex-col gap-1">
          <h2 className="section-title">
            {isRetro ? "[messages over time]" : "Messages over time"}
          </h2>
          <p className="m-0 text-xs text-[var(--color-text-secondary)]">
            Drag the handles below the chart to filter your words.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex gap-3.5 text-xs text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="legend-swatch"
                style={{ background: colors.fromMe }}
              />
              You
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="legend-swatch"
                style={{ background: colors.fromThem }}
              />
              Them
            </span>
          </div>
          <div className="segmented" role="group" aria-label="Group by">
            {AGGREGATION_OPTIONS.map((type) => (
              <button
                key={type}
                className="segmented-item focus-ring"
                aria-pressed={selectedAggregation === type}
                onClick={() => setSelectedAggregation(type)}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {brushRange && (
          <motion.span
            className="insights-timeline-range-badge"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {brushRange.startDate} → {brushRange.endDate}
          </motion.span>
        )}
      </div>

      <div className="insights-timeline-card">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            onClick={handleChartClick}
            style={{ cursor: onSelectPeriod ? "pointer" : undefined }}
          >
            <XAxis
              dataKey={KEYS.displayPeriod}
              tick={{ fontSize: 9, fill: colors.axis }}
              tickLine={false}
              axisLine={{ stroke: colors.axisLine }}
              interval={tickInterval}
            />
            <YAxis
              tick={{ fontSize: 9, fill: colors.axis }}
              tickLine={false}
              axisLine={false}
              domain={[0, maxValue]}
              tickFormatter={(v) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
              }
            />
            <Tooltip
              content={<CustomTooltip hasBreakdown={true} isRetro={isRetro} />}
              cursor={{ fill: colors.cursorFill }}
            />

            {/* Stacked bars: fromMe on bottom, fromThem on top */}
            <Bar
              dataKey={KEYS.fromMe}
              stackId="messages"
              radius={isRetro ? [0, 0, 0, 0] : [2, 2, 0, 0]}
              maxBarSize={8}
              fill={colors.fromMe}
            >
              {data.map((_, index) => {
                const isInRange =
                  brushRange &&
                  index >= brushRange.startIndex &&
                  index <= brushRange.endIndex;
                return (
                  <Cell
                    key={`me-${index}`}
                    stroke={
                      index === selectedIndex ? colors.selected : undefined
                    }
                    fill={
                      isInRange || !brushRange
                        ? colors.fromMe
                        : colors.fromMeDim
                    }
                    fillOpacity={isInRange || !brushRange ? 0.8 : 0.3}
                  />
                );
              })}
            </Bar>
            <Bar
              dataKey={KEYS.fromThem}
              stackId="messages"
              radius={isRetro ? [2, 2, 0, 0] : [4, 4, 0, 0]}
              maxBarSize={8}
              fill={colors.fromThem}
            >
              {data.map((_, index) => {
                const isInRange =
                  brushRange &&
                  index >= brushRange.startIndex &&
                  index <= brushRange.endIndex;
                return (
                  <Cell
                    key={`them-${index}`}
                    stroke={
                      index === selectedIndex ? colors.selected : undefined
                    }
                    fill={
                      isInRange || !brushRange
                        ? colors.fromThem
                        : colors.fromThemDim
                    }
                    fillOpacity={isInRange || !brushRange ? 0.8 : 0.3}
                  />
                );
              })}
            </Bar>

            <Brush
              key={`${rangePreset}-${selectedAggregation}-${data.length}`}
              startIndex={presetRange?.startIndex}
              endIndex={presetRange?.endIndex}
              dataKey={KEYS.period}
              height={28}
              stroke={colors.brush}
              fill={colors.brushFill}
              onChange={handleBrushChange}
              tickFormatter={() => ""}
              travellerWidth={8}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
});

export default MessageTimeline;

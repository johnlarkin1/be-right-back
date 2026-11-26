/**
 * ActivityHeatmap - GitHub-style contribution calendar
 * Dual-mode: CRT green scale (retro) vs emerald scale (modern)
 *
 * Fetches its own data via useCalendarData hook - fully independent.
 */
import { memo, useState, useMemo, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useUIMode } from "@/stores/themeStore";
import { useCalendarData } from "./useCalendarData";
import type { CalendarCell } from "@/types";

/** Years shown as buttons. Older years go in the "Earlier" menu. */
const RECENT_YEARS = 3;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Color scales for heatmap intensity - solid colors for maximum contrast
// Inspired by GitHub's contribution graph: distinct hues, not just opacity
const heatmapColors = {
  retro: {
    empty: "rgba(39, 39, 42, 0.6)", // zinc-800 with opacity
    levels: [
      "#0a3d1a", // dark muted green
      "#0d6b2e", // medium-dark green
      "#17a34a", // medium-bright green
      "#22ee5c", // vivid neon green
    ],
    hoverGlow: "rgba(0, 255, 65, 0.7)",
  },
  modern: {
    empty: "rgba(51, 65, 85, 0.4)", // slate-700 with opacity
    levels: [
      "#064e3b", // emerald-950 dark
      "#047857", // emerald-700
      "#10b981", // emerald-500
      "#34d399", // emerald-400 bright
    ],
    hoverGlow: "none",
  },
};

// Get intensity level (0-4) using percentile-based bucketing
// This spreads days across all 4 levels for maximum visual variety
function getIntensityLevel(
  count: number,
  thresholds: [number, number, number],
): number {
  if (count === 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

// Get intensity color based on mode and level
function getIntensityColor(level: number, isRetro: boolean): string {
  const colors = isRetro ? heatmapColors.retro : heatmapColors.modern;
  if (level === 0) return colors.empty;
  return colors.levels[level - 1];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}

// View mode: T-365 (rolling 365 days) or specific calendar year
type ViewMode = "T-365" | number;

interface ActivityHeatmapProps {
  /** The day whose details are open, highlighted in the grid */
  selectedDate?: string | null;
  /** Opens the details of a clicked day */
  onSelectDay?: (date: string) => void;
}

export const ActivityHeatmap = memo(function ActivityHeatmap({
  selectedDate = null,
  onSelectDay,
}: ActivityHeatmapProps) {
  const { isRetro } = useUIMode();
  const [hoveredCell, setHoveredCell] = useState<CalendarCell | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // View mode state - default to T-365 (rolling 365 days)
  const [selectedView, setSelectedView] = useState<ViewMode>("T-365");

  // Fetch calendar data via own hook - fully independent of other components
  const { calendarData: rawCalendarData, isLoading } = useCalendarData();
  const data = rawCalendarData || [];

  // Get glow color based on mode
  const hoverGlowColor = isRetro
    ? heatmapColors.retro.hoverGlow
    : heatmapColors.modern.hoverGlow;

  // Compute available years from the data
  // Always include current year so user can see "no activity yet" for the new year
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearsSet = new Set<number>([currentYear]);
    for (const cell of data) {
      const year = parseInt(cell.date.slice(0, 4), 10);
      yearsSet.add(year);
    }
    // Sort descending (most recent first)
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [data]);

  const olderYears = availableYears.slice(RECENT_YEARS);
  const isOlderYear =
    typeof selectedView === "number" && olderYears.includes(selectedView);

  // Build a lookup map of date -> cell data
  const dataLookup = useMemo(() => {
    const lookup = new Map<string, CalendarCell>();
    for (const cell of data) {
      lookup.set(cell.date, cell);
    }
    return lookup;
  }, [data]);

  // Compute date range based on view mode
  const { rangeStart, rangeEnd } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedView === "T-365") {
      // Rolling 365-day window: 364 days ago to today (inclusive = 365 days)
      const start = new Date(today);
      start.setDate(start.getDate() - 364);
      return { rangeStart: start, rangeEnd: today };
    } else {
      // Calendar year mode
      const currentYear = today.getFullYear();
      const yearStart = new Date(selectedView, 0, 1); // Jan 1
      const yearEnd =
        selectedView < currentYear
          ? new Date(selectedView, 11, 31) // Dec 31
          : today;
      return { rangeStart: yearStart, rangeEnd: yearEnd };
    }
  }, [selectedView]);

  // Compute percentile-based thresholds for the visible date range
  // This ensures all 4 color levels are well-represented, like GitHub's graph
  const intensityThresholds = useMemo((): [number, number, number] => {
    const startStr = rangeStart.toISOString().slice(0, 10);
    const endStr = rangeEnd.toISOString().slice(0, 10);

    // Collect all non-zero counts in the range
    const counts: number[] = [];
    for (const cell of data) {
      if (cell.date >= startStr && cell.date <= endStr && cell.count > 0) {
        counts.push(cell.count);
      }
    }

    if (counts.length === 0) return [1, 2, 3];

    counts.sort((a, b) => a - b);

    // Use quartile boundaries (25th, 50th, 75th percentile)
    const p = (pct: number) => {
      const idx = Math.floor((pct / 100) * (counts.length - 1));
      return counts[idx];
    };

    const p25 = p(25);
    const p50 = p(50);
    const p75 = p(75);

    // Ensure thresholds are strictly increasing so each level is reachable
    const t1 = p25;
    const t2 = Math.max(p50, t1 + 1);
    const t3 = Math.max(p75, t2 + 1);

    return [t1, t2, t3];
  }, [data, rangeStart, rangeEnd]);

  // Generate calendar grid based on view mode
  // T-365: last 365 days (may span 2 calendar years)
  // Year: Jan 1 to Dec 31 (or today for current year)
  const calendarData = useMemo(() => {
    const cells: CalendarCell[] = [];

    // Find the Sunday at or before range start (to align weeks)
    const firstSundayOffset = rangeStart.getDay();
    const alignedStart = new Date(rangeStart);
    alignedStart.setDate(alignedStart.getDate() - firstSundayOffset);

    // Iterate through all days
    const current = new Date(alignedStart);
    let weekIndex = 0;

    while (current <= rangeEnd) {
      // Use local date formatting to avoid UTC timezone issues
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, "0");
      const day = String(current.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = current.getDay();

      // Include all days within the range (for T-365, spans multiple years)
      if (current >= rangeStart && current <= rangeEnd) {
        const existingCell = dataLookup.get(dateStr);
        const count = existingCell?.count || 0;
        const sent = existingCell?.sent || 0;
        const received = existingCell?.received || 0;

        cells.push({
          date: dateStr,
          day_of_week: dayOfWeek,
          week_index: weekIndex,
          count,
          sent,
          received,
          intensity: getIntensityLevel(count, intensityThresholds),
        });
      }

      // Move to next day
      current.setDate(current.getDate() + 1);

      // Increment week on Sunday (after Saturday)
      if (dayOfWeek === 6) {
        weekIndex++;
      }
    }

    return cells;
  }, [rangeStart, rangeEnd, dataLookup, intensityThresholds]);

  // Group cells by week for columnar layout
  const weekColumns = useMemo(() => {
    const columns: CalendarCell[][] = [];
    let currentWeek: CalendarCell[] = [];
    let lastWeekIndex = -1;

    for (const cell of calendarData) {
      if (cell.week_index !== lastWeekIndex && currentWeek.length > 0) {
        columns.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(cell);
      lastWeekIndex = cell.week_index;
    }
    if (currentWeek.length > 0) {
      columns.push(currentWeek);
    }
    return columns;
  }, [calendarData]);

  // Get month labels for the header
  const monthLabels = useMemo(() => {
    const labels: { month: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    for (const cell of calendarData) {
      const date = new Date(cell.date + "T00:00:00");
      const month = date.getMonth();
      if (month !== lastMonth && cell.day_of_week === 0) {
        labels.push({ month: MONTH_NAMES[month], weekIndex: cell.week_index });
        lastMonth = month;
      }
    }
    // Drop a label that sits too close to the next one, e.g. a partial
    // first month, so the two names do not overlap.
    return labels.filter(
      (label, i) =>
        i === labels.length - 1 ||
        labels[i + 1].weekIndex - label.weekIndex >= 3,
    );
  }, [calendarData]);

  // Calculate total messages for selected year
  const totalMessages = useMemo(() => {
    return calendarData.reduce((sum, cell) => sum + cell.count, 0);
  }, [calendarData]);

  if (isLoading) {
    return (
      <section className="insights-heatmap-section">
        <h2 className="section-title">
          {isRetro ? "[when you text]" : "When you text"}
        </h2>
        <div className="insights-heatmap-card insights-heatmap-loading">
          <div className="insights-heatmap-skeleton" />
        </div>
      </section>
    );
  }

  return (
    <section className="insights-heatmap-section">
      <div className="insights-heatmap-header">
        <div className="flex flex-col gap-1">
          <h2 className="section-title">
            {isRetro ? "[when you text]" : "When you text"}
          </h2>
          <p className="m-0 text-xs text-[var(--color-text-secondary)]">
            {totalMessages.toLocaleString()} messages in{" "}
            {selectedView === "T-365" ? "the last 365 days" : selectedView}
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Year">
          {(
            ["T-365", ...availableYears.slice(0, RECENT_YEARS)] as ViewMode[]
          ).map((view) => (
            <button
              key={view}
              className="segmented-item focus-ring"
              aria-pressed={selectedView === view}
              onClick={() => setSelectedView(view)}
            >
              {view === "T-365" ? (isRetro ? "[365d]" : "365 days") : view}
            </button>
          ))}
          {olderYears.length > 0 && (
            <select
              aria-label="Earlier years"
              className="segmented-item segmented-select focus-ring"
              data-active={isOlderYear}
              value={isOlderYear ? String(selectedView) : ""}
              onChange={(e) => setSelectedView(Number(e.target.value))}
            >
              <option value="" disabled>
                {isRetro ? "[earlier]" : "Earlier"}
              </option>
              {olderYears.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="insights-calendar-card">
        {/* Tooltip */}
        <AnimatePresence>
          {hoveredCell && (
            <motion.div
              className="insights-calendar-tooltip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                left: mousePos.x + 12,
                top: mousePos.y - 40,
              }}
            >
              <span className="insights-calendar-tooltip-count">
                {hoveredCell.count}{" "}
                {hoveredCell.count === 1 ? "message" : "messages"}
              </span>
              <span className="insights-calendar-tooltip-date">
                {DAY_NAMES_FULL[hoveredCell.day_of_week]},{" "}
                {formatDate(hoveredCell.date)}
              </span>
              {hoveredCell.count > 0 && (
                <div className="insights-calendar-tooltip-breakdown">
                  <span className="insights-calendar-tooltip-me">
                    ↑ {hoveredCell.sent} sent
                  </span>
                  <span className="insights-calendar-tooltip-them">
                    ↓ {hoveredCell.received} received
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Month labels row */}
        <div className="insights-calendar-months">
          {monthLabels.map((label, idx) => (
            <span
              key={idx}
              className="insights-calendar-month"
              style={{ "--week": label.weekIndex } as CSSProperties}
            >
              {label.month}
            </span>
          ))}
        </div>

        {/* Main calendar grid */}
        <div className="insights-calendar-container">
          {/* Day labels column */}
          <div className="insights-calendar-days">
            {[1, 3, 5].map((dow) => (
              <span
                key={dow}
                className="insights-calendar-day-label"
                style={{ gridRow: dow + 1 }}
              >
                {DAY_LABELS[dow]}
              </span>
            ))}
          </div>

          {/* Calendar cells grid */}
          <div className="insights-calendar-grid">
            {weekColumns.map((week, weekIdx) => (
              <div key={weekIdx} className="insights-calendar-week">
                {week.map((cell) => {
                  const isHovered = hoveredCell?.date === cell.date;
                  return (
                    <motion.div
                      key={cell.date}
                      className={`
                        insights-calendar-cell
                        ${isRetro ? "" : "rounded-sm"}
                      `}
                      style={{
                        backgroundColor: getIntensityColor(
                          cell.intensity,
                          isRetro,
                        ),
                        gridRow: cell.day_of_week + 1,
                      }}
                      animate={{
                        scale: isHovered ? 1.3 : 1,
                        boxShadow:
                          isHovered && isRetro
                            ? `0 0 8px ${hoverGlowColor}`
                            : "none",
                      }}
                      onMouseEnter={(e) => {
                        setHoveredCell(cell);
                        setMousePos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => {
                        setMousePos({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                      onClick={() => onSelectDay?.(cell.date)}
                      role="button"
                      aria-label={`${cell.date}: ${cell.count} messages`}
                      aria-pressed={selectedDate === cell.date}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="insights-calendar-legend">
          <span className="insights-calendar-legend-label">Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={`
                insights-calendar-legend-cell
                ${isRetro ? "" : "rounded-sm"}
              `}
              style={{ backgroundColor: getIntensityColor(level, isRetro) }}
            />
          ))}
          <span className="insights-calendar-legend-label">More</span>
          <span
            className={`
              insights-calendar-total
              ${
                isRetro
                  ? "font-terminal text-[var(--color-text-muted)]"
                  : "text-[var(--color-text-secondary)]"
              }
            `}
          >
            {totalMessages.toLocaleString()} messages{" "}
            {selectedView === "T-365"
              ? "in last 365 days"
              : `in ${selectedView}`}
          </span>
        </div>
      </div>
    </section>
  );
});

export default ActivityHeatmap;

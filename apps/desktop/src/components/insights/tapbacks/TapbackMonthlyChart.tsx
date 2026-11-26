/**
 * TapbackMonthlyChart - Tapbacks per month, stacked by kind group.
 * A toggle switches between Tapbacks you gave and Tapbacks you got.
 */
import { memo, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUIMode } from "@/stores/themeStore";
import type { TapbackMonth } from "@/bindings/ingestion";
import { GROUPS, GROUP_COLORS, GROUP_LABELS, groupOf } from "./kinds";
import type { TapbackGroup } from "./kinds";

type Direction = "given" | "received";

type MonthRow = { period: string; label: string; total: number } & Record<
  TapbackGroup,
  number
>;

const AXIS = {
  retro: { axis: "#71717a", line: "#27272a", cursor: "rgba(0,255,65,0.05)" },
  modern: {
    axis: "#94a3b8",
    line: "#334155",
    cursor: "rgba(148,163,184,0.08)",
  },
};

/** Pivot (month, kind) rows into one row per month with a count per group. */
export function pivotMonths(
  months: TapbackMonth[],
  direction: Direction,
): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  for (const m of months) {
    let row = rows.get(m.period);
    if (!row) {
      const [y, mo] = m.period.split("-").map(Number);
      const label = new Date(y, mo - 1, 1).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      });
      row = {
        period: m.period,
        label,
        total: 0,
        love: 0,
        laugh: 0,
        like: 0,
        emphasize: 0,
        other: 0,
      };
      rows.set(m.period, row);
    }
    const n = direction === "given" ? m.given : m.received;
    row[groupOf(m.kind)] += n;
    row.total += n;
  }
  return [...rows.values()].sort((a, b) => a.period.localeCompare(b.period));
}

function MonthTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: MonthRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="insights-timeline-tooltip">
      <div className="insights-timeline-tooltip-date">{label}</div>
      <div className="insights-timeline-tooltip-total">
        {row.total.toLocaleString()} Tapbacks
      </div>
      {[...GROUPS].reverse().map((g) =>
        row[g] > 0 ? (
          <div key={g} className="flex items-center gap-1.5 text-xs">
            <span
              className="legend-swatch"
              style={{ background: GROUP_COLORS[g] }}
            />
            {GROUP_LABELS[g]} {row[g].toLocaleString()}
          </div>
        ) : null,
      )}
    </div>
  );
}

interface TapbackMonthlyChartProps {
  months: TapbackMonth[];
}

export const TapbackMonthlyChart = memo(function TapbackMonthlyChart({
  months,
}: TapbackMonthlyChartProps) {
  const { isRetro } = useUIMode();
  const axis = isRetro ? AXIS.retro : AXIS.modern;
  const [direction, setDirection] = useState<Direction>("given");
  const data = useMemo(
    () => pivotMonths(months, direction),
    [months, direction],
  );
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3.5 text-xs text-[var(--color-text-secondary)]">
          {GROUPS.map((g) => (
            <span key={g} className="inline-flex items-center gap-1.5">
              <span
                className="legend-swatch"
                style={{ background: GROUP_COLORS[g] }}
              />
              {GROUP_LABELS[g]}
            </span>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Direction">
          {(["given", "received"] as const).map((d) => (
            <button
              key={d}
              className="segmented-item focus-ring"
              aria-pressed={direction === d}
              onClick={() => setDirection(d)}
            >
              {d === "given" ? "You gave" : "You got"}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          No Tapbacks in this range.
        </p>
      ) : (
        <div className="insights-timeline-card">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: axis.axis }}
                tickLine={false}
                axisLine={{ stroke: axis.line }}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 9, fill: axis.axis }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
                }
              />
              <Tooltip
                content={<MonthTooltip />}
                cursor={{ fill: axis.cursor }}
              />
              {GROUPS.map((g, i) => (
                <Bar
                  key={g}
                  dataKey={g}
                  stackId="tapbacks"
                  fill={GROUP_COLORS[g]}
                  maxBarSize={10}
                  radius={
                    i === GROUPS.length - 1 && !isRetro ? [4, 4, 0, 0] : 0
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
});

export default TapbackMonthlyChart;

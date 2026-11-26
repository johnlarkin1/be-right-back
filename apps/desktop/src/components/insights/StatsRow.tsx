/**
 * StatsRow - Four stat tiles: messages, reply time, active days, topics
 * Dual-mode: uppercase terminal labels (retro) vs plain labels (modern)
 *
 * Fetches its own data via useInsightsStats hook - independent of aggregation changes.
 */
import { memo } from "react";
import { useUIMode } from "@/stores/themeStore";
import { formatNumber } from "@/lib/format";
import { useInsightsStats } from "./useInsightsStats";
import { Tooltip } from "@/components/ui/Tooltip";
import { tooltipContent } from "@/components/ui/tooltipContent";

interface StatItem {
  modernLabel: string;
  retroLabel: string;
  value: string;
  unit: string;
  note: string;
  tooltip?: string;
}

/** Split minutes into a value and a unit, e.g. 44 -> ["44", "min"]. */
function formatReplyTime(mins: number): [string, string] {
  if (mins < 1) return [`${Math.round(mins * 60)}`, "sec"];
  if (mins >= 60) return [(mins / 60).toFixed(1), "hr"];
  return [`${Math.round(mins)}`, "min"];
}

export const StatsRow = memo(function StatsRow() {
  const { isRetro } = useUIMode();
  const { stats: statsData, isLoading } = useInsightsStats();

  const [replyValue, replyUnit] = formatReplyTime(
    statsData?.avg_response_time_mins || 0,
  );

  const stats: StatItem[] = [
    {
      modernLabel: "Messages",
      retroLabel: "MESSAGES",
      value: formatNumber(statsData?.total_messages || 0),
      unit: "",
      note: "sent and received",
    },
    {
      modernLabel: "Your reply time",
      retroLabel: "REPLY_TIME",
      value: replyValue,
      unit: replyUnit,
      note: "typical gap before you answer",
      tooltip: tooltipContent.response,
    },
    {
      modernLabel: "Active days",
      retroLabel: "ACTIVE_DAYS",
      value: formatNumber(statsData?.active_days || 0),
      unit: "days",
      note: "days with at least one message",
      tooltip: tooltipContent.active,
    },
    {
      modernLabel: "Topics",
      retroLabel: "TOPICS",
      value: (statsData?.topics_count || 0).toString(),
      unit: "",
      note: "clusters in the topic map",
      tooltip: tooltipContent.topics,
    },
  ];

  if (isLoading) {
    return (
      <section aria-label="Summary" className="insights-stats-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-elevated insights-stat-loading">
            <div className="insights-stat-skeleton" />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section aria-label="Summary" className="insights-stats-row">
      {stats.map((stat) => {
        const label = (
          <span className="stat-label">
            {isRetro ? stat.retroLabel : stat.modernLabel}
          </span>
        );
        return (
          <div key={stat.modernLabel} className="card-elevated stat-tile">
            {stat.tooltip ? (
              <Tooltip content={stat.tooltip} position="bottom">
                {label}
              </Tooltip>
            ) : (
              label
            )}
            <div className="stat-value">
              {stat.value}
              {stat.unit && <span className="stat-unit"> {stat.unit}</span>}
            </div>
            <div className="stat-note">{stat.note}</div>
          </div>
        );
      })}
    </section>
  );
});

export default StatsRow;

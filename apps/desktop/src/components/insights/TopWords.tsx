/**
 * TopWords - your most-used words as a ranked bar list
 * Dual-mode: bracket title (retro) vs plain title (modern)
 *
 * Fetches its own data via useWordFrequencies hook.
 * Supports filtering by date range (from timeline brush selection).
 */
import { memo, useEffect } from "react";
import { useUIMode } from "@/stores/themeStore";
import { useWordFrequencies } from "./useWordFrequencies";
import type { InsightsDateRange } from "@/types";

/** Words shown in the list. */
const TOP_WORDS = 8;

interface TopWordsProps {
  dateRange: InsightsDateRange | null;
}

export const TopWords = memo(function TopWords({ dateRange }: TopWordsProps) {
  const { isRetro } = useUIMode();
  const { filteredWords, isLoading, fetchWordsForRange, resetFilter } =
    useWordFrequencies();

  useEffect(() => {
    if (dateRange) {
      fetchWordsForRange(dateRange);
    } else {
      resetFilter();
    }
  }, [dateRange, fetchWordsForRange, resetFilter]);

  const words = filteredWords.slice(0, TOP_WORDS);
  const maxCount = Math.max(...words.map((w) => w.count), 1);

  const subtitle = dateRange
    ? `${dateRange.startDate} to ${dateRange.endDate}`
    : "Across all your messages";

  return (
    <section className="insights-wordcloud-section">
      <div className="flex flex-col gap-1">
        <h2 className="section-title">
          {isRetro ? "[most-used words]" : "Your most-used words"}
        </h2>
        <p className="m-0 text-xs text-[var(--color-text-secondary)]">
          {subtitle}
        </p>
      </div>

      {isLoading ? (
        <div className="insights-wordcloud-card insights-wordcloud-loading">
          <div className="insights-wordcloud-skeleton" />
        </div>
      ) : (
        <ol className="m-0 p-0 list-none flex flex-col gap-2.5">
          {words.map((w, i) => (
            <li
              key={w.word}
              className="grid items-center gap-2.5 text-[13px]"
              style={{ gridTemplateColumns: "20px 96px minmax(0, 1fr)" }}
              title={`${w.count.toLocaleString()} uses`}
            >
              <span className="text-xs text-right text-[var(--color-text-secondary)]">
                {i + 1}
              </span>
              <span className="truncate">{w.word}</span>
              <span className="h-2 rounded bg-[var(--color-accent-subtle)] overflow-hidden">
                <span
                  className="block h-full bg-[var(--color-accent)]"
                  style={{ width: `${(w.count / maxCount) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});

export default TopWords;

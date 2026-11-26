/**
 * TapbacksSection - Insights card for Tapbacks (iMessage reactions):
 * kind mix, who reacts to whom, Tapbacks per month, most-loved messages
 * and emoji Tapbacks.
 *
 * Follows the timeline brush, like the word list.
 */
import { memo, useMemo } from "react";
import { useUIMode } from "@/stores/themeStore";
import type { InsightsDateRange } from "@/types";
import { windowFromRange } from "./kinds";
import { useTapbacks } from "./useTapbacks";
import { TapbackMix } from "./TapbackMix";
import { TapbackPeople } from "./TapbackPeople";
import { TapbackMonthlyChart } from "./TapbackMonthlyChart";
import { EmojiTapbacks, MostLovedMessages } from "./MostLoved";

interface TapbacksSectionProps {
  dateRange: InsightsDateRange | null;
}

export const TapbacksSection = memo(function TapbacksSection({
  dateRange,
}: TapbacksSectionProps) {
  const { isRetro } = useUIMode();
  const window = useMemo(() => windowFromRange(dateRange), [dateRange]);
  const { summary, people, months, loved, emojis, isLoading, error } =
    useTapbacks(window);

  const subtitle = dateRange
    ? `${dateRange.startDate} to ${dateRange.endDate}. 1:1 and group chats.`
    : "Reactions you give and get, in 1:1 and group chats.";

  return (
    <section className="insights-timeline-section" aria-label="Tapbacks">
      <div className="flex flex-col gap-1">
        <h2 className="section-title">{isRetro ? "[tapbacks]" : "Tapbacks"}</h2>
        <p className="m-0 text-xs text-[var(--color-text-secondary)]">
          {subtitle}
        </p>
      </div>

      {error ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          Tapbacks are not ready. Re-run ingestion to read them.
        </p>
      ) : isLoading && !summary ? (
        <div className="insights-timeline-card insights-timeline-loading">
          <div className="insights-timeline-skeleton" />
        </div>
      ) : summary && summary.given + summary.received === 0 && !dateRange ? (
        <p className="m-0 text-sm text-[var(--color-text-secondary)]">
          No Tapbacks found. Re-run ingestion to read them from your messages.
        </p>
      ) : (
        <>
          <div className="tapbacks-grid">
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="tapbacks-subtitle">{isRetro ? "> mix" : "Mix"}</h3>
              {summary && <TapbackMix summary={summary} />}
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="tapbacks-subtitle">
                {isRetro ? "> who reacts to whom" : "Who reacts to whom"}
              </h3>
              <TapbackPeople people={people} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="tapbacks-subtitle">
              {isRetro ? "> per month" : "Per month"}
            </h3>
            <TapbackMonthlyChart months={months} />
          </div>
          <div className="tapbacks-grid">
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="tapbacks-subtitle">
                {isRetro ? "> most-loved messages" : "Your most-loved messages"}
              </h3>
              <MostLovedMessages messages={loved} />
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className="tapbacks-subtitle">
                {isRetro ? "> emoji tapbacks" : "Emoji Tapbacks"}
              </h3>
              <EmojiTapbacks emojis={emojis} />
            </div>
          </div>
        </>
      )}
    </section>
  );
});

export default TapbacksSection;

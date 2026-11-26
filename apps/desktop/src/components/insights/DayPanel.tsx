/**
 * DayPanel - Side panel with the details of one day, week or month
 *
 * Opens from the right when a heatmap day or a timeline bar is clicked. Shows
 * the period's totals, who you texted, active topics, top words and snippets.
 * Dual UI mode support (retro/modern).
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import { useCasperDraftStore } from "@/stores/casperDraftStore";
import { getDayDetails } from "@/services/tauri";
import { isLeakedLabel } from "./TopicMap";
import type { AggregationType, DayDetails } from "@/types";

/** People listed before "and N more". */
const TOP_PEOPLE = 6;

/** The period the panel shows. Both dates are ISO and inclusive. */
export interface PanelPeriod {
  kind: "day" | "week" | "month";
  start: string;
  end: string;
}

interface DayPanelProps {
  /** The period to show, or null when closed */
  period: PanelPeriod | null;
  onClose: () => void;
  /** Switches to Ask Casper after the draft question is set */
  onAskCasper?: () => void;
}

/**
 * "2024-01-15" as a local calendar date, so the weekday does not shift.
 * A month-only "2024-01" reads as the first of the month.
 */
function parseDay(date: string): Date {
  const [y, m, d = 1] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A single-day period. */
export function dayPeriod(date: string): PanelPeriod {
  return { kind: "day", start: date, end: date };
}

/**
 * The period behind a timeline bar. `period` is the first active date in the
 * bar. Weekly bars group by ISO week (Monday first), monthly bars by month.
 */
export function timelinePeriod(
  period: string,
  aggregation: AggregationType,
): PanelPeriod {
  if (aggregation === "daily") return dayPeriod(period);
  const d = parseDay(period);
  if (aggregation === "weekly") {
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { kind: "week", start: isoDay(monday), end: isoDay(sunday) };
  }
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { kind: "month", start: isoDay(first), end: isoDay(last) };
}

export function formatDayTitle(date: string): string {
  return parseDay(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPeriodTitle(period: PanelPeriod): string {
  if (period.kind === "day") return formatDayTitle(period.start);
  if (period.kind === "month") {
    return parseDay(period.start).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const monday = parseDay(period.start).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `Week of ${monday}`;
}

/** The question "Ask Casper" hands over for a period. */
export function casperQuestion(period: PanelPeriod): string {
  const title = formatPeriodTitle(period);
  if (period.kind === "day") return `What did I talk about on ${title}?`;
  if (period.kind === "week") {
    return `What did I talk about in the week of ${title.slice("Week of ".length)}?`;
  }
  return `What did I talk about in ${title}?`;
}

function formatTime(at: string, withDate: boolean): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!withDate) return time;
  const day = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day}, ${time}`;
}

const KIND_LABELS = {
  day: { retro: "[day]", modern: "Day", noun: "day" },
  week: { retro: "[week]", modern: "Week", noun: "week" },
  month: { retro: "[month]", modern: "Month", noun: "month" },
} as const;

export function DayPanel({ period, onClose, onAskCasper }: DayPanelProps) {
  const { isRetro } = useUIMode();
  const setCasperDraft = useCasperDraftStore((s) => s.setDraft);
  const [details, setDetails] = useState<DayDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = period?.start ?? null;
  const end = period?.end ?? null;

  useEffect(() => {
    if (!start || !end) return;
    let cancelled = false;
    setDetails(null);
    setError(null);
    getDayDetails(start, end)
      .then((d) => !cancelled && setDetails(d))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  useEffect(() => {
    if (!period) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [period, onClose]);

  const label = (retro: string, modern: string) => (isRetro ? retro : modern);

  const askCasper = () => {
    if (!period) return;
    setCasperDraft(casperQuestion(period));
    onAskCasper?.();
  };

  const kind = period ? KIND_LABELS[period.kind] : KIND_LABELS.day;

  return (
    <AnimatePresence>
      {period && (
        <motion.aside
          key="day-panel"
          role="dialog"
          aria-label={`Details for ${formatPeriodTitle(period)}`}
          className="day-panel"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.2 }}
        >
          <header className="day-panel-header">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="eyebrow">{label(kind.retro, kind.modern)}</span>
              <h2 className="section-title">{formatPeriodTitle(period)}</h2>
            </div>
            <button
              className="day-panel-close focus-ring"
              onClick={onClose}
              aria-label={`Close ${kind.noun} details`}
            >
              {isRetro ? "[x]" : <X size={16} />}
            </button>
          </header>

          <div className="day-panel-body">
            {error ? (
              <p className="day-panel-note">
                Could not load this {kind.noun}: {error}
              </p>
            ) : !details ? (
              <p className="day-panel-note animate-pulse">Loading...</p>
            ) : details.sent + details.received === 0 ? (
              <p className="day-panel-note">No messages this {kind.noun}.</p>
            ) : (
              <DayContent
                details={details}
                isRetro={isRetro}
                multiDay={period.kind !== "day"}
              />
            )}
          </div>

          <footer className="day-panel-footer">
            <button className="btn btn-primary focus-ring" onClick={askCasper}>
              {label(
                `[ask casper about this ${kind.noun}]`,
                `Ask Casper about this ${kind.noun}`,
              )}
            </button>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function DayContent({
  details,
  isRetro,
  multiDay,
}: {
  details: DayDetails;
  isRetro: boolean;
  /** Snippet times also show the date */
  multiDay: boolean;
}) {
  const label = (retro: string, modern: string) => (isRetro ? retro : modern);
  const total = details.sent + details.received;
  const people = details.contacts.slice(0, TOP_PEOPLE);
  const morePeople = details.contacts.length - people.length;
  const busiest = Math.max(...people.map((c) => c.sent + c.received), 1);

  return (
    <>
      <div className="day-panel-stats">
        <Stat label={label("TOTAL", "Messages")} value={total} />
        <Stat label={label("SENT", "Sent")} value={details.sent} />
        <Stat label={label("RECEIVED", "Received")} value={details.received} />
      </div>

      <section className="day-panel-section">
        <div className="flex items-center justify-between gap-3">
          <h3 className="eyebrow">{label("[people]", "People")}</h3>
          <span className="flex gap-3 text-xs text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="legend-swatch day-panel-bar-sent" />
              You
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="legend-swatch day-panel-bar-received" />
              Them
            </span>
          </span>
        </div>
        <ul className="day-panel-people">
          {people.map((c) => {
            const count = c.sent + c.received;
            return (
              <li key={c.contact_id}>
                <div className="flex justify-between gap-3 text-[13px]">
                  <span className="truncate">{c.name}</span>
                  <span className="text-[var(--color-text-secondary)] tabular-nums">
                    {count.toLocaleString()}
                  </span>
                </div>
                <div
                  className="day-panel-bar"
                  style={{ width: `${(count / busiest) * 100}%` }}
                  title={`${c.sent} sent, ${c.received} received`}
                >
                  <span
                    className="day-panel-bar-sent"
                    style={{ flexGrow: c.sent }}
                  />
                  <span
                    className="day-panel-bar-received"
                    style={{ flexGrow: c.received }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {morePeople > 0 && (
          <p className="day-panel-note">and {morePeople} more</p>
        )}
      </section>

      {details.topics.length > 0 && (
        <section className="day-panel-section">
          <h3 className="eyebrow">{label("[topics]", "Topics")}</h3>
          <div className="day-panel-chips">
            {details.topics.map((t) => (
              <span key={t.cluster_id} className="day-panel-chip">
                {isLeakedLabel(t.label) ? "Unnamed topic" : t.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {details.words.length > 0 && (
        <section className="day-panel-section">
          <h3 className="eyebrow">{label("[words]", "Words")}</h3>
          <div className="day-panel-chips">
            {details.words.map((w) => (
              <span key={w.word} className="day-panel-chip">
                {w.word}{" "}
                <span className="text-[var(--color-text-muted)]">
                  {w.count}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      {details.snippets.length > 0 && (
        <section className="day-panel-section">
          <h3 className="eyebrow">{label("[moments]", "Moments")}</h3>
          <ul className="day-panel-snippets">
            {details.snippets.map((s, i) => (
              <li key={i}>
                <div className="flex justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0">{formatTime(s.at, multiDay)}</span>
                </div>
                <p className="m-0 text-[13px] leading-snug">{s.preview}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="day-panel-stat">
      <span className="stat-label">{label}</span>
      <span className="day-panel-stat-value">{value.toLocaleString()}</span>
    </div>
  );
}

export default DayPanel;

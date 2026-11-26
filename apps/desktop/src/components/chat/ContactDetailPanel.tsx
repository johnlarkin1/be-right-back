/**
 * ContactDetailPanel - Detail page for one contact or for "Digital You"
 *
 * Shows a title row with persona actions, stat tiles, the Tapback mix, the personality
 * analysis card and, once trained, the model details.
 * Only "Digital You" can be trained. Dual UI mode support (retro/modern).
 */
import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { AnalysisCard } from "./AnalysisCard";
import { ConversationAnalysisModal } from "./ConversationAnalysisModal";
import { useConversationAnalysis } from "@/hooks/useConversationAnalysis";
import { useUIMode } from "@/stores/themeStore";
import { TapbackMix } from "@/components/insights/tapbacks/TapbackMix";
import { useTapbackSummary } from "@/components/insights/tapbacks/useTapbacks";
import { formatDate } from "@/lib/format";
import type {
  ContactWithStatus,
  ContactDetailStats,
  TrainedPersona,
} from "@/types";

interface ContactDetailPanelProps {
  contact: ContactWithStatus;
  stats: ContactDetailStats | null;
  persona: TrainedPersona | null;
  isLoading: boolean;
  onGeneratePersona: () => void;
  onChat: () => void;
  onRetrain: () => void;
}

/** "12 years 9 months" between two ISO dates. */
/** Reads a date-only "2024-01-15" as local midnight, not UTC midnight. */
function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value);
}

function spanLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const a = parseLocalDate(start);
  const b = parseLocalDate(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (rest > 0) parts.push(`${rest} month${rest === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" ") : "under a month";
}

export function ContactDetailPanel({
  contact,
  stats,
  persona,
  isLoading,
  onGeneratePersona,
  onChat,
  onRetrain,
}: ContactDetailPanelProps) {
  const { isRetro } = useUIMode();
  const isYou = contact.is_you;
  const displayName = isYou
    ? "Digital You"
    : contact.display_name || contact.contact_id;
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const {
    analysis,
    isGenerating,
    phase,
    loadCachedAnalysis,
    startAnalysis,
    reset: resetAnalysis,
  } = useConversationAnalysis();

  useEffect(() => {
    if (contact.contact_id) {
      loadCachedAnalysis(contact.contact_id);
    }
    return () => {
      resetAnalysis();
    };
  }, [contact.contact_id, loadCachedAnalysis, resetAnalysis]);

  const handleAnalyze = () => {
    startAnalysis(contact.contact_id, displayName, false);
    setIsAnalysisModalOpen(true);
  };

  const label = (retro: string, modern: string) => (isRetro ? retro : modern);
  const title = isRetro ? `[${displayName.toLowerCase()}]` : displayName;

  const range =
    stats?.date_range_start && stats?.date_range_end
      ? `${formatDate(stats.date_range_start, { month: "short", year: "numeric" })} to ${formatDate(stats.date_range_end, { month: "short", year: "numeric" })}`
      : null;

  let subtitle: string;
  if (isYou && persona) {
    subtitle = `Trained on your own messages${range ? `, ${range}` : ""}. Last trained ${formatDate(persona.trained_at)}.`;
  } else if (isYou) {
    subtitle =
      "Train a persona on your own messages. It learns from your replies in your 1:1 chats.";
  } else {
    subtitle = range ? `Messages from ${range}.` : contact.contact_id;
  }

  const sent = stats?.messages_from_me ?? 0;
  const usedPct =
    persona && sent > 0
      ? Math.min(100, Math.round((persona.message_count / sent) * 100))
      : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-[1120px] box-border px-10 pt-8 pb-12 flex flex-col gap-[var(--space-section)]">
        <section className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="page-title">{title}</h1>
              {isYou && persona && (
                <span className="text-xs text-[var(--color-success)] border border-[var(--color-border-accent)] px-2.5 py-0.5 rounded-[var(--radius-badge)]">
                  {label("[DIGITAL-YOU] READY", "Persona ready")}
                </span>
              )}
            </div>
            <p className="m-0 text-[var(--color-text-secondary)]">{subtitle}</p>
          </div>
          {isYou && (
            <div className="flex flex-wrap gap-2.5">
              {persona ? (
                <>
                  <button
                    className="btn btn-secondary focus-ring"
                    onClick={onRetrain}
                  >
                    {label("[retrain]", "Retrain")}
                  </button>
                  <button
                    className="btn btn-primary focus-ring"
                    onClick={onChat}
                  >
                    {label("[chat with digital you]", "Chat with Digital You")}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary focus-ring"
                  onClick={onGeneratePersona}
                >
                  {label("[train digital you]", "Train Digital You")}
                </button>
              )}
            </div>
          )}
        </section>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            {isRetro ? (
              <Ghost size={32} variant="sleepy" animate />
            ) : (
              <RefreshCw
                size={24}
                className="animate-spin text-[var(--color-text-muted)]"
              />
            )}
          </div>
        ) : stats ? (
          <>
            <section
              aria-label="Stats"
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              }}
            >
              {isYou ? (
                <StatTile
                  label={label("MESSAGES_SENT", "Messages sent")}
                  value={sent.toLocaleString()}
                  note={
                    spanLabel(stats.date_range_start, stats.date_range_end)
                      ? `over ${spanLabel(stats.date_range_start, stats.date_range_end)}`
                      : undefined
                  }
                />
              ) : (
                <>
                  <StatTile
                    label={label("MESSAGES", "Messages")}
                    value={stats.message_count.toLocaleString()}
                    note={
                      spanLabel(stats.date_range_start, stats.date_range_end)
                        ? `over ${spanLabel(stats.date_range_start, stats.date_range_end)}`
                        : undefined
                    }
                  />
                  <StatTile
                    label={label("FROM_YOU", "From you")}
                    value={stats.messages_from_me.toLocaleString()}
                    note={`${stats.messages_from_them.toLocaleString()} from them`}
                  />
                </>
              )}
              {isYou && persona && (
                <StatTile
                  label={label("USED_IN_TRAINING", "Used in training")}
                  value={persona.message_count.toLocaleString()}
                  note={`${usedPct}% of your history`}
                  progress={usedPct}
                />
              )}
              <StatTile
                label={label("AVG_LENGTH", "Average length")}
                value={`${Math.round(stats.avg_message_length)}`}
                unit="chars"
              />
              <StatTile
                label={label("EMOJI_RATE", "Emoji rate")}
                value={`${(stats.emoji_rate * 100).toFixed(1)}%`}
                note={
                  stats.top_emojis.length > 0
                    ? `top: ${stats.top_emojis.slice(0, 5).join(" ")}`
                    : "of messages use an emoji"
                }
              />
            </section>

            <ContactTapbacks
              contactId={isYou ? null : contact.contact_id}
              title={label("[tapbacks]", "Tapbacks")}
              otherLabel={isYou ? "others" : "they"}
            />

            <AnalysisCard
              analysis={analysis}
              isGenerating={isGenerating}
              phase={phase}
              contactName={isYou ? "you" : displayName}
              onAnalyze={handleAnalyze}
              onViewAnalysis={() => setIsAnalysisModalOpen(true)}
            />

            {persona && (
              <section className="card overflow-hidden">
                <button
                  onClick={() => setDetailsOpen((open) => !open)}
                  aria-expanded={detailsOpen}
                  className="focus-ring w-full min-h-[52px] px-5 bg-transparent text-[var(--color-text-primary)] text-sm font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span>{label("[model details]", "Model details")}</span>
                  <span className="text-xs font-normal text-[var(--color-text-secondary)]">
                    {detailsOpen ? label("[-]", "Hide") : label("[+]", "Show")}
                  </span>
                </button>
                {detailsOpen && (
                  <div
                    className="grid gap-4 px-5 pt-4 pb-5 border-t border-[var(--color-border)]"
                    style={{
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(220px, 1fr))",
                    }}
                  >
                    <Detail label="Base model" value={persona.base_model} />
                    <Detail
                      label="Adapter size"
                      value={persona.adapter_size_display}
                    />
                    <Detail
                      label="Message range"
                      value={
                        stats.date_range_start && stats.date_range_end
                          ? `${stats.date_range_start} → ${stats.date_range_end}`
                          : "N/A"
                      }
                    />
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          <div className="text-center text-[var(--color-text-muted)]">
            Failed to load stats
          </div>
        )}
      </div>

      <ConversationAnalysisModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        analysis={analysis}
        contactName={displayName}
        isGenerating={isGenerating}
        phase={phase}
        onReanalyze={() => startAnalysis(contact.contact_id, displayName, true)}
      />
    </div>
  );
}

/** Stat tile: label, big value, optional unit, note and progress bar. */
function StatTile({
  label,
  value,
  unit,
  note,
  progress,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  progress?: number;
}) {
  return (
    <div className="card-elevated stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit"> {unit}</span>}
      </div>
      {progress !== undefined && (
        <div className="progress-track mt-0.5">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/** One label/value pair in the model details grid. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
      <div className="font-[var(--font-mono)] text-[13px] break-all">
        {value}
      </div>
    </div>
  );
}

export default ContactDetailPanel;

/** Tapback mix between you and one contact, or across everyone for "You". */
function ContactTapbacks({
  contactId,
  title,
  otherLabel,
}: {
  contactId: string | null;
  title: string;
  otherLabel: string;
}) {
  const { summary, isLoading } = useTapbackSummary(contactId);
  if (isLoading || !summary || summary.given + summary.received === 0) {
    return null;
  }
  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Tapbacks">
      <h2 className="m-0 text-sm font-semibold">{title}</h2>
      <TapbackMix summary={summary} otherLabel={otherLabel} />
    </section>
  );
}

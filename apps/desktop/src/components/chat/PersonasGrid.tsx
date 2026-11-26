/**
 * PersonasGrid - Landing screen of the Personas tab
 *
 * One card per trained persona with Chat and Details actions, plus a dashed
 * tile that trains Digital You or opens the contact list.
 * Only "Digital You" can be trained. Dual UI mode support (retro/modern).
 */
import { useUIMode } from "@/stores/themeStore";
import { Avatar } from "./ChatSidebar";
import type { ContactWithStatus, TrainedPersona } from "@/types";

interface PersonasGridProps {
  personas: TrainedPersona[];
  /** The "You" contact, for the total of sent messages */
  youContact?: ContactWithStatus;
  onChat: (persona: TrainedPersona) => void;
  onDetails: (persona: TrainedPersona) => void;
  /** Opens the Digital You detail, where training starts */
  onTrainYou: () => void;
  /** Opens the contact list */
  onBrowseContacts: () => void;
}

export function PersonasGrid({
  personas,
  youContact,
  onChat,
  onDetails,
  onTrainYou,
  onBrowseContacts,
}: PersonasGridProps) {
  const { isRetro } = useUIMode();
  const label = (retro: string, modern: string) => (isRetro ? retro : modern);
  const hasYou = personas.some((p) => p.contact_id === youContact?.contact_id);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <main className="page-column" style={{ maxWidth: 1200, paddingTop: 40 }}>
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="page-title">{label("[personas]", "Personas")}</h1>
            <p className="m-0 text-[var(--color-text-secondary)]">
              Chat with a model trained on how you text. {personas.length}{" "}
              ready.
            </p>
          </div>
          {hasYou ? (
            <button
              className="btn btn-secondary focus-ring"
              onClick={onBrowseContacts}
            >
              {label("[browse contacts]", "Browse contacts")}
            </button>
          ) : (
            <button className="btn btn-primary focus-ring" onClick={onTrainYou}>
              {label("[+] train digital you", "Train Digital You")}
            </button>
          )}
        </section>

        <section
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          }}
        >
          {personas.map((persona) => {
            const isYou = persona.contact_id === youContact?.contact_id;
            const name = isYou ? "Digital You" : persona.display_name;
            const total = isYou ? (youContact?.message_count ?? 0) : 0;
            const pct =
              total > 0
                ? Math.min(
                    100,
                    Math.round((persona.message_count / total) * 100),
                  )
                : null;
            return (
              <article
                key={persona.id}
                className="card p-5 flex flex-col gap-[18px]"
              >
                <div className="flex items-center gap-3.5">
                  <Avatar
                    initial={isYou ? "Y" : name.charAt(0).toUpperCase()}
                    size={52}
                    accent
                  />
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <h2 className="m-0 text-base font-semibold truncate">
                      {name}
                    </h2>
                    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)]">
                      <span className="w-[7px] h-[7px] rounded-full bg-[var(--color-success)]" />
                      {label("[READY]", "Ready")}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                    <span>
                      Trained on {persona.message_count.toLocaleString()}
                      {total > 0 ? ` of ${total.toLocaleString()}` : ""}{" "}
                      messages
                    </span>
                    {pct !== null && <span>{pct}%</span>}
                  </div>
                  {pct !== null && (
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex gap-2.5">
                  <button
                    className="btn btn-primary focus-ring flex-1"
                    onClick={() => onChat(persona)}
                  >
                    {label("[chat]", "Chat")}
                  </button>
                  <button
                    className="btn btn-secondary focus-ring"
                    onClick={() => onDetails(persona)}
                  >
                    {label("[details]", "Details")}
                  </button>
                </div>
              </article>
            );
          })}

          <button
            onClick={hasYou ? onBrowseContacts : onTrainYou}
            className="focus-ring min-h-[220px] border border-dashed border-[var(--color-border)] rounded-[var(--radius-card)] p-[22px] flex flex-col items-center justify-center gap-2.5 text-center text-[var(--color-text-secondary)] bg-transparent cursor-pointer hover:border-[var(--color-border-accent)] transition-colors"
          >
            <span className="font-[var(--font-display)] text-[22px] text-[var(--color-text-accent)]">
              {label("[+]", "+")}
            </span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {hasYou ? "Browse your contacts" : "Train Digital You"}
            </span>
            <span className="text-[13px] leading-relaxed max-w-[240px]">
              {hasYou
                ? "See stats and a personality analysis for anyone you text."
                : "It learns from your own replies in your 1:1 chats. Training runs on this Mac."}
            </span>
          </button>
        </section>
      </main>
    </div>
  );
}

export default PersonasGrid;

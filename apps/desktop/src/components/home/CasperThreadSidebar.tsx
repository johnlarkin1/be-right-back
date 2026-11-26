/**
 * CasperThreadSidebar - ChatGPT-style left rail of saved Casper conversations.
 *
 * Lists persisted Casper threads, grouped by month, with a "New question"
 * action, active highlight, and per-thread rename / delete controls.
 * Dual-mode (retro / modern) styling.
 */
import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import type { CasperConversation } from "@/types";

interface CasperThreadSidebarProps {
  threads: CasperConversation[];
  activeThreadId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  /** Disable actions while a query is in flight */
  isProcessing: boolean;
}

/** Month label for a thread: "September", or "September 2025" in past years. */
function monthLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    "en-US",
    sameYear ? { month: "long" } : { month: "long", year: "numeric" },
  );
}

/** Group threads by month, keeping their order (newest first). */
function groupByMonth(
  threads: CasperConversation[],
): { label: string; threads: CasperConversation[] }[] {
  const groups: { label: string; threads: CasperConversation[] }[] = [];
  for (const thread of threads) {
    const label = monthLabel(thread.updated_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.threads.push(thread);
    else groups.push({ label, threads: [thread] });
  }
  return groups;
}

export function CasperThreadSidebar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  isProcessing,
}: CasperThreadSidebarProps) {
  const { isRetro } = useUIMode();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEditing = (thread: CasperConversation) => {
    setEditingId(thread.id);
    setEditValue(thread.title);
  };

  const commitEditing = () => {
    if (editingId != null) {
      const title = editValue.trim();
      if (title) onRename(editingId, title);
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue("");
  };

  return (
    <aside className="w-72 shrink-0 flex flex-col h-full overflow-hidden border-r border-[var(--color-border)]">
      {/* Header / New question */}
      <div className="p-4 pb-2">
        <button
          onClick={onNew}
          className="btn btn-secondary focus-ring w-full min-h-10"
          title="Start a new conversation"
        >
          {isRetro ? "[+] new question" : "New question"}
        </button>
      </div>

      {/* Thread list, grouped by month */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">
        {threads.length === 0 ? (
          <p
            className={`
              px-2 py-4 text-center text-xs
              ${isRetro ? "font-mono text-[var(--color-text-muted)]/60" : "text-[var(--color-text-muted)]"}
            `}
          >
            {isRetro ? "> no saved questions yet" : "No saved questions yet"}
          </p>
        ) : (
          groupByMonth(threads).map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <div className="eyebrow px-2.5 pb-1">{group.label}</div>
              {group.threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                const isEditing = thread.id === editingId;

                const rowClass = `group relative px-2.5 py-2 rounded-[var(--radius-button)] cursor-pointer transition-colors ${
                  isActive
                    ? "bg-[var(--nav-item-active-bg)]"
                    : "hover:bg-[var(--color-surface-hover)]"
                }`;

                return (
                  <div
                    key={thread.id}
                    className={rowClass}
                    onClick={() => !isEditing && onSelect(thread.id)}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEditing();
                            if (e.key === "Escape") cancelEditing();
                          }}
                          className={`
                        flex-1 min-w-0 bg-transparent outline-none text-xs py-0.5 border-b
                        ${
                          isRetro
                            ? "font-mono text-[var(--color-ghost-pink)] border-[var(--color-ghost-pink)]/40"
                            : "text-[var(--color-text-primary)] border-[var(--color-border)]"
                        }
                      `}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commitEditing();
                          }}
                          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-ghost-pink)]"
                          title="Save"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEditing();
                          }}
                          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                          title="Cancel"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`flex-1 min-w-0 truncate text-[13px] leading-snug ${
                            isActive
                              ? "text-[var(--nav-item-active-text)]"
                              : "text-[var(--color-text-primary)]"
                          }`}
                        >
                          {isRetro ? `> ${thread.title}` : thread.title}
                        </div>

                        {/* Hover actions */}
                        <div
                          className={`
                        shrink-0 flex items-center gap-0.5
                        opacity-0 group-hover:opacity-100 transition-opacity
                        ${isProcessing ? "pointer-events-none" : ""}
                      `}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(thread);
                            }}
                            className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-ghost-pink)]"
                            title="Rename"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(thread.id);
                            }}
                            className="p-0.5 text-[var(--color-text-muted)] hover:text-red-400"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default CasperThreadSidebar;

/**
 * ChatSidebar - Left rail of the persona detail view
 *
 * Shows a link back to all personas, a contact search, the "Digital You"
 * entry, and the most-messaged contacts. Dual UI mode (retro/modern).
 */
import { useMemo, useState } from "react";
import { useUIMode } from "@/stores/themeStore";
import type { ContactWithStatus } from "@/types";

interface ChatSidebarProps {
  contacts: ContactWithStatus[];
  selectedContactId: string | null;
  onContactSelect: (contactId: string) => void;
  /** Returns to the personas grid */
  onBack?: () => void;
  isLoading?: boolean;
}

export function ChatSidebar({
  contacts,
  selectedContactId,
  onContactSelect,
  onBack,
  isLoading = false,
}: ChatSidebarProps) {
  const { isRetro } = useUIMode();
  const [search, setSearch] = useState("");

  const youContact = contacts.find((c) => c.is_you);
  const otherContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((c) => !c.is_you)
      .filter(
        (c) => !q || (c.display_name ?? c.contact_id).toLowerCase().includes(q),
      )
      .sort((a, b) => b.message_count - a.message_count);
  }, [contacts, search]);

  const readyLabel = isRetro ? "[READY]" : "Ready";
  const contactCount = contacts.length - (youContact ? 1 : 0);

  return (
    <aside className="w-80 shrink-0 flex flex-col gap-3 p-4 border-r border-[var(--color-border)] overflow-hidden">
      {onBack && (
        <button
          onClick={onBack}
          className="self-start min-h-8 text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-ring"
        >
          {isRetro ? "< cd ../personas" : "← All personas"}
        </button>
      )}

      <label className="flex">
        <span className="sr-only">Search contacts</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            isRetro
              ? `> search ${contactCount.toLocaleString()} contacts`
              : `Search ${contactCount.toLocaleString()} contacts`
          }
          className="focus-ring w-full h-[38px] px-3 bg-transparent border border-[var(--input-border)] rounded-[var(--radius-input)] text-[var(--input-text)] caret-[var(--input-caret)] text-[13px] outline-none"
        />
      </label>

      {youContact && (
        <button
          onClick={() => onContactSelect(youContact.contact_id)}
          aria-current={
            selectedContactId === youContact.contact_id ? "page" : undefined
          }
          className={`focus-ring flex items-center gap-3 p-2.5 rounded-[var(--radius-card)] text-left border ${
            selectedContactId === youContact.contact_id
              ? "bg-[var(--color-accent-secondary-subtle)] border-[var(--color-border-accent-secondary)]"
              : "border-transparent hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          <Avatar initial="Y" size={40} accent />
          <span className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="font-semibold">Digital You</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {youContact.message_count.toLocaleString()} sent
            </span>
          </span>
          {youContact.has_persona && (
            <span className="text-[11px] text-[var(--color-success)]">
              {readyLabel}
            </span>
          )}
        </button>
      )}

      <div className="eyebrow px-2.5 pt-2">
        {search ? "Matches" : "Most messaged"}
      </div>

      <div className="flex-1 overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
        {isLoading ? (
          <span className="px-2.5 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">
            Loading...
          </span>
        ) : otherContacts.length === 0 ? (
          <span className="px-2.5 py-4 text-sm text-[var(--color-text-muted)]">
            No contacts found
          </span>
        ) : (
          otherContacts.map((contact) => {
            const name = contact.display_name || contact.contact_id;
            const selected = selectedContactId === contact.contact_id;
            return (
              <button
                key={contact.contact_id}
                onClick={() => onContactSelect(contact.contact_id)}
                aria-current={selected ? "page" : undefined}
                className={`focus-ring list-row flex items-center gap-3 px-2.5 py-2 text-left ${
                  selected ? "bg-[var(--nav-item-active-bg)]" : ""
                }`}
              >
                <Avatar initial={name.charAt(0).toUpperCase()} size={34} />
                <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="text-[13px] truncate">{name}</span>
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {contact.message_count.toLocaleString()} messages
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

/** Round initial badge. `accent` uses the persona color. */
export function Avatar({
  initial,
  size,
  accent = false,
}: {
  initial: string;
  size: number;
  accent?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-full border flex items-center justify-center font-[var(--font-display)] ${
        accent
          ? "border-[var(--color-border-accent-secondary)] text-[var(--color-text-accent-secondary)] bg-[var(--color-accent-secondary-subtle)]"
          : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
      }`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
}

export default ChatSidebar;

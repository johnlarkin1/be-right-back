/**
 * ContactMentionDropdown - "@" mention contact selector for the Casper input.
 *
 * Renders a filtered, keyboard-navigable list of contacts when the user types
 * "@<query>" in the Casper input. Selecting a contact tags it so the agent can
 * scope its DuckDB + SQLite queries to that contact_id.
 *
 * Positioning is handled by `useDropdownDirection` (flips above the input when
 * there isn't room below — the common case, since the input sits at the bottom).
 */
import { motion, AnimatePresence } from "framer-motion";
import { User, Sparkles } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import { useDropdownDirection } from "@/hooks/useDropdownDirection";
import type { ContactWithStatus } from "@/types";
import type { RefObject } from "react";

interface ContactMentionDropdownProps {
  /** Whether the dropdown is open. */
  isOpen: boolean;
  /** Already-filtered, ranked contacts to show. */
  contacts: ContactWithStatus[];
  /** Index of the highlighted row. */
  selectedIndex: number;
  /** Fired when a contact is chosen (click or Enter). */
  onSelect: (contact: ContactWithStatus) => void;
  /** Fired when a row is hovered, to sync keyboard highlight. */
  onHover: (index: number) => void;
  /** Anchor used to decide whether to open above or below. */
  anchorRef: RefObject<HTMLElement | null>;
}

export function ContactMentionDropdown({
  isOpen,
  contacts,
  selectedIndex,
  onSelect,
  onHover,
  anchorRef,
}: ContactMentionDropdownProps) {
  const { isRetro } = useUIMode();
  const { direction, dropdownRef } = useDropdownDirection(anchorRef, isOpen);

  const show = isOpen && contacts.length > 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: direction === "down" ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: direction === "down" ? -4 : 4 }}
          transition={{ duration: 0.12 }}
          // Pointer events on mousedown would steal focus/blur before onClick
          // fires; selection is wired through onMouseDown to avoid that.
          className={`
            absolute left-0 right-0 z-50 max-h-[40vh] overflow-y-auto
            ${direction === "down" ? "top-full mt-1" : "bottom-full mb-1"}
            ${
              isRetro
                ? "border border-[var(--color-ghost-pink)]/40 bg-[var(--color-surface)] font-mono"
                : "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-lg"
            }
          `}
        >
          <div
            className={`px-3 py-1.5 text-[10px] uppercase tracking-wider opacity-50 ${
              isRetro
                ? "text-[var(--color-ghost-pink)]"
                : "text-[var(--color-text-muted)]"
            }`}
          >
            {isRetro ? "// contacts" : "Contacts"}
          </div>
          {contacts.map((contact, index) => {
            const active = index === selectedIndex;
            const name = contact.display_name ?? contact.contact_id;
            return (
              <button
                key={contact.contact_id}
                type="button"
                onMouseDown={(e) => {
                  // Prevent the input from blurring before selection lands.
                  e.preventDefault();
                  onSelect(contact);
                }}
                onMouseEnter={() => onHover(index)}
                className={`
                  flex w-full items-center gap-2 px-3 py-2 text-left text-sm
                  ${
                    active
                      ? isRetro
                        ? "bg-[var(--color-ghost-pink)]/15 text-[var(--color-ghost-pink)]"
                        : "bg-[var(--color-ghost-pink)]/10 text-[var(--color-text-primary)]"
                      : isRetro
                        ? "text-[var(--color-ghost-pink)]/80"
                        : "text-[var(--color-text-primary)]"
                  }
                  transition-colors
                `}
              >
                {isRetro ? (
                  <span className="shrink-0 opacity-60">
                    {active ? ">" : " "}
                  </span>
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-ghost-pink)]/10 text-[var(--color-ghost-pink)]">
                    <User size={13} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {contact.has_persona &&
                  (isRetro ? (
                    <span className="shrink-0 text-[10px] opacity-60">
                      [persona]
                    </span>
                  ) : (
                    <Sparkles
                      size={12}
                      className="shrink-0 text-[var(--color-ghost-pink)]"
                    />
                  ))}
                <span
                  className={`shrink-0 text-xs tabular-nums opacity-50 ${
                    isRetro ? "" : "text-[var(--color-text-muted)]"
                  }`}
                >
                  {contact.message_count.toLocaleString()}
                  {isRetro ? "" : " msgs"}
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ContactMentionDropdown;

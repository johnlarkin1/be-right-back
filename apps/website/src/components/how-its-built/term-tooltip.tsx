"use client";

import { useCallback, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen } from "lucide-react";

const LEAVE_DELAY_MS = 120;

interface TermTooltipProps {
  name: string;
  label: string;
  definitionHtml: string;
  /** Later mentions of the same term render fainter than the first. */
  isRepeat?: boolean;
}

export function TermTooltip({
  name,
  label,
  definitionHtml,
  isRepeat = false,
}: TermTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clearLeaveTimer();
    setIsOpen(true);
  }, [clearLeaveTimer]);

  const handleLeave = useCallback(() => {
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => setIsOpen(false), LEAVE_DELAY_MS);
  }, [clearLeaveTimer]);

  return (
    <span
      className="relative inline-block"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          handleLeave();
        }
      }}
    >
      <button
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        className={
          "font-ibm-plex-mono underline decoration-dotted underline-offset-4 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-crt-accent/60 rounded-sm cursor-help hover:text-crt-accent hover:decoration-crt-accent " +
          (isRepeat
            ? // Later mentions: dimmer text and a quieter underline.
              "text-crt-accent/70 decoration-crt-accent/20"
            : // First mention: full-strength accent so it reads as the anchor.
              "text-crt-accent decoration-crt-accent/40")
        }
      >
        {label}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-1/2 top-full z-50 mt-2 block w-[min(90vw,360px)] -translate-x-1/2"
          >
            <span className="relative block rounded-lg border border-crt-accent/30 bg-surface-elevated p-3 text-left shadow-[0_0_24px_rgba(255,176,0,0.1)]">
              <span
                aria-hidden="true"
                className="absolute left-1/2 -top-1.5 block h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-crt-accent/30 bg-surface-elevated"
              />
              <span className="flex items-center gap-1.5 mb-1">
                <BookOpen
                  className="w-3.5 h-3.5 text-crt-accent"
                  aria-hidden="true"
                />
                <span className="font-jetbrains text-xs font-semibold text-text-primary tracking-tight">
                  {name}
                </span>
              </span>
              {/* definitionHtml is server-rendered from trusted local content/glossary.md via remark */}
              <span
                className="block font-inter text-xs leading-relaxed text-text-secondary [&_a]:text-crt-accent [&_a]:hover:underline [&_code]:font-ibm-plex-mono [&_code]:text-crt-accent [&_p]:mb-1 [&_p:last-child]:mb-0"
                dangerouslySetInnerHTML={{ __html: definitionHtml }}
              />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

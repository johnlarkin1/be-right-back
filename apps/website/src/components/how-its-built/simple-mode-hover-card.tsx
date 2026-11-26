"use client";

import { useCallback, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { PromptModal } from "./prompt-modal";
import { SIMPLE_TRANSLATION_PROMPT } from "@/lib/simple-translation-prompt";
import { trackEvent } from "@/lib/analytics";

const LEAVE_DELAY_MS = 150;

const SIMPLE_MODE_EXPLANATION =
  "don't worry, save those tokens! If you're coming at this from a non-technical angle, or annoyed by my less than polished technical writing, i don't mind you turning to the robots. this section will have anthropic generated simpler translations of my technical blog posts. but we also have copy buttons if you want to dig deeper. or!! human to human the old fashioned way - email me.";

interface SimpleModeHoverCardProps {
  children: (props: { describedById: string }) => React.ReactNode;
}

export function SimpleModeHoverCard({ children }: SimpleModeHoverCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const handleShowPrompt = useCallback(() => {
    trackEvent("simple_translation_prompt_viewed");
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return (
    <>
      <div
        className="relative inline-flex"
        onPointerEnter={handleEnter}
        onPointerLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            handleLeave();
          }
        }}
      >
        {children({ describedById: tooltipId })}

        <AnimatePresence>
          {isOpen && (
            <motion.div
              id={tooltipId}
              role="tooltip"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute left-1/2 top-full z-50 mt-3 w-[min(90vw,420px)] -translate-x-1/2"
            >
              <div className="relative rounded-lg border border-crt-accent/30 bg-surface-elevated p-4 shadow-[0_0_30px_rgba(255,176,0,0.1)]">
                <div
                  aria-hidden="true"
                  className="absolute left-1/2 -top-1.5 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-crt-accent/30 bg-surface-elevated"
                />
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles
                    className="w-4 h-4 text-crt-accent"
                    aria-hidden="true"
                  />
                  <h3 className="font-jetbrains text-sm font-semibold text-text-primary tracking-tight">
                    about &quot;simple&quot; mode
                  </h3>
                </div>
                <p className="font-inter text-sm leading-relaxed text-text-secondary">
                  {SIMPLE_MODE_EXPLANATION}
                </p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleShowPrompt}
                    className="inline-flex items-center gap-1.5 rounded-md border border-crt-accent/30 bg-crt-accent/10 px-3 py-1.5 font-jetbrains text-xs font-medium text-crt-accent transition-colors duration-200 hover:bg-crt-accent/20 cursor-pointer"
                  >
                    Show me the prompt →
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <PromptModal
        open={isModalOpen}
        onClose={handleCloseModal}
        prompt={SIMPLE_TRANSLATION_PROMPT}
      />
    </>
  );
}

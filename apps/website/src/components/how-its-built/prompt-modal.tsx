"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { CopyMarkdownButton } from "./copy-markdown-button";

interface PromptModalProps {
  open: boolean;
  onClose: () => void;
  prompt: string;
  title?: string;
  blurb?: string;
}

export function PromptModal({
  open,
  onClose,
  prompt,
  title = "Simple translation prompt",
  blurb = "This is the exact prompt passed to Claude when generating a simple variant of a technical post. Copy it, tweak it, run it yourself — whatever you like.",
}: PromptModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-modal-title"
        >
          <button
            type="button"
            aria-label="Close prompt dialog"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-surface-elevated border border-crt-accent/30 rounded-lg shadow-[0_0_40px_rgba(255,176,0,0.15)] overflow-hidden cursor-auto"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-subtle">
              <div className="min-w-0">
                <h2
                  id="prompt-modal-title"
                  className="font-jetbrains text-lg text-text-primary font-semibold tracking-tight"
                >
                  {title}
                </h2>
                <p className="mt-1 font-inter text-sm text-text-secondary leading-relaxed">
                  {blurb}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex-shrink-0 p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
              <pre className="font-jetbrains text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                {prompt}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle bg-surface/40">
              <CopyMarkdownButton
                markdown={prompt}
                label="Copy prompt"
                copiedLabel="Prompt copied"
                eventName="simple_translation_prompt_copied"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

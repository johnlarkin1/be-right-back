"use client";

import { useTerminal } from "./terminal-provider";
import { useEffect } from "react";
import { motion } from "framer-motion";

export function TerminalTrigger() {
  const { isOpen, toggle } = useTerminal();

  // Global keyboard shortcut: backtick toggles terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);

  if (isOpen) return null;

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1, duration: 0.5 }}
      onClick={toggle}
      className="fixed bottom-4 left-4 z-[997] flex items-center gap-1.5 rounded border border-crt-text/15 bg-[#0a0e0a]/80 px-3 py-1.5 font-ibm-plex-mono text-sm text-crt-text/60 shadow-[0_0_12px_rgba(0,255,65,0.06)] backdrop-blur-sm transition-all duration-300 hover:border-crt-text/30 hover:bg-[#0a0e0a]/90 hover:text-crt-text hover:shadow-[0_0_20px_rgba(0,255,65,0.15)]"
      aria-label="Open terminal"
    >
      <span className="text-crt-accent/60 transition-colors duration-300 hover:text-crt-accent">
        $
      </span>
      <span className="cursor-blink">_</span>
    </motion.button>
  );
}

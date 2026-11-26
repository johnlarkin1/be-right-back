"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTerminal } from "./terminal-provider";
import { TerminalOutput } from "./terminal-output";
import { TerminalInput } from "./terminal-input";
import { useEffect, useCallback } from "react";

export function TerminalDrawer() {
  const {
    isOpen,
    close,
    history,
    currentPath,
    commandHistory,
    executeCommand,
  } = useTerminal();

  const displayPath = currentPath === "/" ? "~" : `~${currentPath}`;
  const prompt = `visitor@brb:${displayPath}$`;

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        close();
      }
    },
    [isOpen, close]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[998] bg-black/20"
            onClick={close}
          />

          {/* Terminal panel */}
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-[999] flex h-[40vh] flex-col overflow-hidden rounded-t-lg border-t border-white/10 bg-[#0a0e0a]/95 shadow-[0_-4px_30px_rgba(0,255,65,0.1)] backdrop-blur-sm md:h-[40vh]"
            style={{
              maxHeight: "calc(100vh - 60px)",
            }}
            role="dialog"
            aria-label="Interactive terminal"
          >
            {/* Title bar */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <button
                    onClick={close}
                    className="h-3 w-3 rounded-full bg-red-500/80 transition-colors hover:bg-red-400"
                    aria-label="Close terminal"
                  />
                  <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                  <div className="h-3 w-3 rounded-full bg-green-500/80" />
                </div>
                <span className="ml-2 font-ibm-plex-mono text-xs text-crt-body-muted">
                  visitor@brb — terminal
                </span>
              </div>
              <span className="font-ibm-plex-mono text-xs text-crt-body-muted">
                {displayPath}
              </span>
            </div>

            {/* Welcome message + output history */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {history.length === 0 && (
                <div className="px-4 py-3 font-jetbrains text-sm text-crt-body-muted">
                  <p>
                    Welcome to{" "}
                    <span className="text-crt-text">berightback.xyz</span>.
                    Type{" "}
                    <span className="text-crt-accent">help</span> to get
                    started.
                  </p>
                </div>
              )}
              <TerminalOutput history={history} />
            </div>

            {/* Input line */}
            <TerminalInput
              prompt={prompt}
              currentPath={currentPath}
              onSubmit={executeCommand}
              commandHistory={commandHistory}
              isOpen={isOpen}
            />

            {/* Subtle scanlines */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0, 255, 65, 0.1) 1px, rgba(0, 255, 65, 0.1) 2px)",
              }}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

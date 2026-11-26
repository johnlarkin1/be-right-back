"use client";

import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-is-mobile";

export function GhostInteractionHints() {
  const isMobile = useIsMobile();

  // Compact mobile version
  if (isMobile) {
    return (
      <motion.div
        className="fixed bottom-4 right-4 z-50 font-ibm-plex-mono text-[10px]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 0.6, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div
          className="border border-crt-text/20 bg-crt-bg/70 backdrop-blur-sm px-2 py-1.5"
          style={{
            textShadow: "0 0 3px currentColor",
          }}
        >
          <div className="text-crt-text/60 mb-2 text-[10px] uppercase tracking-wider text-center">
            Ghost Controls
          </div>
          <div className="flex items-center gap-2 text-crt-text/80">
            <span className="text-crt-accent">auto-spotlight:</span>
            <span>ghosts flee</span>
          </div>
          <div className="flex items-center gap-2 text-crt-text/80">
            <span className="text-crt-accent">double tap:</span>
            <span>spawn ghost</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // Desktop version
  return (
    <motion.div
      className="fixed bottom-6 right-6 z-50 font-ibm-plex-mono text-xs"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 0.7, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div
        className="border border-crt-text/30 bg-crt-bg/80 backdrop-blur-sm px-4 py-3 space-y-1"
        style={{
          textShadow: "0 0 4px currentColor",
          boxShadow: "0 0 10px rgba(0, 255, 65, 0.1)",
        }}
      >
        <div className="text-crt-text/60 mb-2 text-[10px] uppercase tracking-wider text-center">
          Ghost Controls
        </div>
        <div className="flex items-center gap-2 text-crt-text/80">
          <span className="text-crt-accent">default</span>
          <span className="text-crt-text/40">:</span>
          <span>ghosts are scared of the spotlight!</span>
        </div>
        <div className="flex items-center gap-2 text-crt-text/80">
          <span className="text-crt-accent">right click</span>
          <span className="text-crt-text/40">:</span>
          <span>spawn ghost (hold for more)</span>
        </div>
        <div className="flex items-center gap-2 text-crt-text/80">
          <span className="text-crt-accent">left click and hold</span>
          <span className="text-crt-text/40">:</span>
          <span>attract</span>
        </div>
        <div className="text-crt-text/80 text-xs mt-2 text-center">
          <div>you&apos;re capped at 50 ghosts btw... so... </div>
          <div>don&apos;t be too crazy</div>
        </div>
        <div className="border-t border-crt-text/15 mt-2 pt-2">
          <div className="flex items-center gap-2 text-crt-text/80">
            <span className="text-crt-accent">press <kbd className="border border-crt-text/30 bg-crt-text/10 px-1 rounded text-crt-text">`</kbd></span>
            <span className="text-crt-text/40">:</span>
            <span>open terminal</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

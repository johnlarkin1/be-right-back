"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { TypewriterText } from "./typewriter-text";
import { CRTEffect } from "./crt-effect";
import { ScrollIndicator } from "./scroll-indicator";
import { NUM_GHOSTS } from "./constants";
import { trackEvent } from "@/lib/analytics";
import { useIsMobile } from "@/hooks/use-is-mobile";

// The ghost field loads on its own, after the quote has painted.
const GhostField = dynamic(
  () => import("./ghost-field/ghost-field").then((m) => m.GhostField),
  { ssr: false },
);

interface IntroSequenceProps {
  onComplete?: () => void;
  skipIntro?: boolean;
  downloadCount?: number | null;
}

// Below this, the real count looks sad, so the hero shows the floor instead.
const MIN_SHOWN_DOWNLOADS = 100;

type AnimationPhase = "typing" | "complete";

export function IntroSequence({
  onComplete,
  skipIntro = false,
  downloadCount = null,
}: IntroSequenceProps) {
  const [phase, setPhase] = useState<AnimationPhase>("typing");
  const [showGhosts, setShowGhosts] = useState(false);
  const [quoteComplete, setQuoteComplete] = useState(false);
  const [enableFlicker, setEnableFlicker] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const isMobile = useIsMobile();

  // Use newline on mobile for better text wrapping
  const quoteText = isMobile
    ? `we're summoning ghosts,\nnot building animals`
    : "we're summoning ghosts, not building animals";

  // Jump straight to the end state: full quote, ghosts, hero button.
  // The landing content mounts on onComplete, which gives the page room to scroll.
  const skipToEnd = useCallback(() => {
    setSkipped(true);
    setPhase("complete");
    setShowGhosts(true);
    setQuoteComplete(true);
    onComplete?.();
  }, [onComplete]);

  // Reduced motion: skip the typing animation entirely
  useEffect(() => {
    if (skipIntro) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- sync with skipIntro prop */
      skipToEnd();
    }
  }, [skipIntro, skipToEnd]);

  // A key press or a scroll attempt skips the intro. Until the intro ends,
  // the page is one screen tall, so a scroll would otherwise do nothing.
  useEffect(() => {
    if (phase === "complete") return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) skipToEnd();
    };
    let touchStartY: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      // Finger moving up means the visitor is scrolling down
      if (touchStartY !== null && y !== undefined && touchStartY - y > 10) {
        skipToEnd();
      }
    };

    window.addEventListener("keydown", skipToEnd);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      window.removeEventListener("keydown", skipToEnd);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [phase, skipToEnd]);

  const handleTypingComplete = () => {
    if (skipped) return;
    setQuoteComplete(true);
    setEnableFlicker(true);
    // Start showing ghosts after typing completes
    setShowGhosts(true);

    // Disable flicker after 5 seconds
    setTimeout(() => {
      setEnableFlicker(false);
    }, 5000);

    setTimeout(() => {
      setPhase("complete");
      onComplete?.();
    }, 1500);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-crt-bg">
      {/* CRT Effect overlay */}
      <CRTEffect intensity={1} flicker={enableFlicker} />

      {/* Main animation container */}
      <div className="relative z-10 flex items-center justify-center min-h-screen">
        {/* Quote - stays visible with crackle effect */}
        <motion.div
          className="px-4 sm:px-8 md:px-12 lg:px-16 text-center w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <TypewriterText
            text={quoteText}
            attribution="- Andrej Karpathy, 2025"
            typingSpeed={50}
            onTypingComplete={handleTypingComplete}
            shouldDisintegrate={false}
            crackle={quoteComplete}
            skip={skipped}
          />
        </motion.div>

        {/* Ghost wandering (fades in after typing completes) */}
        {showGhosts && <GhostField ghostCount={NUM_GHOSTS} />}
      </div>

      {/* Terminal prompt that appears after intro */}
      {phase === "complete" && (
        <motion.div
          className="absolute top-20 left-8 font-ibm-plex-mono text-crt-text text-sm z-20"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 0.6, y: 0 }}
          transition={{ duration: 0.8 }}
          style={{
            textShadow: "0 0 8px currentColor",
          }}
        >
          user@brb:~$ ./brb chat --with casper
        </motion.div>
      )}

      {phase === "complete" && (
        <motion.a
          href="/download/dmg"
          className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap border-2 border-crt-accent bg-crt-accent/10 px-6 py-3 font-ibm-plex-mono text-base text-crt-text transition-colors hover:bg-crt-accent/20"
          style={{ textShadow: "0 0 8px currentColor" }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          onClick={() =>
            trackEvent("cta_clicked", { label: "download_dmg", location: "hero" })
          }
        >
          <span className="text-crt-accent">$</span> ./download
          {downloadCount !== null && (
            <>
              <span className="ml-3 text-sm text-crt-accent">
                [{Math.max(downloadCount, MIN_SHOWN_DOWNLOADS).toLocaleString()}{" "}
                downloads]
              </span>
              {downloadCount < MIN_SHOWN_DOWNLOADS && (
                <span className="mt-1 block text-center text-xs text-crt-text/60">
                  rounding up to {MIN_SHOWN_DOWNLOADS}, this will change after{" "}
                  {MIN_SHOWN_DOWNLOADS} 😅
                </span>
              )}
            </>
          )}
        </motion.a>
      )}

      {/* Scroll indicator - always visible after typing starts */}
      <ScrollIndicator />
    </div>
  );
}

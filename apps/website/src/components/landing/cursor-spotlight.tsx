"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
  CURSOR_MODE,
  CURSOR_GHOST_VARIANT,
  CURSOR_GHOST_SIZE,
} from "./constants";
import { GhostSprite } from "./ghost-sprite";

/**
 * Custom desktop cursor. Renders the green phosphor spotlight glow and/or a
 * ghost sprite in place of the native cursor, depending on `CURSOR_MODE`
 * (see constants.tsx). The native cursor is hidden via the
 * `cursor-spotlight-active` body class (globals.css). On mobile this renders
 * nothing — the ghost field draws the auto-roaming spotlight there.
 */
export function CursorSpotlight() {
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000 });
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) return; // Skip on mobile

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    document.body.classList.add("cursor-spotlight-active");
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.body.classList.remove("cursor-spotlight-active");
    };
  }, [isMobile]);

  // Don't render on mobile - the ghost field draws its own auto-roaming spotlight
  if (isMobile) return null;

  const showSpotlight =
    CURSOR_MODE === "spotlight" || CURSOR_MODE === "ghost-spotlight";
  const showGhost = CURSOR_MODE === "ghost" || CURSOR_MODE === "ghost-spotlight";

  return (
    <motion.div
      className="pointer-events-none fixed z-50"
      style={{
        left: mousePos.x,
        top: mousePos.y,
        transform: "translate(-50%, -50%)",
      }}
    >
      {showSpotlight && (
        <>
          {/* Large outer glow */}
          <div
            className="absolute"
            style={{
              width: "300px",
              height: "300px",
              marginLeft: "-150px",
              marginTop: "-150px",
              background:
                "radial-gradient(circle, rgba(0, 255, 65, 0.2) 0%, rgba(0, 255, 65, 0.08) 40%, transparent 70%)",
              filter: "blur(20px)",
            }}
          />

          {/* Medium glow */}
          <div
            className="absolute"
            style={{
              width: "180px",
              height: "180px",
              marginLeft: "-90px",
              marginTop: "-90px",
              background:
                "radial-gradient(circle, rgba(0, 255, 65, 0.3) 0%, rgba(0, 255, 65, 0.12) 50%, transparent 80%)",
              filter: "blur(12px)",
            }}
          />

          {/* Inner bright spot - circular */}
          <div
            className="absolute"
            style={{
              width: "80px",
              height: "80px",
              marginLeft: "-40px",
              marginTop: "-40px",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(0, 255, 65, 0.5) 0%, rgba(0, 255, 65, 0.2) 60%, transparent 100%)",
              filter: "blur(6px)",
            }}
          />
        </>
      )}

      {showGhost && (
        <div
          className="absolute"
          style={{
            marginLeft: `-${CURSOR_GHOST_SIZE / 2}px`,
            marginTop: `-${CURSOR_GHOST_SIZE / 2}px`,
          }}
        >
          <GhostSprite variant={CURSOR_GHOST_VARIANT} size={CURSOR_GHOST_SIZE} />
        </div>
      )}
    </motion.div>
  );
}

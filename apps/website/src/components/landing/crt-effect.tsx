"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface CRTEffectProps {
  intensity?: number; // 0-1, controls effect visibility
  flicker?: boolean; // Enable screen flicker
}

export function CRTEffect({ intensity = 1, flicker = false }: CRTEffectProps) {
  const [flickerOpacity, setFlickerOpacity] = useState(1);

  useEffect(() => {
    if (!flicker) return;

    const flickerInterval = setInterval(() => {
      const shouldFlicker = Math.random() > 0.95;
      if (shouldFlicker) {
        setFlickerOpacity(0.85 + Math.random() * 0.15);
        setTimeout(() => setFlickerOpacity(1), 50);
      }
    }, 100);

    return () => clearInterval(flickerInterval);
  }, [flicker]);

  return (
    <>
      {/* Scanlines */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          opacity: intensity * 0.15,
          background: `repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.15),
            rgba(0, 0, 0, 0.15) 1px,
            transparent 1px,
            transparent 2px
          )`,
        }}
      />

      {/* Vignette */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          opacity: intensity * 0.6,
          background: `radial-gradient(
            ellipse at center,
            transparent 0%,
            transparent 40%,
            rgba(0, 0, 0, 0.3) 80%,
            rgba(0, 0, 0, 0.7) 100%
          )`,
        }}
      />

      {/* Phosphor glow overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 mix-blend-screen"
        style={{
          opacity: intensity * 0.03,
          background:
            "radial-gradient(ellipse at center, #00ff4120 0%, transparent 60%)",
        }}
      />

      {/* Noise/grain texture. Static: a looping opacity pulse read as a flickering light. */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          opacity: intensity * 0.08 * flickerOpacity,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
        }}
      />

      {/* Screen curvature - using subtle box-shadow to simulate */}
      <div
        className="pointer-events-none fixed inset-0 z-50"
        style={{
          opacity: intensity * 0.4,
          boxShadow: `
            inset 0 0 100px rgba(0, 0, 0, 0.3),
            inset 0 0 200px rgba(0, 0, 0, 0.2)
          `,
        }}
      />

      {/* Flicker overlay */}
      {flicker && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-50 bg-black"
          style={{ opacity: 1 - flickerOpacity }}
        />
      )}
    </>
  );
}

"use client";

import { motion } from "framer-motion";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  ParticleSystem,
  createParticlesFromChar,
  type Particle,
} from "./particle-system";

// Pure seeded pseudo-random function - deterministic based on seed
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface TypewriterTextProps {
  text: string;
  attribution?: string; // Optional attribution text (e.g., "- Andrej Karpathy")
  typingSpeed?: number; // ms per character
  onTypingComplete?: () => void;
  onDisintegrationComplete?: () => void;
  shouldDisintegrate?: boolean;
  crackle?: boolean; // CRT crackle/glitch effect
  skip?: boolean; // Show the full text and attribution at once, without typing
}

export function TypewriterText({
  text,
  attribution,
  typingSpeed = 50,
  onTypingComplete,
  onDisintegrationComplete,
  shouldDisintegrate = false,
  crackle = false,
  skip = false,
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [showAttribution, setShowAttribution] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isDisintegrating, setIsDisintegrating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const attributionRef = useRef<HTMLDivElement>(null);

  // Precompute stable random values for each character using seeded random
  const charRandomValues = useMemo(() => {
    return text.split("").map((_, index) => ({
      crackleDelay: seededRandom(index) * 0.5,
      crackleDuration: 0.1 + seededRandom(index + 1000) * 0.15,
      opacityVariation: 0.7 + seededRandom(index + 2000) * 0.3,
      repeatDelayOpacity: seededRandom(index + 3000) * 2 + 1,
      repeatDelayX: seededRandom(index + 4000) * 2 + 1,
      xOffset: (seededRandom(index + 5000) - 0.5) * 2,
    }));
  }, [text]);

  // Typing animation
  useEffect(() => {
    if (skip) return;
    if (displayedText.length < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(text.slice(0, displayedText.length + 1));
      }, typingSpeed);
      return () => clearTimeout(timeout);
    } else if (!isTypingComplete) {
      /* eslint-disable react-hooks/set-state-in-effect -- completing typing animation */
      setIsTypingComplete(true);
      /* eslint-enable react-hooks/set-state-in-effect */
      // Show attribution after a brief pause
      if (attribution) {
        setTimeout(() => setShowAttribution(true), 500);
      }
      onTypingComplete?.();
    }
  }, [
    displayedText,
    text,
    typingSpeed,
    isTypingComplete,
    onTypingComplete,
    attribution,
    skip,
  ]);

  // Disintegration effect
  useEffect(() => {
    if (shouldDisintegrate && isTypingComplete && !isDisintegrating) {
      /* eslint-disable react-hooks/set-state-in-effect -- sync with shouldDisintegrate prop */
      setIsDisintegrating(true);
      /* eslint-enable react-hooks/set-state-in-effect */

      // Create particles for each character
      const newParticles: Particle[] = [];
      charRefs.current.forEach((charRef, index) => {
        if (charRef && text[index] !== " ") {
          const rect = charRef.getBoundingClientRect();
          const containerRect = containerRef.current?.getBoundingClientRect();
          if (containerRect) {
            const particlesForChar = createParticlesFromChar(
              text[index],
              rect.left - containerRect.left + rect.width / 2,
              rect.top - containerRect.top + rect.height / 2,
              15 // 15 pixel particles per character for better effect
            );
            newParticles.push(...particlesForChar);
          }
        }
      });

      // Stagger the particle creation slightly for effect
      setParticles(newParticles);

      // Notify when complete
      setTimeout(() => {
        onDisintegrationComplete?.();
      }, 2000);
    }
  }, [
    shouldDisintegrate,
    isTypingComplete,
    isDisintegrating,
    text,
    onDisintegrationComplete,
  ]);

  const shownText = skip ? text : displayedText;
  const typingDone = skip || isTypingComplete;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="text-center font-vt323 text-crt-text px-4 mx-auto leading-tight"
        style={{ fontSize: "clamp(1.5rem, 5vw, 4rem)", maxWidth: "min(80%, 40rem)" }}
      >
        {shownText.split("").map((char, index) => {
          // Handle newline characters as actual line breaks
          if (char === "\n") {
            return <br key={index} />;
          }

          // Use precomputed stable random values for crackle effect
          const randomValues = charRandomValues[index] || {
            crackleDelay: 0,
            crackleDuration: 0.15,
            opacityVariation: 0.85,
            repeatDelayOpacity: 2,
            repeatDelayX: 2,
            xOffset: 0,
          };

          return (
            <motion.span
              key={index}
              ref={(el) => {
                charRefs.current[index] = el;
              }}
              className="inline-block"
              initial={{ opacity: 1 }}
              animate={{
                opacity: isDisintegrating
                  ? 0
                  : crackle
                  ? [1, randomValues.opacityVariation, 1]
                  : 1,
                x: crackle ? [0, randomValues.xOffset, 0] : 0,
              }}
              transition={{
                opacity: {
                  duration: isDisintegrating
                    ? 0.3
                    : crackle
                    ? randomValues.crackleDuration
                    : 0,
                  delay: isDisintegrating ? index * 0.02 : randomValues.crackleDelay,
                  repeat: crackle && !isDisintegrating ? Infinity : 0,
                  repeatDelay: crackle ? randomValues.repeatDelayOpacity : 0,
                },
                x: {
                  duration: crackle ? randomValues.crackleDuration : 0,
                  delay: randomValues.crackleDelay,
                  repeat: crackle && !isDisintegrating ? Infinity : 0,
                  repeatDelay: crackle ? randomValues.repeatDelayX : 0,
                },
              }}
              style={{
                textShadow: "0 0 10px currentColor, 0 0 20px currentColor",
                whiteSpace: char === " " ? "pre" : "normal",
              }}
            >
              {char}
            </motion.span>
          );
        })}
        {!typingDone && (
          <motion.span
            className="inline-block ml-1"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            style={{
              textShadow: "0 0 10px currentColor",
            }}
          >
            _
          </motion.span>
        )}
      </div>

      {/* Attribution */}
      {attribution && (showAttribution || skip) && (
        <motion.div
          ref={attributionRef}
          className="mt-8 text-center font-ibm-plex-mono text-lg sm:text-xl text-crt-text/70"
          initial={{ opacity: 0, y: -10 }}
          animate={{
            opacity: isDisintegrating ? 0 : 1,
            y: 0,
          }}
          transition={{
            opacity: { duration: isDisintegrating ? 0.3 : 0.8 },
            y: { duration: 0.8 },
            delay: isDisintegrating ? shownText.length * 0.02 + 0.2 : 0,
          }}
          style={{
            textShadow: "0 0 8px currentColor",
          }}
        >
          {attribution}
        </motion.div>
      )}

      {isDisintegrating && <ParticleSystem particles={particles} />}
    </div>
  );
}

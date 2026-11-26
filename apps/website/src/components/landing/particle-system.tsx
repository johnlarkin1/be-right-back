"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";

// Pure seeded pseudo-random function - deterministic based on seed
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  char?: string;
  size?: number;
}

interface ParticleSystemProps {
  particles: Particle[];
  onComplete?: () => void;
}

export function ParticleSystem({ particles, onComplete }: ParticleSystemProps) {
  // Precompute random values for each particle using seeded random
  const particleRandomValues = useMemo(() => {
    return particles.map((particle, index) => {
      const seed = index + particle.x + particle.y;
      return {
        driftY: (seededRandom(seed) - 0.5) * 200,
        driftX: (seededRandom(seed + 1) - 0.5) * 200,
        rotate: (seededRandom(seed + 2) - 0.5) * 180,
        duration: 1.2 + seededRandom(seed + 3) * 0.6,
      };
    });
  }, [particles]);

  return (
    <AnimatePresence mode="wait" onExitComplete={onComplete}>
      {particles.map((particle, index) => {
        const randomValues = particleRandomValues[index];
        return (
          <motion.div
            key={particle.id}
            className="pointer-events-none absolute bg-crt-text pixelated"
            style={{
              left: particle.x,
              top: particle.y,
              width: particle.size || 3,
              height: particle.size || 3,
              boxShadow: "0 0 4px currentColor",
            }}
            initial={{
              opacity: 0.9,
              scale: 1,
            }}
            animate={{
              opacity: 0,
              y: particle.y + randomValues.driftY,
              x: particle.x + randomValues.driftX,
              scale: 0.2,
              rotate: randomValues.rotate,
            }}
            exit={{
              opacity: 0,
            }}
            transition={{
              duration: randomValues.duration,
              ease: [0.25, 0.1, 0.25, 1],
            }}
          />
        );
      })}
    </AnimatePresence>
  );
}

// Helper function to create pixel grid particles from a character position
export function createParticlesFromChar(
  char: string,
  x: number,
  y: number,
  particleCount: number = 20 // More particles for pixel grid effect
): Particle[] {
  const particles: Particle[] = [];

  // Create a grid of small pixels around the character position
  const gridSize = 5; // 5x5 grid
  const pixelSize = 3; // Each pixel is 3x3px

  for (let i = 0; i < particleCount; i++) {
    // Distribute particles in a rough grid pattern around the character
    const gridX = (i % gridSize) - Math.floor(gridSize / 2);
    const gridY = Math.floor(i / gridSize) - Math.floor(gridSize / gridSize);

    particles.push({
      id: `pixel-${char}-${x}-${y}-${i}-${Date.now()}-${Math.random()}`,
      x: x + gridX * (pixelSize + 1) + (Math.random() - 0.5) * 2, // Small random offset
      y: y + gridY * (pixelSize + 1) + (Math.random() - 0.5) * 2,
      size: pixelSize + Math.random() * 2, // Slight size variation
    });
  }

  return particles;
}

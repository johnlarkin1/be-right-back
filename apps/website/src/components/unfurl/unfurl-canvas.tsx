"use client";

import { useEffect, useRef } from "react";

// Ghost colors - vibrant palette avoiding terminal green to not conflict with title
const GHOST_COLORS = [
  "#ff66cc", // Hot pink
  "#ff2244", // Bright red
  "#cc66ff", // Purple
  "#aa88ff", // Lavender
  "#66ccff", // Sky blue
  "#00ddff", // Cyan
  "#ffaa00", // Amber/Orange
  "#ff6644", // Coral
  "#ff4477", // Rose
  "#ffdd44", // Golden yellow
  "#44ddaa", // Teal (not too green)
  "#ff8866", // Peach
  "#ff5555", // Red
  "#55ff88", // Mint green
  "#88ddff", // Light blue
  "#ffbbaa", // Salmon
  "#dd77ff", // Violet
  "#77ffdd", // Aquamarine
  "#ffcc77", // Soft orange
  "#ff77aa", // Bubblegum
  "#aaddff", // Powder blue
  "#dd2255", // Crimson
  "#ddff77", // Lime
  "#77aaff", // Periwinkle
];

// Star/particle for background twinkle effect
interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

// Floating particle for ambient effect
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface Ghost {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  scale: number;
  bobOffset: number;
  bobSpeed: number;
  faceType: number; // 0-11 for different expressions
}

// Text avoidance zone (ellipse around main title)
const AVOID_ZONE = {
  cx: 600,
  cy: 280,
  rx: 500,
  ry: 120,
};

export function UnfurlCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const ghostsRef = useRef<Ghost[]>([]);
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 1200;
    const H = 630;
    canvas.width = W;
    canvas.height = H;

    // Initialize twinkling stars (subtle, not too many)
    starsRef.current = [];
    for (let i = 0; i < 25; i++) {
      starsRef.current.push({
        x: Math.random() * W,
        y: Math.random() * H,
        size: 0.8 + Math.random() * 1.2,
        brightness: 0.2 + Math.random() * 0.4,
        twinkleSpeed: 0.015 + Math.random() * 0.02,
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }

    // Initialize floating particles
    particlesRef.current = [];

    // Spawn zones - manually placed for organic distribution
    const spawnZones = [
      // Top-left corner cluster
      { x: 60, y: 50 },
      { x: 120, y: 90 },
      { x: 180, y: 55 },
      { x: 80, y: 140 },
      // Top-right corner cluster
      { x: 1140, y: 55 },
      { x: 1080, y: 90 },
      { x: 1020, y: 60 },
      { x: 1120, y: 140 },
      // Top edge - middle scattered
      { x: 350, y: 70 },
      { x: 550, y: 50 },
      { x: 750, y: 65 },
      { x: 880, y: 80 },
      // Left side
      { x: 45, y: 180 },
      { x: 90, y: 380 },
      { x: 55, y: 520 },
      // Right side
      { x: 1155, y: 200 },
      { x: 1120, y: 420 },
      { x: 1150, y: 550 },
      // Middle-bottom area (below tagline)
      { x: 350, y: 520 },
      { x: 600, y: 510 },
      { x: 850, y: 525 },
      // Bottom edge - scattered
      { x: 100, y: 580 },
      { x: 280, y: 560 },
      { x: 500, y: 590 },
      { x: 720, y: 565 },
      { x: 920, y: 585 },
      { x: 1100, y: 570 },
      // Corners and edges
      { x: 150, y: 130 },
      { x: 1050, y: 110 },
      { x: 170, y: 480 },
      { x: 1030, y: 490 },
    ];

    // Initialize ghosts with more variation
    ghostsRef.current = [];
    for (let i = 0; i < spawnZones.length; i++) {
      const zone = spawnZones[i];
      const color =
        GHOST_COLORS[Math.floor(Math.random() * GHOST_COLORS.length)];
      // More size variation - some small, some larger
      const sizeRoll = Math.random();
      let scale;
      if (sizeRoll < 0.3) {
        scale = 0.65 + Math.random() * 0.2; // Small
      } else if (sizeRoll > 0.85) {
        scale = 1.1 + Math.random() * 0.3; // Large
      } else {
        scale = 0.8 + Math.random() * 0.3; // Medium
      }

      ghostsRef.current.push({
        x: zone.x + (Math.random() - 0.5) * 40,
        y: zone.y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 0.8,
        vy: (Math.random() - 0.5) * 0.4,
        color,
        scale,
        bobOffset: Math.random() * Math.PI * 2,
        bobSpeed: 0.008 + Math.random() * 0.012,
        faceType: Math.floor(Math.random() * 12),
      });
    }

    // Draw twinkling stars
    function drawStars(ctx: CanvasRenderingContext2D, time: number) {
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinkleOffset);
        const alpha = star.brightness * (0.5 + twinkle * 0.5);

        ctx.save();
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();

        // Subtle glow
        ctx.globalAlpha = alpha * 0.2;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // Spawn floating particles occasionally (very subtle)
    function maybeSpawnParticle() {
      if (Math.random() < 0.03 && particlesRef.current.length < 8) {
        const color =
          GHOST_COLORS[Math.floor(Math.random() * GHOST_COLORS.length)];
        particlesRef.current.push({
          x: Math.random() * W,
          y: H + 10,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.3 - Math.random() * 0.5,
          size: 2 + Math.random() * 3,
          color,
          alpha: 0.4,
          life: 0,
          maxLife: 300 + Math.random() * 200,
        });
      }
    }

    // Update and draw floating particles
    function drawParticles(ctx: CanvasRenderingContext2D) {
      particlesRef.current = particlesRef.current.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        // Fade in and out
        const lifeRatio = p.life / p.maxLife;
        if (lifeRatio < 0.1) {
          p.alpha = lifeRatio * 10 * 0.6;
        } else if (lifeRatio > 0.7) {
          p.alpha = ((1 - lifeRatio) / 0.3) * 0.6;
        }

        if (p.life > p.maxLife || p.y < -20) {
          return false;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        return true;
      });
    }

    // Draw pixel ghost with different face expressions
    function drawGhost(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      color: string,
      scale: number,
      faceType: number
    ) {
      const p = 3 * scale; // pixel size

      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = color;

      // Ghost body
      ctx.fillRect(4 * p, 2 * p, 8 * p, 2 * p); // Head top
      ctx.fillRect(3 * p, 4 * p, 10 * p, 2 * p); // Head bottom
      ctx.fillRect(3 * p, 6 * p, 10 * p, 6 * p); // Body

      // Wavy bottom
      ctx.fillRect(3 * p, 12 * p, 2 * p, 1 * p);
      ctx.fillRect(6 * p, 12 * p, 2 * p, 1 * p);
      ctx.fillRect(9 * p, 12 * p, 2 * p, 1 * p);
      ctx.fillRect(11 * p, 12 * p, 2 * p, 1 * p);

      // Face (dark color for features)
      ctx.fillStyle = "#0a0e0a";

      switch (faceType) {
        case 0: // Happy
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(6 * p, 10 * p, 4 * p, 1 * p);
          ctx.fillRect(5 * p, 9 * p, 1 * p, 1 * p);
          ctx.fillRect(10 * p, 9 * p, 1 * p, 1 * p);
          break;
        case 1: // Surprised
          ctx.fillRect(5 * p, 6 * p, 2 * p, 3 * p);
          ctx.fillRect(9 * p, 6 * p, 2 * p, 3 * p);
          ctx.fillRect(7 * p, 10 * p, 2 * p, 1 * p);
          break;
        case 2: // Sleepy
          ctx.fillRect(5 * p, 7 * p, 2 * p, 1 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 1 * p);
          ctx.fillRect(7 * p, 10 * p, 2 * p, 1 * p);
          break;
        case 3: // Wink
          ctx.fillRect(5 * p, 7 * p, 2 * p, 1 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(7 * p, 10 * p, 3 * p, 1 * p);
          ctx.fillRect(10 * p, 9 * p, 1 * p, 1 * p);
          break;
        case 4: // Excited
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(5 * p, 10 * p, 6 * p, 1 * p);
          ctx.fillRect(5 * p, 9 * p, 1 * p, 1 * p);
          ctx.fillRect(10 * p, 9 * p, 1 * p, 1 * p);
          break;
        case 5: // Worried
          ctx.fillRect(5 * p, 6 * p, 2 * p, 3 * p);
          ctx.fillRect(9 * p, 6 * p, 2 * p, 3 * p);
          ctx.fillRect(6 * p, 10 * p, 4 * p, 1 * p);
          ctx.fillRect(5 * p, 9 * p, 1 * p, 1 * p);
          ctx.fillRect(10 * p, 9 * p, 1 * p, 1 * p);
          break;
        case 6: // Mischievous (smirk)
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(6 * p, 10 * p, 5 * p, 1 * p);
          ctx.fillRect(10 * p, 9 * p, 1 * p, 1 * p);
          break;
        case 7: // Cool (sunglasses look - horizontal line eyes)
          ctx.fillRect(4 * p, 7 * p, 3 * p, 1 * p);
          ctx.fillRect(9 * p, 7 * p, 3 * p, 1 * p);
          ctx.fillRect(7 * p, 10 * p, 2 * p, 1 * p);
          break;
        case 8: // Squint
          ctx.fillRect(5 * p, 7 * p, 2 * p, 1 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 1 * p);
          ctx.fillRect(5 * p, 8 * p, 1 * p, 1 * p);
          ctx.fillRect(10 * p, 8 * p, 1 * p, 1 * p);
          ctx.fillRect(6 * p, 10 * p, 4 * p, 1 * p);
          break;
        case 9: // Derpy (asymmetric eyes)
          ctx.fillRect(5 * p, 6 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 8 * p, 2 * p, 2 * p);
          ctx.fillRect(7 * p, 10 * p, 2 * p, 1 * p);
          break;
        case 10: // Angry
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(4 * p, 6 * p, 3 * p, 1 * p);
          ctx.fillRect(9 * p, 6 * p, 3 * p, 1 * p);
          ctx.fillRect(6 * p, 10 * p, 4 * p, 1 * p);
          break;
        case 11: // Cat face
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(7 * p, 10 * p, 2 * p, 1 * p);
          ctx.fillRect(5 * p, 10 * p, 1 * p, 1 * p);
          ctx.fillRect(10 * p, 10 * p, 1 * p, 1 * p);
          break;
        default: // Simple dots
          ctx.fillRect(5 * p, 7 * p, 2 * p, 2 * p);
          ctx.fillRect(9 * p, 7 * p, 2 * p, 2 * p);
          break;
      }

      ctx.restore();
    }

    // CRT scanlines
    function drawScanlines(
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number
    ) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "#000000";
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }
      ctx.restore();
    }

    // Vignette effect
    function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
      const gradient = ctx.createRadialGradient(
        w / 2,
        h / 2,
        w * 0.25,
        w / 2,
        h / 2,
        w * 0.75
      );
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(0.6, "rgba(0, 0, 0, 0.15)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.5)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    function animate() {
      if (!ctx) return;
      timeRef.current += 1;
      const t = timeRef.current;

      // Dark background with subtle gradient
      const bgGradient = ctx.createRadialGradient(
        W / 2,
        H / 2,
        0,
        W / 2,
        H / 2,
        W * 0.7
      );
      bgGradient.addColorStop(0, "#0d120d");
      bgGradient.addColorStop(1, "#050805");
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, W, H);

      // Subtle animated grid
      ctx.strokeStyle = `rgba(0, 255, 65, ${0.02 + Math.sin(t * 0.01) * 0.01})`;
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Draw twinkling stars
      drawStars(ctx, t);

      // Spawn and draw floating particles
      maybeSpawnParticle();
      drawParticles(ctx);

      // Update and draw ghosts
      ghostsRef.current.forEach((ghost) => {
        // Text avoidance
        const dx = ghost.x - AVOID_ZONE.cx;
        const dy = ghost.y - AVOID_ZONE.cy;
        const normalizedDist = Math.sqrt(
          (dx * dx) / (AVOID_ZONE.rx * AVOID_ZONE.rx) +
            (dy * dy) / (AVOID_ZONE.ry * AVOID_ZONE.ry)
        );

        if (normalizedDist < 1.4) {
          const repelStrength = Math.max(0, 1.4 - normalizedDist) * 0.06;
          const angle = Math.atan2(dy, dx);
          ghost.vx += Math.cos(angle) * repelStrength;
          ghost.vy += Math.sin(angle) * repelStrength;
        }

        // Update position
        ghost.x += ghost.vx;
        ghost.y += ghost.vy;

        // Dampen and drift
        ghost.vx *= 0.995;
        ghost.vy *= 0.995;
        if (Math.random() < 0.01) {
          ghost.vx += (Math.random() - 0.5) * 0.15;
          ghost.vy += (Math.random() - 0.5) * 0.15;
        }

        // Speed limits
        const speed = Math.sqrt(ghost.vx * ghost.vx + ghost.vy * ghost.vy);
        if (speed > 0.8) {
          ghost.vx = (ghost.vx / speed) * 0.8;
          ghost.vy = (ghost.vy / speed) * 0.8;
        }
        if (speed < 0.1) {
          ghost.vx += (Math.random() - 0.5) * 0.2;
          ghost.vy += (Math.random() - 0.5) * 0.2;
        }

        // Wrap edges
        if (ghost.x < -60) ghost.x = W + 60;
        if (ghost.x > W + 60) ghost.x = -60;
        if (ghost.y < -60) ghost.y = H + 60;
        if (ghost.y > H + 60) ghost.y = -60;

        // Bob animation
        const bobY = Math.sin(t * ghost.bobSpeed + ghost.bobOffset) * 3;

        // Draw ghost
        ctx.globalAlpha = 0.85;
        drawGhost(
          ctx,
          ghost.x,
          ghost.y + bobY,
          ghost.color,
          ghost.scale,
          ghost.faceType
        );
        ctx.globalAlpha = 1;
      });

      // Draw main title
      ctx.save();
      ctx.font = "bold 120px VT323, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Subtle pulsing glow
      const glowPulse = 6 + Math.sin(t * 0.03) * 2;
      ctx.shadowColor = "#00ff41";
      ctx.shadowBlur = glowPulse;
      ctx.fillStyle = "#00ff41";
      ctx.fillText("Be Right Back", W / 2, H / 2 - 60);

      // Crisp text on top
      ctx.shadowBlur = 0;
      ctx.fillText("Be Right Back", W / 2, H / 2 - 60);

      // Tagline
      ctx.font = "36px 'IBM Plex Mono', monospace";
      ctx.shadowBlur = 3;
      ctx.shadowColor = "#ffb000";
      ctx.fillStyle = "#ffb000";
      ctx.fillText("AI-powered search for your iMessages", W / 2, H / 2 + 60);
      ctx.shadowBlur = 0;
      ctx.fillText("AI-powered search for your iMessages", W / 2, H / 2 + 60);

      ctx.restore();

      // CRT effects
      drawScanlines(ctx, W, H);
      drawVignette(ctx, W, H);

      // Center glow
      const centerGlow = ctx.createRadialGradient(
        W / 2,
        H / 2,
        0,
        W / 2,
        H / 2,
        W * 0.4
      );
      centerGlow.addColorStop(0, "rgba(0, 255, 65, 0.02)");
      centerGlow.addColorStop(1, "rgba(0, 255, 65, 0)");
      ctx.fillStyle = centerGlow;
      ctx.fillRect(0, 0, W, H);

      animationRef.current = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "1200px",
        height: "630px",
        imageRendering: "auto",
      }}
    />
  );
}

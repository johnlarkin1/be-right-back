"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/shared/header";

const GHOST_SIZE = 40;
const COLLECT_RADIUS = 30;
const SPEED = 4.2;

// Breadcrumb fragments Casper collects, as fractions of the play area (kept
// away from the edges and the center where Casper spawns).
const FRAGMENT_POS = [
  { fx: 0.15, fy: 0.26 },
  { fx: 0.83, fy: 0.2 },
  { fx: 0.24, fy: 0.79 },
  { fx: 0.72, fy: 0.74 },
  { fx: 0.5, fy: 0.12 },
];

const MOVE_KEYS = new Set([
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "w",
  "a",
  "s",
  "d",
]);

const GHOST_COLOR = "#4d8cff"; // friendly blue

/** Casper — the pixel ghost sprite, blue and always grinning. */
function GhostSprite() {
  return (
    <svg
      width={GHOST_SIZE}
      height={GHOST_SIZE}
      viewBox="0 0 16 16"
      className="drop-shadow-[0_0_8px_rgba(77,140,255,0.6)]"
      style={{ imageRendering: "pixelated" }}
      aria-hidden="true"
    >
      <g fill={GHOST_COLOR}>
        <rect x="4" y="2" width="8" height="2" />
        <rect x="3" y="4" width="10" height="2" />
        <rect x="3" y="6" width="10" height="6" />
        <rect x="3" y="12" width="2" height="2" />
        <rect x="6" y="13" width="2" height="2" />
        <rect x="8" y="13" width="2" height="2" />
        <rect x="11" y="12" width="2" height="2" />
      </g>
      {/* Eyes + smile */}
      <g fill="#0a0e0a">
        <rect x="5" y="7" width="2" height="2" />
        <rect x="9" y="7" width="2" height="2" />
        <rect x="6" y="10" width="4" height="1" />
        <rect x="5" y="9" width="1" height="1" />
        <rect x="10" y="9" width="1" height="1" />
      </g>
    </svg>
  );
}

export default function NotFound() {
  const router = useRouter();
  const playRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const boundsRef = useRef({ w: 0, h: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const facingRef = useRef<1 | -1>(1);
  const placedRef = useRef(false);

  const [facing, setFacing] = useState<1 | -1>(1);
  const [started, setStarted] = useState(false);
  const [frags, setFrags] = useState(() =>
    FRAGMENT_POS.map((p, i) => ({ ...p, id: i, got: false }))
  );
  const fragsRef = useRef(frags);
  useEffect(() => {
    fragsRef.current = frags;
  }, [frags]);

  const collected = frags.filter((f) => f.got).length;
  const won = collected === frags.length;
  const wonRef = useRef(false);
  useEffect(() => {
    wonRef.current = won;
  }, [won]);

  const applyPos = () => {
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
    }
  };

  // Measure play area; spawn Casper in the center once we know the size.
  useEffect(() => {
    const measure = () => {
      const el = playRef.current;
      if (!el) return;
      boundsRef.current = { w: el.clientWidth, h: el.clientHeight };
      if (!placedRef.current && el.clientWidth > 0) {
        posRef.current = {
          x: el.clientWidth / 2 - GHOST_SIZE / 2,
          y: el.clientHeight / 2 - GHOST_SIZE / 2,
        };
        placedRef.current = true;
        applyPos();
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Keyboard input.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k)) {
        e.preventDefault();
        keysRef.current.add(k);
        setStarted(true);
      } else if (k === "enter" && wonRef.current) {
        router.push("/");
      }
    };
    const onUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [router]);

  // Animation loop: move Casper, clamp to bounds, collect fragments.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const keys = keysRef.current;
      let dx = 0;
      let dy = 0;
      if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
      if (keys.has("arrowright") || keys.has("d")) dx += 1;
      if (keys.has("arrowup") || keys.has("w")) dy -= 1;
      if (keys.has("arrowdown") || keys.has("s")) dy += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        const b = boundsRef.current;
        const maxX = Math.max(0, b.w - GHOST_SIZE);
        const maxY = Math.max(0, b.h - GHOST_SIZE);
        posRef.current.x = Math.min(maxX, Math.max(0, posRef.current.x + (dx / len) * SPEED));
        posRef.current.y = Math.min(maxY, Math.max(0, posRef.current.y + (dy / len) * SPEED));
        applyPos();

        if (dx < 0 && facingRef.current !== -1) {
          facingRef.current = -1;
          setFacing(-1);
        } else if (dx > 0 && facingRef.current !== 1) {
          facingRef.current = 1;
          setFacing(1);
        }

        // Collision with fragments (ghost center vs fragment center).
        const cx = posRef.current.x + GHOST_SIZE / 2;
        const cy = posRef.current.y + GHOST_SIZE / 2;
        let changed = false;
        for (const f of fragsRef.current) {
          if (f.got) continue;
          const fx = f.fx * b.w;
          const fy = f.fy * b.h;
          if (Math.hypot(cx - fx, cy - fy) < COLLECT_RADIUS) {
            f.got = true;
            changed = true;
          }
        }
        if (changed) setFrags(fragsRef.current.map((f) => ({ ...f })));
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="min-h-screen bg-crt-bg">
      <Header />

      <style>{`
        @keyframes casper-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes orb-pulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.85; } 50% { transform: translate(-50%,-50%) scale(1.25); opacity: 1; } }
        @keyframes home-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,176,0,0.5); } 50% { box-shadow: 0 0 18px 2px rgba(255,176,0,0.5); } }
        .casper-float { animation: casper-float 2.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .casper-float, .orb { animation: none !important; }
        }
      `}</style>

      <div className="pt-24 pb-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="font-jetbrains text-sm text-text-secondary mb-2">
            <span className="text-crt-accent">$</span> cd ./that-page
            <span className="text-crt-text/60"> → no such file or directory</span>
          </div>

          <h1
            className="font-ibm-plex-mono text-7xl md:text-8xl font-bold text-crt-text tracking-tight"
            style={{ textShadow: "0 0 18px rgba(0,255,65,0.45)" }}
          >
            404
          </h1>

          <p className="mt-3 font-inter text-lg text-text-secondary">
            {won ? (
              <>
                Casper found the trail home.{" "}
                <span className="text-crt-accent">Press Enter</span> (or pick a door below).
              </>
            ) : (
              <>Casper wandered off the map. Help him find the way back.</>
            )}
          </p>

          <p className="mt-1 font-jetbrains text-xs text-text-muted">
            move with <span className="text-crt-text">↑ ↓ ← →</span> or{" "}
            <span className="text-crt-text">WASD</span> · collect the {frags.length} breadcrumbs
            {"  "}
            <span className="text-crt-accent">{collected}/{frags.length}</span>
          </p>

          {/* Play area */}
          <div
            ref={playRef}
            className="relative mt-6 h-[52vh] min-h-[300px] w-full overflow-hidden rounded-xl border border-crt-text/20 bg-[#0a0e0a]/60"
            style={{
              backgroundImage:
                "radial-gradient(rgba(0,255,65,0.06) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          >
            {/* Breadcrumb fragments */}
            {frags.map((f) => (
              <span
                key={f.id}
                className="orb absolute block h-3 w-3 rounded-full"
                style={{
                  left: `${f.fx * 100}%`,
                  top: `${f.fy * 100}%`,
                  // A running keyframe animation overrides inline opacity, so
                  // collected orbs must drop the animation to actually vanish.
                  transform: f.got
                    ? "translate(-50%,-50%) scale(0)"
                    : "translate(-50%,-50%)",
                  background: "var(--crt-accent)",
                  boxShadow: "0 0 10px 2px rgba(255,176,0,0.6)",
                  animation: f.got ? "none" : "orb-pulse 1.4s ease-in-out infinite",
                  opacity: f.got ? 0 : 1,
                  transition: "opacity 0.25s ease, transform 0.25s ease",
                  pointerEvents: "none",
                }}
              />
            ))}

            {/* Casper */}
            <div
              ref={ghostRef}
              className="absolute left-0 top-0 will-change-transform"
              style={{ width: GHOST_SIZE, height: GHOST_SIZE }}
            >
              <div className="casper-float" style={{ transform: `scaleX(${facing})` }}>
                <GhostSprite />
              </div>
            </div>

            {/* Start hint */}
            {!started && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-jetbrains text-xs text-text-muted">
                press an arrow key to move Casper
              </div>
            )}
          </div>

          {/* Exits */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3 font-jetbrains text-sm">
            <Link
              href="/"
              className="border-2 px-4 py-1.5 text-crt-accent border-crt-accent transition-all hover:bg-crt-accent/10"
              style={won ? { animation: "home-pulse 1.4s ease-in-out infinite" } : undefined}
            >
              ./home
            </Link>
            <Link
              href="/how-its-built"
              className="px-3 py-1.5 text-crt-text/75 transition-colors hover:text-crt-text"
            >
              ./how-its-built
            </Link>
            <Link
              href="/playground"
              className="px-3 py-1.5 text-crt-text/75 transition-colors hover:text-crt-text"
            >
              ./playground
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

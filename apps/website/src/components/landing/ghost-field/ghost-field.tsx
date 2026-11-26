"use client";

import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { NUM_GHOSTS } from "../constants";
import { GhostInteractionHints } from "../ghost-interaction-hints";
import { GhostRenderer, type Spotlight } from "./renderer";
import { COLLAB_URL, joinGhostRoom, type Presence } from "./presence";
import { GhostSim, STEP_MS, type Pointer } from "./sim";
import { StaticGhosts } from "./static-ghosts";

/** Longest frame gap the loop catches up on. Longer gaps (a hidden tab) are dropped. */
const MAX_FRAME_MS = 100;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const SPOTLIGHT_MARGIN = 150;
const MAX_DPR = 2;
/** Glow colours for other visitors, picked by their awareness id. */
const PEER_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.69, 0],
  [0, 1, 1],
  [1, 0.35, 1],
  [0.42, 0.66, 1],
  [1, 0.42, 0.42],
  [0.6, 1, 0.2],
];

/**
 * The homepage ghosts, drawn with WebGL2 on one canvas that fills the hero.
 *
 * `GhostSim` runs the physics at a fixed 60 Hz. `GhostRenderer` draws the
 * frame in between. Without WebGL2, or with reduced motion, the hero shows
 * still ghosts instead.
 *
 * When `NEXT_PUBLIC_COLLAB_URL` is set, the field also joins the collab
 * server's `ghosts` room (presence.ts). Every visitor's pointer then acts on
 * every visitor's ghosts, and other visitors show as coloured spotlights.
 * Each browser still runs its own ghosts, so ghost positions differ per screen.
 */
export function GhostField({ ghostCount = NUM_GHOSTS }: { ghostCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const [webglFailed, setWebglFailed] = useState(false);
  const isStatic = reducedMotion || webglFailed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (isStatic || !canvas) return;

    const font = `${getComputedStyle(document.body).getPropertyValue("--font-ibm-plex-mono") || "monospace"}, monospace`;
    let renderer: GhostRenderer | null;
    try {
      renderer = new GhostRenderer(canvas, font);
    } catch (error) {
      console.warn("Ghost field: falling back to still ghosts.", error);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- WebGL support is only known once the canvas exists
      setWebglFailed(true);
      return;
    }

    let rect = canvas.getBoundingClientRect();
    const sim = new GhostSim((Math.random() * 2 ** 32) >>> 0, rect.width, rect.height, ghostCount);

    const resize = () => {
      rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      sim.resize(rect.width, rect.height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    // Skip all work while the hero is scrolled out of view.
    let visible = true;
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibility.observe(canvas);

    // Pointer in client coordinates. Each step maps it into the field, so
    // scrolling with a still mouse still moves the spotlight over the ghosts.
    const pointer = { clientX: -10000, clientY: -10000 };
    const me: Pointer = { id: "me", x: -10000, y: -10000, attracting: false, spawning: false };
    const cleanups: (() => void)[] = [];
    type EventMap = WindowEventMap & DocumentEventMap;
    const listen = <K extends keyof EventMap>(
      target: Window | Document,
      type: K,
      handler: (e: EventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };

    let spotlightT = 0;
    let spotlights: Spotlight[] = [];

    // Shared cursors. Remote pointers ease toward their latest position,
    // because updates arrive about 15 times a second.
    let presence: Presence | null = null;
    let closed = false;
    if (COLLAB_URL) {
      joinGhostRoom(COLLAB_URL)
        .then((p) => {
          if (closed) p.leave();
          else presence = p;
        })
        .catch((error) => console.warn("Ghost field: shared cursors unavailable.", error));
    }
    const peers = new Map<number, Pointer & { seen: boolean }>();
    let lastCount = -1;
    // A hidden tab stops animation frames, so hide the pointer right away.
    listen(document, "visibilitychange", () => {
      if (document.hidden) presence?.publish(null);
    });

    if (isMobile) {
      // A roaming spotlight on a Lissajous path stands in for the mouse.
      let lastTap: { time: number; x: number; y: number } | null = null;
      listen(
        window,
        "touchend",
        (e) => {
          const touch = e.changedTouches[0];
          if (!touch) return;
          const now = performance.now();
          if (
            lastTap &&
            now - lastTap.time < DOUBLE_TAP_MS &&
            Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < DOUBLE_TAP_PX
          ) {
            e.preventDefault();
            sim.queueSpawn(touch.clientX - rect.left, touch.clientY - rect.top);
            lastTap = null;
            return;
          }
          lastTap = { time: now, x: touch.clientX, y: touch.clientY };
        },
        { passive: false },
      );
    } else {
      // Right clicks spawn ghosts only over the hero. Elsewhere the browser menu works.
      const inHero = (e: MouseEvent) =>
        visible &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      listen(window, "contextmenu", (e) => {
        if (inHero(e)) e.preventDefault();
      });
      listen(window, "mousemove", (e) => {
        pointer.clientX = e.clientX;
        pointer.clientY = e.clientY;
      });
      listen(window, "mousedown", (e) => {
        pointer.clientX = e.clientX;
        pointer.clientY = e.clientY;
        if (e.button === 0) me.attracting = true;
        if (e.button === 2 && inHero(e)) me.spawning = true;
      });
      listen(window, "mouseup", (e) => {
        if (e.button === 0) me.attracting = false;
        if (e.button === 2) me.spawning = false;
      });
      const stop = () => {
        me.spawning = false;
        me.attracting = false;
      };
      listen(window, "blur", stop);
      listen(document, "mouseleave", stop);
    }

    let lost = false;
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
    };
    const onRestored = () => {
      renderer?.dispose();
      try {
        renderer = new GhostRenderer(canvas, font);
        lost = false;
      } catch (error) {
        console.warn("Ghost field: could not restore WebGL, falling back to still ghosts.", error);
        renderer = null;
        setWebglFailed(true);
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    const step = () => {
      if (isMobile) {
        spotlightT += 0.008;
        const cx = sim.width / 2;
        const cy = sim.height / 2;
        const rx = Math.max(0, (sim.width - SPOTLIGHT_MARGIN * 2) / 2);
        const ry = Math.max(0, (sim.height - SPOTLIGHT_MARGIN * 2) / 2);
        me.x = cx + rx * Math.sin(spotlightT * 1.1 + Math.sin(spotlightT * 0.3));
        me.y = cy + ry * Math.sin(spotlightT * 0.7 + Math.cos(spotlightT * 0.2));
      } else {
        me.x = pointer.clientX - rect.left;
        me.y = pointer.clientY - rect.top;
      }
      sim.step({ pointers: [me, ...peers.values()] });
    };

    /** Reads the room once per frame: shares this pointer, eases the others. */
    const syncPresence = (dt: number) => {
      if (!presence) return;
      const inField = me.x >= 0 && me.y >= 0 && me.x <= sim.width && me.y <= sim.height;
      // Phones have no real pointer. Their roaming spotlight stays local, so others never see it.
      presence.publish(
        !isMobile && visible && inField
          ? { x: me.x / sim.width, y: me.y / sim.height, attracting: me.attracting, spawning: me.spawning }
          : null,
      );
      const ease = 1 - Math.exp(-dt / 80);
      for (const peer of peers.values()) peer.seen = false;
      for (const p of presence.peers()) {
        const x = p.x * sim.width;
        const y = p.y * sim.height;
        const peer = peers.get(p.id);
        if (peer) {
          peer.x += (x - peer.x) * ease;
          peer.y += (y - peer.y) * ease;
          peer.attracting = p.attracting;
          peer.spawning = p.spawning;
          peer.seen = true;
        } else {
          peers.set(p.id, { ...p, x, y, seen: true });
        }
      }
      for (const [id, peer] of peers) if (!peer.seen) peers.delete(id);

      const count = presence.count();
      if (count !== lastCount && countRef.current) {
        lastCount = count;
        countRef.current.textContent = count > 1 ? `${count} people here` : "";
      }
    };

    let frame = 0;
    let last = performance.now();
    let pending = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      if (!visible || lost || !renderer) {
        // Off screen: stop showing this visitor's pointer to the room.
        presence?.publish(null);
        return;
      }
      rect = canvas.getBoundingClientRect();
      syncPresence(elapsed);
      pending += elapsed;
      while (pending >= STEP_MS) {
        step();
        pending -= STEP_MS;
      }
      spotlights = [...peers.values()].map((p) => ({
        x: p.x,
        y: p.y,
        rgb: PEER_COLORS[(p.id as number) % PEER_COLORS.length],
        dot: true,
      }));
      // On phones the field also draws this visitor's own roaming spotlight.
      if (isMobile) spotlights.push({ x: me.x, y: me.y });
      renderer.draw(sim, pending / STEP_MS, now, spotlights);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibility.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      for (const cleanup of cleanups) cleanup();
      renderer?.dispose();
      closed = true;
      presence?.leave();
    };
  }, [isStatic, isMobile, ghostCount]);

  if (isStatic) return <StaticGhosts count={ghostCount} />;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
        data-testid="ghost-field"
      />
      <div
        ref={countRef}
        className="pointer-events-none absolute right-8 top-20 z-20 font-ibm-plex-mono text-sm text-crt-text/60"
        aria-live="polite"
      />
      <GhostInteractionHints />
    </>
  );
}

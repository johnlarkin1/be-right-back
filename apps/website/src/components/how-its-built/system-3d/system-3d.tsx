"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  LAYERS,
  LAYER_BY_ID,
  STATION_BY_ID,
  TOURS,
  type Layer,
  type Station,
} from "./data";
import {
  COMPACT,
  FIT_MARGIN,
  NEUTRAL,
  RIM_TINT,
  STEP_STYLE,
  WIDE,
  fitBox,
  pressedY,
  screenAxes,
  type Dims,
} from "./layout";
import type { SceneProps, Sim } from "./scene";
import { DetailPanel, type DetailTarget } from "./detail-panel";
import {
  ACCENT,
  BG,
  Glyph,
  INK,
  INK2,
  KIND_LABEL,
  LayerBadge,
  META,
} from "./parts";

interface System3DProps {
  title?: string;
  height?: number;
}

/** Article prose styles reach into the figure. Inline styles win. */
const LIST_RESET = { margin: 0, padding: 0, listStyle: "none" } as const;

type SceneModule = { default: ComponentType<SceneProps> };

/**
 * The open detail panel. A panel that follows shows the tour's current
 * station and moves with each step.
 */
type Detail = DetailTarget & { follow: boolean };
/** One import per page, shared by every figure. */
let scenePromise: Promise<SceneModule> | null = null;
const loadScene = () => (scenePromise ??= import("./scene"));

/** Subscribes to a media query. The server snapshot is false. */
function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function stationOf(id: string): Station {
  return STATION_BY_ID.get(id)!;
}

/**
 * Exploded 3D view of the system, in the style of a chip explainer. The four
 * layers pull apart once the canvas scrolls into view. Then a packet walks
 * one tour, step by step. Three.js loads when the browser is idle, or when
 * the figure comes near the viewport.
 */
export function System3D({
  title = "Be Right Back in 3D",
  height,
}: System3DProps) {
  const uid = useId();
  const containerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [Scene, setScene] = useState<ComponentType<SceneProps> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);

  const [tourIndex, setTourIndex] = useState(0);
  const [stopIndex, setStopIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [apart, setApart] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  /** Bumped on each explicit open. The panel takes focus when it changes. */
  const [focusKey, setFocusKey] = useState(0);
  /** False when the panel opened from the canvas, which must not scroll. */
  const [autoScroll, setAutoScroll] = useState(true);
  const [wake, setWake] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const tour = TOURS[tourIndex];
  const n = tour.stops.length;
  const si = Math.min(stopIndex, n - 1);

  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const coarse = useMedia("(pointer: coarse)");
  const fine = useMedia("(pointer: fine)");

  const sim = useRef<Sim>({
    playing: false,
    jumpSeq: 0,
    jumpTo: 0,
    fitSeq: 0,
    explode: 0,
  });
  /** The step the packet is at or heading to. Relative steps start here. */
  const target = useRef(0);
  /** The tour on screen. A late arrival from another tour is dropped. */
  const tourId = useRef(TOURS[0].id);
  /** The reader has used a control. Autoplay never starts after that. */
  const interacted = useRef(false);
  const autoplayed = useRef(false);
  /** The reveal has fired once. It latches. */
  const triggered = useRef(false);
  /** Where focus was before the detail panel opened. */
  const opener = useRef<HTMLElement | null>(null);
  const detailId = `${uid}-detail`;

  const bump = useCallback(() => setWake((w) => w + 1), []);
  const play = useCallback((on: boolean) => {
    sim.current.playing = on;
    setPlaying(on);
  }, []);

  useEffect(() => {
    sim.current.playing = playing;
  }, [playing]);

  // Fetch the scene module when the browser is idle.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadScene()
        .then((m) => {
          if (!cancelled) setScene(() => m.default);
        })
        .catch((e: unknown) => {
          if (!cancelled)
            setError(
              e instanceof Error ? e.message : "Failed to load the 3D view",
            );
        });
    if (near) {
      load();
    } else if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 4000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    } else {
      const id = setTimeout(load, 1500);
      return () => {
        cancelled = true;
        clearTimeout(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [near]);

  // Mount the canvas well before the figure scrolls in. It latches.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Stop rendering offscreen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
        // Reduced motion: show the stack apart from the start.
        if (
          entry.isIntersecting &&
          !triggered.current &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          triggered.current = true;
          sim.current.explode = 1;
          setApart(true);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pull the layers apart once, when half the canvas is on screen. A tall
  // canvas in a short window never reaches 50%, so 40% of the viewport
  // height on screen also counts.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const enough =
          entry.intersectionRatio >= 0.5 ||
          entry.intersectionRect.height >= window.innerHeight * 0.4;
        if (!enough || triggered.current) return;
        triggered.current = true;
        sim.current.explode = 1;
        setApart(true);
        setWake((w) => w + 1);
        observer.disconnect();
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fade the step panel in on each change.
  useEffect(() => {
    if (reducedMotion) return;
    panelRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: "ease-out",
    });
  }, [si, tour.id, revealed, reducedMotion]);

  /** Moves the packet to step `i`. A manual jump pauses playback. */
  const jump = useCallback(
    (i: number) => {
      interacted.current = true;
      play(false);
      const j = Math.min(n - 1, Math.max(0, i));
      target.current = j;
      sim.current.jumpTo = j;
      sim.current.jumpSeq += 1;
      // An open block panel follows the step.
      const at = tour.stops[j].station;
      setDetail((d) =>
        d?.kind === "station" ? { kind: "station", id: at, follow: true } : d,
      );
      setFinished(false);
      bump();
    },
    [n, tour, play, bump],
  );
  const step = (delta: number) => jump(target.current + delta);

  const onArrive = useCallback((id: string, i: number) => {
    if (id !== tourId.current) return;
    target.current = i;
    setStopIndex(i);
    const at = TOURS.find((t) => t.id === id)?.stops[i]?.station;
    if (!at) return;
    setDetail((d) =>
      d?.kind === "station" && d.follow && d.id !== at ? { ...d, id: at } : d,
    );
  }, []);

  const onRevealed = useCallback(() => {
    setRevealed(true);
    if (reducedMotion || interacted.current || autoplayed.current) return;
    autoplayed.current = true;
    play(true);
  }, [reducedMotion, play]);

  const onFinish = useCallback(() => {
    play(false);
    setFinished(true);
  }, [play]);

  const togglePlay = () => {
    interacted.current = true;
    if (playing) {
      play(false);
      return;
    }
    if (!apart) {
      triggered.current = true;
      sim.current.explode = 1;
      setApart(true);
    }
    if (finished || target.current >= n - 1) {
      target.current = 0;
      sim.current.jumpTo = 0;
      sim.current.jumpSeq += 1;
      setFinished(false);
    }
    const at = tour.stops[target.current].station;
    setDetail((d) =>
      d?.kind === "station" ? { kind: "station", id: at, follow: true } : d,
    );
    play(true);
    bump();
  };

  const resetView = () => {
    sim.current.fitSeq += 1;
    bump();
  };

  const pickTour = (i: number) => {
    if (i === tourIndex) return;
    interacted.current = true;
    tourId.current = TOURS[i].id;
    target.current = 0;
    setTourIndex(i);
    setStopIndex(0);
    const at = TOURS[i].stops[0].station;
    setDetail((d) =>
      d?.kind === "station" && d.follow ? { ...d, id: at } : d,
    );
    setFinished(false);
    bump();
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = TOURS.length - 1;
    const map: Record<string, number> = {
      ArrowRight: tourIndex === last ? 0 : tourIndex + 1,
      ArrowLeft: tourIndex === 0 ? last : tourIndex - 1,
      Home: 0,
      End: last,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    pickTour(map[e.key]);
    tabRefs.current[map[e.key]]?.focus();
  };

  /** Opens the detail panel. It remembers focus, to give it back on close. */
  const openDetail = useCallback(
    (t: DetailTarget, follow: boolean, scroll = true) => {
      const a = document.activeElement;
      const box = document.getElementById(detailId);
      if (a instanceof HTMLElement && a !== document.body && !box?.contains(a))
        opener.current = a;
      setDetail({ ...t, follow });
      setAutoScroll(scroll);
      setFocusKey((k) => k + 1);
    },
    [detailId],
  );

  const closeDetail = useCallback(() => {
    const box = document.getElementById(detailId);
    if (box?.contains(document.activeElement)) {
      const o = opener.current;
      (o?.isConnected ? o : containerRef.current)?.focus({
        preventScroll: true,
      });
    }
    opener.current = null;
    setDetail(null);
  }, [detailId]);

  const onSelect = useCallback(
    (id: string) => {
      // An empty-canvas tap on a touch screen is too easy to make by mistake.
      if (!id) {
        if (fine) closeDetail();
        return;
      }
      // A station on this tour also moves the packet there.
      const next = tour.stops.findIndex(
        (s, i) => s.station === id && i > target.current,
      );
      const first = tour.stops.findIndex((s) => s.station === id);
      if (first >= 0) jump(next >= 0 ? next : first);
      openDetail({ kind: "station", id }, first >= 0, false);
    },
    [tour, jump, openDetail, closeDetail, fine],
  );

  /** From the canvas, so no scroll. The phone key passes `scroll`. */
  const onLayer = useCallback(
    (id: Layer, scroll = false) =>
      openDetail({ kind: "layer", id }, false, scroll),
    [openDetail],
  );

  /** From inside the panel. Only the current station follows the tour. */
  const openFromPanel = (t: DetailTarget) =>
    openDetail(
      t,
      t.kind === "station" && t.id === tour.stops[target.current].station,
    );

  const onFigureKey = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    // The tabs own their arrow keys. Buttons own Space and Enter.
    if (el.closest('[role="tablist"]')) return;
    const own = el === e.currentTarget;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      Home: () => jump(0),
      End: () => jump(n - 1),
      Escape: closeDetail,
    };
    if (own)
      keys[" "] = () => {
        if (!reducedMotion) togglePlay();
      };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const stop = tour.stops[si];
  const station = stationOf(stop.station);
  const layer = LAYER_BY_ID.get(station.layer)!;
  const selectedId = detail?.kind === "station" ? detail.id : null;
  const stepOpen = detail?.kind === "station" && detail.id === stop.station;
  const toggleStepDetail = () => {
    if (stepOpen) closeDetail();
    else openDetail({ kind: "station", id: stop.station }, true);
  };
  const panelId = `${uid}-panel`;
  const figId = `${uid}-fig`;
  const captionId = `${uid}-caption`;
  const stateOf = (i: number) =>
    i === si ? "current" : i < si ? "done" : "upcoming";

  return (
    <figure
      ref={containerRef}
      tabIndex={0}
      aria-label={`${title}: ${tour.name}`}
      aria-describedby={`${figId} ${captionId}`}
      aria-keyshortcuts="ArrowLeft ArrowRight Home End Space"
      onKeyDown={onFigureKey}
      className="@container not-prose my-10 overflow-hidden rounded-lg border border-border-subtle bg-surface outline-none focus-visible:ring-2 focus-visible:ring-[#ffb000] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f0c]"
    >
      {/* Tour tabs */}
      <div className="border-b border-border-subtle px-4 py-3 @max-[640px]:px-3">
        <div
          role="tablist"
          aria-label="Tours"
          onKeyDown={onTabKey}
          className="flex h-8 gap-1"
        >
          {TOURS.map((t, i) => {
            const on = i === tourIndex;
            return (
              <button
                key={t.id}
                ref={(b) => {
                  tabRefs.current[i] = b;
                }}
                id={`${uid}-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={panelId}
                aria-label={t.name}
                tabIndex={on ? 0 : -1}
                onClick={() => pickTour(i)}
                className={`flex h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded border px-3 font-jetbrains text-[11px] transition-colors @max-[640px]:flex-1 @max-[640px]:px-1 ${
                  on
                    ? "border-[#ffb000] text-[#ffb000]"
                    : "border-transparent text-[#8a8576] hover:text-[#ede7d6]"
                }`}
              >
                <span className="@max-[640px]:hidden">{t.name}</span>
                <span className="hidden @max-[640px]:inline">{t.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${uid}-tab-${tourIndex}`}
      >
        {/* Canvas */}
        <div
          ref={canvasRef}
          className={`relative ${height ? "" : "h-[460px] @max-[640px]:h-[380px]"}`}
          style={{ background: BG, ...(height ? { height } : null) }}
        >
          <div aria-hidden="true" className="absolute inset-0">
            <Slab d={WIDE} className="h-full w-full @max-[640px]:hidden" />
            <Slab
              d={COMPACT}
              className="hidden h-full w-full @max-[640px]:block"
            />
          </div>
          {Scene && near && !error && (
            <div className="absolute inset-0">
              <Scene
                active={visible}
                sim={sim}
                tour={tour}
                stopIndex={si}
                selectedId={selectedId}
                openLayer={detail?.kind === "layer" ? detail.id : null}
                reducedMotion={reducedMotion}
                coarse={coarse}
                wake={wake}
                onArrive={onArrive}
                onSelect={onSelect}
                onLayer={onLayer}
                onJump={jump}
                onRevealed={onRevealed}
                onFinish={onFinish}
              />
            </div>
          )}
          {error && (
            <div
              className="absolute inset-x-0 bottom-3 text-center font-inter text-sm"
              style={{ color: INK2 }}
            >
              {error}
            </div>
          )}

          <div className="absolute right-2 top-2 z-[80] flex gap-1">
            <button
              type="button"
              aria-label="Reset view"
              title="Reset view"
              onClick={resetView}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border-subtle bg-[#0b0f0c]/80 font-jetbrains text-xs text-[#a8a294] transition-colors hover:border-[#ffb000] hover:text-[#ffb000]"
            >
              ⤢
            </button>
          </div>
        </div>

        {/* Key. Wide canvases name the layers in place, so only shapes. */}
        <div
          className="border-t border-border-subtle px-4 py-2 font-jetbrains text-[10px] @max-[640px]:px-3"
          style={{ color: META }}
        >
          <div className="mb-1.5 hidden grid-cols-2 gap-x-3 gap-y-1 @max-[640px]:grid">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onLayer(l.id, true)}
                aria-label={`${l.label} layer details`}
                className="-my-1 flex cursor-pointer items-center gap-1.5 py-1 text-left transition-colors hover:text-[#ede7d6]"
              >
                <LayerBadge letter={l.letter} color={l.color} small />
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {(["call", "daemon", "store"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <Glyph kind={k} />
                {KIND_LABEL[k]}
              </span>
            ))}
          </div>
        </div>

        {/* Figure caption */}
        <p
          id={figId}
          className="border-t border-border-subtle px-4 pt-3 font-inter text-[12.8px] leading-[1.5] @max-[640px]:px-3"
          style={{ color: META }}
        >
          <span style={{ color: INK2 }}>Fig. · {title}.</span> Four layers,
          pulled apart. Pick a tour, then follow its numbered steps.
          {fine
            ? " Drag to tilt, click a block or layer name for details, or use ← → to step."
            : " Tap a block for details."}
        </p>

        {/* Active step */}
        <div className="px-4 pt-3 @max-[640px]:px-3">
          <div ref={panelRef} id={captionId} className="pb-1">
            <div className="flex min-w-0 items-center gap-2 whitespace-nowrap font-jetbrains text-[11px]">
              <Chip n={si + 1} />
              <span className="truncate" style={{ color: INK }}>
                {station.label}
              </span>
              <LayerBadge letter={layer.letter} color={layer.color} small />
              <span
                className="flex min-w-0 items-center gap-1.5"
                style={{ color: META }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: ACCENT }}
                />
                <span className="truncate">{stop.tag}</span>
              </span>
              <button
                type="button"
                onClick={toggleStepDetail}
                aria-expanded={stepOpen}
                aria-controls={stepOpen ? detailId : undefined}
                className={`ml-auto flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border px-2 font-jetbrains text-[10.5px] transition-colors hover:border-[#6e685b] hover:text-[#ede7d6] ${
                  stepOpen
                    ? "border-[#6e685b] text-[#ede7d6]"
                    : "border-border-subtle text-[#a8a294]"
                }`}
              >
                {stepOpen ? "Hide details" : "Details"}
                <span className="sr-only"> for {station.label}</span>
                <span
                  aria-hidden="true"
                  className="inline-block transition-transform"
                  style={{
                    transform: stepOpen ? "rotate(-90deg)" : "rotate(90deg)",
                  }}
                >
                  ›
                </span>
              </button>
            </div>
            {/* Every caption sits in one grid cell, so the panel is as
                tall as the longest one and the controls never jump. */}
            <div className="mt-1.5 grid">
              {tour.stops.map((s, i) => (
                <div
                  key={i}
                  aria-hidden={i !== si}
                  className="[grid-area:1/1]"
                  style={{ visibility: i === si ? "visible" : "hidden" }}
                >
                  <div
                    className="font-inter text-[17px] leading-[1.45]"
                    style={{ color: revealed ? INK : INK2 }}
                  >
                    {s.caption}
                  </div>
                  <div
                    className="mt-1 font-jetbrains text-[11px] leading-[1.4]"
                    style={{ color: META }}
                  >
                    {stationOf(s.station).path}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="sr-only" aria-live={playing ? "off" : "polite"}>
            {revealed ? `Step ${si + 1} of ${n}. ${stop.caption}` : ""}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 px-4 pb-2 pt-1 @max-[640px]:px-3">
          {!reducedMotion && (
            <CtlButton
              label={finished ? "Replay" : playing ? "Pause" : "Play"}
              onClick={togglePlay}
            >
              {finished ? "↺" : playing ? "❚❚" : "▶"}
            </CtlButton>
          )}
          <CtlButton
            label="Previous step"
            onClick={() => step(-1)}
            disabled={si === 0}
            className="@max-[480px]:hidden"
          >
            ‹
          </CtlButton>
          <ol
            aria-label="Steps"
            className="flex min-w-0 items-center gap-[2px] @max-[480px]:gap-0"
            style={LIST_RESET}
          >
            {tour.stops.map((s, i) => {
              const st = stationOf(s.station);
              const state = stateOf(i);
              return (
                <li
                  key={i}
                  className="flex w-[28px] min-w-[24px] shrink before:content-none"
                  style={LIST_RESET}
                >
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={state === "current" ? "step" : undefined}
                    aria-label={`Step ${i + 1} of ${n}: ${st.label}. ${s.caption}`}
                    className="group flex h-10 w-full cursor-pointer items-center @max-[480px]:px-px"
                  >
                    <span
                      className={`flex h-7 w-full items-center justify-center rounded-[3px] border font-jetbrains text-[10px] tabular-nums transition-colors ${
                        state === "upcoming"
                          ? "group-hover:!border-[#6e685b]"
                          : ""
                      }`}
                      style={STEP_STYLE[state]}
                    >
                      {i + 1}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <CtlButton
            label="Next step"
            onClick={() => step(1)}
            disabled={si === n - 1}
            className="@max-[480px]:hidden"
          >
            ›
          </CtlButton>
          <span
            className="ml-auto shrink-0 pl-2 font-jetbrains text-[11px] tabular-nums"
            style={{ color: META }}
          >
            {si + 1} / {n}
          </span>
        </div>

        {/* Click-in details */}
        {detail && (
          <DetailPanel
            id={detailId}
            target={detail}
            focusKey={focusKey}
            autoScroll={autoScroll}
            playing={playing}
            reducedMotion={reducedMotion}
            currentStation={stop.station}
            onOpen={openFromPanel}
            onClose={closeDetail}
          />
        )}

        {/* Every step at once */}
        <div className="border-t border-border-subtle px-4 py-1.5 @max-[640px]:px-3">
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls={`${uid}-all`}
            onClick={() => setListOpen((o) => !o)}
            className="flex h-8 cursor-pointer select-none items-center gap-1.5 font-jetbrains text-[11px] text-[#8a8576] transition-colors hover:text-[#ede7d6]"
          >
            <span
              aria-hidden="true"
              className="inline-block w-2 transition-transform"
              style={{ transform: listOpen ? "rotate(90deg)" : "none" }}
            >
              ▸
            </span>
            All {n} steps
          </button>
          <ol
            id={`${uid}-all`}
            hidden={!listOpen}
            className="mb-1.5 space-y-0.5"
            style={LIST_RESET}
          >
            {tour.stops.map((s, i) => {
              const st = stationOf(s.station);
              const l = LAYER_BY_ID.get(st.layer)!;
              const state = stateOf(i);
              const current = state === "current";
              return (
                <li key={i} className="before:content-none" style={LIST_RESET}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-current={current ? "step" : undefined}
                    className={`grid w-full cursor-pointer grid-cols-[18px_14px_9rem_1fr] items-center gap-x-2.5 gap-y-0.5 border-l-2 py-1 pl-2 pr-1 text-left transition-colors @max-[640px]:grid-cols-[18px_14px_1fr] ${
                      current
                        ? "border-[#ffb000] bg-[#ffb000]/[0.06]"
                        : "border-transparent hover:bg-white/[0.03]"
                    }`}
                  >
                    <Chip n={i + 1} state={state} />
                    <LayerBadge letter={l.letter} color={l.color} small />
                    <span
                      className="truncate font-jetbrains text-[11px]"
                      style={{ color: current ? INK : INK2 }}
                    >
                      {st.label}
                    </span>
                    <span
                      className="font-inter text-[14px] leading-[1.45] @max-[640px]:col-span-3 @max-[640px]:pl-[32px]"
                      style={{
                        color: current ? INK : state === "done" ? INK2 : META,
                      }}
                    >
                      {s.caption}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------- placeholder */

/** Mixes two #rrggbb colors. */
function mix(a: string, b: string, t: number): string {
  const p = (c: string, i: number) =>
    parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  const ch = [0, 1, 2].map((i) =>
    Math.round(p(a, i) + (p(b, i) - p(a, i)) * t)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${ch.join("")}`;
}

/**
 * The pressed slab as a static SVG. It uses the scene's camera and fit, so
 * the canvas replaces it without a jump.
 */
function Slab({ d, className }: { d: Dims; className: string }) {
  const { right, up } = screenAxes(d);
  const proj = (x: number, y: number, z: number): [number, number] => [
    x * right[0] + y * right[1] + z * right[2],
    -(x * up[0] + y * up[1] + z * up[2]),
  ];
  const box = fitBox(d);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const [sx, sy] = proj(
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    );
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  const w = (x1 - x0) / FIT_MARGIN;
  const h = (y1 - y0) / FIT_MARGIN;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const f = (p: [number, number]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const W = d.plateW / 2;
  const D = d.plateD / 2;
  const T = d.plateT / 2;

  return (
    <svg
      className={className}
      viewBox={`${cx - w / 2} ${cy - h / 2} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {[...LAYERS].reverse().map((l) => {
        const y = pressedY(l.id, d);
        const c = (sx: number, sy: number, sz: number) =>
          proj(sx * W, y + sy * T, sz * D);
        const top = [c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)];
        const edges: [number, number, number][][] = [];
        for (const sy of [-1, 1]) {
          edges.push([
            [-1, sy, -1],
            [1, sy, -1],
            [1, sy, 1],
            [-1, sy, 1],
            [-1, sy, -1],
          ]);
        }
        const posts = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([sx, sz]) => `M${f(c(sx, -1, sz))}L${f(c(sx, 1, sz))}`);
        const rings = edges.map(
          (e) => "M" + e.map(([sx, sy, sz]) => f(c(sx, sy, sz))).join("L"),
        );
        return (
          <g key={l.id}>
            <polygon
              points={top.map(f).join(" ")}
              fill={l.color}
              fillOpacity={0.07}
            />
            <path
              d={[...rings, ...posts].join("")}
              fill="none"
              stroke={NEUTRAL}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`M${f(c(-1, 1, 1))}L${f(c(1, 1, 1))}`}
              stroke={mix(NEUTRAL, l.color, RIM_TINT)}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ parts */

function Chip({
  n,
  state = "current",
}: {
  n: number;
  state?: "current" | "done" | "upcoming";
}) {
  return (
    <span
      className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[9px] border px-1 font-jetbrains text-[10px] font-semibold leading-none tracking-normal tabular-nums"
      style={STEP_STYLE[state]}
    >
      {n}
    </span>
  );
}

function CtlButton({
  label,
  onClick,
  children,
  disabled = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded border border-border-subtle font-jetbrains text-xs text-[#a8a294] transition-colors hover:border-[#ffb000] hover:text-[#ffb000] disabled:cursor-default disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:text-[#a8a294] ${className}`}
    >
      {children}
    </button>
  );
}

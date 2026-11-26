"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  LAYERS,
  LAYER_BY_ID,
  STATIONS,
  STATION_BY_ID,
  type Layer,
} from "./data";
import {
  LAYER_DETAILS,
  STATION_DETAILS,
  type Changing,
  type DetailRow,
  type DetailSection,
} from "./details";
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
import { Figures } from "./visual";
import { LAYER_VISUALS, STATION_VISUALS } from "./visuals";

export type DetailTarget =
  | { kind: "station"; id: string }
  | { kind: "layer"; id: Layer };

interface DetailPanelProps {
  id: string;
  target: DetailTarget;
  /** Bumped on each open. The panel takes focus when it changes. */
  focusKey: number;
  /** False when the reader opened the panel from the canvas. */
  autoScroll: boolean;
  /** The tour is playing. The panel keeps its tallest height meanwhile. */
  playing: boolean;
  reducedMotion: boolean;
  /** The station the tour is at, marked "now" in a layer's block list. */
  currentStation: string;
  onOpen: (target: DetailTarget) => void;
  onClose: () => void;
}

/** Article prose styles reach into the figure. Inline styles win. */
const RESET = { margin: 0, padding: 0, listStyle: "none" } as const;

/** Article heading styles reach in too. Mono, small, no margins. */
const MONO = "var(--font-jetbrains), monospace";

/** How much of the panel must show below the fold after it opens. */
const PEEK = 200;
const PEEK_NARROW = 120;

/** Footnote numbers for the changing notes, in reading order. */
type NoteIndex = Map<Changing, number>;

/**
 * Click-in details for one block or layer. It sits under the canvas, so it
 * never hides the stack or the step controls.
 */
export function DetailPanel({
  id,
  target,
  focusKey,
  autoScroll,
  playing,
  reducedMotion,
  currentStation,
  onOpen,
  onClose,
}: DetailPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const tallest = useRef(0);
  const seen = useRef({ focusKey, title: "" });
  const [expanded, setExpanded] = useState<string[]>([]);
  /** The text specs fold under the diagrams. The choice holds across blocks. */
  const [specs, setSpecs] = useState(false);
  const headingId = `${id}-title`;

  const station =
    target.kind === "station" ? STATION_BY_ID.get(target.id) : undefined;
  const layerId: Layer = station ? station.layer : (target.id as Layer);
  const layer = LAYER_BY_ID.get(layerId)!;
  const sd = station ? STATION_DETAILS[station.id] : undefined;
  const ld = target.kind === "layer" ? LAYER_DETAILS[target.id] : undefined;
  const targetKey = `${target.kind}:${target.id}`;

  const title = station ? station.label : layer.label;
  const summary = sd?.summary ?? ld?.summary ?? station?.blurb ?? "";
  const sections: DetailSection[] = sd
    ? sd.sections
    : ld
      ? [{ title: "At a glance", rows: ld.rows }]
      : [];

  // Number the changing notes in reading order.
  const notes: NoteIndex = new Map();
  for (const c of sd?.changing ?? [])
    if (!notes.has(c)) notes.set(c, notes.size + 1);
  for (const s of sections)
    for (const row of s.rows)
      for (const c of row.changing ?? [])
        if (!notes.has(c)) notes.set(c, notes.size + 1);

  // Group sections by part, keeping their order.
  const parts: { part?: string; sections: DetailSection[] }[] = [];
  for (const s of sections) {
    const last = parts[parts.length - 1];
    if (last && last.part === s.part) last.sections.push(s);
    else parts.push({ part: s.part, sections: [s] });
  }
  const firstPart = parts.find((p) => p.part)?.part;
  const figures = station
    ? (STATION_VISUALS[station.id] ?? [])
    : LAYER_VISUALS[layerId];
  const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);
  const specsId = `${id}-specs`;

  // Move focus in on each open. Scroll only when the panel is out of sight,
  // and never when the reader opened it from the canvas.
  useEffect(() => {
    if (focusKey === 0) return;
    headingRef.current?.focus({ preventScroll: true });
    const el = rootRef.current;
    if (!el || !autoScroll) return;
    const peek = el.offsetWidth <= 640 ? PEEK_NARROW : PEEK;
    const over = el.getBoundingClientRect().top + peek - window.innerHeight;
    if (over > 0)
      window.scrollBy({
        top: over,
        behavior: reducedMotion ? "auto" : "smooth",
      });
  }, [focusKey, autoScroll, reducedMotion]);

  // A panel that follows the tour changes block without a new open. Say so.
  useEffect(() => {
    const was = seen.current;
    if (was.focusKey === focusKey && was.title && was.title !== title) {
      if (liveRef.current) liveRef.current.textContent = `Details: ${title}`;
    }
    seen.current = { focusKey, title };
  }, [focusKey, title]);

  // While the tour plays, hold the tallest height, so the page below stays put.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!playing) {
      tallest.current = 0;
      el.style.minHeight = "";
      return;
    }
    tallest.current = Math.max(tallest.current, el.offsetHeight);
    el.style.minHeight = `${tallest.current}px`;
  });

  const toggle = (key: string) =>
    setExpanded((e) =>
      e.includes(key) ? e.filter((k) => k !== key) : [...e, key],
    );

  return (
    <section
      ref={rootRef}
      id={id}
      aria-labelledby={headingId}
      className="relative border-t border-border-subtle px-4 pb-2 pt-3 @max-[640px]:px-3"
      style={{ background: BG }}
    >
      {/* Layer switcher */}
      <div className="flex items-center gap-2 pr-9">
        <div
          role="group"
          aria-label="Layer details"
          className="flex items-center gap-1 @max-[640px]:gap-0"
        >
          {LAYERS.map((l) => {
            const on = l.id === layerId;
            const open = target.kind === "layer" && on;
            return (
              <button
                key={l.id}
                type="button"
                aria-label={`${l.label} layer`}
                aria-current={open ? "true" : undefined}
                title={`${l.label} layer`}
                onClick={() => onOpen({ kind: "layer", id: l.id })}
                className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] border transition-opacity hover:opacity-100 @max-[640px]:h-8 @max-[640px]:w-8 ${
                  on ? "opacity-100" : "opacity-[0.65]"
                }`}
                style={{ borderColor: open ? l.color : "transparent" }}
              >
                <LayerBadge letter={l.letter} color={l.color} />
              </button>
            );
          })}
        </div>
        {station && (
          <span
            className="min-w-0 truncate font-jetbrains text-[10px] uppercase tracking-[0.16em]"
            style={{ color: INK2 }}
          >
            {layer.label}
          </span>
        )}
      </div>

      {/* Title */}
      <h3
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        className="outline-none"
        style={{
          color: INK,
          margin: "8px 0 0",
          fontFamily: MONO,
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.25,
          letterSpacing: 0,
        }}
      >
        {title}
      </h3>
      <div ref={liveRef} className="sr-only" aria-live="polite" />

      {/* Close. After the title in tab order, pinned top right. */}
      <button
        type="button"
        aria-label="Close details"
        title="Close details (Esc)"
        onClick={onClose}
        className="absolute right-4 top-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-border-subtle font-jetbrains text-sm leading-none text-[#a8a294] transition-colors hover:border-[#ffb000] hover:text-[#ffb000] @max-[640px]:right-3"
      >
        ×
      </button>

      <div
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-jetbrains text-[11px]"
        style={{ color: META }}
      >
        {station && <span className="break-all">{station.path}</span>}
        {station ? (
          <span className="flex items-center gap-1">
            <Glyph kind={station.kind} />
            {KIND_LABEL[station.kind]}
          </span>
        ) : (
          <span>Layer {layer.letter}</span>
        )}
      </div>
      <p
        className="mt-2 max-w-[62ch] font-inter text-[14px] leading-[1.5]"
        style={{ color: INK2, margin: "8px 0 0" }}
      >
        {summary}
        {sd?.changing?.map((c) => (
          <ChangingTag key={notes.get(c)} c={c} n={notes.get(c)!} />
        ))}
      </p>

      {/* Diagrams */}
      {figures.length > 0 && (
        <div className="mt-4">
          <Figures figures={figures} />
        </div>
      )}

      {/* Specs, folded under the diagrams */}
      {rowCount > 0 && (
        <button
          type="button"
          aria-expanded={specs}
          aria-controls={specsId}
          onClick={() => setSpecs((v) => !v)}
          className="mb-1 mt-4 flex h-8 w-full cursor-pointer items-center gap-2 text-left font-jetbrains text-[11px]"
          style={{ color: INK }}
        >
          <span
            aria-hidden="true"
            className="inline-block w-2 transition-transform"
            style={{ transform: specs ? "rotate(90deg)" : undefined }}
          >
            ▸
          </span>
          All specs
          <span style={{ color: META }}>
            ({rowCount} facts, each from the code)
          </span>
          <span className="h-px flex-1 bg-[rgba(232,228,210,0.08)]" />
          <span style={{ color: META }}>{specs ? "Hide" : "Show"}</span>
        </button>
      )}
      <div id={specsId} hidden={!specs}>
        {parts.map((p, i) => {
          const fold = !!p.part && p.part !== firstPart;
          const key = `${targetKey}/${p.part}`;
          const open = !fold || expanded.includes(key);
          const bodyId = `${id}-part-${i}`;
          const body =
            p.sections.length === 1 ? (
              <Section section={p.sections[0]} notes={notes} split />
            ) : (
              <div className="columns-2 gap-x-6 @max-[640px]:columns-1">
                {p.sections.map((s) => (
                  <Section key={s.title} section={s} notes={notes} />
                ))}
              </div>
            );
          return (
            <div key={i} className="mt-4">
              {p.part && (
                <div
                  className={`mb-2 flex items-center gap-2 font-jetbrains text-[11px] ${
                    fold ? "@max-[640px]:hidden" : ""
                  }`}
                  style={{ color: INK }}
                >
                  {p.part}
                  <span className="h-px flex-1 bg-[rgba(232,228,210,0.08)]" />
                </div>
              )}
              {fold && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => toggle(key)}
                  className="mb-2 hidden h-8 w-full cursor-pointer items-center gap-2 text-left font-jetbrains text-[11px] @max-[640px]:flex"
                  style={{ color: INK }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block w-2 transition-transform"
                    style={{ transform: open ? "rotate(90deg)" : undefined }}
                  >
                    ▸
                  </span>
                  {p.part}
                  <span className="h-px flex-1 bg-[rgba(232,228,210,0.08)]" />
                  <span style={{ color: META }}>{open ? "Hide" : "Show"}</span>
                </button>
              )}
              <div id={bodyId} className={open ? "" : "@max-[640px]:hidden"}>
                {body}
              </div>
            </div>
          );
        })}
      </div>

      {/* Blocks on this layer */}
      {target.kind === "layer" && (
        <div className="mt-1 pb-2">
          <div
            className="mb-1.5 border-b border-border-subtle pb-1 font-jetbrains text-[10px] uppercase tracking-[0.16em]"
            style={{ color: META }}
          >
            Blocks
          </div>
          <ul className="flex flex-wrap gap-1.5" style={RESET}>
            {STATIONS.filter((s) => s.layer === target.id).map((s) => {
              const now = s.id === currentStation;
              return (
                <li key={s.id} className="before:content-none" style={RESET}>
                  <button
                    type="button"
                    onClick={() => onOpen({ kind: "station", id: s.id })}
                    className="flex h-8 cursor-pointer items-center gap-1.5 rounded border border-border-subtle px-2.5 font-jetbrains text-[11px] text-[#a8a294] transition-colors hover:border-[#6e685b] hover:text-[#ede7d6]"
                  >
                    <Glyph kind={s.kind} />
                    {s.label}
                    {now && (
                      <>
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: ACCENT }}
                        />
                        <span className="sr-only">(current step)</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Changing notes */}
      {notes.size > 0 && (
        <div className="mb-2 mt-1">
          <h4
            className="border-b border-border-subtle pb-1 uppercase"
            style={{
              color: META,
              margin: 0,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1.4,
              letterSpacing: "0.16em",
            }}
          >
            Changing
          </h4>
          <ol style={RESET}>
            {[...notes].map(([c, n]) => (
              <li
                key={n}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-[5px] font-inter text-[13px] leading-[1.4] before:content-none"
                style={{ ...RESET, color: INK2 }}
              >
                <span
                  className="font-jetbrains text-[11px] leading-[1.45]"
                  style={{ color: META }}
                >
                  {n}
                </span>
                <span>{c.note}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/** One table. `split` flows a lone section's rows into two columns. */
function Section({
  section,
  notes,
  split = false,
}: {
  section: DetailSection;
  notes: NoteIndex;
  split?: boolean;
}) {
  return (
    <div className="mb-4 break-inside-avoid">
      <h4
        className="border-b border-border-subtle pb-1 uppercase"
        style={{
          color: META,
          margin: 0,
          fontFamily: MONO,
          fontSize: 10,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: "0.16em",
        }}
      >
        {section.title}
      </h4>
      <dl
        className={split ? "columns-2 gap-x-6 @max-[640px]:columns-1" : ""}
        style={RESET}
      >
        {section.rows.map((row) => (
          <Row key={row.k} row={row} notes={notes} />
        ))}
      </dl>
    </div>
  );
}

function Row({ row, notes }: { row: DetailRow; notes: NoteIndex }) {
  return (
    <div className="grid break-inside-avoid grid-cols-[7.75rem_minmax(0,1fr)] gap-x-3 border-b border-[rgba(232,228,210,0.04)] py-[5px] @max-[640px]:grid-cols-[6.75rem_minmax(0,1fr)]">
      <dt
        className="font-jetbrains text-[11px] leading-[1.45] [overflow-wrap:anywhere]"
        style={{ color: INK2 }}
      >
        {row.k}
      </dt>
      <dd
        className="font-inter text-[13px] leading-[1.4] [overflow-wrap:anywhere]"
        style={{ color: INK, margin: 0 }}
      >
        {row.v}
        {row.changing?.map((c) => (
          <ChangingTag key={notes.get(c)} c={c} n={notes.get(c)!} />
        ))}
      </dd>
    </div>
  );
}

/** A numbered tag. Its note is listed under "Changing" at the panel's foot. */
function ChangingTag({ c, n }: { c: Changing; n: number }) {
  return (
    <span
      className="ml-1.5 inline-block whitespace-nowrap rounded-[3px] border px-1 align-[1px] font-jetbrains text-[10.5px] leading-[15px]"
      style={{ borderColor: "#4a4f47", color: INK2 }}
    >
      {c.pr ? `changing in #${c.pr}` : "changing"}
      <sup
        aria-hidden="true"
        className="ml-0.5 text-[9px]"
        style={{ color: ACCENT }}
      >
        {n}
      </sup>
      <span className="sr-only">, see changing note {n}</span>
    </span>
  );
}

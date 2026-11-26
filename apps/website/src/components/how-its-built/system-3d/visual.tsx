"use client";

/** Draws the figures in `visuals.ts` for the detail panel. */

import { Fragment } from "react";
import { LAYERS } from "./data";
import { ACCENT, INK, INK2, META } from "./parts";
import type { Figure, Step, Tone, Viz } from "./visuals";

const RESET = { margin: 0, padding: 0, listStyle: "none" } as const;
const MONO = "var(--font-jetbrains), monospace";
const LINE = "rgba(232,228,210,0.14)";
const DIM = "#4a4f47";

const TONE: Record<Tone, string> = {
  a: LAYERS[0].color,
  b: LAYERS[1].color,
  c: LAYERS[2].color,
  d: LAYERS[3].color,
  hi: ACCENT,
  dim: DIM,
};

/** A tinted box: a soft fill and an edge in the tone's color. */
function tint(tone: Tone = "b", strong = false) {
  const c = TONE[tone];
  return {
    borderColor: tone === "dim" ? "#5a5f56" : c,
    background: `color-mix(in srgb, ${c} ${strong ? 22 : tone === "dim" ? 10 : 12}%, transparent)`,
  };
}

export function Figures({ figures }: { figures: Figure[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-4 @max-[720px]:grid-cols-1">
      {figures.map((f) => (
        <figure
          key={f.title}
          className={`min-w-0 ${f.wide ? "col-span-2 @max-[720px]:col-span-1" : ""}`}
          style={{ margin: 0 }}
        >
          <figcaption
            className="mb-2 border-b border-border-subtle pb-1 uppercase"
            style={{
              color: META,
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: "0.16em",
              lineHeight: 1.4,
            }}
          >
            {f.title}
          </figcaption>
          <Draw viz={f.viz} />
          {f.note && (
            <p
              className="font-inter text-[12.5px] leading-[1.45]"
              style={{ color: INK2, margin: "8px 0 0", maxWidth: "70ch" }}
            >
              {f.note}
            </p>
          )}
        </figure>
      ))}
    </div>
  );
}

function Draw({ viz }: { viz: Viz }) {
  switch (viz.t) {
    case "flow":
      return <Flow viz={viz} />;
    case "timeline":
      return <Timeline viz={viz} />;
    case "split":
      return <Split viz={viz} />;
    case "tree":
      return <Tree viz={viz} />;
    case "tables":
      return <Tables viz={viz} />;
    case "bars":
      return <Bars viz={viz} />;
    case "meters":
      return <Meters viz={viz} />;
    case "wire":
      return <Wire viz={viz} />;
    case "vector":
      return <Vector dims={viz.dims} />;
    case "layers":
      return <LayerStrip total={viz.total} adapted={viz.adapted} />;
    case "process":
      return <Process viz={viz} />;
    case "chat":
      return <Chat viz={viz} />;
    case "stats":
      return <Stats viz={viz} />;
    case "reorder":
      return <Reorder viz={viz} />;
  }
}

/* ------------------------------------------------------------- flow */

function Box({
  label,
  sub,
  tone,
  small = false,
}: {
  label: string;
  sub?: string;
  tone?: Tone;
  small?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-[4px] border ${small ? "px-2 py-1" : "px-2.5 py-1.5"}`}
      style={tint(tone, tone === "hi")}
    >
      <div
        className="font-jetbrains text-[11.5px] leading-[1.3] [overflow-wrap:anywhere]"
        style={{ color: tone === "hi" ? ACCENT : INK }}
      >
        {label}
      </div>
      {sub && (
        <div
          className="mt-0.5 font-inter text-[11px] leading-[1.3] [overflow-wrap:anywhere]"
          style={{ color: INK2 }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center self-center font-jetbrains text-[13px] leading-none @max-[560px]:rotate-90 @max-[560px]:self-start @max-[560px]:pl-3"
      style={{ color: META }}
    >
      →
    </div>
  );
}

function StepBox({ step }: { step: Step }) {
  if (!step.stack)
    return <Box label={step.label} sub={step.sub} tone={step.tone} />;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {step.stack.map((s) => (
        <Box key={s.label} label={s.label} sub={s.sub} tone={s.tone} small />
      ))}
    </div>
  );
}

function Flow({ viz }: { viz: Extract<Viz, { t: "flow" }> }) {
  const labelled = viz.rows.some((r) => r.label);
  return (
    <div className="flex flex-col gap-2">
      {viz.rows.map((row, i) => (
        <div
          key={i}
          className={`grid items-center gap-2 ${
            labelled
              ? "grid-cols-[3.75rem_minmax(0,1fr)] @max-[560px]:grid-cols-1"
              : ""
          }`}
        >
          {labelled && (
            <div
              className="font-jetbrains text-[10px] uppercase tracking-[0.12em]"
              style={{ color: META }}
            >
              {row.label}
            </div>
          )}
          <div className="flex min-w-0 items-stretch gap-1.5 @max-[560px]:flex-col">
            {row.steps.map((s, j) => (
              <Fragment key={j}>
                {j > 0 && <Arrow />}
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <StepBox step={s} />
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      {viz.loop && (
        <div
          className="flex items-center gap-2 font-jetbrains text-[10.5px]"
          style={{ color: ACCENT }}
        >
          <span aria-hidden="true">↺</span>
          <span
            aria-hidden="true"
            className="h-0 flex-1 border-t border-dashed"
            style={{ borderColor: "rgba(255,176,0,0.45)" }}
          />
          <span>{viz.loop}</span>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- timeline */

function Timeline({ viz }: { viz: Extract<Viz, { t: "timeline" }> }) {
  const STEP = 26;
  const PAD = 14;
  const xs: number[] = [];
  let x = PAD;
  for (const m of viz.msgs) {
    xs.push(x);
    x += m === "gap" ? STEP * 1.4 : STEP;
  }
  const width = x - STEP + PAD * 2;
  const rows = Math.max(...viz.spans.map((s) => s.row)) + 1;
  const DOT_Y = 34;
  const height = DOT_Y + 22 + rows * 22;
  const me = TONE.b;
  const them = TONE.d;

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          role="img"
          aria-label={viz.spans
            .map((s) => `${s.label}: messages ${s.from + 1} to ${s.to + 1}`)
            .join(", ")}
          style={{
            maxWidth: width * 1.6,
            minWidth: Math.min(width, 520),
            display: "block",
          }}
        >
          <line
            x1={PAD - 6}
            x2={width - PAD}
            y1={DOT_Y}
            y2={DOT_Y}
            stroke={LINE}
          />
          {viz.msgs.map((m, i) => {
            const cx = xs[i] + PAD;
            if (m === "gap")
              return (
                <g key={i}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={8}
                    y2={height - 4}
                    stroke={META}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={cx}
                    y={10}
                    textAnchor="middle"
                    fontSize={9}
                    fill={META}
                    fontFamily={MONO}
                  >
                    4 h+
                  </text>
                </g>
              );
            const mine = m.startsWith("me");
            return (
              <g key={i}>
                <rect
                  x={cx - 7}
                  y={DOT_Y - (mine ? 15 : 1)}
                  width={14}
                  height={14}
                  rx={4}
                  fill={mine ? me : them}
                  opacity={0.9}
                />
                {m === "me?" && (
                  <text
                    x={cx}
                    y={DOT_Y - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill="#0b0f0c"
                    fontFamily={MONO}
                  >
                    ?
                  </text>
                )}
              </g>
            );
          })}
          {viz.spans.map((s) => {
            const x1 = xs[s.from] + PAD - 8;
            const x2 = xs[s.to] + PAD + 8;
            const y = DOT_Y + 24 + s.row * 22;
            return (
              <g key={s.label}>
                <path
                  d={`M${x1} ${y - 6} V${y} H${x2} V${y - 6}`}
                  fill="none"
                  stroke={ACCENT}
                  strokeWidth={1.4}
                />
                <text
                  x={x1 + 2}
                  y={y + 11}
                  fontSize={9.5}
                  fill={ACCENT}
                  fontFamily={MONO}
                >
                  {s.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div
        className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-jetbrains text-[10.5px]"
        style={{ color: INK2 }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: me }}
          />
          {viz.meLabel} (upper row)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[3px]"
            style={{ background: them }}
          />
          {viz.themLabel} (lower row)
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ split */

function Split({ viz }: { viz: Extract<Viz, { t: "split" }> }) {
  return (
    <div>
      <div className="flex h-7 overflow-hidden rounded-[4px] border border-border-subtle">
        {viz.parts.map((p) => (
          <div
            key={p.label}
            className="flex items-center justify-center font-jetbrains text-[10.5px]"
            style={{
              width: `${p.pct}%`,
              background: `color-mix(in srgb, ${TONE[p.tone]} 45%, transparent)`,
              color: INK,
            }}
          >
            {p.pct}%
          </div>
        ))}
      </div>
      <div
        className="mt-1.5 flex flex-wrap gap-x-4 font-jetbrains text-[10.5px]"
        style={{ color: INK2 }}
      >
        {viz.parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: TONE[p.tone] }}
            />
            {p.label} {p.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- tree */

function Tree({ viz }: { viz: Extract<Viz, { t: "tree" }> }) {
  return (
    <ul
      className="rounded-[4px] border border-border-subtle"
      style={{
        ...RESET,
        padding: "8px 12px",
        background: "rgba(232,228,210,0.02)",
      }}
    >
      {viz.lines.map((l, i) => {
        const dir = l.name.endsWith("/");
        return (
          <li
            key={i}
            className="flex min-w-0 items-baseline gap-2 py-[2px] font-jetbrains text-[11.5px] leading-[1.4] before:content-none"
            style={{
              ...RESET,
              paddingLeft: l.depth * 16,
              opacity: l.gone ? 0.5 : 1,
            }}
          >
            <span aria-hidden="true" style={{ color: META }}>
              {l.depth > 0 ? "└" : ""}
            </span>
            <span
              className="shrink-0"
              style={{
                color: l.tone === "hi" ? ACCENT : dir ? TONE.a : INK,
                textDecoration: l.gone ? "line-through" : undefined,
              }}
            >
              {l.name}
            </span>
            {l.note && (
              <span
                className="min-w-0 truncate font-inter text-[11px]"
                style={{ color: META }}
              >
                {l.note}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------- tables */

function Tables({ viz }: { viz: Extract<Viz, { t: "tables" }> }) {
  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-2">
        {viz.tables.map((t) => (
          <div
            key={t.name}
            className="min-w-0 overflow-hidden rounded-[4px] border"
            style={{
              borderColor:
                t.tone === "hi"
                  ? ACCENT
                  : t.tone === "dim"
                    ? "#3a3f37"
                    : "#2f3a4a",
            }}
          >
            <div
              className="truncate px-2 py-1 font-jetbrains text-[11px]"
              style={{
                ...tint(t.tone ?? "d", true),
                border: 0,
                color: t.tone === "hi" ? ACCENT : INK,
              }}
            >
              {t.name}
            </div>
            <ul style={{ ...RESET, padding: "4px 8px" }}>
              {t.cols.map((c) => (
                <li
                  key={c}
                  className="truncate py-[1px] font-jetbrains text-[10.5px] before:content-none"
                  style={{ ...RESET, color: INK2 }}
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {viz.links && (
        <div
          className="mt-2 flex flex-col gap-0.5 font-jetbrains text-[10.5px]"
          style={{ color: META }}
        >
          {viz.links.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- bars */

function Bars({ viz }: { viz: Extract<Viz, { t: "bars" }> }) {
  const max = Math.max(...viz.rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-1.5">
      {viz.rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-center gap-2 @max-[560px]:grid-cols-[minmax(0,7rem)_minmax(0,1fr)]"
        >
          <span
            className="truncate font-jetbrains text-[11px]"
            style={{ color: INK2 }}
            title={r.label}
          >
            {r.label}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="h-3.5 shrink-0 rounded-[2px]"
              style={{
                width: `${Math.max(3, (r.value / max) * 62)}%`,
                background:
                  r.tone === "hi"
                    ? ACCENT
                    : `color-mix(in srgb, ${TONE[r.tone ?? "c"]} 70%, transparent)`,
              }}
            />
            <span
              className="shrink-0 font-jetbrains text-[11px]"
              style={{ color: INK }}
            >
              {r.text ?? r.value}
            </span>
            {r.note && (
              <span
                className="min-w-0 truncate font-inter text-[11px]"
                style={{ color: META }}
              >
                {r.note}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- meters */

const SERIES = [TONE.b, ACCENT, TONE.d];

function Meters({ viz }: { viz: Extract<Viz, { t: "meters" }> }) {
  return (
    <div>
      <div
        className="mb-2 flex flex-wrap gap-x-4 font-jetbrains text-[10.5px]"
        style={{ color: INK2 }}
      >
        {viz.series.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-[2px]"
              style={{ background: SERIES[i] }}
            />
            {s}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {viz.rows.map((r) => {
          const max = Math.max(...r.values);
          return (
            <div
              key={r.k}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2"
            >
              <span
                className="font-jetbrains text-[11px]"
                style={{ color: INK2 }}
              >
                {r.k}
              </span>
              <div className="flex flex-col gap-[3px]">
                {r.values.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="h-2 rounded-[2px]"
                      style={{
                        width: `${Math.max(2, (v / max) * 70)}%`,
                        background: SERIES[i],
                        opacity: 0.85,
                      }}
                    />
                    <span
                      className="font-jetbrains text-[10.5px] leading-none"
                      style={{ color: INK }}
                    >
                      {r.text?.[i] ?? v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- wire */

function Wire({ viz }: { viz: Extract<Viz, { t: "wire" }> }) {
  const [left, right] = viz.lanes;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 font-jetbrains text-[11px]">
        <span
          className="rounded-[4px] border px-2 py-1"
          style={{ ...tint("a"), color: INK }}
        >
          {left}
        </span>
        <span
          className="rounded-[4px] border px-2 py-1 text-right"
          style={{ ...tint("b"), color: INK }}
        >
          {right}
        </span>
      </div>
      <ol
        className="border-x border-dashed"
        style={{
          ...RESET,
          margin: "0 12px",
          padding: "0 0 4px",
          borderColor: "rgba(232,228,210,0.22)",
        }}
      >
        {viz.msgs.map((m, i) => {
          const right = m.dir === "r";
          return (
            <li
              key={i}
              className="before:content-none"
              style={{ ...RESET, padding: "8px 4px 0" }}
            >
              <div
                className={`flex items-baseline gap-2 font-jetbrains text-[11px] leading-tight ${
                  right ? "" : "flex-row-reverse text-right"
                }`}
              >
                <span
                  className="min-w-0 [overflow-wrap:anywhere]"
                  style={{ color: right ? INK : ACCENT }}
                >
                  {m.text}
                </span>
                {m.sub && (
                  <span
                    className="shrink-0 font-inter text-[10.5px]"
                    style={{ color: META }}
                  >
                    {m.sub}
                  </span>
                )}
              </div>
              <div
                className={`flex items-center ${right ? "" : "flex-row-reverse"}`}
                aria-hidden="true"
              >
                <span
                  className="h-px flex-1"
                  style={{ background: right ? INK2 : ACCENT, opacity: 0.6 }}
                />
                <span
                  className="text-[10px] leading-none"
                  style={{ color: right ? INK2 : ACCENT }}
                >
                  {right ? "▶" : "◀"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ----------------------------------------------------------- vector */

function Vector({ dims }: { dims: number }) {
  const COLS = 48;
  const rowsN = Math.ceil(dims / COLS);
  const C = 6;
  const G = 1;
  const w = COLS * (C + G);
  const h = rowsN * (C + G);
  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        role="img"
        aria-label={`${dims} numbers`}
        style={{ display: "block" }}
      >
        {Array.from({ length: dims }, (_, i) => {
          // A fixed pseudo-random value per cell, so the grid looks like data.
          const v = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
          return (
            <rect
              key={i}
              x={(i % COLS) * (C + G)}
              y={Math.floor(i / COLS) * (C + G)}
              width={C}
              height={C}
              rx={1}
              fill={v > 0.9 ? ACCENT : TONE.c}
              opacity={0.15 + v * 0.75}
            />
          );
        })}
      </svg>
      <div
        className="mt-1 font-jetbrains text-[10.5px]"
        style={{ color: META }}
      >
        {dims} floats, length 1 · each cell is one number
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- layers */

function LayerStrip({ total, adapted }: { total: number; adapted: number }) {
  const first = total - adapted;
  return (
    <div>
      <div
        className="flex gap-[3px]"
        role="img"
        aria-label={`${total} layers; LoRA on layers ${first + 1} to ${total}`}
      >
        {Array.from({ length: total }, (_, i) => {
          const full = i % 4 === 3;
          const lora = i >= first;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <div
                className="h-1.5 rounded-[1px]"
                style={{ background: lora ? ACCENT : "transparent" }}
              />
              <div
                className="h-9 rounded-[2px]"
                style={{
                  background: full
                    ? TONE.b
                    : `color-mix(in srgb, ${TONE.d} 70%, transparent)`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div
        className="mt-1 flex justify-between font-jetbrains text-[10px]"
        style={{ color: META }}
      >
        <span>layer 1</span>
        <span>layer {total}</span>
      </div>
      <div
        className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-jetbrains text-[10.5px]"
        style={{ color: INK2 }}
      >
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: TONE.d }}
          />
          DeltaNet (linear attention)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: TONE.b }}
          />
          full attention, every 4th
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-2.5 rounded-[1px]"
            style={{ background: ACCENT }}
          />
          LoRA adapter
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- process */

function Process({ viz }: { viz: Extract<Viz, { t: "process" }> }) {
  return (
    <div
      className="rounded-[6px] border p-2"
      style={{ borderColor: TONE.c, background: "rgba(95,132,194,0.06)" }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 font-jetbrains">
        <span className="text-[11.5px]" style={{ color: INK }}>
          ⬡ {viz.name}
        </span>
        <span className="text-[10.5px]" style={{ color: META }}>
          {viz.sub}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {viz.slots.map((s) => (
          <Box key={s.label} label={s.label} sub={s.sub} tone={s.tone} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- chat */

function Chat({ viz }: { viz: Extract<Viz, { t: "chat" }> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {viz.lines.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-stretch gap-2"
        >
          <span
            className="self-center font-jetbrains text-[10.5px]"
            style={{ color: META }}
          >
            {l.role}
          </span>
          <div
            className="flex min-w-0 items-baseline justify-between gap-2 rounded-[4px] border px-2 py-1"
            style={tint(l.tone ?? "d", l.tone === "hi")}
          >
            <span
              className="min-w-0 font-jetbrains text-[11.5px] [overflow-wrap:anywhere]"
              style={{ color: INK }}
            >
              {l.text}
            </span>
            {l.note && (
              <span
                className="shrink-0 font-jetbrains text-[10px] uppercase tracking-[0.1em]"
                style={{ color: l.tone === "hi" ? ACCENT : META }}
              >
                {l.note}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ stats */

function Stats({ viz }: { viz: Extract<Viz, { t: "stats" }> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
      {viz.items.map((s) => (
        <div
          key={s.k}
          className="rounded-[4px] border border-border-subtle px-2.5 py-2"
        >
          <div
            className="font-jetbrains text-[18px] leading-none"
            style={{ color: INK }}
          >
            {s.v}
          </div>
          <div
            className="mt-1 font-inter text-[11px] leading-[1.3]"
            style={{ color: INK2 }}
          >
            {s.k}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------- reorder */

function Reorder({ viz }: { viz: Extract<Viz, { t: "reorder" }> }) {
  const ROW = 24;
  const W = 300;
  const BOX = 78;
  const h = viz.items.length * ROW + 22;
  const top = viz.after[0];
  return (
    <svg
      viewBox={`0 0 ${W} ${h}`}
      width="100%"
      role="img"
      aria-label={`New order: ${viz.after.map((i) => viz.items[i]).join(", ")}`}
      style={{ display: "block", maxWidth: 420 }}
    >
      <text x={0} y={10} fontSize={9.5} fill={META} fontFamily={MONO}>
        {viz.left}
      </text>
      <text
        x={W}
        y={10}
        fontSize={9.5}
        fill={META}
        fontFamily={MONO}
        textAnchor="end"
      >
        {viz.right}
      </text>
      {viz.after.map((old, rank) => {
        const y1 = 22 + old * ROW + 9;
        const y2 = 22 + rank * ROW + 9;
        const hot = old === top;
        return (
          <path
            key={old}
            d={`M${BOX} ${y1} C${W / 2} ${y1}, ${W / 2} ${y2}, ${W - BOX} ${y2}`}
            fill="none"
            stroke={hot ? ACCENT : INK2}
            strokeOpacity={hot ? 0.95 : 0.35}
            strokeWidth={hot ? 1.6 : 1}
          />
        );
      })}
      {viz.items.map((it, i) => {
        const y = 22 + i * ROW;
        const newItem = viz.items[viz.after[i]];
        return (
          <g key={it} fontFamily={MONO} fontSize={10.5}>
            <rect
              x={0}
              y={y}
              width={BOX}
              height={18}
              rx={3}
              fill="rgba(61,104,166,0.18)"
              stroke={TONE.d}
            />
            <text x={6} y={y + 12.5} fill={viz.after[0] === i ? ACCENT : INK}>
              {i + 1}. {it}
            </text>
            <rect
              x={W - BOX}
              y={y}
              width={BOX}
              height={18}
              rx={3}
              fill={i === 0 ? "rgba(255,176,0,0.16)" : "rgba(95,132,194,0.14)"}
              stroke={i === 0 ? ACCENT : TONE.c}
            />
            <text x={W - BOX + 6} y={y + 12.5} fill={i === 0 ? ACCENT : INK}>
              {i + 1}. {newItem}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * TrainingLossChart - live train and validation loss for a persona run.
 *
 * Train loss arrives every report interval (10 steps). Validation loss
 * arrives every validation pass. Both share one y-axis.
 */
import { memo, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { saveLossChart } from "@/services/tauri";
import { renderLossChartPng } from "./exportLossChart";

/** One step of the loss history. A step can carry either loss or both. */
export interface LossPoint {
  step: number;
  loss?: number;
  valLoss?: number;
}

/** Merge a progress report into the history, keeping steps sorted. */
export function addLossPoint(
  points: LossPoint[],
  step: number,
  loss: number | null | undefined,
  valLoss: number | null | undefined,
): LossPoint[] {
  if (loss == null && valLoss == null) return points;
  const next = points.slice();
  const index = next.findIndex((p) => p.step === step);
  const update: LossPoint = { step };
  if (loss != null) update.loss = loss;
  if (valLoss != null) update.valLoss = valLoss;
  if (index >= 0) {
    next[index] = { ...next[index], ...update };
  } else {
    next.push(update);
    next.sort((a, b) => a.step - b.step);
  }
  return next;
}

/** The most recent value of a series, or null. */
function latest(points: LossPoint[], key: "loss" | "valLoss"): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i][key];
    if (value != null) return value;
  }
  return null;
}

// Validated with the dataviz palette check: modern emerald/blue separates
// under deutan (dE 25), retro green/cyan separates under deutan (dE 20).
// Retro amber failed deutan (dE 5), so validation uses cyan there.
const TRAIN_COLOR = "var(--color-accent)";
const VAL_COLOR_MODERN = "var(--color-accent-secondary)";
const VAL_COLOR_RETRO = "var(--primitive-crt-cyan-solid, #00ffff)";

interface TrainingLossChartProps {
  points: LossPoint[];
  totalSteps: number | null;
  isRetro: boolean;
  height?: number;
}

export const TrainingLossChart = memo(function TrainingLossChart({
  points,
  totalSteps,
  isRetro,
  height = 140,
}: TrainingLossChartProps) {
  const font = isRetro ? "font-mono" : "font-[var(--font-body)]";
  const valColor = isRetro ? VAL_COLOR_RETRO : VAL_COLOR_MODERN;
  const trainNow = latest(points, "loss");
  const valNow = latest(points, "valLoss");
  const digits = isRetro ? 4 : 3;
  const figureRef = useRef<HTMLElement>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  // Return the button label to "Save" a few seconds after a save.
  useEffect(() => {
    if (saveState !== "saved" && saveState !== "error") return;
    const timer = setTimeout(() => setSaveState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [saveState]);

  const handleSave = async () => {
    if (!figureRef.current) return;
    setSaveState("saving");
    try {
      const png = await renderLossChartPng(
        figureRef.current,
        [
          {
            label: "Train",
            value: trainNow?.toFixed(digits) ?? "–",
            color: TRAIN_COLOR,
            dashed: false,
          },
          {
            label: "Val",
            value: valNow?.toFixed(digits) ?? "–",
            color: valColor,
            dashed: true,
          },
        ],
        "Training loss",
      );
      await saveLossChart(png);
      setSaveState("saved");
    } catch (err) {
      console.error("Failed to save loss chart:", err);
      setSaveState("error");
    }
  };

  return (
    <figure
      ref={figureRef}
      className={`
        p-3 border border-[var(--color-border)] bg-[var(--color-surface-elevated)]
        ${isRetro ? "rounded-sm" : "rounded-xl"}
      `}
      aria-label="Training loss chart"
    >
      {/* Legend with the latest value of each series */}
      <figcaption
        className={`flex items-center gap-4 text-xs text-[var(--color-text-muted)] ${font}`}
      >
        <span className="text-[var(--color-text-secondary)]">
          {isRetro ? "loss" : "Loss"}
        </span>
        <LegendItem
          label="Train"
          value={trainNow}
          digits={digits}
          color={TRAIN_COLOR}
        />
        <LegendItem
          label="Val"
          value={valNow}
          digits={digits}
          color={valColor}
          dashed
        />
        {points.length > 0 && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            title="Save the chart as a PNG in Downloads"
            className={`
              ml-auto flex items-center gap-1 transition-colors
              disabled:opacity-50
              ${saveState === "error" ? "text-[var(--color-error)]" : "hover:text-[var(--color-text-primary)]"}
            `}
          >
            {!isRetro && <Download size={12} aria-hidden />}
            {saveLabel(saveState, isRetro)}
          </button>
        )}
      </figcaption>

      {points.length === 0 ? (
        <div
          className={`flex items-center justify-center text-xs text-[var(--color-text-muted)] ${font}`}
          style={{ height }}
        >
          {isRetro
            ? "> waiting for first loss report..."
            : "Waiting for the first loss report…"}
        </div>
      ) : (
        <div style={{ height }} className="mt-2" data-testid="loss-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="var(--color-border)"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="step"
                type="number"
                domain={[0, totalSteps ?? "dataMax"]}
                tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                allowDecimals={false}
              />
              <YAxis
                domain={["auto", "auto"]}
                width={36}
                tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <Tooltip
                content={<LossTooltip isRetro={isRetro} digits={digits} />}
                cursor={{ stroke: "var(--color-text-muted)", strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="loss"
                name="Train"
                stroke={TRAIN_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: "var(--color-surface)",
                  strokeWidth: 2,
                }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="valLoss"
                name="Val"
                stroke={valColor}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{
                  r: 4,
                  fill: valColor,
                  stroke: "var(--color-surface)",
                  strokeWidth: 2,
                }}
                activeDot={{
                  r: 5,
                  stroke: "var(--color-surface)",
                  strokeWidth: 2,
                }}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
});

function saveLabel(
  state: "idle" | "saving" | "saved" | "error",
  isRetro: boolean,
): string {
  switch (state) {
    case "saving":
      return isRetro ? "[saving...]" : "Saving…";
    case "saved":
      return isRetro ? "[saved to downloads]" : "Saved to Downloads";
    case "error":
      return isRetro ? "[save failed]" : "Save failed";
    default:
      return isRetro ? "[save png]" : "Save PNG";
  }
}

function LegendItem({
  label,
  value,
  digits,
  color,
  dashed = false,
}: {
  label: string;
  value: number | null;
  digits: number;
  color: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="16" height="8" aria-hidden>
        <line
          x1="0"
          y1="4"
          x2="16"
          y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      <span>{label}</span>
      <span className="tabular-nums text-[var(--color-text-primary)]">
        {value != null ? value.toFixed(digits) : "–"}
      </span>
    </span>
  );
}

interface TooltipPayloadItem {
  dataKey?: string | number;
  value?: number;
  payload?: LossPoint;
}

function LossTooltip({
  active,
  payload,
  isRetro,
  digits,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  isRetro: boolean;
  digits: number;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div
      className={`
        px-2.5 py-1.5 text-xs border
        bg-[var(--color-surface-tooltip,var(--color-surface))] border-[var(--color-border-tooltip,var(--color-border))]
        text-[var(--color-text-primary)]
        ${isRetro ? "font-mono rounded-sm" : "font-[var(--font-body)] rounded-lg shadow-lg"}
      `}
    >
      <div className="text-[var(--color-text-muted)]">Step {point.step}</div>
      {point.loss != null && (
        <div className="tabular-nums">Train {point.loss.toFixed(digits)}</div>
      )}
      {point.valLoss != null && (
        <div className="tabular-nums">Val {point.valLoss.toFixed(digits)}</div>
      )}
    </div>
  );
}

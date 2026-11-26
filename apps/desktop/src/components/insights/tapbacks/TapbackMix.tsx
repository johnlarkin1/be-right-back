/**
 * TapbackMix - kind mix as paired bars: Tapbacks you gave and Tapbacks you got.
 * Used in Insights and on the contact detail page.
 */
import { memo } from "react";
import { useUIMode } from "@/stores/themeStore";
import type { TapbackSummary } from "@/bindings/ingestion";
import { kindGlyph, kindLabel } from "./kinds";

/** Same You/Them colors as the messages timeline. */
export const DIRECTION_COLORS = {
  retro: { given: "#00ff41", received: "#00d4ff" },
  modern: { given: "#10b981", received: "#3b82f6" },
};

interface TapbackMixProps {
  summary: TapbackSummary;
  /** Who "received" refers to, e.g. "them" or "others". */
  otherLabel?: string;
}

export const TapbackMix = memo(function TapbackMix({
  summary,
  otherLabel = "others",
}: TapbackMixProps) {
  const { isRetro } = useUIMode();
  const colors = isRetro ? DIRECTION_COLORS.retro : DIRECTION_COLORS.modern;
  const max = Math.max(
    1,
    ...summary.by_kind.flatMap((k) => [k.given, k.received]),
  );

  if (summary.by_kind.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--color-text-secondary)]">
        No Tapbacks yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3.5 text-xs text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="legend-swatch"
            style={{ background: colors.given }}
          />
          You gave {summary.given.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="legend-swatch"
            style={{ background: colors.received }}
          />
          You got {summary.received.toLocaleString()}
        </span>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
        {summary.by_kind.map((k) => (
          <li
            key={k.kind}
            className="tapback-mix-row"
            title={`${kindLabel(k.kind)}: you gave ${k.given.toLocaleString()}, ${otherLabel} gave you ${k.received.toLocaleString()}`}
          >
            <span className="tapback-mix-label">
              <span aria-hidden="true">{kindGlyph(k.kind)}</span>
              {kindLabel(k.kind)}
            </span>
            <span className="tapback-mix-bars">
              <Bar value={k.given} max={max} color={colors.given} />
              <Bar value={k.received} max={max} color={colors.received} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});

function Bar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  return (
    <span className="tapback-mix-bar">
      <span
        className="tapback-mix-fill"
        style={{ width: `${(value / max) * 100}%`, background: color }}
      />
      <span className="tapback-mix-value">{value.toLocaleString()}</span>
    </span>
  );
}

export default TapbackMix;

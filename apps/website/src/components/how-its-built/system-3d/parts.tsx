/** Small pieces shared by the figure and its detail panel. */

import type { Kind } from "./data";

export const ACCENT = "#ffb000";
export const BG = "#0b0f0c";
export const INK = "#ede7d6";
export const INK2 = "#a8a294";
export const META = "#8a8576";

export function LayerBadge({
  letter,
  color,
  small = false,
}: {
  letter: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[2px] font-jetbrains font-bold leading-none ${
        small ? "h-3.5 w-3.5 text-[9px]" : "h-4 w-4 text-[10px]"
      }`}
      style={{ background: color, color: BG }}
    >
      {letter}
    </span>
  );
}

export function Glyph({ kind }: { kind: Kind }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.2 };
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="shrink-0"
    >
      {kind === "call" && (
        <rect x="1.5" y="2.5" width="9" height="7" rx="1.6" {...stroke} />
      )}
      {kind === "daemon" && (
        <path d="M3.25 1.5h5.5L11.5 6l-2.75 4.5h-5.5L.5 6z" {...stroke} />
      )}
      {kind === "store" && (
        <>
          <ellipse cx="6" cy="3" rx="4.5" ry="1.6" {...stroke} />
          <path d="M1.5 3v6c0 .9 2 1.6 4.5 1.6s4.5-.7 4.5-1.6V3" {...stroke} />
        </>
      )}
    </svg>
  );
}

/** Key text for each kind, shared by the key and the detail panel. */
export const KIND_LABEL: Record<Kind, string> = {
  call: "runs when called",
  daemon: "long-lived daemon",
  store: "file or store",
};

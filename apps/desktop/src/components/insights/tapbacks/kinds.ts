/**
 * Tapback kinds: labels, glyphs, chart groups and colors.
 *
 * Charts fold the eight kinds into five groups so the palette stays at five
 * validated colors. Group order and color are fixed: a filter never repaints a group.
 */
import type { InsightsDateRange } from "@/types";
import type { TapbackWindow } from "@/bindings/ingestion";

export type TapbackKind =
  | "love"
  | "like"
  | "dislike"
  | "laugh"
  | "emphasize"
  | "question"
  | "emoji"
  | "sticker";

export const KIND_LABELS: Record<TapbackKind, string> = {
  love: "Love",
  like: "Like",
  dislike: "Dislike",
  laugh: "Laugh",
  emphasize: "Emphasize",
  question: "Question",
  emoji: "Emoji",
  sticker: "Sticker",
};

/** The glyph Messages shows for each kind. */
export const KIND_GLYPHS: Record<TapbackKind, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  laugh: "😂",
  emphasize: "‼️",
  question: "❓",
  emoji: "🙂",
  sticker: "🏷️",
};

export type TapbackGroup = "love" | "laugh" | "like" | "emphasize" | "other";

/** Stack order, bottom to top. Adjacent pairs pass the CVD check. */
export const GROUPS: TapbackGroup[] = [
  "love",
  "laugh",
  "like",
  "emphasize",
  "other",
];

export const GROUP_LABELS: Record<TapbackGroup, string> = {
  love: "Love",
  laugh: "Laugh",
  like: "Like",
  emphasize: "Emphasize",
  other: "Other",
};

/**
 * Validated with the dataviz validator against the modern card surface
 * (#10192d, dark): all checks pass, worst adjacent CVD ΔE 13.2.
 */
export const GROUP_COLORS: Record<TapbackGroup, string> = {
  love: "#d55181",
  laugh: "#c98500",
  like: "#3987e5",
  emphasize: "#d95926",
  other: "#9085e9",
};

export function groupOf(kind: string): TapbackGroup {
  return (GROUPS as string[]).includes(kind) && kind !== "other"
    ? (kind as TapbackGroup)
    : "other";
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as TapbackKind] ?? kind;
}

export function kindGlyph(kind: string): string {
  return KIND_GLYPHS[kind as TapbackKind] ?? "•";
}

/** Convert the timeline brush range (local dates) to a unix-seconds window. */
export function windowFromRange(
  range: InsightsDateRange | null,
): TapbackWindow {
  if (!range) return { start: null, end: null };
  const start = new Date(`${range.startDate}T00:00:00`).getTime() / 1000;
  const end = new Date(`${range.endDate}T23:59:59`).getTime() / 1000;
  return { start: Math.floor(start), end: Math.floor(end) };
}

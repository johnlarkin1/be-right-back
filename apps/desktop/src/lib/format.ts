/**
 * Shared display formatters.
 */

/** Format an ISO timestamp for display (falls back to the raw string). */
export function formatDate(
  isoString: string,
  opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  try {
    return new Date(isoString).toLocaleDateString("en-US", opts);
  } catch {
    return isoString;
  }
}

/** Compact number display: 1500 -> "1.5K", 2400000 -> "2.4M". */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

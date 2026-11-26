/**
 * StepStatusIcon - Completed/active/pending indicator for step lists
 * (ingestion stages, training phases). Supports dual UI modes.
 */
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Circle } from "lucide-react";

export function StepStatusIcon({
  status,
  size,
  color,
  isRetro,
  checkFg = "var(--color-crt-bg)",
  pendingColor = "var(--color-border)",
  checkSize = Math.round((size * 2) / 3),
}: {
  status: "completed" | "active" | "pending";
  size: number;
  /** Retro-mode accent for the completed fill and the active spinner */
  color: string;
  isRetro: boolean;
  checkFg?: string;
  pendingColor?: string;
  checkSize?: number;
}) {
  if (status === "completed") {
    return isRetro ? (
      <div
        className="rounded-full flex items-center justify-center"
        style={{ width: size, height: size, backgroundColor: color }}
      >
        <svg
          style={{ width: checkSize, height: checkSize, color: checkFg }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
    ) : (
      <CheckCircle2 size={size} className="text-[var(--color-accent)]" />
    );
  }

  if (status === "active") {
    return isRetro ? (
      <motion.div
        className="rounded-full border-2"
        style={{
          width: size,
          height: size,
          borderColor: color,
          borderTopColor: "transparent",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />
    ) : (
      <Loader2
        size={size}
        className="text-[var(--color-accent)] animate-spin"
      />
    );
  }

  return <Circle size={size} style={{ color: pendingColor }} />;
}

export default StepStatusIcon;

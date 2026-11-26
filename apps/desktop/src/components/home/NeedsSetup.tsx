/**
 * NeedsSetup - Shared component for when a tab requires setup first
 * Shows a friendly message guiding users to complete the necessary setup steps
 * Supports dual UI modes (retro/modern)
 */
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Ghost, Casper } from "@/components/Ghost";
import { useUIMode } from "@/stores/themeStore";
import type { GhostVariant } from "@/types";

interface NeedsSetupProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  variant?: "green" | "pink";
  ghostVariant?: GhostVariant;
}

export function NeedsSetup({
  title,
  description,
  actionLabel,
  onAction,
  variant = "green",
  ghostVariant = "sleepy",
}: NeedsSetupProps) {
  const { isRetro } = useUIMode();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="needs-setup"
    >
      {isRetro ? (
        variant === "pink" ? (
          <Casper size={64} variant={ghostVariant} />
        ) : (
          <Ghost size={64} variant={ghostVariant} />
        )
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-warning)]/10 flex items-center justify-center mb-4">
          <AlertCircle size={32} className="text-[var(--color-warning)]" />
        </div>
      )}

      <h2
        className={
          isRetro
            ? "needs-setup-title"
            : "text-xl font-semibold text-[var(--color-text-primary)] mb-2"
        }
      >
        {title}
      </h2>
      <p
        className={
          isRetro
            ? "needs-setup-description"
            : "text-sm text-[var(--color-text-secondary)] max-w-md text-center mb-6"
        }
      >
        {description}
      </p>

      <button
        className={
          isRetro
            ? "needs-setup-button"
            : "flex items-center gap-2 px-6 py-3 bg-[var(--color-accent)] text-white rounded-[var(--radius-button)] font-medium hover:brightness-110 transition-all"
        }
        onClick={onAction}
      >
        {isRetro ? `[${actionLabel}]` : actionLabel}
        {!isRetro && <ArrowRight size={16} />}
      </button>
    </motion.div>
  );
}

export default NeedsSetup;

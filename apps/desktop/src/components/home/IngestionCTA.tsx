/**
 * IngestionCTA - Main call-to-action button for snapshot & ingest
 * Supports dual UI modes (retro/modern)
 */
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface IngestionCTAProps {
  onStart: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  hasExistingSnapshot?: boolean;
  className?: string;
}

export function IngestionCTA({
  onStart,
  isLoading = false,
  disabled = false,
  variant = "primary",
  hasExistingSnapshot = false,
  className = "",
}: IngestionCTAProps) {
  const { isRetro } = useUIMode();
  const isPrimary = variant === "primary";
  const label = hasExistingSnapshot ? "Update Snapshot" : "Snapshot & Ingest";
  const description = hasExistingSnapshot
    ? "Create a new snapshot of your messages"
    : "Create your first snapshot";

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={onStart}
      disabled={disabled || isLoading}
      className={`
        group relative overflow-hidden rounded-[var(--radius-button)]
        transition-all duration-200
        ${
          isRetro
            ? isPrimary
              ? "bg-[var(--color-crt-text)] text-[var(--color-crt-bg)] px-8 py-4"
              : "bg-[var(--color-crt-bg-light)] text-[var(--color-crt-text)] border border-[var(--color-crt-border)] px-6 py-3"
            : isPrimary
              ? "bg-[var(--color-accent)] text-white px-8 py-4 shadow-lg hover:brightness-110"
              : "bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)] px-6 py-3 hover:border-[var(--color-accent)]"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${className}
      `}
      style={
        isRetro && isPrimary
          ? { boxShadow: "0 0 20px rgba(0, 255, 65, 0.3)" }
          : undefined
      }
    >
      {/* Animated background shimmer */}
      {isPrimary && !disabled && isRetro && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatDelay: 3,
          }}
        />
      )}

      <div className="relative flex flex-col items-center gap-1">
        {isLoading ? (
          <div className="flex items-center gap-2">
            {isRetro ? (
              <motion.div
                className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <Loader2 size={16} className="animate-spin" />
            )}
            <span className={isRetro ? "font-mono font-bold" : "font-medium"}>
              Processing...
            </span>
          </div>
        ) : (
          <>
            <span
              className={`flex items-center gap-2 ${
                isRetro
                  ? "font-mono font-bold text-lg"
                  : "font-semibold text-lg"
              }`}
            >
              {label}
              {!isRetro && isPrimary && <ArrowRight size={18} />}
            </span>
            <span
              className={`text-xs ${
                isRetro
                  ? `font-mono ${isPrimary ? "opacity-70" : "text-[var(--color-crt-text-dim)]"}`
                  : `${isPrimary ? "opacity-80" : "text-[var(--color-text-secondary)]"}`
              }`}
            >
              {description}
            </span>
          </>
        )}
      </div>
    </motion.button>
  );
}

export default IngestionCTA;

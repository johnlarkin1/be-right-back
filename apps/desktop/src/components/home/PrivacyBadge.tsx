/**
 * PrivacyBadge - Visual indicator of local-first privacy
 * Shows users that their data stays on their device
 * Supports dual UI modes (retro/modern)
 */
import { motion } from "framer-motion";
import { Shield, Lock, CloudOff, Download } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface PrivacyBadgeProps {
  variant?: "inline" | "card";
  className?: string;
}

export function PrivacyBadge({
  variant = "inline",
  className = "",
}: PrivacyBadgeProps) {
  const { isRetro } = useUIMode();

  if (variant === "card") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-[var(--radius-card)] p-4 ${
          isRetro
            ? "bg-[var(--color-crt-bg-light)] border border-[var(--color-crt-border)]"
            : "bg-[var(--color-surface-elevated)] border border-[var(--color-border)] shadow-sm"
        } ${className}`}
      >
        <div className="flex items-center gap-3">
          {/* Lock icon */}
          <div className="flex-shrink-0">
            {isRetro ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="text-[var(--color-crt-text)]"
              >
                <path
                  d="M12 2C9.24 2 7 4.24 7 7V10H6C4.9 10 4 10.9 4 12V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V12C20 10.9 19.1 10 18 10H17V7C17 4.24 14.76 2 12 2ZM12 4C13.66 4 15 5.34 15 7V10H9V7C9 5.34 10.34 4 12 4ZM12 14C13.1 14 14 14.9 14 16C14 17.1 13.1 18 12 18C10.9 18 10 17.1 10 16C10 14.9 10.9 14 12 14Z"
                  fill="currentColor"
                  opacity="0.8"
                />
              </svg>
            ) : (
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <Lock size={20} className="text-[var(--color-accent)]" />
              </div>
            )}
          </div>

          <div className="flex-1">
            <p
              className={
                isRetro
                  ? "font-mono text-sm text-[var(--color-crt-text)] font-medium"
                  : "text-sm text-[var(--color-text-primary)] font-medium"
              }
            >
              Your data never leaves your device
            </p>
            <p
              className={`mt-1 ${
                isRetro
                  ? "font-mono text-xs text-[var(--color-crt-text-dim)]"
                  : "text-xs text-[var(--color-text-secondary)]"
              }`}
            >
              All processing happens locally on your Mac
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Inline variant - more compact
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-badge)] ${
        isRetro
          ? "border border-[var(--color-accent-dim)] text-[var(--color-accent)]"
          : "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
      } ${className}`}
    >
      {isRetro ? (
        <span className="font-terminal text-xs">[LOCK]</span>
      ) : (
        <Shield size={12} />
      )}
      <span className={`text-xs font-medium ${isRetro ? "font-terminal" : ""}`}>
        {isRetro ? "LOCAL_ONLY" : "Private & Local"}
      </span>
    </motion.div>
  );
}

/** Detailed privacy information panel */
export function PrivacyInfo({ className = "" }: { className?: string }) {
  const { isRetro } = useUIMode();

  const points = [
    {
      icon: Shield,
      title: "Your data stays on your Mac",
      description: "Messages and models never leave your device",
    },
    {
      icon: CloudOff,
      title: "No cloud processing",
      description: "All AI training happens locally using your hardware",
    },
    {
      icon: Download,
      title: "Only model downloads",
      description: "The only network use is downloading base AI models",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`space-y-4 ${className}`}
    >
      {points.map((point, index) => {
        const IconComponent = point.icon;
        return (
          <motion.div
            key={point.title}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-start gap-3"
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                isRetro
                  ? "bg-[var(--color-crt-bg-light)] border border-[var(--color-crt-border)]"
                  : "bg-[var(--color-accent-subtle)]"
              }`}
            >
              {isRetro ? (
                <span className="text-[var(--color-crt-text)] text-sm font-terminal">
                  {index + 1}
                </span>
              ) : (
                <IconComponent
                  size={16}
                  className="text-[var(--color-accent)]"
                />
              )}
            </div>
            <div>
              <p
                className={
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text)]"
                    : "text-sm text-[var(--color-text-primary)] font-medium"
                }
              >
                {point.title}
              </p>
              <p
                className={`mt-0.5 ${
                  isRetro
                    ? "font-mono text-xs text-[var(--color-crt-text-dim)]"
                    : "text-xs text-[var(--color-text-secondary)]"
                }`}
              >
                {point.description}
              </p>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export default PrivacyBadge;

/**
 * ThemeToggle - Button to switch between retro and modern UI modes
 */
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Monitor } from "lucide-react";
import { useThemeStore, useUIMode } from "@/stores/themeStore";

interface ThemeToggleProps {
  /** Compact mode for TopBar (icon only) */
  compact?: boolean;
  /** Show labels (for settings page) */
  showLabel?: boolean;
}

export function ThemeToggle({
  compact = false,
  showLabel = false,
}: ThemeToggleProps) {
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const { mode, isRetro } = useUIMode();

  const nextMode = isRetro ? "Modern" : "Retro";

  if (compact) {
    return (
      <motion.button
        onClick={toggleMode}
        className="topbar-theme-toggle"
        title={`Switch to ${nextMode} mode`}
        aria-label={`Switch to ${nextMode} mode`}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {isRetro ? <Terminal size={18} /> : <Monitor size={18} />}
          </motion.div>
        </AnimatePresence>
      </motion.button>
    );
  }

  // Full toggle for Settings page
  return (
    <div className="flex items-center gap-4">
      {showLabel && (
        <span className="text-[var(--color-text-secondary)] text-sm">
          UI Mode
        </span>
      )}

      <div className="flex p-1 rounded-lg bg-[var(--color-surface)]">
        <ToggleOption
          active={isRetro}
          onClick={() => useThemeStore.getState().setMode("retro")}
          icon={<Terminal size={16} />}
          label="Retro"
        />
        <ToggleOption
          active={!isRetro}
          onClick={() => useThemeStore.getState().setMode("modern")}
          icon={<Monitor size={16} />}
          label="Modern"
        />
      </div>
    </div>
  );
}

interface ToggleOptionProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function ToggleOption({ active, onClick, icon, label }: ToggleOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
        transition-all duration-200
        ${
          active
            ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        }
      `}
    >
      {icon}
      {label}
    </button>
  );
}

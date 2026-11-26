/**
 * Accordion - Collapsible section component with dual-mode styling
 * Uses Framer Motion for smooth animations
 * Automatically adapts styling and icons for retro/modern modes
 */
import { useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface AccordionProps {
  title: string;
  icon?: LucideIcon;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  id?: string;
}

export function Accordion({
  title,
  icon: Icon,
  isOpen,
  onToggle,
  children,
  id,
}: AccordionProps) {
  const contentId = useId();
  const headerId = useId();
  const { isRetro } = useUIMode();

  // Mode-aware expand/collapse indicator
  const ExpandIndicator = () => {
    if (isRetro) {
      // ASCII-style indicator for retro mode
      return (
        <span className="text-[var(--color-text-muted)] font-mono text-sm">
          {isOpen ? "[-]" : "[+]"}
        </span>
      );
    }

    // Lucide chevron for modern mode
    return (
      <motion.div
        animate={{ rotate: isOpen ? 90 : 0 }}
        transition={{ duration: 0.2 }}
      >
        <ChevronRight
          size={16}
          className="text-[var(--color-text-muted)]"
          strokeWidth={1.5}
        />
      </motion.div>
    );
  };

  return (
    <div
      className={`
        border border-[var(--color-border)]
        rounded-[var(--radius-card)]
        overflow-hidden
        bg-[var(--color-surface)]
      `}
      id={id}
    >
      {/* Header/Toggle */}
      <button
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className={`
          w-full flex items-center justify-between px-4 py-3
          bg-[var(--color-surface-elevated)]
          hover:bg-[var(--color-surface-hover,var(--color-surface-elevated))]
          transition-colors duration-200 text-left
        `}
      >
        <div className="flex items-center gap-3">
          {Icon && (
            <Icon
              size={16}
              className="text-[var(--color-text-secondary)] opacity-70"
              strokeWidth={1.5}
            />
          )}
          <span
            className={`
              text-sm font-medium text-[var(--color-text-primary)]
              ${isRetro ? "font-mono uppercase tracking-wide" : ""}
            `}
          >
            {title}
          </span>
        </div>
        <ExpandIndicator />
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            role="region"
            aria-labelledby={headerId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 border-t border-[var(--color-border)]">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Accordion;

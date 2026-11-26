/**
 * ThinkingBlock - Collapsible display for model thinking/reasoning
 *
 * Shows the <think> block content from the model in a collapsible section.
 * Dual-mode styling for retro terminal and modern card aesthetics.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface ThinkingBlockProps {
  thinking: string;
  defaultExpanded?: boolean;
}

export function ThinkingBlock({
  thinking,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  const { isRetro } = useUIMode();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!thinking || thinking.trim().length === 0) {
    return null;
  }

  return (
    <div
      className={`
        mb-3
        ${isRetro ? "border border-[var(--color-ghost-purple)]/30" : "rounded-lg bg-[var(--color-surface-tertiary)]"}
        overflow-hidden
      `}
      style={isRetro ? { background: "rgba(139, 92, 246, 0.08)" } : undefined}
    >
      {/* Header - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center gap-2 px-3 py-2 text-xs
          ${isRetro ? "hover:bg-[var(--color-ghost-purple)]/10" : "hover:bg-[var(--color-surface-hover)]"}
          transition-colors
        `}
      >
        {isRetro ? (
          <>
            <span className="text-[var(--color-ghost-purple)]/60">
              {isExpanded ? "[-]" : "[+]"}
            </span>
            <span className="text-[var(--color-ghost-purple)]">THINKING</span>
          </>
        ) : (
          <>
            {isExpanded ? (
              <ChevronDown
                size={14}
                className="text-[var(--color-text-muted)]"
              />
            ) : (
              <ChevronRight
                size={14}
                className="text-[var(--color-text-muted)]"
              />
            )}
            <Brain size={14} className="text-[var(--color-ghost-purple)]" />
            <span className="text-[var(--color-text-secondary)] font-medium">
              Thinking
            </span>
          </>
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className={`
                px-3 pb-3 text-xs leading-relaxed whitespace-pre-wrap
                ${isRetro ? "font-mono text-[var(--color-ghost-purple)]/70" : "text-[var(--color-text-muted)]"}
              `}
            >
              {thinking}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ThinkingBlock;

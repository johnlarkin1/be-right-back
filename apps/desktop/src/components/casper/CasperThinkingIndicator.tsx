/**
 * CasperThinkingIndicator - Shows Casper's current state during agent execution
 *
 * Displays:
 * - Ghost mascot with appropriate variant
 * - Status text (thinking, searching, etc.)
 * - Current tool being called (if any)
 * - Mini-preview of completed tools
 */
import { motion, AnimatePresence } from "framer-motion";
import { Casper } from "@/components/Ghost";
import { ToolCallCard } from "./ToolCallCard";
import { useUIMode } from "@/stores/themeStore";
import type { CasperAgentState, CasperProgress, GhostVariant } from "@/types";

interface CasperThinkingIndicatorProps {
  state: CasperAgentState;
  progress: CasperProgress;
  statusMessage: string;
  ghostVariant: GhostVariant;
}

export function CasperThinkingIndicator({
  state,
  progress,
  statusMessage,
  ghostVariant,
}: CasperThinkingIndicatorProps) {
  const { isRetro } = useUIMode();

  // Don't render if idle or complete
  if (state === "idle" || state === "complete") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`
        ${isRetro ? "font-mono" : "font-sans"}
        ${isRetro ? "border border-[var(--color-ghost-pink)]/30" : "rounded-2xl bg-[var(--color-surface-elevated)]"}
        p-4
      `}
      style={
        isRetro
          ? {
              background: "rgba(255, 105, 180, 0.05)",
              boxShadow: "0 0 8px rgba(255, 105, 180, 0.1)",
            }
          : undefined
      }
    >
      {/* Ghost + Status */}
      <div className="flex items-center gap-3 mb-3">
        <motion.div
          animate={
            state === "thinking"
              ? { y: [0, -4, 0] }
              : state === "tool_calling"
                ? { rotate: [0, 5, -5, 0] }
                : {}
          }
          transition={{
            duration: state === "thinking" ? 2 : 0.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <Casper size={40} variant={ghostVariant} animate={true} />
        </motion.div>

        <div className="flex-1">
          {isRetro ? (
            <div className="text-[var(--color-ghost-pink)]">
              <span className="opacity-60 text-xs">[CASPER]</span>
              <span className="ml-2 text-sm">{statusMessage}</span>
              <motion.span
                className="ml-1"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                _
              </motion.span>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              {statusMessage}
            </p>
          )}

          {/* Iteration counter */}
          {state === "thinking" && (
            <p
              className={`text-xs mt-1 ${isRetro ? "text-[var(--color-ghost-pink)]/50" : "text-[var(--color-text-muted)]"}`}
            >
              {isRetro
                ? `[ITER ${progress.iteration}/${progress.maxIterations}]`
                : `Iteration ${progress.iteration} of ${progress.maxIterations}`}
            </p>
          )}
        </div>
      </div>

      {/* Current Tool Call */}
      <AnimatePresence>
        {progress.currentTool && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2"
          >
            <ToolCallCard tool={progress.currentTool} compact={true} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Completed Tools Mini-Preview */}
      {progress.completedTools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {progress.completedTools.map((tool, index) => (
            <span
              key={index}
              className={`
                text-xs px-2 py-0.5 rounded
                ${
                  isRetro
                    ? "border border-[var(--color-ghost-pink)]/20 text-[var(--color-ghost-pink)]/70"
                    : "bg-[var(--color-surface-tertiary)] text-[var(--color-text-muted)]"
                }
                ${tool.status === "success" ? "opacity-100" : "opacity-50"}
              `}
            >
              {isRetro ? `[${tool.toolName}]` : tool.toolName}
              {tool.status === "success" && (
                <span className="ml-1 text-green-500">
                  {isRetro ? " OK" : " ✓"}
                </span>
              )}
              {tool.status === "error" && (
                <span className="ml-1 text-red-500">
                  {isRetro ? " ERR" : " ✗"}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Error Display */}
      {state === "error" && progress.error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={`
            mt-3 p-2 rounded text-sm
            ${isRetro ? "border border-red-500/30 bg-red-500/10 text-red-400" : "bg-red-50 text-red-600"}
          `}
        >
          {isRetro ? `[ERROR] ${progress.error}` : progress.error}
        </motion.div>
      )}
    </motion.div>
  );
}

export default CasperThinkingIndicator;

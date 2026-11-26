/**
 * TypingIndicator - iMessage-style three bouncing dots
 *
 * Shown when the persona is processing but hasn't started streaming yet.
 * - Retro: Terminal-style with text glow
 * - Modern: Clean bubble with animated dots
 */
import { motion } from "framer-motion";
import { useUIMode } from "@/stores/themeStore";

export function TypingIndicator() {
  const { isRetro } = useUIMode();

  const bgColor = "bg-[var(--message-persona-bg)]";
  const borderColor = "border-[var(--message-persona-border)]";
  const shape = isRetro ? "rounded-sm" : "rounded-2xl rounded-bl-sm";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div
        className={`
          ${bgColor} ${borderColor} ${shape}
          border px-4 py-3
        `}
      >
        {isRetro && (
          <div className="font-[var(--font-terminal)] text-xs text-[var(--message-persona-text)] opacity-60 mb-1">
            [DIGITAL-YOU]
          </div>
        )}
        <div className="flex items-center gap-1 h-5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className={`
                inline-block rounded-full
                ${isRetro ? "w-1.5 h-1.5 bg-[var(--color-accent)]" : "w-2 h-2 bg-[var(--color-text-muted)]"}
              `}
              animate={{ y: [0, -4, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
              style={isRetro ? { boxShadow: "var(--text-glow)" } : undefined}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default TypingIndicator;

/**
 * MessageBubble - Message display with dual-mode styling
 * - Retro: Terminal-style with sharp corners, labels, and text glow
 * - Modern: Clean bubbles with rounded corners
 */
import { motion } from "framer-motion";
import { useUIMode } from "@/stores/themeStore";

interface MessageBubbleProps {
  message: string;
  isUser: boolean;
  isStreaming?: boolean;
}

export function MessageBubble({
  message,
  isUser,
  isStreaming = false,
}: MessageBubbleProps) {
  const { isRetro } = useUIMode();

  // Mode-specific labels
  const retroLabel = isUser ? "USER" : "DIGITAL-YOU";

  // Color tokens
  const bgColor = isUser
    ? "bg-[var(--message-user-bg)]"
    : "bg-[var(--message-persona-bg)]";
  const borderColor = isUser
    ? "border-[var(--message-user-border)]"
    : "border-[var(--message-persona-border)]";
  const textColor = isUser
    ? "text-[var(--message-user-text)]"
    : "text-[var(--message-persona-text)]";

  // Shape based on mode and sender
  const shape = isRetro
    ? "rounded-sm"
    : isUser
      ? "rounded-2xl rounded-br-sm"
      : "rounded-2xl rounded-bl-sm";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`
          ${bgColor} ${borderColor} ${shape}
          border px-4 py-3 max-w-[80%]
        `}
      >
        {/* Label - retro only */}
        {isRetro && (
          <div
            className={`
              font-[var(--font-terminal)] text-xs ${textColor} opacity-60 mb-1
            `}
          >
            [{retroLabel}]
          </div>
        )}

        {/* Message content */}
        <div
          className={`
            text-sm leading-relaxed
            ${textColor}
            ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
          `}
          style={isRetro ? { textShadow: "var(--text-glow)" } : undefined}
        >
          {/* Retro prefix */}
          {isRetro && (
            <span className="opacity-50 mr-1">{isUser ? ">" : "<"}</span>
          )}
          {message}
          {/* Streaming cursor */}
          {isStreaming && (
            <span
              className={`
                ml-0.5 animate-pulse
                ${isRetro ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}
              `}
            >
              {isRetro ? "_" : "|"}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default MessageBubble;

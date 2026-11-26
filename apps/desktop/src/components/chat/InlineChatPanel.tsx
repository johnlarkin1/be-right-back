/**
 * InlineChatPanel - Chat interface for personas with dual-mode styling
 *
 * Shows chat messages with the selected persona in the right panel
 * - Retro: Ghost mascot, terminal aesthetics
 * - Modern: Clean icons, rounded elements
 */
import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, MessageCircle, Trash2 } from "lucide-react";
import MessageBubble from "@/components/chat/MessageBubble";
import ChatInput from "@/components/chat/ChatInput";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { Ghost } from "@/components/Ghost";
import { useUIMode } from "@/stores/themeStore";
import type { TrainedPersona, ChatMessage } from "@/types";

interface InlineChatPanelProps {
  persona: TrainedPersona;
  messages: ChatMessage[];
  streamingMessage: string;
  isLoading: boolean;
  ragCount: number;
  onSendMessage: (message: string) => void;
  onClearChat: () => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
}

export function InlineChatPanel({
  persona,
  messages,
  streamingMessage,
  isLoading,
  ragCount,
  onSendMessage,
  onClearChat,
  thinkingEnabled,
  onToggleThinking,
}: InlineChatPanelProps) {
  const { isRetro } = useUIMode();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--color-surface)]">
      {/* Header */}
      <div
        className={`
          px-4 py-3 border-b border-[var(--color-border)]
          flex items-center justify-between
          bg-[var(--color-surface-elevated)]
        `}
      >
        <div className="flex items-center gap-3">
          {/* Avatar - Ghost in retro, initials circle in modern */}
          {isRetro ? (
            <Ghost size={32} variant="happy" color="cyan" />
          ) : (
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center
                text-sm font-semibold font-[var(--font-body)]
                bg-[var(--color-accent-secondary)]/10 text-[var(--color-accent-secondary)]
              `}
            >
              {persona.display_name.charAt(0).toUpperCase()}
            </div>
          )}

          <div>
            <h2
              className={`
                text-sm text-[var(--color-text-primary)]
                ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}
              `}
            >
              {persona.display_name}
            </h2>
            <div
              className={`
                flex items-center gap-2 text-xs text-[var(--color-text-muted)]
                ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
              `}
            >
              <span
                className={`
                  w-1.5 h-1.5 rounded-full animate-pulse
                  ${isRetro ? "bg-[var(--color-text-primary)]" : "bg-[var(--color-success)]"}
                `}
              />
              <span>Online</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Thinking mode toggle */}
          {isRetro ? (
            <button
              onClick={onToggleThinking}
              className={`
                px-2 py-1 text-xs font-mono transition-colors border rounded-sm
                ${
                  thinkingEnabled
                    ? "text-[var(--color-accent-secondary)] border-[var(--color-accent-secondary)]"
                    : "text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-text-secondary)]"
                }
              `}
              title={thinkingEnabled ? "Thinking mode ON" : "Thinking mode OFF"}
            >
              [THINK: {thinkingEnabled ? "ON" : "OFF"}]
            </button>
          ) : (
            <button
              onClick={onToggleThinking}
              className={`
                flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-[var(--font-body)]
                transition-colors
                ${
                  thinkingEnabled
                    ? "text-[var(--color-accent-secondary)] bg-[var(--color-accent-secondary)]/10"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
                }
              `}
              title={thinkingEnabled ? "Thinking mode ON" : "Thinking mode OFF"}
            >
              <Brain size={14} />
              <span>{thinkingEnabled ? "On" : "Off"}</span>
            </button>
          )}

          {messages.length > 0 && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClearChat}
              className={`
                transition-colors
                ${
                  isRetro
                    ? "px-3 py-1.5 text-xs font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-sm hover:border-[var(--color-text-secondary)]"
                    : "p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
                }
              `}
            >
              {isRetro ? "Clear" : <Trash2 size={18} />}
            </motion.button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streamingMessage ? (
          <EmptyState personaName={persona.display_name} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={i}
                message={msg.content}
                isUser={msg.role === "user"}
              />
            ))}
            {streamingMessage && (
              <MessageBubble
                message={streamingMessage}
                isUser={false}
                isStreaming={true}
              />
            )}
            <AnimatePresence>
              {isLoading && !streamingMessage && <TypingIndicator />}
            </AnimatePresence>
            {/* RAG grounding indicator — shown after last assistant message.
                ragCount is excerpts (chunks of ~8 messages), not messages. */}
            {!isLoading &&
              !streamingMessage &&
              ragCount > 0 &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "assistant" && (
                <div
                  className={`
                  text-xs text-[var(--color-text-muted)] px-2 py-1 text-right
                  ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                `}
                >
                  {isRetro
                    ? `[MEMORY: ${ragCount} excerpt${ragCount !== 1 ? "s" : ""} referenced]`
                    : `Grounded in ${ragCount} excerpt${ragCount !== 1 ? "s" : ""}`}
                </div>
              )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={onSendMessage}
        disabled={isLoading}
        placeholder={
          isLoading ? "thinking..." : `Message ${persona.display_name}...`
        }
      />
    </div>
  );
}

/** Empty state when no messages yet */
function EmptyState({ personaName }: { personaName: string }) {
  const { isRetro } = useUIMode();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col items-center justify-center text-center px-4"
    >
      {isRetro ? (
        <Ghost size={48} variant="happy" color="cyan" animate />
      ) : (
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-secondary)]/10 flex items-center justify-center">
          <MessageCircle
            size={32}
            className="text-[var(--color-accent-secondary)]"
          />
        </div>
      )}
      <h3
        className={`
          mt-4 mb-2 text-[var(--color-text-primary)]
          ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}
        `}
      >
        Chat with {personaName}
      </h3>
      <p
        className={`
          text-sm text-[var(--color-text-muted)] max-w-xs
          ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
        `}
      >
        Start a conversation! The persona will respond based on their messaging
        style.
      </p>
    </motion.div>
  );
}

export default InlineChatPanel;

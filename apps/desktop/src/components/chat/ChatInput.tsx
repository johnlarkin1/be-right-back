/**
 * ChatInput - Message input with dual-mode styling
 * - Retro: Terminal-style with `>` prompt and blinking cursor
 * - Modern: Clean input with send icon button
 */
import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "type here...",
}: ChatInputProps) {
  const { isRetro } = useUIMode();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`
        flex items-center ${isRetro ? "gap-1.5" : "gap-3"} p-4
        border-t border-[var(--color-border)]
        bg-[var(--color-surface)]
      `}
    >
      {/* Terminal prompt - retro only */}
      {isRetro && (
        <span className="font-[var(--font-terminal)] text-[var(--color-accent)] text-lg">
          {">"}
        </span>
      )}

      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={isRetro ? placeholder : "Type a message..."}
          className={`
            w-full text-sm bg-transparent outline-none
            text-[var(--color-text-primary)]
            placeholder:text-[var(--color-text-muted)]
            ${isRetro ? "font-mono p-0" : "font-[var(--font-body)]"}
            ${!isRetro ? "px-4 py-2 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] focus:border-[var(--color-accent)]" : ""}
          `}
          autoComplete="off"
          spellCheck="false"
        />
        {/* Blinking cursor - retro only, when empty */}
        {isRetro && value === "" && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[var(--color-accent)] cursor-blink">
            _
          </span>
        )}
      </div>

      {/* Send button - different styles per mode */}
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={`
          transition-all duration-200
          disabled:opacity-30 disabled:cursor-not-allowed
          ${
            isRetro
              ? "font-mono text-sm text-[var(--color-accent)] px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:shadow-[var(--shadow-glow)]"
              : "p-2 rounded-full bg-[var(--color-accent)] text-white hover:opacity-90"
          }
        `}
      >
        {isRetro ? "[SEND]" : <Send size={18} />}
      </button>
    </form>
  );
}

export default ChatInput;

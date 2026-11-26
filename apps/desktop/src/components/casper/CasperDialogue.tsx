/**
 * CasperDialogue - Speech bubble component for Casper's messages
 * Features a typing animation effect for a friendly, conversational feel
 */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CasperDialogueProps {
  message: string;
  isVisible?: boolean;
  typingSpeed?: number;
  onTypingComplete?: () => void;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function CasperDialogue({
  message,
  isVisible = true,
  typingSpeed = 25,
  onTypingComplete,
  position = "right",
  className = "",
}: CasperDialogueProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Typing animation effect
  useEffect(() => {
    if (!isVisible || !message) {
      setDisplayedText("");
      return;
    }

    setIsTyping(true);
    setDisplayedText("");
    let currentIndex = 0;

    const typingInterval = setInterval(() => {
      if (currentIndex < message.length) {
        setDisplayedText(message.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(typingInterval);
        setIsTyping(false);
        onTypingComplete?.();
      }
    }, typingSpeed);

    return () => clearInterval(typingInterval);
  }, [message, isVisible, typingSpeed, onTypingComplete]);

  // Position-based styling
  const positionStyles: Record<string, string> = {
    top: "bottom-full mb-3 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-3 left-1/2 -translate-x-1/2",
    left: "right-full mr-3 top-1/2 -translate-y-1/2",
    right: "left-full ml-3 top-1/2 -translate-y-1/2",
  };

  // Tail position
  const tailStyles: Record<string, string> = {
    top: "top-full left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-[var(--color-crt-bg-light)]",
    bottom:
      "bottom-full left-1/2 -translate-x-1/2 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-[var(--color-crt-bg-light)]",
    left: "left-full top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-l-8 border-t-transparent border-b-transparent border-l-[var(--color-crt-bg-light)]",
    right:
      "right-full top-1/2 -translate-y-1/2 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-[var(--color-crt-bg-light)]",
  };

  return (
    <AnimatePresence>
      {isVisible && message && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
          className={`absolute ${positionStyles[position]} ${className}`}
        >
          <div
            className="relative bg-[var(--color-crt-bg-light)] border border-[var(--color-ghost-pink)] rounded-lg px-4 py-3 max-w-xs shadow-lg"
            style={{
              boxShadow: "0 0 12px rgba(255, 105, 180, 0.3)",
            }}
          >
            {/* Speech bubble tail */}
            <div className={`absolute w-0 h-0 ${tailStyles[position]}`} />

            {/* Message text */}
            <p className="text-sm font-mono text-[var(--color-crt-text)] leading-relaxed">
              {displayedText}
              {isTyping && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-[var(--color-ghost-pink)] animate-pulse" />
              )}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default CasperDialogue;

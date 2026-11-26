"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { getCompletions } from "./terminal-commands";

interface TerminalInputProps {
  prompt: string;
  currentPath: string;
  onSubmit: (command: string) => void;
  commandHistory: string[];
  isOpen: boolean;
}

export function TerminalInput({
  prompt,
  currentPath,
  onSubmit,
  commandHistory,
  isOpen,
}: TerminalInputProps) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when terminal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the animation start
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "Enter": {
          e.preventDefault();
          onSubmit(value);
          setValue("");
          setHistoryIndex(-1);
          setSavedInput("");
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          if (commandHistory.length === 0) return;
          const newIndex =
            historyIndex === -1
              ? commandHistory.length - 1
              : Math.max(0, historyIndex - 1);
          if (historyIndex === -1) setSavedInput(value);
          setHistoryIndex(newIndex);
          setValue(commandHistory[newIndex]);
          break;
        }

        case "ArrowDown": {
          e.preventDefault();
          if (historyIndex === -1) return;
          const newIndex = historyIndex + 1;
          if (newIndex >= commandHistory.length) {
            setHistoryIndex(-1);
            setValue(savedInput);
          } else {
            setHistoryIndex(newIndex);
            setValue(commandHistory[newIndex]);
          }
          break;
        }

        case "Tab": {
          e.preventDefault();
          if (!value.trim()) return;
          const completions = getCompletions(value, currentPath);
          if (completions.length === 1) {
            setValue(completions[0]);
          }
          break;
        }

        case "c": {
          if (e.ctrlKey) {
            e.preventDefault();
            setValue("");
            setHistoryIndex(-1);
          }
          break;
        }

        case "l": {
          if (e.ctrlKey) {
            e.preventDefault();
            onSubmit("clear");
          }
          break;
        }
      }
    },
    [value, historyIndex, savedInput, commandHistory, currentPath, onSubmit]
  );

  return (
    <div
      className="flex items-center border-t border-white/10 px-4 py-2 font-ibm-plex-mono"
      onClick={() => inputRef.current?.focus()}
    >
      <span className="text-crt-accent mr-1 shrink-0 text-sm">{prompt}</span>
      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm text-crt-body caret-crt-text outline-none"
          aria-label="Terminal command input"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

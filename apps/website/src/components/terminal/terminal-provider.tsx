"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { executeCommand as execCmd } from "./terminal-commands";
import { pathnameToFSPath } from "./terminal-filesystem";
import type { HistoryEntry } from "./terminal-output";

interface TerminalContextValue {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  history: HistoryEntry[];
  currentPath: string;
  commandHistory: string[];
  executeCommand: (input: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal must be used within TerminalProvider");
  return ctx;
}

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  // Sync currentPath when user navigates via header links or browser nav
  useEffect(() => {
    setCurrentPath(pathnameToFSPath(pathname));
  }, [pathname]);

  const buildPrompt = useCallback(
    (path: string) => {
      const displayPath = path === "/" ? "~" : `~${path}`;
      return `visitor@brb:${displayPath}$`;
    },
    []
  );

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const executeCommand = useCallback(
    (input: string) => {
      const trimmed = input.trim();

      // Save to command history (even empty for prompt display)
      if (trimmed) {
        setCommandHistory((prev) => [...prev, trimmed]);
        // Also persist to sessionStorage
        try {
          const stored = JSON.parse(
            sessionStorage.getItem("brb-terminal-history") ?? "[]"
          );
          stored.push(trimmed);
          sessionStorage.setItem(
            "brb-terminal-history",
            JSON.stringify(stored.slice(-100))
          );
        } catch {
          // sessionStorage unavailable
        }
      }

      const prompt = buildPrompt(currentPath);

      // Empty input — just show an empty prompt line
      if (!trimmed) {
        setHistory((prev) => [...prev, { command: "", output: [], prompt }]);
        return;
      }

      const result = execCmd(trimmed, {
        currentPath,
        setCurrentPath,
        navigate: (route: string) => router.push(route),
        clearHistory,
        closeTerminal: close,
        commandHistory,
      });

      if (result === "clear") {
        setHistory([]);
        return;
      }

      setHistory((prev) => [
        ...prev,
        { command: trimmed || "", output: result, prompt },
      ]);
    },
    [currentPath, commandHistory, router, buildPrompt, clearHistory, close]
  );

  // Load command history from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem("brb-terminal-history") ?? "[]"
      );
      if (Array.isArray(stored)) setCommandHistory(stored);
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  return (
    <TerminalContext.Provider
      value={{
        isOpen,
        toggle,
        open,
        close,
        history,
        currentPath,
        commandHistory,
        executeCommand,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

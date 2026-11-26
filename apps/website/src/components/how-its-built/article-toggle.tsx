"use client";

import { useCallback, useSyncExternalStore } from "react";
import { trackEvent } from "@/lib/analytics";
import { SimpleModeHoverCard } from "./simple-mode-hover-card";

export type ArticleMode = "technical" | "simple";

interface ArticleToggleProps {
  mode: ArticleMode;
  onModeChange: (mode: ArticleMode) => void;
}

const STORAGE_KEY = "brb-article-mode";

function getStoredMode(): ArticleMode {
  if (typeof window === "undefined") return "technical";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "simple" ? "simple" : "technical";
}

function subscribeToStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function useArticleMode(): [ArticleMode, (mode: ArticleMode) => void] {
  // Use useSyncExternalStore to safely read from localStorage
  const mode = useSyncExternalStore(
    subscribeToStorage,
    getStoredMode,
    () => "technical" as ArticleMode // Server snapshot
  );

  const setMode = useCallback((newMode: ArticleMode) => {
    trackEvent("article_mode_toggled", { new_mode: newMode });
    localStorage.setItem(STORAGE_KEY, newMode);
    // Dispatch storage event to trigger re-render
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  }, []);

  return [mode, setMode];
}

export function ArticleToggle({ mode, onModeChange }: ArticleToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-surface rounded-lg border border-border-subtle">
      <ToggleButton
        active={mode === "technical"}
        onClick={() => onModeChange("technical")}
      >
        <CodeIcon className="w-4 h-4 mr-1.5" />
        Technical
      </ToggleButton>
      <SimpleModeHoverCard>
        {({ describedById }) => (
          <ToggleButton
            active={mode === "simple"}
            onClick={() => onModeChange("simple")}
            ariaDescribedBy={describedById}
          >
            <BookIcon className="w-4 h-4 mr-1.5" />
            Simple
          </ToggleButton>
        )}
      </SimpleModeHoverCard>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  ariaDescribedBy,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaDescribedBy?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-describedby={ariaDescribedBy}
      className={`
        flex items-center px-3 py-1.5 rounded-md text-sm font-medium
        transition-all duration-200 ease-out cursor-pointer
        ${
          active
            ? "bg-crt-accent/20 text-crt-accent border border-crt-accent/30"
            : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
        }
      `}
    >
      {children}
    </button>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  );
}

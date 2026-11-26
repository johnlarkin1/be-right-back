"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

type CopyState = "idle" | "copied" | "error";

interface CopyMarkdownButtonProps {
  markdown: string;
  label?: string;
  copiedLabel?: string;
  eventName?: string;
  eventProperties?: Record<string, unknown>;
  className?: string;
  disabled?: boolean;
}

export function CopyMarkdownButton({
  markdown,
  label = "Copy markdown",
  copiedLabel = "Copied!",
  eventName = "article_markdown_copied",
  eventProperties,
  className = "",
  disabled = false,
}: CopyMarkdownButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (disabled || !markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
      trackEvent(eventName, eventProperties);
    } catch {
      setState("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 1500);
  }, [disabled, markdown, eventName, eventProperties]);

  const isCopied = state === "copied";
  const isError = state === "error";
  const displayLabel = isCopied ? copiedLabel : isError ? "Copy failed" : label;
  const Icon = isCopied ? Check : Copy;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !markdown}
      aria-label={displayLabel}
      className={`
        inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
        font-jetbrains transition-all duration-200 ease-out
        border cursor-pointer
        ${
          isCopied
            ? "bg-crt-accent/20 text-crt-accent border-crt-accent/30"
            : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated border-border-subtle"
        }
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      <span>{displayLabel}</span>
    </button>
  );
}

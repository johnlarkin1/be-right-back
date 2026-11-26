"use client";

import { useArticleMode, type ArticleMode } from "./article-toggle";

const MODES: { mode: ArticleMode; label: string }[] = [
  { mode: "technical", label: "Technical" },
  { mode: "simple", label: "Simple" },
];

/**
 * The tip on the How It's Built index. It sets the same stored mode that
 * the article pages read, so a reader picks a mode once.
 */
export function ReadingModeTip() {
  const [mode, setMode] = useArticleMode();

  return (
    <div className="flex flex-col-reverse gap-2.5 rounded-[10px] border border-border-subtle bg-surface p-3.5 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-4 md:px-5 md:py-4">
      <p className="font-inter text-[13px] leading-normal text-text-secondary md:flex-[1_1_300px] md:text-[15px]">
        <span className="font-jetbrains text-crt-accent">tip:</span> Most articles have a{" "}
        <strong className="text-text-primary">Technical</strong> and{" "}
        <strong className="text-text-primary">Simple</strong> mode. Toggle between them based on your preference.
      </p>
      <div
        role="group"
        aria-label="Reading mode"
        className="grid grid-cols-2 rounded-lg border border-[rgba(232,228,210,0.1)] bg-crt-bg p-[3px] font-jetbrains text-[13px] md:flex"
      >
        {MODES.map(({ mode: m, label }) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(m)}
              className={`h-11 rounded-md px-4 transition-colors md:h-9 ${
                active ? "bg-crt-accent text-[#09090b]" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

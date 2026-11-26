"use client";

import { Fragment, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookMarked,
  CornerDownLeft,
  FileText,
  Hash,
  type LucideIcon,
  PlayCircle,
  Search,
  Sparkles,
} from "lucide-react";
import type { SearchDocType, SearchResult } from "@/lib/search/types";
import { useSearch } from "./use-search";

const TYPE_ICON: Record<SearchDocType, LucideIcon> = {
  article: FileText,
  section: Hash,
  glossary: BookMarked,
  demo: PlayCircle,
  page: FileText,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bold the query terms inside a snippet. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const termSet = new Set(terms);
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        termSet.has(part.toLowerCase()) ? (
          <mark
            key={i}
            className="bg-crt-accent/20 text-crt-accent rounded-[2px] px-0.5"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { query, setQuery, results, answer, terms, semanticState, indexAvailable } =
    useSearch(open);

  const go = useCallback(
    (url: string) => {
      onClose();
      router.push(url);
    },
    [onClose, router],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-xl"
          >
            <Command
              shouldFilter={false}
              loop
              className="overflow-hidden border-2 border-crt-text/30 bg-crt-bg/98 shadow-[0_0_30px_rgba(0,255,65,0.15)] backdrop-blur-md"
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
            >
              {/* Input row */}
              <div className="flex items-center gap-2.5 border-b border-crt-text/20 px-4">
                <Search className="h-4 w-4 shrink-0 text-crt-text/60" aria-hidden />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search or ask a question…"
                  className="h-12 w-full bg-transparent font-inter text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                />
                {semanticState === "loading" && (
                  <span className="shrink-0 font-jetbrains text-[10px] uppercase tracking-wide text-crt-text/50">
                    loading ai…
                  </span>
                )}
              </div>

              <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
                {!indexAvailable && query.trim() && (
                  <div className="px-3 py-6 text-center font-inter text-sm text-text-muted">
                    Search index isn&apos;t built yet. Run{" "}
                    <code className="text-crt-accent">npm run build:search</code>.
                  </div>
                )}

                {indexAvailable && (
                  <Command.Empty className="px-3 py-6 text-center font-inter text-sm text-text-muted">
                    {query.trim() ? "No matches." : "Type to search the site."}
                  </Command.Empty>
                )}

                {/* Answer card — the best semantic passage for a natural-language question. */}
                {answer && (
                  <Command.Group
                    heading={
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" aria-hidden /> Answer
                      </span>
                    }
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-ibm-plex-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-crt-accent"
                  >
                    <Command.Item
                      value={`answer-${answer.id}`}
                      onSelect={() => go(answer.url)}
                      className="mb-1 cursor-pointer rounded-sm border border-crt-text/15 bg-crt-text/[0.04] px-3 py-2.5 data-[selected=true]:border-crt-accent/40 data-[selected=true]:bg-crt-accent/[0.06]"
                    >
                      <div className="mb-1 font-jetbrains text-xs text-crt-text/70">
                        {answer.title}
                        {answer.subtitle && answer.subtitle !== answer.title && (
                          <span className="text-text-muted"> › {answer.subtitle}</span>
                        )}
                      </div>
                      <p className="font-inter text-sm leading-relaxed text-text-primary">
                        <Highlight text={answer.text} terms={terms} />
                      </p>
                    </Command.Item>
                  </Command.Group>
                )}

                {/* Navigation results. */}
                {results.length > 0 && (
                  <Command.Group
                    heading="Results"
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-ibm-plex-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-muted"
                  >
                    {results.map((r) => (
                      <ResultRow key={r.id} result={r} terms={terms} onSelect={go} />
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer hint */}
              <div className="flex items-center justify-between border-t border-crt-text/20 px-4 py-2 font-jetbrains text-[11px] text-text-muted">
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" aria-hidden /> to open
                </span>
                <span>esc to close</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ResultRow({
  result,
  terms,
  onSelect,
}: {
  result: SearchResult;
  terms: string[];
  onSelect: (url: string) => void;
}) {
  const Icon = TYPE_ICON[result.type];
  return (
    <Command.Item
      value={result.id}
      onSelect={() => onSelect(result.url)}
      className="flex cursor-pointer items-start gap-2.5 rounded-sm px-3 py-2 data-[selected=true]:bg-crt-text/10"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-crt-text/50" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate font-inter text-sm text-text-primary">
          {result.title}
          {result.subtitle && result.subtitle !== result.title && (
            <span className="text-text-muted"> › {result.subtitle}</span>
          )}
        </div>
        <div className="truncate font-inter text-xs text-text-muted">
          <Highlight text={result.text} terms={terms} />
        </div>
      </div>
    </Command.Item>
  );
}

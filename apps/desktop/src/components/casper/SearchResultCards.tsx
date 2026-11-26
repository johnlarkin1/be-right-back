/**
 * SearchResultCards - Compact cards showing search result chunks
 *
 * Parses the resultPreview JSON from search_messages tool calls
 * and renders each result as a compact, readable card.
 */
import { useMemo } from "react";
import { Search, Clock, User } from "lucide-react";
import { useUIMode } from "@/stores/themeStore";

/** Shape of a single search result from the backend */
interface SearchResultItem {
  contact_name: string;
  conversation: string;
  date: string;
  relative_time: string;
  similarity: string;
  match_type?: string;
}

interface SearchResultCardsProps {
  /** Raw JSON string from tool resultPreview */
  resultPreview: string;
  /** Max cards to display */
  maxCards?: number;
}

/** Try to parse the resultPreview JSON into search results */
function parseResults(raw: string): SearchResultItem[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.results && Array.isArray(parsed.results)) {
      return parsed.results;
    }
    return null;
  } catch {
    return null;
  }
}

/** Truncate a conversation snippet to a max length */
function truncateSnippet(text: string, maxLen: number): string {
  // Take last N characters (most recent messages are most interesting)
  const lines = text.split("\n").filter((l) => l.trim());
  let result = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (result.length + line.length + 1 > maxLen) break;
    result = line + (result ? "\n" + result : "");
  }
  return result || text.slice(0, maxLen);
}

export function SearchResultCards({
  resultPreview,
  maxCards = 5,
}: SearchResultCardsProps) {
  const { isRetro } = useUIMode();

  const results = useMemo(() => parseResults(resultPreview), [resultPreview]);

  if (!results || results.length === 0) {
    return (
      <div
        className={`mt-2 text-[10px] ${isRetro ? "font-mono text-[var(--color-ghost-pink)]/30" : "text-[var(--color-text-muted)]"}`}
      >
        {isRetro ? "[NO MATCHING CHUNKS]" : "No matching results"}
      </div>
    );
  }

  const displayed = results.slice(0, maxCards);

  return (
    <div className="mt-2 space-y-1.5">
      <div
        className={`
          flex items-center gap-1 text-[10px]
          ${isRetro ? "font-mono text-[var(--color-ghost-pink)]/40" : "text-[var(--color-text-muted)]"}
        `}
      >
        {isRetro ? (
          <span>[{results.length} CHUNKS FOUND]</span>
        ) : (
          <>
            <Search size={10} />
            <span>
              {results.length} result{results.length !== 1 ? "s" : ""} found
            </span>
          </>
        )}
      </div>

      {displayed.map((result, idx) => (
        <div
          key={`${result.contact_name}-${result.date}-${idx}`}
          className={`
            px-2.5 py-2 text-xs
            ${
              isRetro
                ? "font-mono border border-[var(--color-ghost-pink)]/15 bg-[var(--color-ghost-pink)]/[0.03]"
                : "rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)]/50"
            }
          `}
        >
          {/* Header: contact name + relative time */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {isRetro ? (
                <span className="text-[var(--color-ghost-pink)]/70 truncate">
                  {result.contact_name}
                </span>
              ) : (
                <>
                  <User
                    size={10}
                    className="text-[var(--color-ghost-pink)] shrink-0"
                  />
                  <span className="text-[var(--color-text-primary)] font-medium truncate">
                    {result.contact_name}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isRetro ? (
                <span className="text-[var(--color-ghost-pink)]/40">
                  [{result.relative_time}]
                </span>
              ) : (
                <>
                  <Clock size={10} className="text-[var(--color-text-muted)]" />
                  <span className="text-[var(--color-text-muted)]">
                    {result.relative_time}
                  </span>
                </>
              )}
              {result.match_type === "keyword" && (
                <span
                  className={`
                    ml-1 px-1 py-0.5 text-[9px]
                    ${isRetro ? "text-[var(--color-ghost-pink)]/50 border border-[var(--color-ghost-pink)]/20" : "rounded text-[var(--color-text-muted)] bg-[var(--color-surface-tertiary)]"}
                  `}
                >
                  {isRetro ? "KW" : "keyword"}
                </span>
              )}
            </div>
          </div>

          {/* Snippet: 2-line conversation preview */}
          <div
            className={`
              leading-relaxed whitespace-pre-line line-clamp-2
              ${isRetro ? "text-[var(--color-ghost-pink)]/50" : "text-[var(--color-text-secondary)]"}
            `}
          >
            {truncateSnippet(result.conversation, 150)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default SearchResultCards;

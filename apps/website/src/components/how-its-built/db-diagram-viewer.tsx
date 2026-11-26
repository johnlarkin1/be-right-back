"use client";

import { useState, useEffect, useRef } from "react";

interface DbDiagramViewerProps {
  /** Full dbdiagram.io embed URL, or just the bare embed token. */
  src: string;
  title?: string;
  height?: number;
}

// When the markdown still carries this marker the embed hasn't been
// configured yet — show setup instructions instead of a broken iframe.
const PLACEHOLDER_MARKER = "REPLACE_WITH";

/**
 * Resolve a directive value into a dbdiagram.io embed URL. Accepts a full
 * URL (used as-is) or a bare embed token.
 */
function resolveEmbedUrl(src: string): string {
  if (/^https?:\/\//.test(src)) return src;
  return `https://dbdiagram.io/embed/${src}`;
}

export function DbDiagramViewer({
  src,
  title = "Database Schema",
  height = 520,
}: DbDiagramViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const isPlaceholder = !src || src.includes(PLACEHOLDER_MARKER);
  const embedUrl = isPlaceholder ? "" : resolveEmbedUrl(src);

  // Lazy-load the iframe only once it scrolls near the viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="my-8 border border-border-subtle rounded-lg overflow-hidden bg-surface"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="w-4 h-4 text-crt-accent" />
          <span className="font-jetbrains text-sm text-text-primary">
            {title}
          </span>
        </div>
        {!isPlaceholder && (
          <a
            href={embedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-crt-accent transition-colors"
          >
            <span>Open in dbdiagram.io</span>
            <ExternalLinkIcon className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Diagram container */}
      <div className="relative" style={{ height }}>
        {isPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface px-6 text-center">
            <p className="text-sm text-text-secondary font-inter max-w-md">
              Schema diagram not configured yet. Paste{" "}
              <code className="font-jetbrains text-xs text-crt-accent">
                public/diagrams/imessage-schema.dbml
              </code>{" "}
              into{" "}
              <a
                href="https://dbdiagram.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-crt-accent underline"
              >
                dbdiagram.io
              </a>
              , then drop the embed token into the{" "}
              <code className="font-jetbrains text-xs text-crt-accent">
                ::dbdiagram
              </code>{" "}
              directive.
            </p>
          </div>
        ) : (
          <>
            {(!isInView || !isLoaded) && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-crt-accent/30 border-t-crt-accent rounded-full animate-spin" />
                  <span className="text-sm text-text-secondary font-inter">
                    Loading schema...
                  </span>
                </div>
              </div>
            )}
            {isInView && (
              <iframe
                src={embedUrl}
                title={title}
                className="w-full h-full border-0"
                loading="lazy"
                onLoad={() => setIsLoaded(true)}
              />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border-subtle bg-surface-elevated">
        <p className="text-xs text-text-muted font-inter">
          <span className="text-crt-accent">&gt;</span> Drag tables to
          rearrange. Scroll to zoom. Hover a relationship to trace its foreign
          keys.
        </p>
      </div>
    </div>
  );
}

function DatabaseIcon({ className }: { className?: string }) {
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
        d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3"
      />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
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
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

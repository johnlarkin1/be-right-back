"use client";

import { useState } from "react";

interface ArchitectureDiagramProps {
  excalidrawUrl: string;
  title?: string;
  height?: number;
  className?: string;
}

export function ArchitectureDiagram({
  excalidrawUrl,
  title = "Architecture Diagram",
  height = 600,
  className = "",
}: ArchitectureDiagramProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div
      className={`border border-border-subtle rounded-lg overflow-hidden bg-surface ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-elevated">
        <div className="flex items-center gap-2">
          <DiagramIcon className="w-4 h-4 text-crt-accent" />
          <span className="font-jetbrains text-sm text-text-primary">
            {title}
          </span>
        </div>
        <a
          href={excalidrawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-crt-accent transition-colors"
        >
          <span>Open in Excalidraw</span>
          <ExternalLinkIcon className="w-3 h-3" />
        </a>
      </div>

      {/* Diagram container */}
      <div className="relative" style={{ height }}>
        {isLoading && !hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-crt-accent/30 border-t-crt-accent rounded-full animate-spin" />
              <span className="text-sm text-text-secondary">Loading diagram...</span>
            </div>
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <WarningIcon className="w-8 h-8 text-crt-accent" />
              <span className="text-sm text-text-secondary">
                Failed to load diagram.{" "}
                <a
                  href={excalidrawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-crt-accent hover:underline"
                >
                  Open in Excalidraw
                </a>
              </span>
            </div>
          </div>
        )}

        <iframe
          src={excalidrawUrl}
          className={`w-full h-full border-0 ${isLoading || hasError ? "invisible" : "visible"}`}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          title={title}
          allow="fullscreen"
        />
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-border-subtle bg-surface-elevated">
        <p className="text-xs text-text-muted">
          <span className="text-crt-accent">&gt;</span> Pan and zoom to explore the architecture. Click elements for details.
        </p>
      </div>
    </div>
  );
}

function DiagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

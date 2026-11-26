"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ExcalidrawViewerProps {
  src: string;
  title?: string;
  height?: number;
  /** Zoom to fit the whole diagram in the frame once it loads. */
  fit?: boolean;
}

interface ExcalidrawData {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

// Track whether we've imported the CSS
let cssLoaded = false;

export function ExcalidrawViewer({
  src,
  title = "Architecture Diagram",
  height = 500,
  fit = false,
}: ExcalidrawViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [diagramData, setDiagramData] = useState<ExcalidrawData | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<React.ComponentType<any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Intersection observer for lazy loading
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

  // Load Excalidraw library and diagram data when in view
  useEffect(() => {
    if (!isInView) return;

    let cancelled = false;

    async function load() {
      try {
        // Load CSS once
        if (!cssLoaded) {
          await import("@excalidraw/excalidraw/index.css");
          cssLoaded = true;
        }

        // Load library and data in parallel
        const [excalidrawModule, response] = await Promise.all([
          import("@excalidraw/excalidraw"),
          fetch(src),
        ]);

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch diagram: ${response.status}`);
        }

        const data = await response.json();

        if (cancelled) return;

        setExcalidrawComponent(() => excalidrawModule.Excalidraw);
        setDiagramData(data);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load diagram");
        setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isInView, src]);

  const handleWheelCapture = useCallback((e: React.WheelEvent) => {
    // Prevent Excalidraw from capturing scroll when not zooming (ctrl/meta)
    if (!e.ctrlKey && !e.metaKey) {
      e.stopPropagation();
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="my-8 border border-border-subtle rounded-lg overflow-hidden bg-surface"
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
          href={`https://excalidraw.com/#json=${encodeURIComponent(src)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-crt-accent transition-colors"
        >
          <span>View source</span>
          <ExternalLinkIcon className="w-3 h-3" />
        </a>
      </div>

      {/* Diagram container */}
      <div className="relative" style={{ height }}>
        {isLoading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-crt-accent/30 border-t-crt-accent rounded-full animate-spin" />
              <span className="text-sm text-text-secondary font-inter">
                Loading diagram...
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface z-10">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <WarningIcon className="w-8 h-8 text-crt-accent" />
              <span className="text-sm text-text-secondary font-inter">
                {error}
              </span>
            </div>
          </div>
        )}

        {ExcalidrawComponent && diagramData && (
          <div
            className="w-full h-full excalidraw-wrapper"
            onWheelCapture={handleWheelCapture}
          >
            <ExcalidrawComponent
              initialData={{
                elements: diagramData.elements,
                appState: {
                  ...(diagramData.appState || {}),
                  viewModeEnabled: true,
                  zenModeEnabled: true,
                  gridSize: null,
                  scrollToContent: true,
                },
                files: diagramData.files,
              }}
              excalidrawAPI={
                fit
                  ? (api: { scrollToContent: (target?: undefined, opts?: { fitToViewport?: boolean; viewportZoomFactor?: number }) => void }) => {
                      // Wait a frame so the canvas has its final size.
                      requestAnimationFrame(() =>
                        api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.95 })
                      );
                    }
                  : undefined
              }
              viewModeEnabled={true}
              zenModeEnabled={true}
              theme="dark"
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false,
                  clearCanvas: false,
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  toggleTheme: false,
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border-subtle bg-surface-elevated">
        <p className="text-xs text-text-muted font-inter">
          <span className="text-crt-accent">&gt;</span> Pinch or Ctrl+scroll
          to zoom. Drag to pan.
        </p>
      </div>
    </div>
  );
}

function DiagramIcon({ className }: { className?: string }) {
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
        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
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

function WarningIcon({ className }: { className?: string }) {
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
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

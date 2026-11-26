"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createRoot, type Root } from "react-dom/client";
import { ExcalidrawViewer } from "./excalidraw-viewer";
import { DbDiagramViewer } from "./db-diagram-viewer";
import { TermTooltip } from "./term-tooltip";
import { PlaygroundButton } from "./playground-button";
import { System3D } from "./system-3d/system-3d";

interface ArticleContentProps {
  htmlContent: string;
  className?: string;
}

type RootRecord = { root: Root; live: boolean };

export function ArticleContent({ htmlContent, className = "" }: ArticleContentProps) {
  const articleRef = useRef<HTMLElement>(null);
  // Keyed by the placeholder element so we never call createRoot() twice on the
  // same container. React 19 StrictMode mounts → cleans up → mounts again while
  // reusing the same DOM nodes, so we reuse the existing root instead of
  // creating a duplicate (which triggers the createRoot warning).
  const recordsRef = useRef<Map<HTMLElement, RootRecord>>(new Map());

  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;

    const records = recordsRef.current;

    // Render `node` into `target`, reusing an existing root if one is present.
    const mount = (target: HTMLElement, node: ReactNode) => {
      let record = records.get(target);
      if (record) {
        record.live = true; // cancel any pending deferred unmount
      } else {
        record = { root: createRoot(target), live: true };
        records.set(target, record);
      }
      record.root.render(node);
    };

    // Mount ExcalidrawViewer into each placeholder
    const placeholders = el.querySelectorAll<HTMLElement>(
      "[data-excalidraw-diagram]"
    );
    for (const placeholder of placeholders) {
      const src = placeholder.dataset.excalidrawDiagram;
      if (!src) continue;

      const title = placeholder.dataset.excalidrawTitle;
      const fit = placeholder.dataset.excalidrawFit === "true";
      const heightAttr = Number(placeholder.dataset.excalidrawHeight);
      const height = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : undefined;
      mount(
        placeholder,
        <ExcalidrawViewer src={src} title={title} fit={fit} height={height} />
      );
    }

    // Mount DbDiagramViewer into each dbdiagram placeholder div
    const dbPlaceholders = el.querySelectorAll<HTMLElement>(
      "[data-dbdiagram-src]"
    );
    for (const placeholder of dbPlaceholders) {
      const src = placeholder.dataset.dbdiagramSrc;
      if (!src) continue;

      const title = placeholder.dataset.dbdiagramTitle;
      const heightAttr = placeholder.dataset.dbdiagramHeight;
      const height = heightAttr ? Number(heightAttr) : undefined;
      mount(
        placeholder,
        <DbDiagramViewer
          src={src}
          title={title}
          height={Number.isFinite(height) ? height : undefined}
        />
      );
    }

    // Mount PlaygroundButton into each ::playground placeholder div
    const playgroundPlaceholders = el.querySelectorAll<HTMLElement>(
      "[data-playground-slug]"
    );
    for (const placeholder of playgroundPlaceholders) {
      const slug = placeholder.dataset.playgroundSlug;
      if (!slug) continue;

      const label = placeholder.dataset.playgroundLabel ?? slug;
      const preview = placeholder.dataset.playgroundPreview;
      mount(
        placeholder,
        <PlaygroundButton slug={slug} label={label} preview={preview} />
      );
    }

    // Mount System3D into each ::system3d placeholder div
    for (const placeholder of el.querySelectorAll<HTMLElement>("[data-system3d]")) {
      const heightAttr = Number(placeholder.dataset.system3dHeight);
      mount(
        placeholder,
        <System3D
          title={placeholder.dataset.system3dTitle}
          height={Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : undefined}
        />
      );
    }

    // Mount TermTooltip into each glossary term span
    const termSpans = el.querySelectorAll<HTMLElement>("[data-term]");
    for (const span of termSpans) {
      const termKey = span.dataset.term;
      const termName = span.dataset.termName;
      const definitionHtml = span.dataset.termHtml;
      if (!termKey || !termName || !definitionHtml) continue;

      const label = span.textContent ?? termName;
      const isRepeat = span.dataset.termRepeat === "true";
      mount(
        span,
        <TermTooltip
          name={termName}
          label={label}
          definitionHtml={definitionHtml}
          isRepeat={isRepeat}
        />
      );
    }

    // Cleanup on unmount or content change. Mark every root for unmount, then
    // defer the actual teardown to a microtask so we don't synchronously
    // unmount nested roots while the parent tree is still rendering (React 19
    // logs a warning otherwise). A subsequent effect run (StrictMode remount or
    // a re-render reusing the same nodes) flips `live` back to true via mount(),
    // which cancels the pending unmount for that element.
    return () => {
      for (const record of records.values()) {
        record.live = false;
      }
      queueMicrotask(() => {
        for (const [target, record] of records) {
          if (!record.live) {
            record.root.unmount();
            records.delete(target);
          }
        }
      });
    };
  }, [htmlContent]);

  return (
    <AnimatePresence mode="wait">
      <motion.article
        ref={articleRef}
        key={htmlContent.slice(0, 100)}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className={`prose-brb font-inter ${className}`}
        // Content is server-processed markdown from trusted local .md files only
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </AnimatePresence>
  );
}

/**
 * Placeholder content shown when article is loading or not yet written
 */
export function ArticlePlaceholder({ title }: { title: string }) {
  return (
    <div className="border-2 border-dashed border-crt-accent/30 bg-crt-accent/5 rounded-lg p-8 text-center">
      <div className="font-jetbrains text-crt-accent text-sm mb-2">&gt; {title}</div>
      <p className="font-inter text-text-secondary">
        This article is coming soon. Check back later for the full content.
      </p>
    </div>
  );
}

"use client";

import { useEffect } from "react";
import {
  ArticleToggle,
  ArticleContent,
  ArticlePlaceholder,
  CopyMarkdownButton,
  TableOfContents,
  useArticleMode,
} from "@/components/how-its-built";
import type { ArticleContent as ArticleContentType } from "@/lib/markdown";
import { trackEvent } from "@/lib/analytics";

interface ArticlePageClientProps {
  technicalContent: ArticleContentType | null;
  simpleContent: ArticleContentType | null;
  articleTitle: string;
  isShared?: boolean;
}

export function ArticlePageClient({
  technicalContent,
  simpleContent,
  articleTitle,
  isShared = false,
}: ArticlePageClientProps) {
  const [mode, setMode] = useArticleMode();

  useEffect(() => {
    trackEvent("article_viewed", { slug: articleTitle, title: articleTitle, mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentContent = isShared
    ? technicalContent
    : mode === "technical"
      ? technicalContent
      : simpleContent;
  const hasContent = currentContent && currentContent.htmlContent.trim().length > 0;

  // Get headings from current content, or fall back to technical content headings
  // This ensures TOC is visible even when viewing simple mode (which may be empty)
  const tocHeadings = currentContent?.headings?.length
    ? currentContent.headings
    : technicalContent?.headings || [];

  return (
    <div className="flex gap-12">
      {/* Main article content */}
      <div className="flex-1 min-w-0">
        {/* Toolbar: toggle (if split) + copy markdown button */}
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          {!isShared ? (
            <ArticleToggle mode={mode} onModeChange={setMode} />
          ) : (
            <div />
          )}
          <CopyMarkdownButton
            markdown={currentContent?.content ?? ""}
            eventProperties={{
              slug: articleTitle,
              mode: isShared ? "shared" : mode,
            }}
            disabled={!currentContent?.content}
          />
        </div>

        {/* Article content */}
        {hasContent ? (
          <ArticleContent htmlContent={currentContent.htmlContent} />
        ) : (
          <ArticlePlaceholder title={articleTitle} />
        )}
      </div>

      {/* Table of contents - sticky right sidebar on xl screens */}
      {tocHeadings.length > 0 && (
        <aside className="hidden xl:block w-64 flex-shrink-0">
          <div className="sticky top-24">
            <TableOfContents headings={tocHeadings} />
          </div>
        </aside>
      )}
    </div>
  );
}

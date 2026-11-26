/**
 * MarkdownRenderer - Dual-mode styled markdown rendering using react-markdown
 * Provides custom components that adapt to retro/modern themes via CSS tokens
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useUIMode } from "@/stores/themeStore";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Create mode-aware component overrides for markdown styling
 */
function useMarkdownComponents(isRetro: boolean): Components {
  // Mode-specific code styling
  const inlineCodeClass = isRetro
    ? "px-1 py-0.5 bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-mono text-sm"
    : "px-1.5 py-0.5 bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] rounded font-mono text-sm";

  const codeBlockClass = isRetro
    ? "block p-3 bg-black border border-[var(--color-accent-dim)] font-mono text-xs text-[var(--color-accent)] overflow-x-auto mb-3"
    : "block p-4 bg-[var(--color-surface)] rounded-lg font-mono text-sm text-[var(--color-text-primary)] overflow-x-auto mb-3";

  return {
    // Headers (shouldn't appear in section content, but handle gracefully)
    h1: ({ children }) => (
      <h1
        className={`
          text-lg font-bold text-[var(--color-text-primary)] mb-3
          ${isRetro ? "font-mono uppercase tracking-wide" : ""}
        `}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={`
          text-base font-bold text-[var(--color-text-primary)] mb-2
          border-b border-[var(--color-border)] pb-1
          ${isRetro ? "font-mono uppercase tracking-wide" : ""}
        `}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={`
          text-sm font-bold text-[var(--color-text-primary)] mb-2
          ${isRetro ? "font-mono uppercase tracking-wide" : ""}
        `}
      >
        {children}
      </h3>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p
        className={`
          text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3 last:mb-0
          ${isRetro ? "font-mono" : ""}
        `}
      >
        {children}
      </p>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="list-none space-y-1.5 mb-3 pl-0">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol
        className={`
          list-decimal list-inside space-y-1.5 mb-3 text-sm text-[var(--color-text-secondary)] pl-0
          ${isRetro ? "font-mono" : ""}
        `}
      >
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li
        className={`
          text-sm text-[var(--color-text-secondary)] leading-relaxed flex items-start gap-2
          ${isRetro ? "font-mono" : ""}
        `}
      >
        <span className="text-[var(--color-text-muted)] select-none shrink-0">
          {isRetro ? "-" : "\u2022"}
        </span>
        <span className="flex-1">{children}</span>
      </li>
    ),

    // Inline formatting
    strong: ({ children }) => (
      <strong className="text-[var(--color-text-primary)] font-bold">
        {children}
      </strong>
    ),
    em: ({ children }) => (
      <em className="text-[var(--color-text-primary)] italic">{children}</em>
    ),

    // Code
    code: ({ children, className }) => {
      // Check if inline or block
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return <code className={codeBlockClass}>{children}</code>;
      }
      return <code className={inlineCodeClass}>{children}</code>;
    },

    // Blockquotes (for direct quotes from conversations)
    blockquote: ({ children }) => (
      <blockquote
        className={`
          border-l-2 border-[var(--color-accent-dim)] pl-3 my-3 italic
          text-[var(--color-text-secondary)]
        `}
      >
        {children}
      </blockquote>
    ),

    // Horizontal rules
    hr: () => <hr className="border-[var(--color-border)] my-4" />,

    // Links (shouldn't appear but handle)
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-[var(--color-accent)] underline hover:opacity-80 transition-opacity"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
  };
}

export function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  const { isRetro } = useUIMode();
  const components = useMarkdownComponents(isRetro);

  return (
    <div className={`markdown-content ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}

export default MarkdownRenderer;

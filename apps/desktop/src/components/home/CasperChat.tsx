/**
 * CasperChat - Casper Q&A Chat Interface (the Ask Casper tab)
 *
 * A ChatGPT/Claude-like experience for asking Casper questions about
 * your iMessage history. Shows real-time thinking indicators, tool
 * invocations, and streams the final answer.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Square,
  Trash2,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Bot,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Casper } from "@/components/Ghost";
import {
  CasperThinkingIndicator,
  ToolList,
  ThinkingBlock,
  ContactMentionDropdown,
} from "@/components/casper";
import { CasperThreadSidebar } from "./CasperThreadSidebar";
import { CasperModelMenu } from "./CasperModelMenu";
import { useUIMode } from "@/stores/themeStore";
import { useCasperDraftStore } from "@/stores/casperDraftStore";
import { formatNumber } from "@/lib/format";
import { useCasperAgent } from "@/hooks/useCasperAgent";
import { useContacts } from "@/hooks/useContacts";
import type {
  CasperChatMessage,
  ContactWithStatus,
  MentionedContact,
} from "@/types";
import { EXAMPLE_QUERIES } from "@/types";

/** Max contacts shown in the "@" mention dropdown. */
const MAX_MENTION_RESULTS = 8;

/** An in-progress "@" mention token: the text typed after "@" and its offset. */
interface MentionToken {
  query: string;
  start: number;
}

/**
 * Detect an active "@" mention immediately before the cursor.
 *
 * Returns the token (query text + the "@" offset) when the cursor sits inside
 * an "@word" that starts at the beginning of the input or after whitespace.
 * Returns null otherwise (e.g. email addresses, or once a space is typed).
 */
function getMentionToken(text: string, cursor: number): MentionToken | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      const before = i === 0 ? " " : text[i - 1];
      if (/\s/.test(before)) {
        return { query: text.slice(i + 1, cursor), start: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * Whether an "@Name" tag for `displayName` is still present in `text` as a
 * whole token: the "@" must sit at the start or after whitespace, and the name
 * must be followed by whitespace or the end of the string. A plain substring
 * test would wrongly match when one tagged name is a prefix of another (e.g.
 * "@Jon" reported as present inside "@Jonathan").
 */
function hasMentionTag(text: string, displayName: string): boolean {
  const tag = `@${displayName}`;
  for (let from = 0; ; ) {
    const at = text.indexOf(tag, from);
    if (at === -1) return false;
    const before = at === 0 ? " " : text[at - 1];
    const afterIdx = at + tag.length;
    const after = afterIdx >= text.length ? " " : text[afterIdx];
    if (/\s/.test(before) && /\s/.test(after)) return true;
    from = at + 1;
  }
}

/** A display name that reads like a real name, not a raw phone/email handle. */
function looksLikeName(displayName: string | null): displayName is string {
  const trimmed = displayName?.trim();
  if (!trimmed) return false;
  // Skip raw handles (emails, phone numbers) — they make awkward suggestions.
  if (trimmed.includes("@")) return false;
  if (/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  return true;
}

/** A starter question with a one-word label for what it does. */
interface SuggestedQuery {
  kind: string;
  query: string;
}

/**
 * Build starter-question cards personalized to the user's most-messaged
 * contacts. Falls back to the generic EXAMPLE_QUERIES when we don't have real
 * contact names yet (still loading, or only raw phone/email handles).
 */
function buildSuggestedQueries(
  contacts: ContactWithStatus[],
): SuggestedQuery[] {
  const topNames = [...contacts]
    .sort((a, b) => b.message_count - a.message_count)
    .map((c) => c.display_name)
    .filter(looksLikeName)
    .slice(0, 2);

  if (topNames.length === 0) {
    return EXAMPLE_QUERIES.map((query) => ({ kind: "Find", query }));
  }

  const personalized: SuggestedQuery[] = [
    { kind: "Recap", query: `What did ${topNames[0]} and I last talk about?` },
  ];
  if (topNames[1]) {
    personalized.push({
      kind: "Summarize",
      query: `Summarize my recent chats with ${topNames[1]}`,
    });
  }

  // Round out with a couple of evergreen prompts.
  return [
    ...personalized,
    { kind: "Rank", query: "Who do I text the most?" },
    { kind: "Find", query: "Find messages about weekend plans" },
  ].slice(0, 4);
}

/** Maximum number of messages to display for performance */
const MAX_VISIBLE_MESSAGES = 50;

/** Preprocess markdown content to fix literal \n sequences from LLM output */
function preprocessMarkdown(content: string): string {
  return content.replace(/\\n/g, "\n");
}

interface CasperChatProps {
  /** Messages and contacts Casper can search, for the empty state */
  messageCount?: number;
  contactCount?: number;
  /** Stats panel controls */
  statsCollapsed: boolean;
  onToggleStats: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/** Custom markdown components for styling */
function MarkdownComponents(isRetro: boolean) {
  const textColor = "text-[var(--color-ghost-pink)]";

  return {
    // Strong/bold text
    strong: ({ children }: { children?: React.ReactNode }) => (
      <span className={`font-bold ${textColor}`}>{children}</span>
    ),
    // Emphasis/italic text
    em: ({ children }: { children?: React.ReactNode }) => (
      <span
        className={`italic ${isRetro ? "" : "text-[var(--color-ghost-pink)]/90"}`}
      >
        {children}
      </span>
    ),
    // Code blocks
    code: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code
            className={`
              px-1 py-0.5 rounded text-xs
              ${isRetro ? "bg-black/30 text-[var(--color-ghost-pink)]" : "bg-[var(--color-surface-secondary)] text-[var(--color-ghost-pink)]"}
            `}
          >
            {children}
          </code>
        );
      }
      return <code className={`${className} text-xs`}>{children}</code>;
    },
    // Pre blocks (code blocks)
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre
        className={`
          my-2 p-2 rounded overflow-x-auto text-xs
          ${isRetro ? "bg-black/30" : "bg-[var(--color-surface-secondary)]"}
        `}
      >
        {children}
      </pre>
    ),
    // Links
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`
          underline decoration-dotted hover:decoration-solid
          ${textColor}
        `}
      >
        {children}
      </a>
    ),
    // Lists
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-none space-y-1 my-2 pl-0">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal list-inside space-y-1 my-2 pl-0">
        {children}
      </ol>
    ),
    // List items
    li: ({ children }: { children?: React.ReactNode }) => (
      <li
        className={`leading-relaxed flex items-start gap-2 ${isRetro ? "font-mono" : ""}`}
      >
        <span className="text-[var(--color-ghost-pink)]/60 select-none shrink-0">
          {isRetro ? "-" : "\u2022"}
        </span>
        <span className="flex-1">{children}</span>
      </li>
    ),
    // Paragraphs
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-3 last:mb-0">{children}</p>
    ),
  };
}

/** Message bubble for Casper chat */
function CasperMessageBubble({
  message,
  isStreaming = false,
}: {
  message: CasperChatMessage;
  isStreaming?: boolean;
}) {
  const { isRetro } = useUIMode();
  const isUser = message.role === "user";

  // Color tokens
  const bgColor = isUser
    ? "bg-[var(--message-user-bg)]"
    : "bg-[var(--color-ghost-pink)]/10";
  const borderColor = isUser
    ? "border-[var(--message-user-border)]"
    : "border-[var(--color-ghost-pink)]/20";
  const textColor = isUser
    ? "text-[var(--message-user-text)]"
    : "text-[var(--color-ghost-pink)]";

  // Shape based on mode and sender
  const shape = isRetro
    ? "rounded-sm"
    : isUser
      ? "rounded-2xl rounded-br-sm"
      : "rounded-2xl rounded-bl-sm";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`
          ${bgColor} ${borderColor} ${shape}
          border px-4 py-3 max-w-[85%]
        `}
      >
        {/* Label - retro only */}
        {isRetro && (
          <div
            className={`
              font-mono text-xs ${textColor} opacity-60 mb-1
            `}
          >
            [{isUser ? "YOU" : "CASPER"}]
          </div>
        )}

        {/* Thinking block (collapsible) - only when thinking was enabled */}
        {!isUser && message.thinking_enabled && message.thinking && (
          <ThinkingBlock thinking={message.thinking} />
        )}

        {/* Message content */}
        <div
          className={`
            text-sm leading-relaxed
            ${textColor}
            ${isRetro ? "font-mono" : "font-sans"}
          `}
          style={
            isRetro && !isUser
              ? { textShadow: "0 0 8px rgba(255, 105, 180, 0.4)" }
              : undefined
          }
        >
          {/* Retro prefix */}
          {isRetro && (
            <span className="opacity-50 mr-1">{isUser ? ">" : "<"}</span>
          )}
          {/* Render content: markdown for assistant, plain text for user */}
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={MarkdownComponents(isRetro)}
            >
              {preprocessMarkdown(message.content)}
            </ReactMarkdown>
          )}
          {/* Streaming cursor */}
          {isStreaming && (
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className={`
                ml-0.5
                ${isRetro ? "text-[var(--color-ghost-pink)]" : "text-[var(--color-text-muted)]"}
              `}
            >
              {isRetro ? "_" : "|"}
            </motion.span>
          )}
        </div>

        {/* Tool list (non-collapsible) for assistant messages */}
        {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <ToolList toolCalls={message.tool_calls} />
        )}
      </div>
    </motion.div>
  );
}

/** Streaming message display */
function StreamingMessage({ content }: { content: string }) {
  const { isRetro } = useUIMode();

  if (!content) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-start"
    >
      <div
        className={`
          ${isRetro ? "rounded-sm border border-[var(--color-ghost-pink)]/20" : "rounded-2xl rounded-bl-sm"}
          bg-[var(--color-ghost-pink)]/10
          px-4 py-3 max-w-[85%]
        `}
      >
        {isRetro && (
          <div className="font-mono text-xs text-[var(--color-ghost-pink)] opacity-60 mb-1">
            [CASPER]
          </div>
        )}
        <div
          className={`
            text-sm leading-relaxed text-[var(--color-ghost-pink)]
            ${isRetro ? "font-mono" : "font-sans"}
          `}
          style={
            isRetro
              ? { textShadow: "0 0 8px rgba(255, 105, 180, 0.4)" }
              : undefined
          }
        >
          {isRetro && <span className="opacity-50 mr-1">&lt;</span>}
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={MarkdownComponents(isRetro)}
          >
            {preprocessMarkdown(content)}
          </ReactMarkdown>
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="ml-0.5"
          >
            {isRetro ? "_" : "|"}
          </motion.span>
        </div>
      </div>
    </motion.div>
  );
}

export function CasperChat({
  messageCount = 0,
  contactCount = 0,
  statsCollapsed,
  onToggleStats,
  onRefresh,
  isRefreshing,
}: CasperChatProps) {
  const { isRetro } = useUIMode();
  const [query, setQuery] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // "@" mention selector state
  const { otherContacts } = useContacts();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  // Contacts tagged in the message currently being composed.
  const [mentions, setMentions] = useState<MentionedContact[]>([]);

  const mentionMatches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return otherContacts
      .filter((c) => (c.display_name ?? c.contact_id).toLowerCase().includes(q))
      .sort((a, b) => b.message_count - a.message_count)
      .slice(0, MAX_MENTION_RESULTS);
  }, [mention, otherContacts]);

  // Starter-question pills, personalized to the user's top contacts.
  const suggestedQueries = useMemo(
    () => buildSuggestedQueries(otherContacts),
    [otherContacts],
  );

  const mentionOpen = mention !== null && mentionMatches.length > 0;

  const syncMention = (text: string, cursor: number) => {
    setMention(getMentionToken(text, cursor));
    setMentionIndex(0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setQuery(text);
    syncMention(text, e.target.selectionStart ?? text.length);
  };

  const selectMention = (contact: ContactWithStatus) => {
    if (!mention) return;
    const name = contact.display_name ?? contact.contact_id;
    const before = query.slice(0, mention.start);
    const after = query.slice(mention.start + 1 + mention.query.length);
    const insert = `@${name} `;
    setQuery(before + insert + after);
    setMentions((prev) =>
      prev.some((m) => m.contact_id === contact.contact_id)
        ? prev
        : [...prev, { contact_id: contact.contact_id, display_name: name }],
    );
    setMention(null);
    // Restore focus and place the cursor just after the inserted mention.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        const pos = before.length + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen) {
      // Enter submits; Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit(e);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
        );
        break;
      case "Enter":
      case "Tab":
        // Select instead of submitting the form.
        e.preventDefault();
        selectMention(mentionMatches[mentionIndex]);
        break;
      case "Escape":
        e.preventDefault();
        setMention(null);
        break;
    }
  };

  const {
    state,
    progress,
    messages,
    isProcessing,
    error,
    lastQuestion,
    threads,
    activeThreadId,
    askQuestion,
    clearConversation,
    cancelRequest,
    retryLastQuestion,
    loadThread,
    newThread,
    renameThread,
    deleteThread,
    ghostVariant,
    statusMessage,
  } = useCasperAgent({ thinkingEnabled });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, progress.streamingAnswer]);

  // Auto-grow the input as the user types so long messages wrap and expand
  // (up to a max height) instead of overflowing horizontally.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [query]);

  const handleSubmit = async (e?: { preventDefault: () => void }) => {
    e?.preventDefault();
    if (!query.trim() || isProcessing) return;

    const question = query.trim();
    // Keep only mentions whose "@Name" tag is still present in the final text
    // (the user may have edited or deleted one after tagging).
    const activeMentions = mentions.filter((m) =>
      hasMentionTag(question, m.display_name),
    );
    setQuery("");
    setMentions([]);
    setMention(null);
    await askQuestion(question, activeMentions);
  };

  // A question handed over from another screen, e.g. the topic map.
  const draft = useCasperDraftStore((s) => s.draft);
  const setDraft = useCasperDraftStore((s) => s.setDraft);
  useEffect(() => {
    if (draft === null) return;
    setQuery(draft);
    // Clear the handed-over draft in the same frame as the focus.
    requestAnimationFrame(() => {
      setDraft(null);
      inputRef.current?.focus();
    });
  }, [draft, setDraft]);

  const handleExampleClick = (example: string) => {
    if (isProcessing) return;
    askQuestion(example);
  };

  const hasMessages = messages.length > 0;
  const isEmpty = !hasMessages && !isProcessing;

  const inputForm = (
    <form
      onSubmit={handleSubmit}
      className={`relative w-full ${isEmpty ? "max-w-[720px]" : "max-w-2xl mx-auto"}`}
    >
      <ContactMentionDropdown
        isOpen={mentionOpen}
        contacts={mentionMatches}
        selectedIndex={mentionIndex}
        onSelect={selectMention}
        onHover={setMentionIndex}
        anchorRef={inputWrapperRef}
      />
      <div
        ref={inputWrapperRef}
        className={`
                flex items-end gap-2
                ${
                  isRetro
                    ? "border border-[var(--color-ghost-pink)]/30 px-3 py-2"
                    : "rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] px-3 py-1.5 shadow-sm focus-within:border-[var(--color-ghost-pink)]/40 transition-colors"
                }
              `}
        style={
          isRetro ? { background: "rgba(255, 105, 180, 0.05)" } : undefined
        }
      >
        {isRetro && (
          <span className="font-mono text-[var(--color-ghost-pink)] text-sm py-1">
            &gt;
          </span>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={
            isProcessing
              ? "Casper is thinking..."
              : isRetro
                ? "ask anything. type @ to search one person"
                : "Ask anything. Type @ to search one person"
          }
          disabled={isProcessing}
          className={`
                flex-1 bg-transparent border-none outline-none text-sm py-1
                resize-none overflow-y-auto break-words leading-relaxed
                ${isRetro ? "font-mono text-[var(--color-ghost-pink)]" : "text-[var(--color-text-primary)]"}
                placeholder:opacity-40
              `}
          style={isRetro ? { caretColor: "#ff69b4" } : undefined}
        />
        {isProcessing ? (
          <button
            type="button"
            onClick={cancelRequest}
            aria-label="Stop Casper"
            title="Stop"
            className={`
                  flex items-center justify-center shrink-0 self-end mb-0.5
                  ${
                    isRetro
                      ? "font-mono text-xs px-3 py-1 border border-[var(--color-ghost-pink)]/30 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/10"
                      : "p-1.5 rounded-lg border border-[var(--color-ghost-pink)]/40 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/10"
                  }
                  transition-colors
                `}
          >
            {isRetro ? "[STOP]" : <Square size={16} fill="currentColor" />}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!query.trim()}
            className={`
                  flex items-center justify-center shrink-0 self-end mb-0.5
                  ${
                    isRetro
                      ? "font-mono text-xs px-3 py-1 border border-[var(--color-ghost-pink)]/30 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/10"
                      : "p-1.5 rounded-lg bg-[var(--color-ghost-pink)] text-white hover:bg-[var(--color-ghost-pink)]/90"
                  }
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-colors
                `}
          >
            {isRetro ? "[SEND]" : <Send size={16} />}
          </button>
        )}
      </div>
    </form>
  );

  // Common button styles for consistent look - pill with border
  const buttonBaseClass = isRetro
    ? "font-mono text-xs px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-crt-text)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] hover:border-[var(--color-crt-text)]/30 cursor-pointer transition-all"
    : "text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-[var(--color-surface-elevated)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-text-muted)]/50 cursor-pointer transition-all";

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Saved conversation threads (ChatGPT-style left rail) */}
      <CasperThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onSelect={loadThread}
        onNew={newThread}
        onRename={renameThread}
        onDelete={deleteThread}
        isProcessing={isProcessing}
      />

      {/* Conversation column */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header - button pills */}
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left side: Casper status */}
          <div className="flex items-center gap-3">
            {/* Casper status pill */}
            <div
              hidden={isEmpty}
              className={`
              flex items-center gap-1.5 px-2 py-1
              ${
                isRetro
                  ? "font-mono text-[10px] border border-[var(--color-ghost-pink)]/30 bg-[var(--color-ghost-pink)]/5"
                  : "text-[11px] rounded-full border border-[var(--color-ghost-pink)]/20 bg-[var(--color-ghost-pink)]/5"
              }
            `}
            >
              <Casper size={14} variant={ghostVariant} animate={false} />
              <span
                className={`${isRetro ? "text-[var(--color-ghost-pink)]/80" : "text-[var(--color-ghost-pink)]"}`}
              >
                {statusMessage}
              </span>
            </div>
          </div>

          {/* Right side: Model menu, Stats toggle, Refresh, Clear */}
          <div className="flex items-center gap-2">
            {/* Model selector + thinking toggle */}
            <CasperModelMenu
              thinkingEnabled={thinkingEnabled}
              onThinkingChange={setThinkingEnabled}
            />

            {/* Stats toggle */}
            <button
              onClick={onToggleStats}
              className={`flex items-center gap-1 ${buttonBaseClass}`}
              title={statsCollapsed ? "Show stats" : "Hide stats"}
            >
              {isRetro ? (
                statsCollapsed ? (
                  "[stats ▼]"
                ) : (
                  "[stats ▲]"
                )
              ) : (
                <>
                  <span>Stats</span>
                  {statsCollapsed ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronUp size={12} />
                  )}
                </>
              )}
            </button>

            {/* Refresh button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={`flex items-center justify-center ${buttonBaseClass} disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Sync new messages"
            >
              {isRetro ? (
                "[↻]"
              ) : (
                <motion.div
                  animate={isRefreshing ? { rotate: 360 } : {}}
                  transition={
                    isRefreshing
                      ? { duration: 1, repeat: Infinity, ease: "linear" }
                      : {}
                  }
                >
                  <RefreshCw size={14} />
                </motion.div>
              )}
            </button>

            {/* Clear button - show when there are messages or an error */}
            {(hasMessages || state === "error") && (
              <button
                onClick={clearConversation}
                disabled={isProcessing}
                className={`flex items-center gap-1.5 ${buttonBaseClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Clear conversation"
              >
                {isRetro ? (
                  "[clear]"
                ) : (
                  <>
                    <Trash2 size={12} />
                    <span>Clear</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isEmpty ? (
            /* Empty state */
            <div className="min-h-full flex flex-col items-center justify-center gap-7 py-10">
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-3.5 text-center"
              >
                {isRetro ? (
                  <Casper size={76} variant="happy" />
                ) : (
                  <div className="w-16 h-16 rounded-[var(--radius-card)] bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-ghost-pink)] flex items-center justify-center">
                    <Bot size={32} aria-hidden="true" />
                  </div>
                )}
                <h1 className="page-title">
                  {isRetro
                    ? "[CASPER] ready"
                    : "Ask Casper about your messages"}
                </h1>
                <p className="m-0 max-w-[480px] leading-relaxed text-[var(--color-text-secondary)]">
                  {messageCount > 0
                    ? `Casper searches ${formatNumber(messageCount)} messages across ${contactCount.toLocaleString()} contacts. `
                    : "Casper searches your messages. "}
                  All processing happens locally on your Mac.
                </p>
              </motion.div>

              {inputForm}

              {/* Starter questions */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15 }}
                className="w-full max-w-[720px] grid grid-cols-2 gap-2.5"
              >
                {suggestedQueries.map((s) => (
                  <button
                    key={s.query}
                    onClick={() => handleExampleClick(s.query)}
                    className="card focus-ring min-h-16 text-left px-3.5 py-3 text-[13px] leading-snug text-[var(--color-text-primary)] flex flex-col gap-1 cursor-pointer hover:border-[var(--color-ghost-pink)]/40 transition-colors"
                  >
                    <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--color-ghost-pink)]">
                      {isRetro ? `[${s.kind.toLowerCase()}]` : s.kind}
                    </span>
                    {s.query}
                  </button>
                ))}
              </motion.div>
            </div>
          ) : (
            /* Conversation */
            <div className="space-y-4 max-w-3xl mx-auto">
              {/* Load older messages indicator */}
              {messages.length > MAX_VISIBLE_MESSAGES && (
                <div className="text-center py-2">
                  <span
                    className={`text-xs ${
                      isRetro
                        ? "font-mono text-[var(--color-ghost-pink)]/50"
                        : "text-[var(--color-text-muted)]"
                    }`}
                  >
                    {isRetro
                      ? `[${messages.length - MAX_VISIBLE_MESSAGES} older messages hidden]`
                      : `${messages.length - MAX_VISIBLE_MESSAGES} older messages...`}
                  </span>
                </div>
              )}

              {/* Display messages with limit */}
              {messages.slice(-MAX_VISIBLE_MESSAGES).map((msg, index) => (
                <CasperMessageBubble key={index} message={msg} />
              ))}

              {/* Error state UI */}
              <AnimatePresence>
                {state === "error" && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`
                    flex flex-col items-center gap-4 p-6 rounded-lg
                    ${
                      isRetro
                        ? "border border-red-500/30 bg-red-500/5"
                        : "bg-red-50 dark:bg-red-900/10"
                    }
                  `}
                  >
                    <Casper size={48} variant="sad" />
                    <div className="text-center">
                      <p
                        className={`text-sm mb-2 ${
                          isRetro
                            ? "font-mono text-red-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {isRetro ? "[ERROR]" : "Oops, something went wrong"}
                      </p>
                      <p
                        className={`text-xs max-w-md ${
                          isRetro
                            ? "font-mono text-[var(--color-ghost-pink)]/60"
                            : "text-[var(--color-text-muted)]"
                        }`}
                      >
                        {error ||
                          "An unexpected error occurred. Please try again."}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      {lastQuestion && (
                        <button
                          onClick={retryLastQuestion}
                          className={`
                          flex items-center gap-2 px-4 py-2 text-sm
                          ${
                            isRetro
                              ? "font-mono border border-[var(--color-ghost-pink)]/30 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/10"
                              : "rounded-lg bg-[var(--color-ghost-pink)]/10 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/20"
                          }
                          transition-colors
                        `}
                        >
                          {isRetro ? (
                            "[RETRY]"
                          ) : (
                            <>
                              <RotateCcw size={14} />
                              Retry
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={clearConversation}
                        className={`
                        flex items-center gap-2 px-4 py-2 text-sm
                        ${
                          isRetro
                            ? "font-mono border border-[var(--color-ghost-pink)]/50 bg-[var(--color-ghost-pink)]/10 text-[var(--color-ghost-pink)] hover:bg-[var(--color-ghost-pink)]/20"
                            : "rounded-lg bg-[var(--color-ghost-pink)] text-white hover:bg-[var(--color-ghost-pink)]/90"
                        }
                        transition-colors
                      `}
                      >
                        {isRetro ? (
                          "[START FRESH]"
                        ) : (
                          <>
                            <RefreshCw size={14} />
                            Start Fresh
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Streaming answer */}
              {progress.streamingAnswer && (
                <StreamingMessage content={progress.streamingAnswer} />
              )}

              {/* Thinking indicator */}
              <AnimatePresence>
                {isProcessing && state !== "answering" && (
                  <CasperThinkingIndicator
                    state={state}
                    progress={progress}
                    statusMessage={statusMessage}
                    ghostVariant={ghostVariant}
                  />
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area: in the empty state the input sits in the center */}
        {!isEmpty && <div className="px-4 py-3">{inputForm}</div>}
      </div>
    </div>
  );
}

export default CasperChat;

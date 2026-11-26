/**
 * ToolCallCard - Displays a single tool call with status, args, and results
 *
 * Supports both compact (inline during processing) and expanded views.
 * Dual-mode styling for retro terminal and modern card aesthetics.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Users,
  MessageSquare,
  BarChart2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { useUIMode } from "@/stores/themeStore";
import type { CasperToolCall } from "@/types";
import { SearchResultCards } from "./SearchResultCards";

/** Map tool names to icons */
const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  list_contacts: Users,
  search_messages: Search,
  get_conversation_context: MessageSquare,
  get_contact_stats: BarChart2,
};

/** Map tool names to display names */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  list_contacts: "Finding contacts",
  search_messages: "Searching messages",
  get_conversation_context: "Getting context",
  get_contact_stats: "Analyzing stats",
};

/** Format duration in milliseconds to a human-readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

interface ToolCallCardProps {
  tool: CasperToolCall;
  compact?: boolean;
  defaultExpanded?: boolean;
}

export function ToolCallCard({
  tool,
  compact = false,
  defaultExpanded = false,
}: ToolCallCardProps) {
  const { isRetro } = useUIMode();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const Icon = TOOL_ICONS[tool.toolName] || Search;
  const displayName = TOOL_DISPLAY_NAMES[tool.toolName] || tool.toolName;

  // Status indicator
  const StatusIndicator = () => {
    switch (tool.status) {
      case "running":
        return isRetro ? (
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="text-[var(--color-ghost-pink)]"
          >
            ...
          </motion.span>
        ) : (
          <Loader2
            size={14}
            className="animate-spin text-[var(--color-ghost-pink)]"
          />
        );
      case "success":
        return isRetro ? (
          <span className="text-green-400">OK</span>
        ) : (
          <Check size={14} className="text-green-500" />
        );
      case "error":
        return isRetro ? (
          <span className="text-red-400">ERR</span>
        ) : (
          <X size={14} className="text-red-500" />
        );
      default:
        return null;
    }
  };

  // Compact view for inline display during processing
  if (compact) {
    return (
      <div
        className={`
          flex items-center gap-2 px-3 py-2 text-sm
          ${isRetro ? "font-mono border border-[var(--color-ghost-pink)]/20" : "rounded-lg bg-[var(--color-surface-tertiary)]"}
        `}
        style={
          isRetro ? { background: "rgba(255, 105, 180, 0.08)" } : undefined
        }
      >
        {isRetro ? (
          <>
            <span className="text-[var(--color-ghost-pink)]/60">&gt;</span>
            <span className="text-[var(--color-ghost-pink)]">
              {tool.toolName}
            </span>
            <span className="text-[var(--color-ghost-pink)]/40">
              (
              {Object.keys(tool.arguments).length > 0
                ? JSON.stringify(Object.values(tool.arguments)[0]).slice(0, 20)
                : "..."}
              )
            </span>
            <div className="flex-1" />
            <StatusIndicator />
          </>
        ) : (
          <>
            <Icon size={16} className="text-[var(--color-ghost-pink)]" />
            <span className="text-[var(--color-text-primary)]">
              {displayName}
            </span>
            <div className="flex-1" />
            <StatusIndicator />
          </>
        )}
      </div>
    );
  }

  // Expanded view for tool history
  return (
    <div
      className={`
        ${isRetro ? "font-mono border border-[var(--color-ghost-pink)]/20" : "rounded-lg bg-[var(--color-surface-tertiary)]"}
        overflow-hidden
      `}
      style={isRetro ? { background: "rgba(255, 105, 180, 0.05)" } : undefined}
    >
      {/* Header - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center gap-2 px-3 py-2 text-sm
          ${isRetro ? "hover:bg-[var(--color-ghost-pink)]/10" : "hover:bg-[var(--color-surface-hover)]"}
          transition-colors
        `}
      >
        {isRetro ? (
          <>
            <span className="text-[var(--color-ghost-pink)]/60">
              {isExpanded ? "[-]" : "[+]"}
            </span>
            <span className="text-[var(--color-ghost-pink)]">
              {tool.toolName}
            </span>
            <div className="flex-1" />
            <StatusIndicator />
            {tool.durationMs !== undefined && (
              <span className="text-[var(--color-ghost-pink)]/40 ml-2">
                {formatDuration(tool.durationMs)}
              </span>
            )}
          </>
        ) : (
          <>
            {isExpanded ? (
              <ChevronDown
                size={14}
                className="text-[var(--color-text-muted)]"
              />
            ) : (
              <ChevronRight
                size={14}
                className="text-[var(--color-text-muted)]"
              />
            )}
            <Icon size={16} className="text-[var(--color-ghost-pink)]" />
            <span className="text-[var(--color-text-primary)] font-medium">
              {displayName}
            </span>
            <div className="flex-1" />
            <StatusIndicator />
            {tool.durationMs !== undefined && (
              <span className="text-xs text-[var(--color-text-muted)] ml-2">
                {formatDuration(tool.durationMs)}
              </span>
            )}
          </>
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`
              px-3 pb-2 text-xs overflow-hidden
              ${isRetro ? "text-[var(--color-ghost-pink)]/70" : "text-[var(--color-text-muted)]"}
            `}
          >
            {/* Arguments */}
            {Object.keys(tool.arguments).length > 0 && (
              <div className="mb-2">
                <span className={isRetro ? "opacity-60" : "font-medium"}>
                  {isRetro ? "args: " : "Arguments:"}
                </span>
                <pre
                  className={`
                    mt-1 p-2 rounded overflow-x-auto
                    ${isRetro ? "bg-black/20" : "bg-[var(--color-surface-secondary)]"}
                  `}
                >
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
              </div>
            )}

            {/* Result preview */}
            {tool.resultPreview && (
              <div>
                <span className={isRetro ? "opacity-60" : "font-medium"}>
                  {isRetro ? "result: " : "Result:"}
                </span>
                <pre
                  className={`
                    mt-1 p-2 rounded overflow-x-auto max-h-32
                    ${isRetro ? "bg-black/20" : "bg-[var(--color-surface-secondary)]"}
                  `}
                >
                  {tool.resultPreview}
                </pre>
              </div>
            )}

            {/* Error */}
            {tool.error && (
              <div
                className={`
                  mt-2 p-2 rounded
                  ${isRetro ? "bg-red-500/10 border border-red-500/20" : "bg-red-50"}
                  text-red-500
                `}
              >
                {isRetro ? `[ERROR] ${tool.error}` : tool.error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ToolListItem - A single tool call entry in the ToolList.
 *
 * For search_messages, the row is collapsible and expands to show SearchResultCards.
 */
function ToolListItem({ tool }: { tool: CasperToolCall }) {
  const { isRetro } = useUIMode();
  const [isExpanded, setIsExpanded] = useState(false);

  const Icon = TOOL_ICONS[tool.toolName] || Search;
  const displayName = TOOL_DISPLAY_NAMES[tool.toolName] || tool.toolName;

  const hasResults =
    tool.toolName === "search_messages" &&
    tool.resultPreview &&
    tool.status === "success";

  const query =
    tool.toolName === "search_messages" &&
    typeof tool.arguments?.query === "string"
      ? tool.arguments.query
      : null;

  return (
    <div>
      {/* Tool header row */}
      <button
        onClick={() => hasResults && setIsExpanded(!isExpanded)}
        disabled={!hasResults}
        className={`
          w-full flex items-center gap-2 text-xs
          ${isRetro ? "font-mono" : ""}
          ${hasResults ? "cursor-pointer hover:opacity-80" : "cursor-default"}
          transition-opacity
        `}
      >
        {isRetro ? (
          <>
            {hasResults ? (
              <span className="text-[var(--color-ghost-pink)]/40">
                {isExpanded ? "[-]" : "[+]"}
              </span>
            ) : (
              <span className="text-[var(--color-ghost-pink)]/40">&gt;</span>
            )}
            <span className="text-[var(--color-ghost-pink)]/70">
              {tool.toolName}
            </span>
            {query && (
              <span className="text-[var(--color-ghost-pink)]/40 italic truncate max-w-[150px]">
                &ldquo;{query}&rdquo;
              </span>
            )}
            <span className="flex-1" />
            {tool.status === "success" ? (
              <span className="text-green-400">OK</span>
            ) : tool.status === "error" ? (
              <span className="text-red-400">ERR</span>
            ) : (
              <span className="text-[var(--color-ghost-pink)]/50">...</span>
            )}
            {tool.durationMs !== undefined && (
              <span className="text-[var(--color-ghost-pink)]/30 ml-1">
                {formatDuration(tool.durationMs)}
              </span>
            )}
          </>
        ) : (
          <>
            {hasResults ? (
              isExpanded ? (
                <ChevronDown
                  size={12}
                  className="text-[var(--color-text-muted)] shrink-0"
                />
              ) : (
                <ChevronRight
                  size={12}
                  className="text-[var(--color-text-muted)] shrink-0"
                />
              )
            ) : (
              <Icon
                size={12}
                className="text-[var(--color-ghost-pink)] shrink-0"
              />
            )}
            {hasResults && (
              <Icon
                size={12}
                className="text-[var(--color-ghost-pink)] shrink-0"
              />
            )}
            <span className="text-[var(--color-text-secondary)]">
              {displayName}
            </span>
            {query && (
              <span className="text-[var(--color-text-muted)] italic truncate max-w-[150px]">
                &ldquo;{query}&rdquo;
              </span>
            )}
            <span className="flex-1" />
            {tool.status === "success" ? (
              <Check size={12} className="text-green-500 shrink-0" />
            ) : tool.status === "error" ? (
              <X size={12} className="text-red-500 shrink-0" />
            ) : (
              <Loader2
                size={12}
                className="animate-spin text-[var(--color-ghost-pink)] shrink-0"
              />
            )}
            {tool.durationMs !== undefined && (
              <span className="text-[var(--color-text-muted)] ml-1 shrink-0">
                {formatDuration(tool.durationMs)}
              </span>
            )}
          </>
        )}
      </button>

      {/* Collapsible search results */}
      <AnimatePresence>
        {isExpanded && hasResults && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <SearchResultCards resultPreview={tool.resultPreview!} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * ToolList - Inline display of tool calls with collapsible search results.
 *
 * Shows tools used in a compact format. Search results can be expanded
 * to show the actual message chunks that were found.
 */
interface ToolListProps {
  toolCalls: CasperToolCall[];
}

export function ToolList({ toolCalls }: ToolListProps) {
  const { isRetro } = useUIMode();

  if (toolCalls.length === 0) {
    return null;
  }

  const totalDuration = toolCalls.reduce(
    (sum, t) => sum + (t.durationMs || 0),
    0,
  );

  return (
    <div
      className={`
        mt-3 pt-2
        ${isRetro ? "border-t border-[var(--color-ghost-pink)]/20" : "border-t border-[var(--color-border)]"}
      `}
    >
      {/* Header */}
      <div
        className={`
          flex items-center gap-1 mb-2 text-xs
          ${isRetro ? "text-[var(--color-ghost-pink)]/50 font-mono" : "text-[var(--color-text-muted)]"}
        `}
      >
        {isRetro ? (
          <span>
            [TOOLS: {toolCalls.length}] {formatDuration(totalDuration)}
          </span>
        ) : (
          <span>
            {toolCalls.length} tool{toolCalls.length !== 1 ? "s" : ""} used
            <span className="opacity-50 ml-1">
              ({formatDuration(totalDuration)})
            </span>
          </span>
        )}
      </div>

      {/* Tool items */}
      <div className="flex flex-col gap-1">
        {toolCalls.map((tool, index) => (
          <ToolListItem key={`${tool.toolName}-${index}`} tool={tool} />
        ))}
      </div>
    </div>
  );
}

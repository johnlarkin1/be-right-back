/**
 * ConversationAnalysisModal - Modal for displaying conversation analysis
 *
 * Features:
 * - Table of contents with clickable navigation
 * - Collapsible accordion sections per analysis category
 * - Section icons using Lucide React
 * - Full markdown rendering (lists, bold, italic, quotes)
 * - Re-analyze button for force refresh
 * - Dual UI mode support (retro/modern)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Sparkles } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { Accordion } from "@/components/ui/Accordion";
import { MarkdownRenderer } from "@/components/ui/MarkdownRenderer";
import { useUIMode } from "@/stores/themeStore";
import { formatDate } from "@/lib/format";
import {
  parseAnalysisSections,
  cleanAnalysisMarkdown,
  type AnalysisSection,
} from "@/lib/analysisParser";
import type { ConversationAnalysisResult } from "@/hooks/useConversationAnalysis";
import type { AnalysisPhase } from "@/hooks/useConversationAnalysis";

interface ConversationAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: ConversationAnalysisResult | null;
  contactName: string;
  isGenerating: boolean;
  phase: AnalysisPhase;
  onReanalyze: () => void;
}

/** Phase display names */
const PHASE_LABELS: Record<AnalysisPhase, string> = {
  idle: "",
  loading_model: "Loading model...",
  sampling: "Sampling conversations...",
  formatting: "Formatting messages...",
  extracting_quotes: "Extracting quotes & topics...",
  analyzing_personality: "Generating personality analysis...",
  phase1_complete: "Generating personality analysis...",
  generating: "Generating personality analysis...",
  complete: "Analysis complete",
  error: "Analysis failed",
};

export function ConversationAnalysisModal({
  isOpen,
  onClose,
  analysis,
  contactName,
  isGenerating,
  phase,
  onReanalyze,
}: ConversationAnalysisModalProps) {
  const { isRetro } = useUIMode();
  const [sections, setSections] = useState<AnalysisSection[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const contentRef = useRef<HTMLDivElement>(null);

  // Parse analysis into sections when it changes
  useEffect(() => {
    if (analysis?.analysis_markdown) {
      console.log(
        "[Analysis] Raw markdown length:",
        analysis.analysis_markdown.length,
      );
      console.log(
        "[Analysis] First 200 chars:",
        analysis.analysis_markdown.slice(0, 200),
      );
      const cleaned = cleanAnalysisMarkdown(analysis.analysis_markdown);
      console.log("[Analysis] Cleaned markdown length:", cleaned.length);
      const parsed = parseAnalysisSections(cleaned);
      console.log(
        "[Analysis] Parsed sections:",
        parsed.length,
        parsed.map((s) => s.title),
      );
      setSections(parsed);
      // Expand first section by default
      if (parsed.length > 0) {
        setExpandedSections(new Set([parsed[0].id]));
      }
    } else {
      console.log("[Analysis] No analysisMarkdown in analysis:", analysis);
      setSections([]);
      setExpandedSections(new Set());
    }
  }, [analysis]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Toggle section expansion
  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Expand all sections
  const expandAll = useCallback(() => {
    setExpandedSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  // Collapse all sections
  const collapseAll = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  // Scroll to section and expand it
  const scrollToSection = useCallback((id: string) => {
    // Expand the section first
    setExpandedSections((prev) => new Set([...prev, id]));

    // Wait for animation then scroll
    setTimeout(() => {
      const element = document.getElementById(`section-${id}`);
      if (element && contentRef.current) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-4 md:inset-8 lg:inset-12 z-50 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          >
            <div
              className={`
                w-full max-w-5xl max-h-full flex flex-col overflow-hidden
                bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl
                ${isRetro ? "rounded-sm" : "rounded-2xl"}
              `}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className={`
                  flex items-center justify-between px-6 py-4 shrink-0
                  border-b border-[var(--color-border)]
                  bg-[var(--color-surface-elevated)]
                `}
              >
                <div className="flex items-center gap-3">
                  {isRetro ? (
                    <Ghost size={28} variant="happy" animate={!isGenerating} />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                      <Sparkles
                        size={20}
                        className="text-[var(--color-accent)]"
                      />
                    </div>
                  )}
                  <div>
                    <h2
                      className={`
                        text-lg text-[var(--color-text-primary)]
                        ${isRetro ? "font-mono" : "font-[var(--font-body)] font-semibold"}
                      `}
                    >
                      {contactName}
                    </h2>
                    <p
                      className={`
                        text-xs text-[var(--color-text-muted)]
                        ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                      `}
                    >
                      Personality Analysis
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className={`
                    w-8 h-8 flex items-center justify-center
                    text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                    hover:bg-[var(--color-surface)] transition-colors duration-200
                    ${isRetro ? "rounded-sm font-mono text-xl" : "rounded-lg"}
                  `}
                  aria-label="Close modal"
                >
                  {isRetro ? "x" : <X size={20} />}
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 flex min-h-0 overflow-hidden">
                {isGenerating ? (
                  // Loading state
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
                    {isRetro ? (
                      <Ghost size={48} variant="thinking" animate />
                    ) : (
                      <div className="animate-spin">
                        <RefreshCw
                          size={32}
                          className="text-[var(--color-accent)]"
                        />
                      </div>
                    )}
                    <div className="text-center space-y-2">
                      <p
                        className={`
                          text-sm text-[var(--color-text-primary)]
                          ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                        `}
                      >
                        {PHASE_LABELS[phase] || "Analyzing..."}
                      </p>
                      <p
                        className={`
                          text-xs text-[var(--color-text-muted)]
                          ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                        `}
                      >
                        This may take 2-5 minutes
                      </p>
                    </div>
                    <div
                      className={`
                        w-48 h-1 overflow-hidden
                        bg-[var(--color-border)]
                        ${isRetro ? "rounded-none" : "rounded-full"}
                      `}
                    >
                      <motion.div
                        className="h-full bg-[var(--color-accent)]"
                        initial={{ width: "0%" }}
                        animate={{ width: getProgressWidth(phase) }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                ) : analysis && sections.length > 0 ? (
                  <>
                    {/* Table of Contents Sidebar */}
                    <aside
                      className={`
                        w-56 p-4 overflow-y-auto shrink-0 hidden lg:block
                        border-r border-[var(--color-border)]
                        bg-[var(--color-surface-elevated)]
                      `}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3
                          className={`
                            text-xs text-[var(--color-text-muted)] uppercase tracking-wide
                            ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}
                          `}
                        >
                          Contents
                        </h3>
                        <div className="flex gap-1">
                          <button
                            onClick={expandAll}
                            className={`
                              text-xs px-1 transition-colors
                              text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                              ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                            `}
                            title="Expand all"
                          >
                            {isRetro ? "[+]" : "+"}
                          </button>
                          <button
                            onClick={collapseAll}
                            className={`
                              text-xs px-1 transition-colors
                              text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                              ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                            `}
                            title="Collapse all"
                          >
                            {isRetro ? "[-]" : "-"}
                          </button>
                        </div>
                      </div>
                      <nav className="space-y-1">
                        {sections.map((section) => {
                          const Icon = section.icon;
                          return (
                            <button
                              key={section.id}
                              onClick={() => scrollToSection(section.id)}
                              className={`
                                w-full text-left px-2 py-1.5 text-xs
                                transition-colors duration-150 flex items-center gap-2
                                ${isRetro ? "font-mono rounded-sm" : "font-[var(--font-body)] rounded-md"}
                                ${
                                  expandedSections.has(section.id)
                                    ? "text-[var(--color-text-primary)] bg-[var(--color-accent-subtle)]"
                                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]"
                                }
                              `}
                            >
                              <Icon size={12} className="opacity-60 shrink-0" />
                              <span className="truncate">{section.title}</span>
                            </button>
                          );
                        })}
                      </nav>
                    </aside>

                    {/* Main Content Area */}
                    <div
                      ref={contentRef}
                      className="flex-1 overflow-y-auto p-6 space-y-3"
                    >
                      {/* Mobile TOC (horizontal) */}
                      <div className="lg:hidden mb-4 pb-3 border-b border-[var(--color-border)] overflow-x-auto">
                        <div className="flex gap-2 min-w-max">
                          {sections.map((section) => {
                            const Icon = section.icon;
                            return (
                              <button
                                key={section.id}
                                onClick={() => scrollToSection(section.id)}
                                className={`
                                  px-2 py-1 text-xs whitespace-nowrap
                                  flex items-center gap-1.5 transition-colors
                                  text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                                  border border-[var(--color-border)] hover:border-[var(--color-text-secondary)]
                                  ${isRetro ? "font-mono rounded-sm" : "font-[var(--font-body)] rounded-md"}
                                `}
                              >
                                <Icon size={12} />
                                {section.title}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Accordion Sections */}
                      {sections.map((section) => (
                        <div key={section.id} id={`section-${section.id}`}>
                          <Accordion
                            title={section.title}
                            icon={section.icon}
                            isOpen={expandedSections.has(section.id)}
                            onToggle={() => toggleSection(section.id)}
                          >
                            <MarkdownRenderer content={section.content} />
                          </Accordion>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  // No analysis
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
                    {isRetro ? (
                      <Ghost size={48} variant="sleepy" />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-elevated)] flex items-center justify-center">
                        <Sparkles
                          size={32}
                          className="text-[var(--color-text-muted)]"
                        />
                      </div>
                    )}
                    <p
                      className={`
                        text-sm text-[var(--color-text-muted)]
                        ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                      `}
                    >
                      No analysis available
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              {analysis && !isGenerating && (
                <div
                  className={`
                    flex items-center justify-between px-6 py-4 shrink-0
                    border-t border-[var(--color-border)]
                    bg-[var(--color-surface-elevated)]
                  `}
                >
                  <div
                    className={`
                      text-xs space-x-4 text-[var(--color-text-muted)]
                      ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                    `}
                  >
                    <span>{formatDate(analysis.created_at)}</span>
                    {analysis.generation_duration_secs && (
                      <span>
                        {Math.round(analysis.generation_duration_secs / 60)} min
                      </span>
                    )}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onReanalyze}
                    disabled={isGenerating}
                    className={`
                      px-4 py-2 text-xs transition-colors duration-200
                      disabled:opacity-50 disabled:cursor-not-allowed
                      border text-[var(--color-text-muted)]
                      hover:text-[var(--color-text-primary)]
                      ${
                        isRetro
                          ? "font-mono border-[var(--color-text-primary)]/30 hover:border-[var(--color-text-primary)]/50 rounded-sm"
                          : "font-[var(--font-body)] border-[var(--color-border)] hover:border-[var(--color-text-secondary)] rounded-lg"
                      }
                    `}
                  >
                    Re-analyze
                  </motion.button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Phase order for monotonic progress (never backtracks) */
const PHASE_PROGRESS: Record<AnalysisPhase, number> = {
  idle: 5,
  loading_model: 15,
  sampling: 30,
  formatting: 40,
  extracting_quotes: 55,
  phase1_complete: 65,
  analyzing_personality: 75,
  generating: 85,
  complete: 100,
  error: 100,
};

/** Track highest progress seen to prevent backtracking */
let maxProgressSeen = 0;

/** Get progress bar width based on phase (monotonically increasing) */
function getProgressWidth(phase: AnalysisPhase): string {
  const progress = PHASE_PROGRESS[phase] ?? 10;
  maxProgressSeen = Math.max(maxProgressSeen, progress);
  // Reset when starting a new analysis or completing
  if (phase === "idle" || phase === "complete" || phase === "error") {
    maxProgressSeen = progress;
  }
  return `${maxProgressSeen}%`;
}

export default ConversationAnalysisModal;

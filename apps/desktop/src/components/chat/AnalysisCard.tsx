/**
 * AnalysisCard - Card for conversation analysis section
 *
 * Shows:
 * - Description and CTA button when no analysis exists
 * - Preview and "View Analysis" button when analysis is cached
 * - Loading state during analysis generation
 *
 * Dual-mode: Retro (terminal glow) vs Modern (clean minimal)
 */
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Ghost } from "@/components/Ghost";
import { useUIMode } from "@/stores/themeStore";
import { formatDate } from "@/lib/format";
import type { ConversationAnalysisResult } from "@/hooks/useConversationAnalysis";
import type { AnalysisPhase } from "@/hooks/useConversationAnalysis";

interface AnalysisCardProps {
  analysis: ConversationAnalysisResult | null;
  isGenerating: boolean;
  phase: AnalysisPhase;
  contactName: string;
  onAnalyze: () => void;
  onViewAnalysis: () => void;
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

export function AnalysisCard({
  analysis,
  isGenerating,
  phase,
  contactName,
  onAnalyze,
  onViewAnalysis,
}: AnalysisCardProps) {
  const { isRetro } = useUIMode();

  // Extract preview (first 200 chars of markdown)
  const preview = analysis?.analysis_markdown
    ? extractPreview(analysis.analysis_markdown)
    : null;

  let body: React.ReactNode;
  let action: React.ReactNode = null;
  if (isGenerating) {
    body = (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          {isRetro ? (
            <Ghost size={24} variant="thinking" animate />
          ) : (
            <Loader2
              size={18}
              className="text-[var(--color-accent)] animate-spin"
            />
          )}
          <span className="text-sm">
            {PHASE_LABELS[phase] || "Analyzing..."}
          </span>
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-[var(--color-border)] max-w-md">
          <motion.div
            className="h-full bg-[var(--color-accent)]"
            initial={{ width: "0%" }}
            animate={{ width: getProgressWidth(phase) }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <p className="m-0 text-xs text-[var(--color-text-secondary)]">
          This may take 2-5 minutes on first run while the model loads.
        </p>
      </div>
    );
  } else if (analysis) {
    body = (
      <>
        <p className="m-0 text-sm leading-relaxed text-[var(--color-text-secondary)] line-clamp-3">
          {preview}
        </p>
        <p className="m-0 text-xs text-[var(--color-text-muted)]">
          Generated{" "}
          {formatDate(analysis.created_at, { month: "short", day: "numeric" })}
          {analysis.generation_duration_secs
            ? ` in ${Math.round(analysis.generation_duration_secs / 60)} min`
            : ""}
        </p>
      </>
    );
    action = (
      <button className="btn btn-secondary focus-ring" onClick={onViewAnalysis}>
        {isRetro ? "[view analysis]" : "View analysis"}
      </button>
    );
  } else {
    body = (
      <p className="m-0 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        Not generated yet. Generate a personality analysis of {contactName}{" "}
        based on your conversation history: tone, habits and recurring topics.
      </p>
    );
    action = (
      <button className="btn btn-secondary focus-ring" onClick={onAnalyze}>
        {isRetro ? "[generate]" : "Generate analysis"}
      </button>
    );
  }

  return (
    <section className="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1 flex-[1_1_360px] min-w-0">
        <h2 className="section-title">
          {isRetro ? "[personality analysis]" : "Personality analysis"}
        </h2>
        {body}
      </div>
      {action}
    </section>
  );
}

/** Extract first paragraph or 200 chars for preview */
function extractPreview(markdown: string): string {
  // Remove markdown headers
  const cleaned = markdown.replace(/^#+\s+.+$/gm, "").trim();
  // Get first paragraph
  const firstPara = cleaned.split(/\n\n/)[0];
  // Limit to 200 chars
  if (firstPara.length > 200) {
    return firstPara.slice(0, 200) + "...";
  }
  return firstPara;
}

/** Get progress bar width based on phase */
function getProgressWidth(phase: AnalysisPhase): string {
  switch (phase) {
    case "loading_model":
      return "20%";
    case "sampling":
      return "35%";
    case "formatting":
      return "50%";
    case "generating":
      return "80%";
    case "complete":
      return "100%";
    default:
      return "10%";
  }
}

export default AnalysisCard;

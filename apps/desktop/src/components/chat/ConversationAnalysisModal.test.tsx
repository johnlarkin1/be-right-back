import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { ConversationAnalysisModal } from "./ConversationAnalysisModal";
import type { ConversationAnalysisResult } from "@/hooks/useConversationAnalysis";
import type { AnalysisPhase } from "@/hooks/useConversationAnalysis";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

vi.mock("@/components/ui/Accordion", () => ({
  Accordion: ({ title, isOpen, onToggle, children }: any) => (
    <div data-testid={`accordion-${title}`}>
      <button onClick={onToggle}>{title}</button>
      {isOpen && <div>{children}</div>}
    </div>
  ),
}));

vi.mock("@/components/ui/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: any) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

vi.mock("@/lib/analysisParser", () => ({
  cleanAnalysisMarkdown: (md: string) => md,
  parseAnalysisSections: (md: string) => {
    const sections: any[] = [];
    const regex = /^###\s+(.+?)$/gm;
    let lastTitle = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(md)) !== null) {
      if (lastTitle) {
        sections.push({
          id: lastTitle.toLowerCase().replace(/\s+/g, "-"),
          title: lastTitle,
          icon: () => <span />,
          content: md.slice(lastIndex, match.index).trim(),
        });
      }
      lastTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastTitle) {
      sections.push({
        id: lastTitle.toLowerCase().replace(/\s+/g, "-"),
        title: lastTitle,
        icon: () => <span />,
        content: md.slice(lastIndex).trim(),
      });
    }
    return sections;
  },
}));

const sampleAnalysis: ConversationAnalysisResult = {
  contact_id: "c1",
  analysis_markdown:
    "### Personality Traits\nFriendly and outgoing\n### Communication Style\nCasual and warm",
  model_id: "qwen",
  generation_duration_secs: 180,
  created_at: "2025-06-15T12:00:00Z",
  from_cache: false,
};

function renderModal({
  isOpen = true,
  onClose = vi.fn(),
  analysis = null as ConversationAnalysisResult | null,
  contactName = "Alice",
  isGenerating = false,
  phase = "idle" as AnalysisPhase,
  onReanalyze = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <ConversationAnalysisModal
      isOpen={isOpen}
      onClose={onClose}
      analysis={analysis}
      contactName={contactName}
      isGenerating={isGenerating}
      phase={phase}
      onReanalyze={onReanalyze}
    />,
    { theme },
  );
  return { ...result, onClose, onReanalyze };
}

describe("ConversationAnalysisModal", () => {
  it("renders nothing when isOpen=false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Personality Analysis")).not.toBeInTheDocument();
  });

  it("shows contact name and 'Personality Analysis' when open", () => {
    renderModal({ isOpen: true, analysis: sampleAnalysis });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Personality Analysis")).toBeInTheDocument();
  });

  it("shows loading state with phase label when isGenerating=true", () => {
    renderModal({
      isGenerating: true,
      phase: "sampling",
    });
    expect(screen.getByText("Sampling conversations...")).toBeInTheDocument();
  });

  it("shows 'No analysis available' when analysis is null and not generating", () => {
    renderModal({ analysis: null, isGenerating: false });
    expect(screen.getByText("No analysis available")).toBeInTheDocument();
  });

  it("shows accordion sections when analysis has markdown", () => {
    renderModal({ analysis: sampleAnalysis });
    expect(
      screen.getByTestId("accordion-Personality Traits"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("accordion-Communication Style"),
    ).toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderModal({ analysis: sampleAnalysis });
    const closeButton = screen.getByLabelText("Close modal");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-analyze button calls onReanalyze", () => {
    const { onReanalyze } = renderModal({ analysis: sampleAnalysis });
    fireEvent.click(screen.getByText("Re-analyze"));
    expect(onReanalyze).toHaveBeenCalledTimes(1);
  });

  it("shows 'This may take 2-5 minutes' during generation", () => {
    renderModal({ isGenerating: true, phase: "generating" });
    expect(screen.getByText("This may take 2-5 minutes")).toBeInTheDocument();
  });
});

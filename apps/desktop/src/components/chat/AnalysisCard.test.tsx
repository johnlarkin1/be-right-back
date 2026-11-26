import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { AnalysisCard } from "./AnalysisCard";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
  Casper: ({ variant }: any) => (
    <div data-testid="casper" data-variant={variant} />
  ),
}));

vi.mock("@/hooks/useConversationAnalysis", () => ({}));

type AnalysisPhase =
  | "idle"
  | "loading_model"
  | "sampling"
  | "formatting"
  | "extracting_quotes"
  | "analyzing_personality"
  | "phase1_complete"
  | "generating"
  | "complete"
  | "error";

const defaultProps = {
  analysis: null,
  isGenerating: false,
  phase: "idle" as AnalysisPhase,
  contactName: "Alice",
  onAnalyze: vi.fn(),
  onViewAnalysis: vi.fn(),
};

describe("AnalysisCard", () => {
  it('shows "Personality analysis" heading in modern mode', () => {
    renderWithProviders(<AnalysisCard {...defaultProps} />, {
      theme: "modern",
    });

    expect(screen.getByText("Personality analysis")).toBeInTheDocument();
  });

  it("shows bracketed heading in retro mode", () => {
    renderWithProviders(<AnalysisCard {...defaultProps} />, {
      theme: "retro",
    });

    expect(screen.getByText("[personality analysis]")).toBeInTheDocument();
  });

  it('no analysis: shows "Generate analysis" button and description with contact name', () => {
    renderWithProviders(<AnalysisCard {...defaultProps} />, {
      theme: "modern",
    });

    expect(screen.getByText("Generate analysis")).toBeInTheDocument();
    expect(
      screen.getByText(/Generate a personality analysis of Alice/),
    ).toBeInTheDocument();
  });

  it('clicking "Generate analysis" calls onAnalyze', () => {
    const onAnalyze = vi.fn();
    renderWithProviders(
      <AnalysisCard {...defaultProps} onAnalyze={onAnalyze} />,
      { theme: "modern" },
    );

    fireEvent.click(screen.getByText("Generate analysis"));

    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it('generating: shows phase label and "2-5 minutes" message', () => {
    renderWithProviders(
      <AnalysisCard
        {...defaultProps}
        isGenerating={true}
        phase="loading_model"
      />,
      { theme: "modern" },
    );

    expect(screen.getByText("Loading model...")).toBeInTheDocument();
    expect(screen.getByText(/2-5 minutes/)).toBeInTheDocument();
  });

  it('has analysis: shows preview text and "View analysis" button', () => {
    const analysis = {
      analysis_markdown:
        "This is a detailed personality analysis of the conversation patterns observed.",
      created_at: "2025-01-15T10:00:00Z",
      generation_duration_secs: 180,
    };
    renderWithProviders(
      <AnalysisCard
        {...defaultProps}
        analysis={analysis as any}
        isGenerating={false}
        phase="complete"
      />,
      { theme: "modern" },
    );

    expect(
      screen.getByText(/This is a detailed personality analysis/),
    ).toBeInTheDocument();
    expect(screen.getByText("View analysis")).toBeInTheDocument();
  });

  it('clicking "View analysis" calls onViewAnalysis', () => {
    const onViewAnalysis = vi.fn();
    const analysis = {
      analysis_markdown: "Some analysis text here.",
      created_at: "2025-01-15T10:00:00Z",
      generation_duration_secs: 120,
    };
    renderWithProviders(
      <AnalysisCard
        {...defaultProps}
        analysis={analysis as any}
        isGenerating={false}
        phase="complete"
        onViewAnalysis={onViewAnalysis}
      />,
      { theme: "modern" },
    );

    fireEvent.click(screen.getByText("View analysis"));

    expect(onViewAnalysis).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { CompactStatsBar } from "./CompactStatsBar";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    svg: ({ children, ...props }: any) => <svg {...props}>{children}</svg>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/ui/Tooltip", () => ({
  Tooltip: ({ children }: any) => children,
}));

vi.mock("@/components/ui/tooltipContent", () => ({
  tooltipContent: {
    chunks: "chunks tooltip",
    syncNewMessages: "sync tooltip",
    snapshot: "snap",
    vectors: "vec",
    total: "tot",
    response: "resp",
    active: "act",
    topics: "top",
  },
}));

const defaultProps = {
  messageCount: 500,
  contactCount: 25,
  chunkCount: 300,
  lastSnapshot: null as string | null,
};

describe("CompactStatsBar", () => {
  it("renders message count, contact count, and chunk count", () => {
    renderWithProviders(<CompactStatsBar {...defaultProps} />);

    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("messages")).toBeInTheDocument();
    expect(screen.getByText("contacts")).toBeInTheDocument();
    expect(screen.getByText("chunks")).toBeInTheDocument();
  });

  it("formats large numbers (1000 -> 1.0K, 1500000 -> 1.5M)", () => {
    renderWithProviders(
      <CompactStatsBar
        {...defaultProps}
        messageCount={1000}
        contactCount={1500000}
        chunkCount={500}
      />,
    );

    expect(screen.getByText("1.0K")).toBeInTheDocument();
    expect(screen.getByText("1.5M")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows last snapshot date when provided", () => {
    renderWithProviders(
      <CompactStatsBar {...defaultProps} lastSnapshot="2025-01-15" />,
    );

    expect(screen.getByText("2025-01-15")).toBeInTheDocument();
    expect(screen.getByText("updated")).toBeInTheDocument();
  });

  it("shows storage stats when provided", () => {
    renderWithProviders(
      <CompactStatsBar
        {...defaultProps}
        snapshotSize="25.0 MB"
        embeddingsSize="50.0 MB"
        totalSize="75.0 MB"
      />,
    );

    expect(screen.getByText("25.0 MB")).toBeInTheDocument();
    expect(screen.getByText("50.0 MB")).toBeInTheDocument();
    expect(screen.getByText("75.0 MB")).toBeInTheDocument();
    expect(screen.getByText("snapshot")).toBeInTheDocument();
    expect(screen.getByText("vectors")).toBeInTheDocument();
    expect(screen.getByText("total")).toBeInTheDocument();
  });

  it('shows "Sync New Messages" button when onRefresh provided', () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <CompactStatsBar {...defaultProps} onRefresh={onRefresh} />,
    );

    expect(screen.getByText("Sync New Messages")).toBeInTheDocument();
  });

  it("click refresh opens confirmation modal", () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <CompactStatsBar {...defaultProps} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByText("Sync New Messages"));

    // Modal should now be visible with confirm/cancel buttons
    expect(screen.getByText("Start Sync")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("confirm starts refresh (calls onRefresh)", () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <CompactStatsBar {...defaultProps} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByText("Sync New Messages"));
    fireEvent.click(screen.getByText("Start Sync"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("cancel closes modal without calling onRefresh", () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <CompactStatsBar {...defaultProps} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByText("Sync New Messages"));
    expect(screen.getByText("Start Sync")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));

    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Start Sync")).not.toBeInTheDocument();
  });

  it('shows "Syncing..." when isRefreshing=true', () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <CompactStatsBar
        {...defaultProps}
        onRefresh={onRefresh}
        isRefreshing={true}
      />,
    );

    expect(screen.getByText("Syncing...")).toBeInTheDocument();
  });
});

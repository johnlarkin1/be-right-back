import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { InsightsHeader } from "./InsightsHeader";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));

vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

vi.mock("@/components/settings/IngestionSettingsModal", () => ({
  IngestionSettingsModal: () => null,
}));

vi.mock("@/components/ui/Tooltip", () => ({
  Tooltip: ({ children }: any) => children,
}));

vi.mock("@/components/ui/tooltipContent", () => ({
  tooltipContent: { reanalyze: "re-analyze tooltip" },
}));

describe("InsightsHeader", () => {
  it("renders the bracketed title in retro mode", () => {
    renderWithProviders(<InsightsHeader />, { theme: "retro" });

    expect(screen.getByText("[insights]")).toBeInTheDocument();
  });

  it("renders the title and subtitle in modern mode", () => {
    renderWithProviders(
      <InsightsHeader subtitle="Patterns across 3 contacts." />,
      {
        theme: "modern",
      },
    );

    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("Patterns across 3 contacts.")).toBeInTheDocument();
  });

  it("range control marks the current range and reports clicks", () => {
    const onRangeChange = vi.fn();
    renderWithProviders(
      <InsightsHeader range="all" onRangeChange={onRangeChange} />,
      { theme: "modern" },
    );

    expect(screen.getByText("All time")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByText("Last 365 days"));
    expect(onRangeChange).toHaveBeenCalledWith("year");
  });

  it("hides the range control without onRangeChange", () => {
    renderWithProviders(<InsightsHeader />, { theme: "modern" });

    expect(screen.queryByText("Last 365 days")).not.toBeInTheDocument();
  });

  it("shows re-analyze button with retro text", () => {
    renderWithProviders(<InsightsHeader />, { theme: "retro" });

    expect(screen.getByText("[Re-analyze]")).toBeInTheDocument();
  });

  it("shows re-analyze button with modern text", () => {
    renderWithProviders(<InsightsHeader />, { theme: "modern" });

    expect(screen.getByText("Re-analyze")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { createInsightsStats } from "@/test/fixtures";
import { StatsRow } from "./StatsRow";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("./useInsightsStats", () => ({
  useInsightsStats: vi.fn(),
}));

vi.mock("@/components/ui/Tooltip", () => ({
  Tooltip: ({ children }: any) => children,
}));

vi.mock("@/components/ui/tooltipContent", () => ({
  tooltipContent: { response: "resp", active: "act", topics: "top" },
}));

import { useInsightsStats } from "./useInsightsStats";
const mockUseInsightsStats = vi.mocked(useInsightsStats);

beforeEach(() => {
  mockUseInsightsStats.mockReturnValue({
    stats: createInsightsStats(),
    isLoading: false,
    error: null,
  });
});

/** Text of each big stat value, e.g. ["12.5K", "15 min", ...]. */
function statValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".stat-value")).map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

describe("StatsRow", () => {
  it("renders 4 stat tiles with modern labels", () => {
    renderWithProviders(<StatsRow />, { theme: "modern" });

    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("Your reply time")).toBeInTheDocument();
    expect(screen.getByText("Active days")).toBeInTheDocument();
    expect(screen.getByText("Topics")).toBeInTheDocument();
  });

  it("formats each value with its unit", () => {
    const { container } = renderWithProviders(<StatsRow />);

    expect(statValues(container)).toEqual([
      "12.5K",
      "15 min",
      "365 days",
      "25",
    ]);
  });

  it("loading state shows skeleton cards", () => {
    mockUseInsightsStats.mockReturnValue({
      stats: null as any,
      isLoading: true,
      error: null,
    });

    const { container } = renderWithProviders(<StatsRow />);

    const skeletons = container.querySelectorAll(".insights-stat-skeleton");
    expect(skeletons).toHaveLength(4);

    const loadingCards = container.querySelectorAll(".insights-stat-loading");
    expect(loadingCards).toHaveLength(4);
  });

  it("retro mode shows terminal-style labels", () => {
    renderWithProviders(<StatsRow />, { theme: "retro" });

    expect(screen.getByText("MESSAGES")).toBeInTheDocument();
    expect(screen.getByText("REPLY_TIME")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE_DAYS")).toBeInTheDocument();
    expect(screen.getByText("TOPICS")).toBeInTheDocument();
  });
});

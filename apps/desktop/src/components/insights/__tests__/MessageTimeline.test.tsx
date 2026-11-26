import { describe, it, expect, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render } from "@testing-library/react";
import type { AggregatedCount } from "@/types";
import { MessageTimeline } from "../MessageTimeline";

// jsdom has no layout, so hand the chart a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  // Bars grow from zero height while animating, so skip the animation.
  actual.Bar.defaultProps = {
    ...actual.Bar.defaultProps,
    isAnimationActive: false,
  };
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 800, height: 160 } as object),
  };
});

const rows: AggregatedCount[] = [
  {
    period: "2024-01-01",
    display_period: "Jan 2024",
    from_me: 120,
    from_them: 80,
    total: 200,
    aggregation_type: "monthly",
  },
  {
    period: "2024-02-01",
    display_period: "Feb 2024",
    from_me: 60,
    from_them: 140,
    total: 200,
    aggregation_type: "monthly",
  },
];

vi.mock("../useTimelineData", () => ({
  useTimelineData: () => ({
    timelineData: rows,
    aggregationType: "monthly",
    isLoading: false,
    error: null,
  }),
}));

describe("MessageTimeline", () => {
  it("draws a sent and a received bar for each period", () => {
    const { container } = render(
      <MessageTimeline brushRange={null} onBrushChange={() => {}} />,
    );
    // Two periods x two stacked series. Zero bars means a data key does
    // not match the snake_case fields on AggregatedCount.
    const bars = container.querySelectorAll(
      ".recharts-bar-rectangle path, .recharts-bar-rectangle rect",
    );
    expect(bars.length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain("Jan 2024");
  });
});

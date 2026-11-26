import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { configureInvoke } from "@/test/mocks/tauri";
import { useCasperDraftStore } from "@/stores/casperDraftStore";
import {
  DayPanel,
  casperQuestion,
  dayPeriod,
  formatDayTitle,
  formatPeriodTitle,
  timelinePeriod,
} from "./DayPanel";
import type { DayDetails } from "@/types";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));

vi.mock("framer-motion", () => ({
  motion: {
    aside: ({
      children,
      initial,
      animate,
      exit,
      transition,
      ...props
    }: any) => <aside {...props}>{children}</aside>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

const day: DayDetails = {
  date: "2024-06-02",
  end_date: "2024-06-02",
  sent: 5,
  received: 6,
  contacts: [
    { contact_id: "a", name: "Alice", sent: 4, received: 6 },
    { contact_id: "b", name: "Bob", sent: 1, received: 0 },
  ],
  topics: [
    { cluster_id: 0, label: "Dinner plans", chunks: 2 },
    { cluster_id: 1, label: "**Leaked**", chunks: 1 },
  ],
  words: [{ word: "pizza", count: 3, weight: 1 }],
  snippets: [
    { name: "Alice", preview: "pizza tonight?", at: "2024-06-02T15:00:00Z" },
  ],
};

beforeEach(() => {
  configureInvoke("get_day_details", day);
  useCasperDraftStore.setState({ draft: null });
});

describe("DayPanel", () => {
  it("renders nothing when no day is selected", () => {
    renderWithProviders(<DayPanel period={null} onClose={vi.fn()} />, {
      theme: "modern",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows totals, people, topics, words and moments for the day", async () => {
    renderWithProviders(
      <DayPanel period={dayPeriod("2024-06-02")} onClose={vi.fn()} />,
      {
        theme: "modern",
      },
    );

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
    expect(screen.getByText(formatDayTitle("2024-06-02"))).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Dinner plans")).toBeInTheDocument();
    // A label with leaked markdown is hidden, as on the topic map
    expect(screen.getByText("Unnamed topic")).toBeInTheDocument();
    expect(screen.getByText("pizza tonight?")).toBeInTheDocument();
  });

  it("shows an empty message for a day without messages", async () => {
    configureInvoke("get_day_details", {
      ...day,
      sent: 0,
      received: 0,
      contacts: [],
    });
    renderWithProviders(
      <DayPanel period={dayPeriod("2024-06-02")} onClose={vi.fn()} />,
      {
        theme: "modern",
      },
    );
    await waitFor(() => {
      expect(screen.getByText("No messages this day.")).toBeInTheDocument();
    });
  });

  it("closes from the close button and from Escape", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <DayPanel period={dayPeriod("2024-06-02")} onClose={onClose} />,
      {
        theme: "modern",
      },
    );
    fireEvent.click(screen.getByLabelText("Close day details"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("hands Casper a question about the day", () => {
    const onAskCasper = vi.fn();
    renderWithProviders(
      <DayPanel
        period={dayPeriod("2024-06-02")}
        onClose={vi.fn()}
        onAskCasper={onAskCasper}
      />,
      { theme: "modern" },
    );
    fireEvent.click(screen.getByText("Ask Casper about this day"));
    expect(useCasperDraftStore.getState().draft).toBe(
      `What did I talk about on ${formatDayTitle("2024-06-02")}?`,
    );
    expect(onAskCasper).toHaveBeenCalled();
  });
});

describe("timelinePeriod", () => {
  it("maps a daily bar to its day", () => {
    expect(timelinePeriod("2024-06-05", "daily")).toEqual(
      dayPeriod("2024-06-05"),
    );
  });

  it("maps a weekly bar to its Monday-to-Sunday week", () => {
    // 2024-06-05 is a Wednesday
    expect(timelinePeriod("2024-06-05", "weekly")).toEqual({
      kind: "week",
      start: "2024-06-03",
      end: "2024-06-09",
    });
    // A Sunday belongs to the week that started the Monday before
    expect(timelinePeriod("2024-06-09", "weekly").start).toBe("2024-06-03");
  });

  it("maps a monthly bar to the whole month", () => {
    expect(timelinePeriod("2024-02-12", "monthly")).toEqual({
      kind: "month",
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("titles and asks about each kind of period", () => {
    const week = timelinePeriod("2024-06-05", "weekly");
    expect(formatPeriodTitle(week)).toMatch(/^Week of /);
    expect(casperQuestion(week)).toMatch(
      /^What did I talk about in the week of .+\?$/,
    );
    const month = timelinePeriod("2024-02-12", "monthly");
    expect(casperQuestion(month)).toBe(
      `What did I talk about in ${formatPeriodTitle(month)}?`,
    );
  });
});

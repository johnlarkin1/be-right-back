import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import type {
  ReactedMessage,
  TapbackContact,
  TapbackMonth,
  TapbackSummary,
} from "@/bindings/ingestion";
import { TapbacksSection } from "./TapbacksSection";
import { balanceLabel } from "./TapbackPeople";
import { pivotMonths } from "./TapbackMonthlyChart";
import { groupOf, windowFromRange } from "./kinds";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock("./useTapbacks", () => ({
  TOP_PEOPLE: 8,
  useTapbacks: vi.fn(),
}));

import { useTapbacks } from "./useTapbacks";
const mockUseTapbacks = vi.mocked(useTapbacks);

const summary: TapbackSummary = {
  given: 30,
  received: 12,
  by_kind: [
    { kind: "love", given: 20, received: 8 },
    { kind: "laugh", given: 10, received: 4 },
  ],
};
const people: TapbackContact[] = [
  {
    contact_id: "+1555",
    display_name: "Sam",
    given: 21,
    received: 10,
    top_given_kind: "love",
    top_received_kind: "laugh",
  },
];
const months: TapbackMonth[] = [
  { period: "2024-01", kind: "love", given: 5, received: 1 },
  { period: "2024-01", kind: "question", given: 2, received: 0 },
  { period: "2023-12", kind: "laugh", given: 1, received: 3 },
];

const loved: ReactedMessage[] = [
  {
    message_rowid: 100,
    text: "see you at 6",
    sent_at: 1_706_745_600,
    contact_id: null,
    contact_name: null,
    tapbacks: 5,
    people: 4,
    kinds: [{ kind: "love", given: 0, received: 3 }],
  },
];

beforeEach(() => {
  mockUseTapbacks.mockReturnValue({
    summary,
    people,
    months,
    loved,
    emojis: [{ emoji: "🫠", given: 3, received: 1 }],
    isLoading: false,
    error: null,
  });
});

describe("TapbacksSection", () => {
  it("shows the kind mix and the people table", () => {
    renderWithProviders(<TapbacksSection dateRange={null} />, {
      theme: "modern",
    });

    expect(screen.getByText("Tapbacks")).toBeInTheDocument();
    expect(screen.getByText("You gave 30")).toBeInTheDocument();
    expect(screen.getByText("You got 12")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("You 2.1×")).toBeInTheDocument();
  });

  it("lists most-loved messages and emoji Tapbacks", () => {
    renderWithProviders(<TapbacksSection dateRange={null} />, {
      theme: "modern",
    });
    expect(screen.getByText("see you at 6")).toBeInTheDocument();
    expect(screen.getByText("5 Tapbacks from 4 people")).toBeInTheDocument();
    expect(screen.getByText(/in a group chat/)).toBeInTheDocument();
    expect(screen.getByText("🫠")).toBeInTheDocument();
  });

  it("asks for a re-ingest when there are no Tapbacks", () => {
    mockUseTapbacks.mockReturnValue({
      summary: { given: 0, received: 0, by_kind: [] },
      people: [],
      months: [],
      loved: [],
      emojis: [],
      isLoading: false,
      error: null,
    });
    renderWithProviders(<TapbacksSection dateRange={null} />);
    expect(screen.getByText(/Re-run ingestion/)).toBeInTheDocument();
  });

  it("uses a bracket title in retro mode", () => {
    renderWithProviders(<TapbacksSection dateRange={null} />, {
      theme: "retro",
    });
    expect(screen.getByText("[tapbacks]")).toBeInTheDocument();
  });
});

describe("tapback helpers", () => {
  it("labels the balance between two people", () => {
    expect(balanceLabel(21, 10)).toBe("You 2.1×");
    expect(balanceLabel(10, 30)).toBe("Them 3.0×");
    expect(balanceLabel(10, 11)).toBe("Even");
    expect(balanceLabel(4, 0)).toBe("Only you");
  });

  it("folds rare kinds into other and sorts months", () => {
    expect(groupOf("love")).toBe("love");
    expect(groupOf("question")).toBe("other");
    const rows = pivotMonths(months, "given");
    expect(rows.map((r) => r.period)).toEqual(["2023-12", "2024-01"]);
    expect(rows[1]).toMatchObject({ love: 5, other: 2, total: 7 });
  });

  it("turns a brush range into an inclusive unix window", () => {
    const w = windowFromRange({
      startDate: "2024-01-01",
      endDate: "2024-01-01",
      startIndex: 0,
      endIndex: 0,
    });
    expect(w.end! - w.start!).toBe(86_399);
    expect(windowFromRange(null)).toEqual({ start: null, end: null });
  });
});

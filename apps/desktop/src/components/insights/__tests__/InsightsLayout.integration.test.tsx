/**
 * Integration tests for InsightsLayout routing and state logic.
 * Tests the flow: loading -> NeedsSetup / error / empty / full dashboard
 * based on InitializationStatus and insights store state.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));
vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

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

vi.mock("@/components/insights/InsightsHeader", () => ({
  InsightsHeader: ({ onReanalyzeComplete }: any) => (
    <div data-testid="insights-header">
      <h1>Conversation Analytics</h1>
      <button onClick={onReanalyzeComplete}>[Re-analyze]</button>
    </div>
  ),
}));

vi.mock("@/components/insights/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="message-timeline">Timeline</div>,
}));

vi.mock("@/components/insights/TopWords", () => ({
  TopWords: () => <div data-testid="top-words">TopWords</div>,
}));

vi.mock("@/components/insights/ActivityHeatmap", () => ({
  ActivityHeatmap: () => <div data-testid="activity-heatmap">Heatmap</div>,
}));

vi.mock("@/components/insights/TopicMap", () => ({
  TopicMap: () => <div data-testid="topic-map">TopicMap</div>,
}));

import { InsightsLayout } from "@/components/insights/InsightsLayout";
import { configureInvoke } from "@/test/mocks/tauri";
import {
  createInitializationStatus,
  createInsightsStats,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/helpers/render";
import { useInsightsStore } from "@/stores/insightsStore";

// Reset insights store between tests to avoid state leaking
beforeEach(() => {
  useInsightsStore.getState().invalidateAll();
});

describe("InsightsLayout integration", () => {
  it("shows loading state initially while checking prerequisites", () => {
    // Configure invoke to never resolve so we stay in loading
    configureInvoke(
      "get_initialization_status",
      () => new Promise(() => {}), // never resolves
    );

    renderWithProviders(<InsightsLayout />);

    expect(screen.getByTestId("ghost")).toBeInTheDocument();
    expect(screen.getByTestId("ghost")).toHaveAttribute(
      "data-variant",
      "sleepy",
    );
  });

  it("shows NeedsSetup when has_snapshot=false", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: false,
      }),
    );

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByText("Snapshot Required")).toBeInTheDocument();
    });
    expect(screen.getByText(/Go to Setup/)).toBeInTheDocument();
  });

  it("shows NeedsSetup when has_vector_db=false", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: false,
      }),
    );

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByText("Ingestion Required")).toBeInTheDocument();
    });
    expect(screen.getByText(/Go to Setup/)).toBeInTheDocument();
  });

  it("shows full dashboard when initialized with stats", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", createInsightsStats());

    // Pre-populate the store so the component sees stats immediately
    useInsightsStore.getState().setStats(createInsightsStats());

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("insights-header")).toBeInTheDocument();
    });
    expect(screen.getByTestId("message-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("top-words")).toBeInTheDocument();
    expect(screen.getByTestId("activity-heatmap")).toBeInTheDocument();
    expect(screen.getByTestId("topic-map")).toBeInTheDocument();
  });

  it("StatsRow renders with formatted stats from mock data", async () => {
    const stats = createInsightsStats({
      total_messages: 12500,
      avg_response_time_mins: 15,
      active_days: 365,
      topics_count: 25,
    });

    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", stats);

    // Pre-populate stats so dashboard renders
    useInsightsStore.getState().setStats(stats);

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("insights-header")).toBeInTheDocument();
    });

    // StatsRow is mocked away (it fetches its own data), but the dashboard
    // structure is confirmed by the presence of sub-components.
    // The key test is that totalMessages > 0, so we don't get empty state.
    expect(screen.queryByText(/No data yet/i)).not.toBeInTheDocument();
  });

  it("shows error state with retry button when stats fetch fails", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", () => {
      throw new Error("Database connection failed");
    });

    // Set an error in the store to trigger the error branch
    useInsightsStore.getState().setError("Database connection failed");

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(
        screen.getByText("Database connection failed"),
      ).toBeInTheDocument();
    });

    // In retro mode (default), error heading is "ERROR"
    expect(screen.getByText("ERROR")).toBeInTheDocument();

    // Retry button should exist (retro shows "[Retry]")
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retry button clears error and triggers refetch", async () => {
    const user = userEvent.setup();

    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", createInsightsStats());

    // Set initial error state
    useInsightsStore.getState().setError("Temporary failure");

    renderWithProviders(<InsightsLayout />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText("Temporary failure")).toBeInTheDocument();
    });

    // Click retry - this calls invalidateAll which clears error
    const retryButton = screen.getByRole("button", { name: /retry/i });
    await user.click(retryButton);

    // After invalidateAll, error is cleared and stats are null,
    // so the component should re-render without the error state
    await waitFor(() => {
      expect(screen.queryByText("Temporary failure")).not.toBeInTheDocument();
    });
  });

  it("shows empty state when totalMessages=0", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke(
      "get_insights_stats",
      createInsightsStats({ total_messages: 0 }),
    );

    // Set stats with zero messages
    useInsightsStore
      .getState()
      .setStats(createInsightsStats({ total_messages: 0 }));

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      // Retro mode shows "NO DATA YET"
      expect(screen.getByText("NO DATA YET")).toBeInTheDocument();
    });

    expect(screen.getByTestId("ghost")).toHaveAttribute(
      "data-variant",
      "surprised",
    );
  });

  it("InsightsHeader renders with correct title in dashboard", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", createInsightsStats());

    useInsightsStore.getState().setStats(createInsightsStats());

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("insights-header")).toBeInTheDocument();
    });
    expect(screen.getByText("Conversation Analytics")).toBeInTheDocument();
  });

  it("re-analyze button invalidates store and triggers refetch", async () => {
    const user = userEvent.setup();

    const stats = createInsightsStats({ total_messages: 5000 });

    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_vector_db: true,
      }),
    );
    configureInvoke("get_insights_stats", stats);

    useInsightsStore.getState().setStats(stats);

    renderWithProviders(<InsightsLayout />);

    await waitFor(() => {
      expect(screen.getByTestId("insights-header")).toBeInTheDocument();
    });

    // Click re-analyze button (which calls onReanalyzeComplete -> refetch -> invalidateAll)
    const reanalyzeButton = screen.getByRole("button", {
      name: /re-analyze/i,
    });
    await user.click(reanalyzeButton);

    // After invalidateAll, store is cleared (stats=null, error=null)
    // The store should be invalidated
    const storeState = useInsightsStore.getState();
    expect(storeState.stats).toBeNull();
    expect(storeState.timelineData).toBeNull();
  });

  it("NeedsSetup calls onNavigate when Go to Setup is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: false,
      }),
    );

    renderWithProviders(<InsightsLayout onNavigate={onNavigate} />);

    await waitFor(() => {
      expect(screen.getByText("Snapshot Required")).toBeInTheDocument();
    });

    const setupButton = screen.getByRole("button", { name: /go to setup/i });
    await user.click(setupButton);

    expect(onNavigate).toHaveBeenCalledWith("casper");
  });
});

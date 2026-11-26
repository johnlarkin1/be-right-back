/**
 * Integration tests for HomeLayout routing logic.
 * Tests the flow: loading -> error/WelcomeView/DashboardView
 * based on InitializationStatus from the backend.
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

vi.mock("@/components/home/WelcomeView", () => ({
  WelcomeView: ({ initStatus }: any) => (
    <div data-testid="welcome-view">
      Welcome - Stage: {initStatus.current_stage}
    </div>
  ),
}));

vi.mock("@/components/home/DashboardView", () => ({
  DashboardView: ({ initStatus, onNavigate }: any) => (
    <div data-testid="dashboard-view">
      Dashboard - Messages: {initStatus.snapshot_message_count}
      <button onClick={() => onNavigate("chat")}>Go to Chat</button>
    </div>
  ),
}));

import { HomeLayout } from "@/components/home/HomeLayout";
import { configureInvoke } from "@/test/mocks/tauri";
import { createInitializationStatus } from "@/test/fixtures";
import { renderWithProviders } from "@/test/helpers/render";

describe("HomeLayout integration", () => {
  it("shows loading state initially while fetching status", () => {
    // Configure invoke to never resolve so we stay in loading
    configureInvoke(
      "get_initialization_status",
      () => new Promise(() => {}), // never resolves
    );

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows WelcomeView when has_snapshot=false", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: false,
        has_sqlite_db: false,
        current_stage: "snapshot",
      }),
    );

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
    });
    expect(screen.getByText(/Stage: snapshot/)).toBeInTheDocument();
  });

  it("shows WelcomeView when has_sqlite_db=false (has snapshot but no ingestion)", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_sqlite_db: false,
        current_stage: "ingestion",
      }),
    );

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("welcome-view")).toBeInTheDocument();
    });
    expect(screen.getByText(/Stage: ingestion/)).toBeInTheDocument();
  });

  it("shows DashboardView when has_snapshot=true AND has_sqlite_db=true", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_sqlite_db: true,
        snapshot_message_count: 9999,
      }),
    );

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });
    expect(screen.getByText(/Messages: 9999/)).toBeInTheDocument();
  });

  it("shows error state when invoke fails", async () => {
    configureInvoke("get_initialization_status", () => {
      throw new Error("Backend down");
    });

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load status")).toBeInTheDocument();
    });
    expect(screen.getByText("Backend down")).toBeInTheDocument();
  });

  it("error state has Retry button that re-fetches", async () => {
    const user = userEvent.setup();

    let callCount = 0;
    configureInvoke("get_initialization_status", () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Backend down");
      }
      return createInitializationStatus({
        has_snapshot: true,
        has_sqlite_db: true,
      });
    });

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText("Failed to load status")).toBeInTheDocument();
    });

    // Click retry
    const retryButton = screen.getByRole("button", { name: /retry/i });
    await user.click(retryButton);

    // Should now show dashboard
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });
  });

  it("DashboardView receives initStatus data", async () => {
    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_sqlite_db: true,
        snapshot_message_count: 42000,
      }),
    );

    renderWithProviders(<HomeLayout onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });
    expect(screen.getByText(/Messages: 42000/)).toBeInTheDocument();
  });

  it("DashboardView onNavigate callback works", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    configureInvoke(
      "get_initialization_status",
      createInitializationStatus({
        has_snapshot: true,
        has_sqlite_db: true,
      }),
    );

    renderWithProviders(<HomeLayout onNavigate={onNavigate} />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /go to chat/i }));
    expect(onNavigate).toHaveBeenCalledWith("chat");
  });
});

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { emitMockEvent, mockListen } from "@/test/mocks/tauriEvent";
import { renderWithProviders } from "@/test/helpers/render";
import { IngestionProgress } from "./IngestionProgress";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => children,
  useReducedMotion: () => false,
}));

vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
  Casper: ({ variant }: any) => (
    <div data-testid="casper" data-variant={variant} />
  ),
}));

vi.mock("@/components/ModeAwareMascot", () => ({
  ModeAwareMascot: ({ variant }: any) => (
    <div data-testid="mascot" data-variant={variant} />
  ),
}));

const defaultStages = [
  {
    stage: "snapshot" as const,
    percent: 100,
    status: "completed" as const,
    message: "Done",
  },
  {
    stage: "parsing" as const,
    percent: 100,
    status: "completed" as const,
    message: "Done",
  },
  {
    stage: "chunking" as const,
    percent: 50,
    status: "in_progress" as const,
    message: "Chunking...",
  },
  {
    stage: "embedding" as const,
    percent: 0,
    status: "pending" as const,
    message: "",
  },
  {
    stage: "saving" as const,
    percent: 0,
    status: "pending" as const,
    message: "",
  },
  {
    stage: "analyzing" as const,
    percent: 0,
    status: "pending" as const,
    message: "",
  },
];

const defaultStats = {
  messagesProcessed: 500,
  totalMessages: 1000,
  contactsProcessed: 5,
  totalContacts: 10,
  currentContact: null,
  chunksCreated: 200,
  chunksEmbedded: 100,
  elapsedSecs: 45,
  estimatedRemainingSecs: 30,
};

describe("IngestionProgress", () => {
  it("renders all 6 stage labels", () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
      />,
    );

    expect(screen.getByText("Creating snapshot")).toBeInTheDocument();
    expect(screen.getByText("Parsing messages")).toBeInTheDocument();
    expect(screen.getByText("Chunking messages")).toBeInTheDocument();
    expect(screen.getByText("Embedding messages")).toBeInTheDocument();
    expect(screen.getByText("Saving results")).toBeInTheDocument();
    expect(screen.getByText("Analyzing patterns")).toBeInTheDocument();
  });

  it("shows percentage for each stage", () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
      />,
    );

    // Two stages at 100%, one at 50%, three at 0%
    const allPercentTexts = screen.getAllByText(/^\d+%$/);
    expect(allPercentTexts).toHaveLength(6);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("shows error state with error message when error prop is set", () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
        error="Disk full"
      />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Disk full")).toBeInTheDocument();
    // Stage labels should NOT render in error state
    expect(screen.queryByText("Creating snapshot")).not.toBeInTheDocument();
  });

  it("shows elapsed time and estimated remaining", () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
        isRunning={true}
      />,
    );

    expect(screen.getByText(/45s elapsed/)).toBeInTheDocument();
    expect(screen.getByText(/~30s remaining/)).toBeInTheDocument();
  });

  it("shows cancel button when isRunning=true and onCancel provided", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
        isRunning={true}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Cancel Ingestion")).toBeInTheDocument();
  });

  it("shows the resource strip while running and expands on click", async () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
        isRunning={true}
      />,
    );
    await waitFor(() =>
      expect(mockListen).toHaveBeenCalledWith(
        "system-resources",
        expect.any(Function),
      ),
    );

    act(() =>
      emitMockEvent("system-resources", {
        ts_ms: 1,
        cpu_pct: 42,
        cpu_cores: [40, 44],
        mem_used: 8 * 1024 ** 3,
        mem_total: 16 * 1024 ** 3,
        swap_used: 0,
        swap_total: 0,
        pressure: "warn",
        gpu_pct: 84,
        gpu_mem: 1024 ** 3,
        procs: [{ pid: 7, name: "python", cpu_pct: 90, rss: 1024 ** 3 }],
      }),
    );

    const strip = await screen.findByRole("button", { name: /GPU/ });
    expect(strip).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("warn pressure")).toBeInTheDocument();

    fireEvent.click(strip);
    expect(strip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("python")).toBeInTheDocument();
  });

  it("hides the resource strip when not running", () => {
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage={null}
        stats={defaultStats}
        isRunning={false}
      />,
    );
    expect(screen.queryByText(/Waiting for resource data/)).toBeNull();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={defaultStats}
        isRunning={true}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText("Cancel Ingestion"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows "All done!" message when isComplete=true', () => {
    const completedStages = defaultStages.map((s) => ({
      ...s,
      percent: 100,
      status: "completed" as const,
      message: "Done",
    }));

    renderWithProviders(
      <IngestionProgress
        stages={completedStages}
        currentStage={null}
        stats={defaultStats}
        isComplete={true}
      />,
    );

    expect(screen.getByText("All done!")).toBeInTheDocument();
  });

  it("shows current contact name when stats.currentContact is provided", () => {
    const statsWithContact = {
      ...defaultStats,
      currentContact: {
        contact_id: "c1",
        contact_name: "Alice Smith",
        messages_in_contact: 100,
        chunks_for_contact: 25,
      },
    };

    renderWithProviders(
      <IngestionProgress
        stages={defaultStages}
        currentStage="chunking"
        stats={statsWithContact}
      />,
    );

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("25 chunks")).toBeInTheDocument();
  });
});

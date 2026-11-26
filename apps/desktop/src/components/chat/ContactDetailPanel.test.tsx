import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { createContact, createContactDetailStats } from "@/test/fixtures";
import { configureInvoke } from "@/test/mocks/tauri";
import { ContactDetailPanel } from "./ContactDetailPanel";
import type { TrainedPersona } from "@/types";

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

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

vi.mock("@/components/ModeAwareMascot", () => ({
  ModeAwareMascot: ({ variant }: any) => (
    <div data-testid="mascot" data-variant={variant} />
  ),
}));

vi.mock("@/hooks/useConversationAnalysis", () => ({
  useConversationAnalysis: () => ({
    analysis: null,
    isGenerating: false,
    phase: null,
    loadCachedAnalysis: vi.fn(),
    startAnalysis: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("./AnalysisCard", () => ({
  AnalysisCard: () => <div data-testid="analysis-card" />,
}));

vi.mock("./ConversationAnalysisModal", () => ({
  ConversationAnalysisModal: () => null,
}));

function makePersona(overrides: Partial<TrainedPersona> = {}): TrainedPersona {
  return {
    id: "p1",
    contact_id: "contact-1",
    contact_name: "Alice Smith",
    display_name: "Alice Smith",
    base_model: "mlx-community/Qwen3.5-9B-4bit",
    adapter_size_bytes: 50000000,
    adapter_size_display: "50 MB",
    trained_at: "2025-01-15T12:00:00Z",
    message_count: 500,
    ...overrides,
  };
}

interface RenderProps {
  contact?: ReturnType<typeof createContact>;
  stats?: ReturnType<typeof createContactDetailStats> | null;
  persona?: TrainedPersona | null;
  isLoading?: boolean;
  onGeneratePersona?: ReturnType<typeof vi.fn>;
  onChat?: ReturnType<typeof vi.fn>;
  onRetrain?: ReturnType<typeof vi.fn>;
  theme?: "retro" | "modern";
}

function renderPanel({
  contact = createContact(),
  stats = createContactDetailStats(),
  persona = null,
  isLoading = false,
  onGeneratePersona = vi.fn(),
  onChat = vi.fn(),
  onRetrain = vi.fn(),
  theme = "modern",
}: RenderProps = {}) {
  const result = renderWithProviders(
    <ContactDetailPanel
      contact={contact}
      stats={stats}
      persona={persona}
      isLoading={isLoading}
      onGeneratePersona={onGeneratePersona}
      onChat={onChat}
      onRetrain={onRetrain}
    />,
    { theme },
  );
  return { ...result, onGeneratePersona, onChat, onRetrain };
}

const YOU_CONTACT = createContact({
  is_you: true,
  display_name: "You",
  contact_id: "you",
});

describe("ContactDetailPanel", () => {
  it("renders contact display name", () => {
    renderPanel();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows loading state when isLoading=true", () => {
    renderPanel({ isLoading: true, theme: "retro" });
    // In retro mode, a ghost with "sleepy" variant appears as spinner
    const ghosts = screen.getAllByTestId("ghost");
    const sleepyGhost = ghosts.find(
      (g) => g.getAttribute("data-variant") === "sleepy",
    );
    expect(sleepyGhost).toBeInTheDocument();
  });

  it("shows stat tiles for another contact", () => {
    renderPanel({
      stats: createContactDetailStats({
        message_count: 500,
        messages_from_me: 300,
        messages_from_them: 200,
      }),
    });
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("From you")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("200 from them")).toBeInTheDocument();
    expect(screen.getByText("Average length")).toBeInTheDocument();
    expect(screen.getByText("Emoji rate")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-card")).toBeInTheDocument();
  });

  it("titles the You entry Digital You", () => {
    renderPanel({ contact: YOU_CONTACT });
    expect(screen.getByText("Digital You")).toBeInTheDocument();
    expect(
      screen.getByText(/Train a persona on your own messages/),
    ).toBeInTheDocument();
  });

  it("shows Train Digital You when no persona, and it calls onGeneratePersona", () => {
    const { onGeneratePersona } = renderPanel({
      contact: YOU_CONTACT,
      persona: null,
    });
    fireEvent.click(screen.getByText("Train Digital You"));
    expect(onGeneratePersona).toHaveBeenCalledTimes(1);
  });

  it("shows ready badge, training share and actions when trained", () => {
    const { onChat, onRetrain } = renderPanel({
      contact: YOU_CONTACT,
      stats: createContactDetailStats({ messages_from_me: 1000 }),
      persona: makePersona({ message_count: 250 }),
    });
    expect(screen.getByText("Persona ready")).toBeInTheDocument();
    expect(screen.getByText("Used in training")).toBeInTheDocument();
    expect(screen.getByText("25% of your history")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Chat with Digital You"));
    expect(onChat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Retrain"));
    expect(onRetrain).toHaveBeenCalledTimes(1);
  });

  it("model details open on click", () => {
    renderPanel({ contact: YOU_CONTACT, persona: makePersona() });
    expect(screen.queryByText("50 MB")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Model details"));
    expect(screen.getByText("50 MB")).toBeInTheDocument();
    expect(
      screen.getByText("mlx-community/Qwen3.5-9B-4bit"),
    ).toBeInTheDocument();
  });

  it("does not offer training for another contact", () => {
    renderPanel();
    expect(screen.queryByText("Train Digital You")).not.toBeInTheDocument();
    expect(screen.queryByText("Retrain")).not.toBeInTheDocument();
  });

  it("shows 'Failed to load stats' when stats is null and not loading", () => {
    renderPanel({ stats: null, isLoading: false });
    expect(screen.getByText("Failed to load stats")).toBeInTheDocument();
  });
});

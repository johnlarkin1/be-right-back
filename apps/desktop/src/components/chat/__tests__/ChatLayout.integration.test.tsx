/**
 * ChatLayout integration test
 *
 * Renders the full ChatLayout with mocked Tauri commands and verifies
 * multi-component flows: the personas grid, the contact sidebar, contact
 * selection, and persona chat.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureInvoke } from "@/test/mocks/tauri";
import {
  createContact,
  createYouContact,
  createContactDetailStats,
  createInitializationStatus,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/helpers/render";
import { ChatLayout } from "@/components/chat/ChatLayout";

// ── Mocks ──────────────────────────────────────────────────────────

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

vi.mock("@/components/ModeAwareMascot", () => ({
  ModeAwareMascot: ({ variant }: any) => (
    <div data-testid="mascot" data-variant={variant} />
  ),
}));

vi.mock("@/hooks/useConversationAnalysis", () => ({
  useConversationAnalysis: () => ({
    analysis: null,
    isGenerating: false,
    phase: "idle",
    error: null,
    loadCachedAnalysis: vi.fn(),
    startAnalysis: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/components/chat/ConversationAnalysisModal", () => ({
  ConversationAnalysisModal: () => null,
}));

vi.mock("@/components/chat/TrainingModal", () => ({
  TrainingModal: () => null,
}));

// ── Test data ──────────────────────────────────────────────────────

const contacts = [
  createYouContact(),
  createContact({
    contact_id: "alice",
    display_name: "Alice Smith",
    message_count: 500,
  }),
  createContact({
    contact_id: "bob",
    display_name: "Bob Jones",
    message_count: 200,
  }),
];

const youPersona = {
  id: "p-you",
  contact_id: "you",
  contact_name: "You",
  display_name: "You",
  base_model: "qwen",
  adapter_size_bytes: 5000000,
  adapter_size_display: "5 MB",
  trained_at: "2025-01-15",
  message_count: 5000,
};

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom has no scrollIntoView; the chat panel calls it on new messages
  Element.prototype.scrollIntoView = vi.fn();
  configureInvoke("get_all_contacts", contacts);
  configureInvoke(
    "get_initialization_status",
    createInitializationStatus({ has_snapshot: true }),
  );
  configureInvoke("list_personas", [youPersona]);
  configureInvoke("get_contact_detail_stats", (args) =>
    createContactDetailStats({
      contact_id: (args?.contactId as string) ?? "contact-1",
      display_name:
        contacts.find((c) => c.contact_id === args?.contactId)?.display_name ??
        "Unknown",
    }),
  );
  configureInvoke("chat_with_persona_streaming", undefined);
  configureInvoke("get_conversation_analysis", null);
  configureInvoke("analyze_conversation", undefined);
});

async function openContactList(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByText("Digital You")).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: "Browse contacts" }));
  await waitFor(() => {
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ChatLayout integration", () => {
  it("opens on the personas grid with the trained Digital You", async () => {
    renderWithProviders(<ChatLayout />, { theme: "modern" });

    await waitFor(() => {
      expect(screen.getByText("Digital You")).toBeInTheDocument();
    });
    expect(screen.getByText(/1 ready\./)).toBeInTheDocument();
    expect(
      screen.getByText("Trained on 5,000 of 12,500 messages"),
    ).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("offers Train Digital You when no persona exists", async () => {
    configureInvoke("list_personas", []);
    renderWithProviders(<ChatLayout />, { theme: "modern" });

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Train Digital You/ }).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText(/0 ready\./)).toBeInTheDocument();
  });

  it("Browse contacts shows the sidebar sorted by message count", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatLayout />, { theme: "modern" });
    await openContactList(user);

    const alice = screen.getByText("Alice Smith");
    const bob = screen.getByText("Bob Jones");
    expect(
      alice.compareDocumentPosition(bob) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Most messaged")).toBeInTheDocument();
  });

  it("clicking a contact shows stats and the analysis card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatLayout />, { theme: "modern" });
    await openContactList(user);

    await user.click(screen.getByText("Alice Smith"));

    await waitFor(() => {
      expect(screen.getByText("From you")).toBeInTheDocument();
      expect(screen.getByText("Personality analysis")).toBeInTheDocument();
    });
    // Only "You" can be trained
    expect(
      screen.queryByRole("button", { name: /Train/ }),
    ).not.toBeInTheDocument();
  });

  it("the back link returns to the grid", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatLayout />, { theme: "modern" });
    await openContactList(user);

    await user.click(screen.getByText("← All personas"));

    await waitFor(() => {
      expect(screen.getByText("Personas")).toBeInTheDocument();
    });
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
  });

  it("Chat on a persona card opens the chat view", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatLayout />, { theme: "modern" });

    await waitFor(() => {
      expect(screen.getByText("Digital You")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Chat" }));

    await waitFor(() => {
      expect(screen.getByText("← All personas")).toBeInTheDocument();
    });
    expect(screen.queryByText("Personas")).not.toBeInTheDocument();
  });
});

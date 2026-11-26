import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { createContact, createYouContact } from "@/test/fixtures";
import { ChatSidebar } from "./ChatSidebar";

interface RenderProps {
  contacts?: ReturnType<typeof createContact>[];
  selectedContactId?: string | null;
  onContactSelect?: ReturnType<typeof vi.fn>;
  onBack?: ReturnType<typeof vi.fn>;
  isLoading?: boolean;
  theme?: "retro" | "modern";
}

function renderSidebar({
  contacts = [],
  selectedContactId = null,
  onContactSelect = vi.fn(),
  onBack,
  isLoading = false,
  theme = "modern",
}: RenderProps = {}) {
  const result = renderWithProviders(
    <ChatSidebar
      contacts={contacts}
      selectedContactId={selectedContactId}
      onContactSelect={onContactSelect}
      onBack={onBack}
      isLoading={isLoading}
    />,
    { theme },
  );
  return { ...result, onContactSelect, onBack };
}

const contacts = [
  createYouContact(),
  createContact({ contact_id: "a", display_name: "Alice", message_count: 10 }),
  createContact({ contact_id: "b", display_name: "Bob", message_count: 90 }),
];

describe("ChatSidebar", () => {
  it("shows the Digital You row with its sent count", () => {
    renderSidebar({ contacts });
    expect(screen.getByText("Digital You")).toBeInTheDocument();
    expect(screen.getByText("12,500 sent")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("selects Digital You on click", () => {
    const { onContactSelect } = renderSidebar({ contacts });
    fireEvent.click(screen.getByText("Digital You"));
    expect(onContactSelect).toHaveBeenCalledWith("you");
  });

  it("lists other contacts by message count, most first", () => {
    renderSidebar({ contacts });
    const names = screen
      .getAllByText(/^(Alice|Bob)$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["Bob", "Alice"]);
    expect(screen.getByText("Most messaged")).toBeInTheDocument();
  });

  it("filters contacts by search", () => {
    renderSidebar({ contacts });
    fireEvent.change(screen.getByPlaceholderText("Search 2 contacts"), {
      target: { value: "ali" },
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.getByText("Matches")).toBeInTheDocument();
  });

  it("shows an empty message when no contact matches", () => {
    renderSidebar({ contacts });
    fireEvent.change(screen.getByPlaceholderText("Search 2 contacts"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No contacts found")).toBeInTheDocument();
  });

  it("marks the selected contact", () => {
    renderSidebar({ contacts, selectedContactId: "b" });
    expect(screen.getByText("Bob").closest("button")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("calls onBack from the back link", () => {
    const onBack = vi.fn();
    renderSidebar({ contacts, onBack });
    fireEvent.click(screen.getByText("← All personas"));
    expect(onBack).toHaveBeenCalled();
  });

  it("hides the back link without onBack", () => {
    renderSidebar({ contacts });
    expect(screen.queryByText("← All personas")).not.toBeInTheDocument();
  });

  it("shows a loading state", () => {
    renderSidebar({ contacts, isLoading: true });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("uses retro labels in retro mode", () => {
    renderSidebar({ contacts, onBack: vi.fn(), theme: "retro" });
    expect(screen.getByText("< cd ../personas")).toBeInTheDocument();
    expect(screen.getByText("[READY]")).toBeInTheDocument();
  });
});

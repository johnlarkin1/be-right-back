import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { InlineChatPanel } from "./InlineChatPanel";

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/chat/MessageBubble", () => ({
  default: ({ message, isUser, isStreaming }: any) => (
    <div
      data-testid={isUser ? "user-bubble" : "assistant-bubble"}
      data-streaming={isStreaming}
    >
      {message}
    </div>
  ),
}));

vi.mock("@/components/chat/ChatInput", () => ({
  default: ({ onSend, disabled, placeholder }: any) => (
    <input
      data-testid="chat-input"
      placeholder={placeholder}
      disabled={disabled}
      onKeyDown={(e: any) => e.key === "Enter" && onSend(e.target.value)}
    />
  ),
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

const persona = {
  id: "p1",
  contact_id: "c1",
  contact_name: "Alice",
  display_name: "Alice",
  base_model: "qwen",
  adapter_size_bytes: 1000,
  adapter_size_display: "1 KB",
  trained_at: "2025-01-15",
  message_count: 500,
};

function renderPanel({
  messages = [] as any[],
  streamingMessage = "",
  isLoading = false,
  onSendMessage = vi.fn(),
  onClearChat = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <InlineChatPanel
      persona={persona}
      messages={messages}
      streamingMessage={streamingMessage}
      isLoading={isLoading}
      onSendMessage={onSendMessage}
      onClearChat={onClearChat}
    />,
    { theme },
  );
  return { ...result, onSendMessage, onClearChat };
}

describe("InlineChatPanel", () => {
  it("shows persona display name in header", () => {
    renderPanel();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows 'Online' status indicator", () => {
    renderPanel();
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("shows empty state when no messages", () => {
    renderPanel();
    expect(screen.getByText("Chat with Alice")).toBeInTheDocument();
  });

  it("renders user and assistant message bubbles", () => {
    renderPanel({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });
    expect(screen.getByTestId("user-bubble")).toHaveTextContent("Hello");
    expect(screen.getByTestId("assistant-bubble")).toHaveTextContent(
      "Hi there",
    );
  });

  it("shows streaming message bubble with isStreaming=true", () => {
    renderPanel({ streamingMessage: "I am thinking..." });
    const bubble = screen.getByTestId("assistant-bubble");
    expect(bubble).toHaveTextContent("I am thinking...");
    expect(bubble).toHaveAttribute("data-streaming", "true");
  });

  it("clear button visible when messages exist", () => {
    renderPanel({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("clear button calls onClearChat", () => {
    const { onClearChat } = renderPanel({
      messages: [{ role: "user", content: "Hello" }],
    });
    fireEvent.click(screen.getByText("Clear"));
    expect(onClearChat).toHaveBeenCalledTimes(1);
  });

  it("input disabled when isLoading=true", () => {
    renderPanel({ isLoading: true });
    const input = screen.getByTestId("chat-input");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("placeholder", "thinking...");
  });
});

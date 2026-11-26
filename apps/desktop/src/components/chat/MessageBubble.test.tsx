import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { MessageBubble } from "./MessageBubble";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

describe("MessageBubble", () => {
  it("renders user message text", () => {
    renderWithProviders(<MessageBubble message="Hello there" isUser={true} />);

    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("renders assistant message text", () => {
    renderWithProviders(
      <MessageBubble message="I am your digital self" isUser={false} />,
    );

    expect(screen.getByText("I am your digital self")).toBeInTheDocument();
  });

  it("shows '_' streaming cursor in retro mode", () => {
    renderWithProviders(
      <MessageBubble message="typing..." isUser={false} isStreaming={true} />,
      { theme: "retro" },
    );

    expect(screen.getByText("_")).toBeInTheDocument();
  });

  it("shows '|' streaming cursor in modern mode", () => {
    renderWithProviders(
      <MessageBubble message="typing..." isUser={false} isStreaming={true} />,
      { theme: "modern" },
    );

    expect(screen.getByText("|")).toBeInTheDocument();
  });

  it("shows [USER] and [DIGITAL-YOU] labels in retro mode", () => {
    const { unmount } = renderWithProviders(
      <MessageBubble message="hi" isUser={true} />,
      { theme: "retro" },
    );
    expect(screen.getByText("[USER]")).toBeInTheDocument();
    unmount();

    renderWithProviders(<MessageBubble message="hello" isUser={false} />, {
      theme: "retro",
    });
    expect(screen.getByText("[DIGITAL-YOU]")).toBeInTheDocument();
  });

  it("does not show [USER] or [DIGITAL-YOU] labels in modern mode", () => {
    renderWithProviders(<MessageBubble message="hi" isUser={true} />, {
      theme: "modern",
    });

    expect(screen.queryByText("[USER]")).not.toBeInTheDocument();
    expect(screen.queryByText("[DIGITAL-YOU]")).not.toBeInTheDocument();
  });

  it("displays the message content", () => {
    const longMessage =
      "This is a longer message with multiple words to verify rendering.";
    renderWithProviders(<MessageBubble message={longMessage} isUser={true} />);

    expect(screen.getByText(longMessage)).toBeInTheDocument();
  });
});

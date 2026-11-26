import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { ChatInput } from "./ChatInput";

describe("ChatInput", () => {
  it("renders the input field", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("sends message on Enter key", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello world");
  });

  it("does not call onSend when input is empty", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />);

    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("clears the input after sending", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test message" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(input).toHaveValue("");
  });

  it("prevents interaction when disabled", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} disabled />);

    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();

    // Submit button should also be disabled
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });

  it("shows '>' prompt and '[SEND]' button in retro mode", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />, { theme: "retro" });

    expect(screen.getByText(">")).toBeInTheDocument();
    expect(screen.getByText("[SEND]")).toBeInTheDocument();
  });

  it("shows Send icon (no '>' or '[SEND]') in modern mode", () => {
    const onSend = vi.fn();
    renderWithProviders(<ChatInput onSend={onSend} />, { theme: "modern" });

    expect(screen.queryByText(">")).not.toBeInTheDocument();
    expect(screen.queryByText("[SEND]")).not.toBeInTheDocument();
    // The button should still exist (renders a Send icon)
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

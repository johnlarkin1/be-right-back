import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { CommandPalette } from "./CommandPalette";

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

function renderPalette({
  isOpen = true,
  onClose = vi.fn(),
  onExecute = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <CommandPalette isOpen={isOpen} onClose={onClose} onExecute={onExecute} />,
    { theme },
  );
  return { ...result, onClose, onExecute };
}

describe("CommandPalette", () => {
  it("renders nothing when isOpen=false", () => {
    renderPalette({ isOpen: false });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Personas")).not.toBeInTheDocument();
  });

  it("shows input and command list when isOpen=true", () => {
    renderPalette({ isOpen: true });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("Go to Personas")).toBeInTheDocument();
  });

  it("shows all 6 commands", () => {
    renderPalette();
    expect(screen.getByText("Go to Personas")).toBeInTheDocument();
    expect(screen.getByText("Go to Ask Casper")).toBeInTheDocument();
    expect(screen.getByText("Go to Insights")).toBeInTheDocument();
    expect(screen.getByText("Toggle Theme")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it('search filters commands (type "personas" shows only "Go to Personas")', () => {
    renderPalette();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "personas" } });
    expect(screen.getByText("Go to Personas")).toBeInTheDocument();
    expect(screen.queryByText("Go to Ask Casper")).not.toBeInTheDocument();
    expect(screen.queryByText("Toggle Theme")).not.toBeInTheDocument();
  });

  it('shows "No results" text when search has no matches', () => {
    renderPalette({ theme: "modern" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "zzzzz" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("clicking a command calls onExecute with command id and onClose", () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    renderPalette({ onExecute, onClose });
    fireEvent.click(screen.getByText("Go to Personas"));
    expect(onExecute).toHaveBeenCalledWith("go-personas");
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown/ArrowUp navigates selection", () => {
    renderPalette();
    const input = screen.getByRole("textbox");

    // Initially first item is selected
    const items = screen.getAllByText(/^Go to/);
    const allItems = document.querySelectorAll(".command-palette-item");
    expect(allItems[0]).toHaveClass("selected");

    // ArrowDown moves selection down
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const allItemsAfterDown = document.querySelectorAll(
      ".command-palette-item",
    );
    expect(allItemsAfterDown[1]).toHaveClass("selected");
    expect(allItemsAfterDown[0]).not.toHaveClass("selected");

    // ArrowUp moves selection back up
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const allItemsAfterUp = document.querySelectorAll(".command-palette-item");
    expect(allItemsAfterUp[0]).toHaveClass("selected");
  });

  it("Enter executes selected command", () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    renderPalette({ onExecute, onClose });
    const input = screen.getByRole("textbox");

    // Move down to second command (Go to Ask Casper)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onExecute).toHaveBeenCalledWith("go-casper");
    expect(onClose).toHaveBeenCalled();
  });

  it("commands are grouped by section (Navigation, Actions)", () => {
    renderPalette();
    // In retro mode, sections show as "// navigation" and "// actions"
    expect(screen.getByText("// navigation")).toBeInTheDocument();
    expect(screen.getByText("// actions")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { ShortcutsModal } from "./ShortcutsModal";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => children,
}));

function renderModal({
  isOpen = true,
  onClose = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <ShortcutsModal isOpen={isOpen} onClose={onClose} />,
    { theme },
  );
  return { ...result, onClose };
}

describe("ShortcutsModal", () => {
  it("renders nothing when isOpen=false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText("Keyboard Shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByText("> keyboard shortcuts_")).not.toBeInTheDocument();
  });

  it("shows shortcut entries when isOpen=true", () => {
    renderModal({ isOpen: true });
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Close overlay")).toBeInTheDocument();
  });

  it("shows navigation shortcuts", () => {
    renderModal();
    expect(screen.getByText("⌘ 1 / 2 / 3")).toBeInTheDocument();
    expect(screen.getByText("⌘ ⇧ [")).toBeInTheDocument();
    expect(screen.getByText("⌘ ⇧ ]")).toBeInTheDocument();
  });

  it("shows action shortcuts", () => {
    renderModal();
    expect(screen.getByText("⌘ K")).toBeInTheDocument();
    expect(screen.getByText("⌘ ⇧ T")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Toggle theme")).toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderModal();
    const closeButton = screen.getByText("×");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("retro mode shows '// navigation' header; modern shows 'Navigation'", () => {
    const { unmount } = renderModal({ theme: "retro" });
    expect(screen.getByText("// navigation")).toBeInTheDocument();
    unmount();

    renderModal({ theme: "modern" });
    expect(screen.getByText("Navigation")).toBeInTheDocument();
  });
});

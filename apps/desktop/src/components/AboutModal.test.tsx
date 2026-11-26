import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { AboutModal } from "./AboutModal";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

function renderModal({
  isOpen = true,
  onClose = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <AboutModal isOpen={isOpen} onClose={onClose} />,
    { theme },
  );
  return { ...result, onClose };
}

describe("AboutModal", () => {
  it("renders nothing when isOpen=false", () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText("be right back")).not.toBeInTheDocument();
  });

  it("shows 'be right back' title when open", () => {
    renderModal({ isOpen: true });
    expect(screen.getByText("be right back")).toBeInTheDocument();
  });

  it("shows version '0.1.0'", () => {
    renderModal({ isOpen: true });
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
  });

  it("shows 'tauri + mlx' runtime", () => {
    renderModal({ isOpen: true });
    expect(screen.getByText("tauri + mlx")).toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderModal({ isOpen: true });
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

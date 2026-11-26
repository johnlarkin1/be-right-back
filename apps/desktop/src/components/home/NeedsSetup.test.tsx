import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { NeedsSetup } from "./NeedsSetup";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
  Casper: ({ variant }: any) => (
    <div data-testid="casper" data-variant={variant} />
  ),
}));

describe("NeedsSetup", () => {
  it("renders title and description", () => {
    renderWithProviders(
      <NeedsSetup
        title="Setup Required"
        description="Please complete setup first."
        actionLabel="Go to Setup"
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Setup Required")).toBeInTheDocument();
    expect(
      screen.getByText("Please complete setup first."),
    ).toBeInTheDocument();
  });

  it("action button shows label and calls onAction", () => {
    const onAction = vi.fn();
    renderWithProviders(
      <NeedsSetup
        title="Setup"
        description="Desc"
        actionLabel="Go to Setup"
        onAction={onAction}
      />,
    );

    const button = screen.getByRole("button", { name: /Go to Setup/ });
    fireEvent.click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("retro mode wraps label in brackets", () => {
    renderWithProviders(
      <NeedsSetup
        title="Setup"
        description="Desc"
        actionLabel="Go to Setup"
        onAction={vi.fn()}
      />,
      { theme: "retro" },
    );

    expect(screen.getByText("[Go to Setup]")).toBeInTheDocument();
  });
});

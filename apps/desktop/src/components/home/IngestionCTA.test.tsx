import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { IngestionCTA } from "./IngestionCTA";

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

describe("IngestionCTA", () => {
  it('shows "Snapshot & Ingest" for first time (hasExistingSnapshot=false)', () => {
    renderWithProviders(
      <IngestionCTA onStart={vi.fn()} hasExistingSnapshot={false} />,
    );

    expect(screen.getByText("Snapshot & Ingest")).toBeInTheDocument();
    expect(screen.getByText("Create your first snapshot")).toBeInTheDocument();
  });

  it('shows "Update Snapshot" when hasExistingSnapshot=true', () => {
    renderWithProviders(
      <IngestionCTA onStart={vi.fn()} hasExistingSnapshot={true} />,
    );

    expect(screen.getByText("Update Snapshot")).toBeInTheDocument();
    expect(
      screen.getByText("Create a new snapshot of your messages"),
    ).toBeInTheDocument();
  });

  it("clicking calls onStart", () => {
    const onStart = vi.fn();
    renderWithProviders(<IngestionCTA onStart={onStart} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("disabled state prevents click", () => {
    const onStart = vi.fn();
    renderWithProviders(<IngestionCTA onStart={onStart} disabled={true} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('loading state shows "Processing..."', () => {
    renderWithProviders(<IngestionCTA onStart={vi.fn()} isLoading={true} />);

    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });
});

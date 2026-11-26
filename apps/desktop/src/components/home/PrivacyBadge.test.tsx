import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { PrivacyBadge, PrivacyInfo } from "./PrivacyBadge";

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

describe("PrivacyBadge", () => {
  it('inline variant shows "Private & Local" text in modern mode', () => {
    renderWithProviders(<PrivacyBadge variant="inline" />, {
      theme: "modern",
    });

    expect(screen.getByText("Private & Local")).toBeInTheDocument();
  });

  it('inline variant shows "LOCAL_ONLY" text in retro mode', () => {
    renderWithProviders(<PrivacyBadge variant="inline" />, {
      theme: "retro",
    });

    expect(screen.getByText("LOCAL_ONLY")).toBeInTheDocument();
  });

  it('card variant shows "Your data never leaves your device"', () => {
    renderWithProviders(<PrivacyBadge variant="card" />);

    expect(
      screen.getByText("Your data never leaves your device"),
    ).toBeInTheDocument();
  });

  it('card variant shows "All processing happens locally on your Mac"', () => {
    renderWithProviders(<PrivacyBadge variant="card" />);

    expect(
      screen.getByText("All processing happens locally on your Mac"),
    ).toBeInTheDocument();
  });

  it('retro inline shows "[LOCK]"', () => {
    renderWithProviders(<PrivacyBadge variant="inline" />, {
      theme: "retro",
    });

    expect(screen.getByText("[LOCK]")).toBeInTheDocument();
  });
});

describe("PrivacyInfo", () => {
  it("shows 3 privacy points", () => {
    renderWithProviders(<PrivacyInfo />);

    expect(screen.getByText("Your data stays on your Mac")).toBeInTheDocument();
    expect(screen.getByText("No cloud processing")).toBeInTheDocument();
    expect(screen.getByText("Only model downloads")).toBeInTheDocument();
  });
});

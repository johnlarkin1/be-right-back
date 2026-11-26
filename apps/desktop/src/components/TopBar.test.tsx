import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/helpers/render";
import { TopBar } from "./TopBar";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: any) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

vi.mock("@/components/theme", () => ({
  ThemeToggle: ({ compact }: any) => (
    <button data-testid="theme-toggle">Toggle</button>
  ),
}));

vi.mock("@/components/ui/Tooltip", () => ({
  Tooltip: ({ children }: any) => children,
}));

function renderTopBar({
  activeTab = "insights" as "insights" | "casper" | "personas",
  onTabChange = vi.fn(),
  onAboutClick = vi.fn(),
  onShortcutsClick = vi.fn(),
  theme = "retro" as "retro" | "modern",
} = {}) {
  const result = renderWithProviders(
    <TopBar
      activeTab={activeTab}
      onTabChange={onTabChange}
      onAboutClick={onAboutClick}
      onShortcutsClick={onShortcutsClick}
    />,
    { theme },
  );
  return { ...result, onTabChange, onAboutClick, onShortcutsClick };
}

describe("TopBar", () => {
  it("renders 'Be Right Back' brand text", () => {
    renderTopBar();
    expect(screen.getByText("Be Right Back")).toBeInTheDocument();
  });

  it("shows 3 tab buttons (insights, ask casper, personas)", () => {
    renderTopBar();
    expect(screen.getByText("insights")).toBeInTheDocument();
    expect(screen.getByText("ask casper")).toBeInTheDocument();
    expect(screen.getByText("personas")).toBeInTheDocument();
  });

  it("clicking a tab calls onTabChange", () => {
    const { onTabChange } = renderTopBar({ activeTab: "insights" });
    fireEvent.click(screen.getByText("personas"));
    expect(onTabChange).toHaveBeenCalledWith("personas");
  });

  it("active tab has 'active' class and aria-current", () => {
    renderTopBar({ activeTab: "casper" });
    const casperButton = screen.getByText("ask casper").closest("button");
    expect(casperButton?.className).toContain("active");
    expect(casperButton).toHaveAttribute("aria-current", "page");

    const insightsButton = screen.getByText("insights").closest("button");
    expect(insightsButton?.className).not.toContain("active");
  });

  it("shows the privacy badge", () => {
    renderTopBar();
    expect(screen.getByText("LOCAL_ONLY")).toBeInTheDocument();
  });

  it("menu button (aria-label='Menu') toggles dropdown", () => {
    renderTopBar();
    const menuButton = screen.getByLabelText("Menu");
    expect(screen.queryByText("About")).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("dropdown shows About and Keyboard Shortcuts items", () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText("Menu"));

    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });

  it("clicking About in menu calls onAboutClick", () => {
    const { onAboutClick } = renderTopBar();
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(screen.getByText("About"));
    expect(onAboutClick).toHaveBeenCalledTimes(1);
  });

  it("clicking Keyboard Shortcuts calls onShortcutsClick", () => {
    const { onShortcutsClick } = renderTopBar();
    fireEvent.click(screen.getByLabelText("Menu"));
    fireEvent.click(screen.getByText("Keyboard Shortcuts"));
    expect(onShortcutsClick).toHaveBeenCalledTimes(1);
  });
});

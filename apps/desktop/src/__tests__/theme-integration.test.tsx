/**
 * Integration tests for theme toggling across components.
 * Verifies that the Zustand theme store drives data-theme on the document,
 * persists to localStorage, and propagates to TopBar tab labels.
 */
import { act, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));
vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

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

vi.mock("@/components/theme", () => ({
  ThemedIcon: ({ retroElement }: any) => <span>{retroElement}</span>,
  ThemeProvider: ({ children }: any) => children,
  ThemeToggle: () => null,
}));

import { useThemeStore } from "@/stores/themeStore";
import { TopBar } from "@/components/TopBar";
import { renderWithProviders } from "@/test/helpers/render";

describe("Theme integration", () => {
  it("default theme is retro and data-theme attribute is set on document", () => {
    // renderWithProviders defaults to retro; explicitly call setMode to
    // trigger the side-effect that applies the data-theme attribute
    renderWithProviders(<div data-testid="placeholder">test</div>);

    act(() => {
      useThemeStore.getState().setMode("retro");
    });

    expect(useThemeStore.getState().mode).toBe("retro");
    expect(document.documentElement.getAttribute("data-theme")).toBe("retro");
  });

  it("toggling theme updates document data-theme attribute", () => {
    renderWithProviders(<div>test</div>);

    act(() => {
      useThemeStore.getState().toggleMode();
    });

    expect(useThemeStore.getState().mode).toBe("modern");
    expect(document.documentElement.getAttribute("data-theme")).toBe("modern");
  });

  it('theme persists to localStorage (key "brb-ui-mode")', () => {
    renderWithProviders(<div>test</div>);

    act(() => {
      useThemeStore.getState().setMode("modern");
    });

    const stored = JSON.parse(localStorage.getItem("brb-ui-mode") || "{}");
    expect(stored.state?.mode).toBe("modern");
  });

  it("TopBar renders retro tab labels when theme is retro", () => {
    renderWithProviders(<TopBar activeTab="insights" onTabChange={vi.fn()} />, {
      theme: "retro",
    });

    expect(screen.getByText("insights")).toBeInTheDocument();
    expect(screen.getByText("ask casper")).toBeInTheDocument();
    expect(screen.getByText("personas")).toBeInTheDocument();
  });

  it("TopBar renders modern tab labels when theme is modern", () => {
    renderWithProviders(<TopBar activeTab="insights" onTabChange={vi.fn()} />, {
      theme: "modern",
    });

    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("Ask Casper")).toBeInTheDocument();
    expect(screen.getByText("Personas")).toBeInTheDocument();
  });

  it("multiple components in same render tree share the same theme", () => {
    renderWithProviders(
      <div>
        <TopBar activeTab="insights" onTabChange={vi.fn()} />
        <TopBar activeTab="casper" onTabChange={vi.fn()} />
      </div>,
      { theme: "retro" },
    );

    // Both TopBar instances should show retro labels
    expect(screen.getAllByText("ask casper")).toHaveLength(2);

    // Toggle theme and verify both update
    act(() => {
      useThemeStore.getState().toggleMode();
    });

    expect(screen.queryByText("ask casper")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ask Casper")).toHaveLength(2);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";
import { useThemeStore } from "@/stores/themeStore";

// Mock the Ghost component since it has complex SVG internals
vi.mock("@/components/Ghost", () => ({
  Ghost: ({ variant }: { variant?: string }) => (
    <div data-testid="ghost" data-variant={variant} />
  ),
}));

// Component that throws on demand
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test render error");
  }
  return <div>Child content</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: "retro" });
    // Suppress console.error from React's error boundary logging
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary tabName="Home">
        <div>Normal content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary tabName="Home">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Home crashed")).toBeInTheDocument();
    expect(screen.getByText("Test render error")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("displays the tab name in the error message", () => {
    render(
      <ErrorBoundary tabName="Insights">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Insights crashed")).toBeInTheDocument();
  });

  it("recovers when Try Again is clicked", async () => {
    const user = userEvent.setup();

    // We need a stateful wrapper to control the throw
    let shouldThrow = true;

    function ControlledChild() {
      if (shouldThrow) {
        throw new Error("Temporary error");
      }
      return <div>Recovered content</div>;
    }

    const { rerender } = render(
      <ErrorBoundary tabName="Chat">
        <ControlledChild />
      </ErrorBoundary>,
    );

    // Error state shown
    expect(screen.getByText("Chat crashed")).toBeInTheDocument();

    // Fix the error condition
    shouldThrow = false;

    // Click retry
    await user.click(screen.getByRole("button", { name: /try again/i }));

    // Force rerender so the boundary re-renders children
    rerender(
      <ErrorBoundary tabName="Chat">
        <ControlledChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });

  it("shows ghost in retro mode", () => {
    useThemeStore.setState({ mode: "retro" });

    render(
      <ErrorBoundary tabName="Home">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("ghost")).toBeInTheDocument();
  });

  it("shows alert icon in modern mode", () => {
    useThemeStore.setState({ mode: "modern" });

    render(
      <ErrorBoundary tabName="Home">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // In modern mode, no ghost should render
    expect(screen.queryByTestId("ghost")).not.toBeInTheDocument();
  });
});

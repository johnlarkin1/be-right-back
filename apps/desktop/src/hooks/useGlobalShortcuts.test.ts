import { renderHook, fireEvent } from "@testing-library/react";
import type { ShortcutCallbacks } from "./useGlobalShortcuts";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

function createCallbacks(): ShortcutCallbacks {
  return {
    onNextTab: vi.fn(),
    onPrevTab: vi.fn(),
    onGoToInsights: vi.fn(),
    onGoToCasper: vi.fn(),
    onGoToPersonas: vi.fn(),
    onToggleTheme: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onEscape: vi.fn(),
  };
}

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(window, { key, ...opts });
}

describe("useGlobalShortcuts", () => {
  it("Escape calls onEscape", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("Escape");
    expect(cb.onEscape).toHaveBeenCalledTimes(1);
  });

  it("Cmd+K calls onOpenCommandPalette", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("k", { metaKey: true, code: "KeyK" });
    expect(cb.onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("Cmd+1/2/3 call onGoToInsights/Casper/Personas", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("1", { metaKey: true, code: "Digit1" });
    expect(cb.onGoToInsights).toHaveBeenCalledTimes(1);

    press("2", { metaKey: true, code: "Digit2" });
    expect(cb.onGoToCasper).toHaveBeenCalledTimes(1);

    press("3", { metaKey: true, code: "Digit3" });
    expect(cb.onGoToPersonas).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Shift+[ calls onPrevTab", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("[", { metaKey: true, shiftKey: true, code: "BracketLeft" });
    expect(cb.onPrevTab).toHaveBeenCalledTimes(1);
  });

  it("Cmd+Shift+] calls onNextTab", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("]", { metaKey: true, shiftKey: true, code: "BracketRight" });
    expect(cb.onNextTab).toHaveBeenCalledTimes(1);
  });

  it("bare ? calls onOpenShortcuts", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("?", { shiftKey: true, code: "Slash" });
    expect(cb.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("shortcuts are suppressed in input elements (except Escape and Cmd+K)", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    // Create an input element to use as the event target
    const input = document.createElement("input");
    document.body.appendChild(input);

    // Cmd+1 should be suppressed in an input
    fireEvent.keyDown(input, { key: "1", metaKey: true, code: "Digit1" });
    expect(cb.onGoToInsights).not.toHaveBeenCalled();

    // Bare ? should be suppressed in an input
    fireEvent.keyDown(input, { key: "?", shiftKey: true, code: "Slash" });
    expect(cb.onOpenShortcuts).not.toHaveBeenCalled();

    // Escape should still fire in an input
    fireEvent.keyDown(input, { key: "Escape" });
    expect(cb.onEscape).toHaveBeenCalledTimes(1);

    // Cmd+K should still fire in an input
    fireEvent.keyDown(input, { key: "k", metaKey: true, code: "KeyK" });
    expect(cb.onOpenCommandPalette).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it("Cmd+Shift+T calls onToggleTheme", () => {
    const cb = createCallbacks();
    renderHook(() => useGlobalShortcuts(cb));

    press("T", { metaKey: true, shiftKey: true, code: "KeyT" });
    expect(cb.onToggleTheme).toHaveBeenCalledTimes(1);
  });
});

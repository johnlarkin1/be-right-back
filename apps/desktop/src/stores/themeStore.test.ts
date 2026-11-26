import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "./themeStore";

describe("useThemeStore", () => {
  beforeEach(() => {
    // Reset store to default state before each test
    useThemeStore.setState({ mode: "retro" });
  });

  it("defaults to retro mode", () => {
    expect(useThemeStore.getState().mode).toBe("retro");
  });

  it("setMode switches to modern", () => {
    useThemeStore.getState().setMode("modern");
    expect(useThemeStore.getState().mode).toBe("modern");
  });

  it("setMode switches back to retro", () => {
    useThemeStore.getState().setMode("modern");
    useThemeStore.getState().setMode("retro");
    expect(useThemeStore.getState().mode).toBe("retro");
  });

  it("toggleMode flips retro to modern", () => {
    useThemeStore.getState().toggleMode();
    expect(useThemeStore.getState().mode).toBe("modern");
  });

  it("toggleMode flips modern back to retro", () => {
    useThemeStore.getState().setMode("modern");
    useThemeStore.getState().toggleMode();
    expect(useThemeStore.getState().mode).toBe("retro");
  });

  it("setMode applies data-theme attribute to document", () => {
    useThemeStore.getState().setMode("modern");
    expect(document.documentElement.getAttribute("data-theme")).toBe("modern");
  });

  it("toggleMode applies data-theme attribute to document", () => {
    useThemeStore.getState().toggleMode();
    expect(document.documentElement.getAttribute("data-theme")).toBe("modern");

    useThemeStore.getState().toggleMode();
    expect(document.documentElement.getAttribute("data-theme")).toBe("retro");
  });
});

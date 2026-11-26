import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetInvokeMocks } from "./mocks/tauri";
import { resetEventMocks } from "./mocks/tauriEvent";

afterEach(() => {
  cleanup();
  resetInvokeMocks();
  resetEventMocks();
  localStorage.clear();
});

// Mock window.matchMedia (needed by some UI components in jsdom)
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

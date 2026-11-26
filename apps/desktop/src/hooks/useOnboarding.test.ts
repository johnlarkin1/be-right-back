import { renderHook, act } from "@testing-library/react";
import type { InitializationStatus } from "@/types";
import { createInitializationStatus } from "@/test/fixtures";

import { useOnboarding } from "./useOnboarding";

describe("useOnboarding", () => {
  it("has initial state with currentStep='welcome'", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.state.currentStep).toBe("welcome");
    expect(result.current.state.hasSeenWelcome).toBe(false);
    expect(result.current.state.hasGrantedFDA).toBe(false);
    expect(result.current.state.casperMinimized).toBe(false);
  });

  it("restores state from localStorage", () => {
    const saved = {
      currentStep: "permissions",
      hasSeenWelcome: true,
      hasGrantedFDA: false,
      hasFirstSnapshot: false,
      hasCompletedIngestion: false,
      casperMinimized: false,
    };
    localStorage.setItem("brb-onboarding-state", JSON.stringify(saved));

    const { result } = renderHook(() => useOnboarding());
    expect(result.current.state.currentStep).toBe("permissions");
    expect(result.current.state.hasSeenWelcome).toBe(true);
  });

  it("advance() transitions welcome -> privacy_intro", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.state.currentStep).toBe("welcome");

    act(() => {
      result.current.advance();
    });

    expect(result.current.state.currentStep).toBe("privacy_intro");
    expect(result.current.state.hasSeenWelcome).toBe(true);
  });

  it("advance() from privacy_intro -> permissions when !hasGrantedFDA", () => {
    const { result } = renderHook(() => useOnboarding());

    // welcome -> privacy_intro
    act(() => result.current.advance());
    expect(result.current.state.currentStep).toBe("privacy_intro");

    // privacy_intro -> permissions (no FDA)
    act(() => result.current.advance());
    expect(result.current.state.currentStep).toBe("permissions");
  });

  it("updateFromStatus() with full completion -> 'complete'", () => {
    const { result } = renderHook(() => useOnboarding());

    const status = createInitializationStatus({
      has_fda_permission: true,
      has_snapshot: true,
      has_sqlite_db: true,
    });

    act(() => {
      result.current.updateFromStatus(status);
    });

    expect(result.current.state.currentStep).toBe("complete");
    expect(result.current.isComplete).toBe(true);
  });

  it("updateFromStatus() with snapshot only -> 'ingestion_ready'", () => {
    const { result } = renderHook(() => useOnboarding());

    const status = createInitializationStatus({
      has_fda_permission: true,
      has_snapshot: true,
      has_sqlite_db: false,
    });

    act(() => {
      result.current.updateFromStatus(status);
    });

    expect(result.current.state.currentStep).toBe("ingestion_ready");
  });

  it("updateFromStatus() with FDA only -> 'first_snapshot'", () => {
    const { result } = renderHook(() => useOnboarding());

    const status = createInitializationStatus({
      has_fda_permission: true,
      has_snapshot: false,
      has_sqlite_db: false,
    });

    act(() => {
      result.current.updateFromStatus(status);
    });

    expect(result.current.state.currentStep).toBe("first_snapshot");
  });

  it("updateFromStatus() preserves welcome/privacy_intro when no FDA", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.state.currentStep).toBe("welcome");

    const status = createInitializationStatus({
      has_fda_permission: false,
      has_snapshot: false,
      has_sqlite_db: false,
    });

    act(() => {
      result.current.updateFromStatus(status);
    });

    // Should stay on "welcome" rather than jumping to "permissions"
    expect(result.current.state.currentStep).toBe("welcome");

    // Advance to privacy_intro, then update again
    act(() => result.current.advance());
    expect(result.current.state.currentStep).toBe("privacy_intro");

    act(() => {
      result.current.updateFromStatus(status);
    });

    // Should stay on "privacy_intro"
    expect(result.current.state.currentStep).toBe("privacy_intro");
  });

  it("minimizeCasper / expandCasper toggle casperMinimized", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.state.casperMinimized).toBe(false);

    act(() => result.current.minimizeCasper());
    expect(result.current.state.casperMinimized).toBe(true);

    act(() => result.current.expandCasper());
    expect(result.current.state.casperMinimized).toBe(false);
  });

  it("reset() clears state and localStorage", () => {
    const { result } = renderHook(() => useOnboarding());

    // Advance past welcome
    act(() => result.current.advance());
    expect(result.current.state.currentStep).toBe("privacy_intro");

    act(() => result.current.reset());

    expect(result.current.state.currentStep).toBe("welcome");
    expect(result.current.state.hasSeenWelcome).toBe(false);
    // The useEffect re-persists the reset (initial) state to localStorage,
    // so we verify it wrote the initial state rather than being null.
    const stored = JSON.parse(localStorage.getItem("brb-onboarding-state")!);
    expect(stored.currentStep).toBe("welcome");
    expect(stored.hasSeenWelcome).toBe(false);
  });

  it("isComplete is true when currentStep='complete' or snapshot+ingestion done", () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.isComplete).toBe(false);

    // Set to complete via updateFromStatus
    const status = createInitializationStatus({
      has_fda_permission: true,
      has_snapshot: true,
      has_sqlite_db: true,
    });

    act(() => {
      result.current.updateFromStatus(status);
    });

    expect(result.current.isComplete).toBe(true);
  });
});

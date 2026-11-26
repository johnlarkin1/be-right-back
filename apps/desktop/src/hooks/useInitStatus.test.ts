import { renderHook, waitFor } from "@testing-library/react";
import { configureInvoke } from "@/test/mocks/tauri";
import { createInitializationStatus } from "@/test/fixtures";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));

// Must import after vi.mock so the module picks up the mocked invoke
import { useInitStatus } from "./useInitStatus";

describe("useInitStatus", () => {
  it("isLoading starts as true", () => {
    configureInvoke("get_initialization_status", createInitializationStatus());
    const { result } = renderHook(() => useInitStatus());
    expect(result.current.isLoading).toBe(true);
  });

  it("fetches status on mount and sets isLoading to false", async () => {
    const status = createInitializationStatus();
    configureInvoke("get_initialization_status", status);

    const { result } = renderHook(() => useInitStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("returns status data from invoke", async () => {
    const status = createInitializationStatus({ has_trained_persona: true });
    configureInvoke("get_initialization_status", status);

    const { result } = renderHook(() => useInitStatus());

    await waitFor(() => {
      expect(result.current.status).toEqual(status);
    });
    expect(result.current.error).toBeNull();
  });

  it("handles error from invoke and sets error string", async () => {
    configureInvoke("get_initialization_status", () => {
      throw new Error("Backend unavailable");
    });

    const { result } = renderHook(() => useInitStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe("Backend unavailable");
    expect(result.current.status).toBeNull();
  });

  it("refresh() re-fetches status", async () => {
    const statusV1 = createInitializationStatus({ has_trained_persona: false });
    configureInvoke("get_initialization_status", statusV1);

    const { result } = renderHook(() => useInitStatus());

    await waitFor(() => {
      expect(result.current.status).toEqual(statusV1);
    });

    // Reconfigure to return updated data
    const statusV2 = createInitializationStatus({ has_trained_persona: true });
    configureInvoke("get_initialization_status", statusV2);

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.status).toEqual(statusV2);
    });
  });
});

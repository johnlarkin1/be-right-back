import { renderHook, act, waitFor } from "@testing-library/react";
import { configureInvoke, mockInvoke } from "@/test/mocks/tauri";
import { emitMockEvent, mockListen } from "@/test/mocks/tauriEvent";
import { createIngestionProgressEvent } from "@/test/fixtures";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));
vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

import { useIngestion } from "./useIngestion";

const defaultIngestionResult = {
  success: true,
  sqlite_records: 100,
  vector_embeddings: 200,
  timestamp: "2025-01-15",
  error: null,
};

/** Helper: render hook and wait for listener to be set up */
async function renderAndWaitForListener() {
  const hook = renderHook(() => useIngestion());
  await waitFor(() => {
    expect(mockListen).toHaveBeenCalledWith(
      "ingestion-progress",
      expect.any(Function),
    );
  });
  return hook;
}

describe("useIngestion", () => {
  beforeEach(() => {
    configureInvoke("run_ingestion", defaultIngestionResult);
    configureInvoke("cancel_ingestion", undefined);
    configureInvoke("save_ingestion_settings", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with initial idle state", () => {
    const { result } = renderHook(() => useIngestion());

    expect(result.current.isRunning).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.currentStage).toBeNull();
    expect(result.current.stages).toHaveLength(6);
    expect(result.current.stages.every((s) => s.status === "pending")).toBe(
      true,
    );
  });

  it("startIngestion() calls invoke and sets isRunning", async () => {
    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.startIngestion();
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_ingestion");
    // After completion, isRunning goes back to false (finally block)
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isComplete).toBe(true);
  });

  it("startIngestion() with settings saves settings first", async () => {
    const settings = {
      start_date: "2024-01-01",
      end_date: null,
      min_messages_per_contact: 10,
      analytics: null,
    };

    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.startIngestion(settings);
    });

    // save_ingestion_settings should be called before run_ingestion
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    const saveIdx = calls.indexOf("save_ingestion_settings");
    const runIdx = calls.indexOf("run_ingestion");
    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(runIdx).toBeGreaterThan(saveIdx);
    expect(mockInvoke).toHaveBeenCalledWith("save_ingestion_settings", {
      settings,
    });
  });

  it("progress events update stages, stats, and currentStage", async () => {
    const { result } = await renderAndWaitForListener();

    const progressEvent = createIngestionProgressEvent({
      stats: {
        messages_processed: 50,
        total_messages: 200,
        contacts_processed: 3,
        total_contacts: 10,
        chunks_created: 120,
        chunks_embedded: 60,
        elapsed_secs: 15,
        estimated_remaining_secs: 30,
      },
    });

    act(() => {
      emitMockEvent("ingestion-progress", progressEvent);
    });

    expect(result.current.currentStage).toBe("embedding");
    expect(result.current.stats.messagesProcessed).toBe(50);
    expect(result.current.stats.totalMessages).toBe(200);
    expect(result.current.stats.contactsProcessed).toBe(3);
    expect(result.current.stats.totalContacts).toBe(10);
    expect(result.current.stats.chunksCreated).toBe(120);
    expect(result.current.stats.chunksEmbedded).toBe(60);
    expect(result.current.stats.elapsedSecs).toBe(15);
    expect(result.current.stats.estimatedRemainingSecs).toBe(30);
    expect(result.current.stages[3].status).toBe("in_progress");
  });

  it("error events set error and stop running", async () => {
    const { result } = await renderAndWaitForListener();

    const errorEvent = createIngestionProgressEvent({
      error: "Embedding model failed to load",
      is_complete: false,
    });

    act(() => {
      emitMockEvent("ingestion-progress", errorEvent);
    });

    expect(result.current.error).toBe("Embedding model failed to load");
    expect(result.current.isRunning).toBe(false);
  });

  it("completion events set isComplete and stop running", async () => {
    const { result } = await renderAndWaitForListener();

    const completeEvent = createIngestionProgressEvent({
      is_complete: true,
    });

    act(() => {
      emitMockEvent("ingestion-progress", completeEvent);
    });

    expect(result.current.isComplete).toBe(true);
    expect(result.current.isRunning).toBe(false);
  });

  it("error and completion events bypass throttle", async () => {
    // Render with real timers so the async listener resolves
    const { result } = await renderAndWaitForListener();

    // Now switch to fake timers to control Date.now()
    vi.useFakeTimers();

    // First normal event -- applied (no prior throttle timestamp)
    act(() => {
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({ current_stage: "parsing" }),
      );
    });
    expect(result.current.currentStage).toBe("parsing");

    // Error event immediately after -- should bypass throttle
    act(() => {
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({
          error: "Disk full",
          current_stage: "embedding",
        }),
      );
    });
    expect(result.current.error).toBe("Disk full");
    expect(result.current.currentStage).toBe("embedding");
  });

  it("throttle drops normal events within 500ms", async () => {
    // Render with real timers so the async listener resolves
    const { result } = await renderAndWaitForListener();

    // Switch to fake timers
    vi.useFakeTimers();

    // First event -- applied
    act(() => {
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({ current_stage: "snapshot" }),
      );
    });
    expect(result.current.currentStage).toBe("snapshot");

    // Second event within 500ms -- should be dropped
    act(() => {
      vi.advanceTimersByTime(100);
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({ current_stage: "parsing" }),
      );
    });
    expect(result.current.currentStage).toBe("snapshot"); // unchanged

    // Advance past throttle window
    act(() => {
      vi.advanceTimersByTime(500);
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({ current_stage: "chunking" }),
      );
    });
    expect(result.current.currentStage).toBe("chunking");
  });

  it("cancelIngestion() calls invoke and sets error message", async () => {
    const { result } = renderHook(() => useIngestion());

    await act(async () => {
      await result.current.cancelIngestion();
    });

    expect(mockInvoke).toHaveBeenCalledWith("cancel_ingestion");
    expect(result.current.error).toBe("Ingestion cancelled");
    expect(result.current.isRunning).toBe(false);
  });

  it("reset() returns to initial state", async () => {
    const { result } = await renderAndWaitForListener();

    act(() => {
      emitMockEvent(
        "ingestion-progress",
        createIngestionProgressEvent({ is_complete: true }),
      );
    });
    expect(result.current.isComplete).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.isComplete).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.currentStage).toBeNull();
    expect(result.current.stages.every((s) => s.status === "pending")).toBe(
      true,
    );
  });

  it("listener is cleaned up on unmount", async () => {
    const { unmount } = await renderAndWaitForListener();

    unmount();

    // Should not throw when emitting after unmount
    expect(() => {
      emitMockEvent("ingestion-progress", createIngestionProgressEvent());
    }).not.toThrow();
  });

  it("startIngestion catches invoke errors and sets error state", async () => {
    configureInvoke("run_ingestion", () => {
      throw new Error("Backend crashed");
    });

    const { result } = renderHook(() => useIngestion());

    let returnValue: unknown;
    await act(async () => {
      returnValue = await result.current.startIngestion();
    });

    expect(returnValue).toBeNull();
    expect(result.current.error).toBe("Backend crashed");
    expect(result.current.isRunning).toBe(false);
  });
});

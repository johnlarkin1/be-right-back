import { renderHook, act, waitFor } from "@testing-library/react";
import { configureInvoke, mockInvoke } from "@/test/mocks/tauri";
import { emitMockEvent, mockListen } from "@/test/mocks/tauriEvent";
import {
  createCasperStartedEvent,
  createCasperThinkingEvent,
  createCasperToolStartEvent,
  createCasperToolCompleteEvent,
  createCasperTokenEvent,
  createCasperCompleteEvent,
  createCasperErrorEvent,
} from "@/test/fixtures";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));
vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

import { useCasperAgent } from "./useCasperAgent";

describe("useCasperAgent", () => {
  beforeEach(() => {
    configureInvoke("ask_casper_streaming", undefined);
    // Best-effort thread-persistence calls (on mount / per turn)
    configureInvoke("list_casper_threads", []);
    configureInvoke("create_casper_thread", 1);
    configureInvoke("append_casper_message", 1);
  });

  it("starts with idle state", () => {
    const { result } = renderHook(() => useCasperAgent());

    expect(result.current.state).toBe("idle");
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.progress.streamingAnswer).toBe("");
    expect(result.current.progress.completedTools).toEqual([]);
  });

  it("askQuestion calls invoke with correct args", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.askQuestion("Who do I text the most?");
    });

    expect(mockInvoke).toHaveBeenCalledWith("ask_casper_streaming", {
      question: "Who do I text the most?",
      history: [],
      maxIterations: 5,
      enableThinking: false,
      // Always sent, empty when the user tagged nobody with "@".
      mentions: [],
    });
  });

  it("started event sets state to started and adds user message", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperStartedEvent({ question: "Hello Casper" }),
      );
    });

    expect(result.current.state).toBe("started");
    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Hello Casper" }),
      ]),
    );
  });

  it("thinking event sets state to thinking and updates iteration", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperThinkingEvent({ iteration: 2, max_iterations: 5 }),
      );
    });

    expect(result.current.state).toBe("thinking");
    expect(result.current.progress.iteration).toBe(2);
    expect(result.current.progress.maxIterations).toBe(5);
  });

  it("tool_start event sets state to tool_calling and sets currentTool", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperToolStartEvent({
          tool_name: "search_messages",
          arguments: { query: "birthday" },
        }),
      );
    });

    expect(result.current.state).toBe("tool_calling");
    expect(result.current.progress.currentTool).toEqual(
      expect.objectContaining({
        toolName: "search_messages",
        arguments: { query: "birthday" },
        status: "running",
      }),
    );
  });

  it("tool_complete event moves tool to completedTools and sets state to processing", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperToolStartEvent());
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperToolCompleteEvent({
          tool_name: "search_messages",
          success: true,
          duration_ms: 200,
          result_preview: "Found 10 results",
        }),
      );
    });

    expect(result.current.state).toBe("processing");
    expect(result.current.progress.currentTool).toBeNull();
    expect(result.current.progress.completedTools).toHaveLength(1);
    expect(result.current.progress.completedTools[0]).toEqual(
      expect.objectContaining({
        toolName: "search_messages",
        status: "success",
        durationMs: 200,
      }),
    );
  });

  it("token events set state to answering and accumulate streamingAnswer", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperTokenEvent("Based on "));
    });

    expect(result.current.state).toBe("answering");
    expect(result.current.progress.streamingAnswer).toBe("Based on ");

    act(() => {
      emitMockEvent("casper-progress", createCasperTokenEvent("your messages"));
    });

    expect(result.current.progress.streamingAnswer).toBe(
      "Based on your messages",
    );
  });

  it("complete event sets state to complete and adds assistant message", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperToolStartEvent());
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperToolCompleteEvent());
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperCompleteEvent({
          answer: "You text Alice the most!",
          tool_calls: [
            {
              tool_name: "search_messages",
              success: true,
              duration_ms: 150,
              error: null,
            },
          ],
        }),
      );
    });

    expect(result.current.state).toBe("complete");
    expect(result.current.progress.streamingAnswer).toBe("");
    const assistantMsg = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.content).toBe("You text Alice the most!");
  });

  it("error event sets state to error", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperErrorEvent({ message: "Model crashed" }),
      );
    });

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Model crashed");
    expect(result.current.progress.error).toBe("Model crashed");
  });

  it("clearConversation resets all state", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // Get into a non-idle state
    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperCompleteEvent({ answer: "Done" }),
      );
    });

    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearConversation();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.lastQuestion).toBeNull();
    expect(result.current.progress.streamingAnswer).toBe("");
    expect(result.current.progress.completedTools).toEqual([]);
  });

  it("ghostVariant updates per state", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    expect(result.current.ghostVariant).toBe("happy"); // idle

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    expect(result.current.ghostVariant).toBe("excited"); // started

    act(() => {
      emitMockEvent("casper-progress", createCasperThinkingEvent());
    });
    expect(result.current.ghostVariant).toBe("thinking"); // thinking

    act(() => {
      emitMockEvent("casper-progress", createCasperToolStartEvent());
    });
    expect(result.current.ghostVariant).toBe("mischievous"); // tool_calling

    act(() => {
      emitMockEvent("casper-progress", createCasperToolCompleteEvent());
    });
    expect(result.current.ghostVariant).toBe("sleepy"); // processing

    act(() => {
      emitMockEvent("casper-progress", createCasperTokenEvent("Hi"));
    });
    expect(result.current.ghostVariant).toBe("excited"); // answering

    act(() => {
      emitMockEvent("casper-progress", createCasperErrorEvent());
    });
    expect(result.current.ghostVariant).toBe("sad"); // error
  });

  it("statusMessage updates per state", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    expect(result.current.statusMessage).toBe("Ready to help!"); // idle

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    // thinkingEnabled defaults to false
    expect(result.current.statusMessage).toBe("On it...");

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperThinkingEvent({ iteration: 1, max_iterations: 5 }),
      );
    });
    expect(result.current.statusMessage).toBe("Processing... (iteration 1/5)");

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperToolStartEvent({ tool_name: "search_messages" }),
      );
    });
    expect(result.current.statusMessage).toBe("Using search_messages...");
  });

  it("isProcessing is true during active states", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // idle -> not processing
    expect(result.current.isProcessing).toBe(false);

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    expect(result.current.isProcessing).toBe(true); // started

    act(() => {
      emitMockEvent("casper-progress", createCasperThinkingEvent());
    });
    expect(result.current.isProcessing).toBe(true); // thinking

    act(() => {
      emitMockEvent("casper-progress", createCasperToolStartEvent());
    });
    expect(result.current.isProcessing).toBe(true); // tool_calling

    act(() => {
      emitMockEvent("casper-progress", createCasperToolCompleteEvent());
    });
    expect(result.current.isProcessing).toBe(true); // processing

    act(() => {
      emitMockEvent("casper-progress", createCasperTokenEvent("x"));
    });
    expect(result.current.isProcessing).toBe(true); // answering

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperCompleteEvent({ answer: "Done" }),
      );
    });
    expect(result.current.isProcessing).toBe(false); // complete

    // Reset and test error
    act(() => {
      result.current.clearConversation();
    });
    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    act(() => {
      emitMockEvent("casper-progress", createCasperErrorEvent());
    });
    expect(result.current.isProcessing).toBe(false); // error
  });

  it("statusMessage with thinkingEnabled shows different text", async () => {
    const { result } = renderHook(() =>
      useCasperAgent({ thinkingEnabled: true }),
    );

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
    });
    expect(result.current.statusMessage).toBe("Let me think about that...");

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperThinkingEvent({ iteration: 2, max_iterations: 5 }),
      );
    });
    expect(result.current.statusMessage).toBe(
      "Thinking deeply... (iteration 2/5)",
    );
  });

  it("token_reset clears the streamed draft", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("casper-progress", createCasperStartedEvent());
      emitMockEvent("casper-progress", createCasperTokenEvent("Let me check"));
    });
    expect(result.current.progress.streamingAnswer).toBe("Let me check");

    act(() => {
      emitMockEvent("casper-progress", { type: "token_reset" });
    });
    expect(result.current.progress.streamingAnswer).toBe("");
    expect(result.current.state).toBe("processing");
    expect(result.current.isProcessing).toBe(true);
  });

  it("cancelled event ends processing without an assistant message", async () => {
    const { result } = renderHook(() => useCasperAgent());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent(
        "casper-progress",
        createCasperStartedEvent({ question: "Stop me" }),
      );
      emitMockEvent("casper-progress", createCasperTokenEvent("partial"));
    });

    act(() => {
      emitMockEvent("casper-progress", { type: "cancelled" });
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.progress.streamingAnswer).toBe("");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].role).toBe("user");
  });

  it("cancelRequest invokes cancel_casper", async () => {
    configureInvoke("cancel_casper", true);
    const { result } = renderHook(() => useCasperAgent());

    act(() => {
      result.current.cancelRequest();
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("cancel_casper");
    });
  });
});

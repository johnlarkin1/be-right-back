import { renderHook, act, waitFor } from "@testing-library/react";
import { configureInvoke, mockInvoke } from "@/test/mocks/tauri";
import { emitMockEvent, mockListen } from "@/test/mocks/tauriEvent";

vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("@/test/mocks/tauri")).mockInvoke,
}));
vi.mock("@tauri-apps/api/event", async () => ({
  listen: (await import("@/test/mocks/tauriEvent")).mockListen,
}));

import { splitMsgBreaks, useChatMessages } from "./useChatMessages";

describe("useChatMessages", () => {
  beforeEach(() => {
    configureInvoke("chat_with_persona_streaming", undefined);
  });

  it("starts with empty state", () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.streamingMessage).toBe("");
  });

  it("sendMessage adds a user message to the list", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage("Hello there");
    });

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Hello there" }),
      ]),
    );
  });

  it("sendMessage calls invoke with correct args", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    expect(mockInvoke).toHaveBeenCalledWith("chat_with_persona_streaming", {
      message: "Hi",
      history: [{ role: "user", content: "Hi" }],
      enableThinking: false,
    });
  });

  it("does nothing when personaId is null", async () => {
    const { result } = renderHook(() => useChatMessages(null));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(result.current.messages).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "chat_with_persona_streaming",
      expect.anything(),
    );
  });

  it("token events accumulate into streamingMessage", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        "chat-token",
        expect.any(Function),
      );
    });

    act(() => {
      emitMockEvent("chat-token", { token: "Hello", done: false });
    });
    expect(result.current.streamingMessage).toBe("Hello");

    act(() => {
      emitMockEvent("chat-token", { token: " world", done: false });
    });
    expect(result.current.streamingMessage).toBe("Hello world");
  });

  it("done event finalizes tokens into assistant messages", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("chat-token", { token: "Great answer", done: false });
    });

    act(() => {
      emitMockEvent("chat-token", { token: "", done: true });
    });

    expect(result.current.streamingMessage).toBe("");
    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "Great answer",
        }),
      ]),
    );
  });

  it("strips think blocks from streaming preview and final messages", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("chat-token", {
        token: "<think>internal reasoning</think>Visible text",
        done: false,
      });
    });
    expect(result.current.streamingMessage).toBe("Visible text");

    act(() => {
      emitMockEvent("chat-token", { token: "", done: true });
    });

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          content: "Visible text",
        }),
      ]),
    );
  });

  it("surfaces a message when output is only an unclosed think block", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // Thinking mode ran out of tokens before emitting </think>, so stripping
    // leaves nothing -- the turn must not vanish.
    act(() => {
      emitMockEvent("chat-token", {
        token: "<think>reasoning that never closes",
        done: false,
      });
    });
    expect(result.current.streamingMessage).toBe("");

    act(() => {
      emitMockEvent("chat-token", { token: "", done: true });
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].content).not.toBe("");
  });

  it("the chat-meta break token splits the reply into bubbles", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    act(() => {
      emitMockEvent("chat-meta", {
        rag_result_count: 0,
        msg_break_token: "<MSG_BREAK>",
      });
    });

    act(() => {
      emitMockEvent("chat-token", {
        token: "First message<MSG_BREAK>Second message",
        done: false,
      });
    });

    act(() => {
      emitMockEvent("chat-token", { token: "", done: true });
    });

    const assistantMessages = result.current.messages.filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0].content).toBe("First message");
    expect(assistantMessages[1].content).toBe("Second message");
  });

  it("error from invoke adds [ERROR] assistant message", async () => {
    configureInvoke("chat_with_persona_streaming", () => {
      throw new Error("Model not loaded");
    });

    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    const errorMsg = result.current.messages.find(
      (m) => m.role === "assistant" && m.content.includes("[ERROR]"),
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.content).toContain("Model not loaded");
    expect(result.current.isLoading).toBe(false);
  });

  it("clearMessages resets messages and streaming state", async () => {
    const { result } = renderHook(() => useChatMessages("persona-1"));

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // Add a message
    await act(async () => {
      await result.current.sendMessage("Hello");
    });
    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.streamingMessage).toBe("");
  });

  it("persona change clears messages", async () => {
    const { result, rerender } = renderHook(
      ({ personaId }) => useChatMessages(personaId),
      { initialProps: { personaId: "persona-1" as string | null } },
    );

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled();
    });

    // Send a message with persona-1
    await act(async () => {
      await result.current.sendMessage("Hello");
    });
    expect(result.current.messages.length).toBeGreaterThan(0);

    // Change persona
    rerender({ personaId: "persona-2" });

    await waitFor(() => {
      expect(result.current.messages).toEqual([]);
    });
    expect(result.current.streamingMessage).toBe("");
  });
});

describe("splitMsgBreaks", () => {
  it("splits on the token and keeps newlines inside a bubble", () => {
    expect(splitMsgBreaks("yo<B>what time\nmaybe 6<B> <B>ok", "<B>")).toEqual([
      "yo",
      "what time\nmaybe 6",
      "ok",
    ]);
  });

  it("returns one bubble when no token is known", () => {
    expect(splitMsgBreaks(" yo<B>ok ", null)).toEqual(["yo<B>ok"]);
  });
});

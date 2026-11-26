import { useState, useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { chatWithPersonaStreaming } from "@/services/tauri";
import type { ChatMessage } from "@/types";

/** Payload emitted by the backend for each streaming token */
interface ChatTokenPayload {
  token: string;
  done: boolean;
}

/** Payload emitted by the backend before streaming starts */
interface ChatMetaPayload {
  /** Separates the reply's bubbles. Comes from the Rust export constant. */
  msg_break_token: string;
  rag_result_count: number;
}

/** Strip <think>...</think> blocks from model output.
 *  Handles both complete blocks and unclosed blocks (model still
 *  generating or hit max_tokens before closing the tag). */
function stripThinkTags(text: string): string {
  // Strip complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // Strip unclosed <think> block (model still generating or hit max_tokens)
  result = result.replace(/<think>[\s\S]*$/g, "");
  return result.trim();
}

/** Split a reply into bubbles on the break token, dropping empty parts */
export function splitMsgBreaks(
  text: string,
  breakToken: string | null,
): string[] {
  const parts = breakToken ? text.split(breakToken) : [text];
  return parts.map((part) => part.trim()).filter(Boolean);
}

interface UseChatMessagesReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  streamingMessage: string;
  ragCount: number;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChatMessages(
  personaId: string | null,
  enableThinking: boolean = false,
): UseChatMessagesReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [ragCount, setRagCount] = useState(0);

  // Ref to accumulate streaming tokens (avoids stale closure issues)
  const streamingRef = useRef("");
  // Set by each chat-meta event, which arrives before the reply's first token.
  const breakTokenRef = useRef<string | null>(null);

  // Clear chat when persona changes
  useEffect(() => {
    setMessages([]);
    setStreamingMessage("");
    streamingRef.current = "";
    setRagCount(0);
    // The next persona's chat-meta event sets its own token.
    breakTokenRef.current = null;
  }, [personaId]);

  // Set up listeners for chat-meta and chat-token events.
  // Uses a `cancelled` flag to prevent React Strict Mode from creating
  // duplicate listeners (the async listen() may resolve after cleanup runs).
  useEffect(() => {
    let unlistenToken: UnlistenFn | null = null;
    let unlistenMeta: UnlistenFn | null = null;
    let cancelled = false;

    const setupListeners = async () => {
      const metaFn = await listen<ChatMetaPayload>("chat-meta", (event) => {
        if (cancelled) return;
        setRagCount(event.payload.rag_result_count);
        breakTokenRef.current = event.payload.msg_break_token;
      });

      const tokenFn = await listen<ChatTokenPayload>("chat-token", (event) => {
        if (cancelled) return;

        const { token, done } = event.payload;

        if (done) {
          // Generation complete -- clean up and split into message bubbles
          const rawText = streamingRef.current;
          streamingRef.current = "";
          setStreamingMessage("");
          setIsLoading(false);

          const cleaned = stripThinkTags(rawText);
          if (cleaned) {
            const parts = splitMsgBreaks(cleaned, breakTokenRef.current);
            setMessages((prev) => [
              ...prev,
              ...parts.map((content) => ({
                role: "assistant" as const,
                content,
              })),
            ]);
          } else if (rawText.trim()) {
            // The model generated only an unclosed <think> block, so stripping
            // left nothing. Say so rather than dropping the turn silently.
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "[ERROR] Response was cut off inside the model's thinking block. Try again, or turn thinking off.",
              },
            ]);
          }
        } else {
          // Accumulate token and show cleaned preview while streaming
          streamingRef.current += token;
          setStreamingMessage(
            splitMsgBreaks(
              stripThinkTags(streamingRef.current),
              breakTokenRef.current,
            ).join("\n"),
          );
        }
      });

      if (cancelled) {
        metaFn();
        tokenFn();
      } else {
        unlistenMeta = metaFn;
        unlistenToken = tokenFn;
      }
    };

    setupListeners();

    return () => {
      cancelled = true;
      if (unlistenToken) unlistenToken();
      if (unlistenMeta) unlistenMeta();
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!personaId) {
        console.error("Cannot send message: no persona selected");
        return;
      }

      const userMessage: ChatMessage = { role: "user", content };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setStreamingMessage("");
      streamingRef.current = "";

      try {
        // One entry per bubble. Rust joins same-role runs into turns.
        const history = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Call the streaming Tauri command -- it emits chat-token events
        await chatWithPersonaStreaming({
          message: content,
          history,
          enableThinking,
        });
      } catch (error) {
        console.error("Chat error:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `[ERROR] ${errorMsg || "Failed to generate response"}`,
          },
        ]);
        setIsLoading(false);
        setStreamingMessage("");
        streamingRef.current = "";
      }
    },
    [messages, personaId, enableThinking],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingMessage("");
    streamingRef.current = "";
  }, []);

  return {
    messages,
    isLoading,
    streamingMessage,
    ragCount,
    sendMessage,
    clearMessages,
  };
}

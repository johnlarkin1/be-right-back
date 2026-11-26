/**
 * Hook for interacting with the Casper AI agent
 *
 * Provides real-time progress updates as Casper thinks and uses tools
 * to answer questions about your iMessage history.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  askCasperStreaming,
  cancelCasper,
  createCasperThread,
  listCasperThreads,
  appendCasperMessage,
  loadCasperThread,
  renameCasperThread,
  deleteCasperThread,
} from "@/services/tauri";
import type {
  CasperAgentState,
  CasperProgress,
  CasperChatMessage,
  CasperToolCall,
  CasperConversation,
  CasperEvent,
  GhostVariant,
  MentionedContact,
} from "@/types";
import { CASPER_STATE_VARIANTS, CASPER_STATE_MESSAGES } from "@/types";

/** History message format for backend */
interface CasperHistoryMessage {
  role: string;
  content: string;
}

interface UseCasperAgentOptions {
  /** Whether thinking mode is enabled (controlled externally) */
  thinkingEnabled?: boolean;
}

interface UseCasperAgentReturn {
  /** Current agent execution state */
  state: CasperAgentState;
  /** Detailed progress information */
  progress: CasperProgress;
  /** Conversation messages (user + assistant) */
  messages: CasperChatMessage[];
  /** Whether the agent is currently processing */
  isProcessing: boolean;
  /** Current error if any */
  error: string | null;
  /** Last question asked (for retry functionality) */
  lastQuestion: string | null;

  /** Saved conversation threads (most recently updated first) */
  threads: CasperConversation[];
  /** Currently active thread id, or null for an unsaved/new conversation */
  activeThreadId: number | null;

  /** Ask Casper a question, optionally scoped to contacts tagged with "@" */
  askQuestion: (
    question: string,
    mentions?: MentionedContact[],
  ) => Promise<void>;
  /** Clear the conversation and start a new (unsaved) thread */
  clearConversation: () => void;
  /** Stop the current request. The answer so far is discarded. */
  cancelRequest: () => void;
  /** Retry the last question after an error */
  retryLastQuestion: () => Promise<void>;

  /** Reload the saved thread list from the backend */
  refreshThreads: () => Promise<void>;
  /** Load a saved thread into the conversation view */
  loadThread: (threadId: number) => Promise<void>;
  /** Start a fresh conversation (alias for clearConversation) */
  newThread: () => void;
  /** Rename a saved thread */
  renameThread: (threadId: number, title: string) => Promise<void>;
  /** Delete a saved thread */
  deleteThread: (threadId: number) => Promise<void>;

  /** Ghost variant for current state */
  ghostVariant: GhostVariant;
  /** Human-readable status message */
  statusMessage: string;
}

/** Initial progress state */
const initialProgress: CasperProgress = {
  state: "idle",
  iteration: 0,
  maxIterations: 5,
  currentTool: null,
  completedTools: [],
  streamingAnswer: "",
  error: null,
};

/** Derive a thread title from the first question (trimmed + truncated). */
function deriveThreadTitle(question: string): string {
  const cleaned = question.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return cleaned || "New conversation";
  return `${cleaned.slice(0, 60).trimEnd()}…`;
}

/** Get status message for state (uses canonical mapping with dynamic overrides) */
function getStatusMessage(
  state: CasperAgentState,
  progress: CasperProgress,
  thinkingEnabled: boolean,
): string {
  if (state === "tool_calling" && progress.currentTool) {
    return `Using ${progress.currentTool.toolName}...`;
  }
  if (state === "thinking") {
    const prefix = thinkingEnabled ? "Thinking deeply" : "Processing";
    return `${prefix}... (iteration ${progress.iteration}/${progress.maxIterations})`;
  }
  if (state === "started") {
    return thinkingEnabled ? "Let me think about that..." : "On it...";
  }
  if (state === "error" && progress.error) {
    return progress.error;
  }
  return CASPER_STATE_MESSAGES[state];
}

export function useCasperAgent(
  options: UseCasperAgentOptions = {},
): UseCasperAgentReturn {
  const { thinkingEnabled = false } = options;

  const [state, setState] = useState<CasperAgentState>("idle");
  const [progress, setProgress] = useState<CasperProgress>(initialProgress);
  const [messages, setMessages] = useState<CasperChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  // Mentions tagged on the last question, replayed by retryLastQuestion.
  const lastMentionsRef = useRef<MentionedContact[]>([]);

  // Saved thread list + the currently active thread (null = unsaved/new)
  const [threads, setThreads] = useState<CasperConversation[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  // Mirror activeThreadId in a ref so event handlers read the current value
  // without re-subscribing the listener.
  const activeThreadIdRef = useRef<number | null>(null);

  /** Reload the saved thread list from the backend. */
  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listCasperThreads());
    } catch (err) {
      console.error("Failed to list Casper threads:", err);
    }
  }, []);

  // Track if we're currently processing
  const isProcessing =
    state !== "idle" && state !== "complete" && state !== "error";

  // Track the current question for building messages
  const currentQuestionRef = useRef<string>("");

  // Track last processed event to prevent duplicates (React strict mode)
  const lastEventRef = useRef<{ type: string; timestamp: number } | null>(null);

  // Mirror completedTools in a ref so we can read it outside state updaters
  // (calling setMessages inside setProgress's updater causes double-append in strict mode)
  const completedToolsRef = useRef<CasperToolCall[]>([]);

  // Ref to hold the unlisten function — survives across strict mode remounts
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Listen for Casper progress events
  useEffect(() => {
    // Clean up any existing listener before setting up a new one
    // (handles React strict mode double-mount)
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    let cancelled = false;

    listen<CasperEvent>("casper-progress", (event) => {
      handleCasperEvent(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenRef.current = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // Load the saved thread list once on mount
  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  /** Handle incoming Casper events */
  const handleCasperEvent = useCallback(
    (event: CasperEvent) => {
      // Deduplicate events (React strict mode can cause double processing)
      // Skip dedup for token events — consecutive identical characters (e.g., "ll" in "college")
      // are legitimate and must not be dropped.
      if (event.type !== "token") {
        const now = Date.now();
        const eventKey = `${event.type}-${JSON.stringify(event)}`;
        if (
          lastEventRef.current &&
          lastEventRef.current.type === eventKey &&
          now - lastEventRef.current.timestamp < 100
        ) {
          console.log("[Casper] Skipping duplicate event:", event.type);
          return;
        }
        lastEventRef.current = { type: eventKey, timestamp: now };
      }

      switch (event.type) {
        case "started":
          setState("started");
          setError(null);
          completedToolsRef.current = [];
          setProgress((prev) => ({
            ...prev,
            state: "started",
            error: null,
            streamingAnswer: "",
            completedTools: [],
            currentTool: null,
          }));
          // Add user message
          setMessages((prev) => [
            ...prev,
            {
              role: "user",
              content: event.question,
              tool_calls: null,
              thinking: null,
              thinking_enabled: false,
              created_at: new Date().toISOString(),
            },
          ]);
          currentQuestionRef.current = event.question;
          break;

        case "thinking":
          setState("thinking");
          setProgress((prev) => ({
            ...prev,
            state: "thinking",
            iteration: event.iteration,
            maxIterations: event.max_iterations,
          }));
          break;

        case "tool_start":
          setState("tool_calling");
          const newTool: CasperToolCall = {
            toolName: event.tool_name,
            arguments: event.arguments,
            status: "running",
          };
          setProgress((prev) => ({
            ...prev,
            state: "tool_calling",
            currentTool: newTool,
          }));
          break;

        case "tool_complete":
          // Move current tool to completed
          setProgress((prev) => {
            const completedTool: CasperToolCall = {
              toolName: event.tool_name,
              arguments: prev.currentTool?.arguments || {},
              status: event.success ? "success" : "error",
              durationMs: event.duration_ms,
              resultPreview: event.result_preview,
              error: event.success ? undefined : event.result_preview,
            };
            const newCompleted = [...prev.completedTools, completedTool];
            completedToolsRef.current = newCompleted;
            return {
              ...prev,
              state: "processing",
              currentTool: null,
              completedTools: newCompleted,
            };
          });
          setState("processing");
          break;

        case "token":
          // Live preview of the answer, streamed as the model generates it
          setState("answering");
          setProgress((prev) => ({
            ...prev,
            state: "answering",
            streamingAnswer: prev.streamingAnswer + event.text,
          }));
          break;

        case "token_reset":
          // The streamed text was a draft (it led to a tool call). Drop it
          // and go back to the thinking indicator.
          setState("processing");
          setProgress((prev) => ({
            ...prev,
            state: "processing",
            streamingAnswer: "",
          }));
          break;

        case "cancelled":
          // The user stopped the run. Keep the question, drop the draft.
          setState("idle");
          setProgress((prev) => ({
            ...prev,
            state: "idle",
            streamingAnswer: "",
            currentTool: null,
          }));
          break;

        case "complete": {
          setState("complete");
          setProgress((prev) => ({
            ...prev,
            state: "complete",
            streamingAnswer: "",
            currentTool: null,
          }));
          // Build tool calls with resultPreview matched by name + occurrence order
          const toolResultsByName = new Map<string, CasperToolCall[]>();
          for (const t of completedToolsRef.current) {
            const arr = toolResultsByName.get(t.toolName) || [];
            arr.push(t);
            toolResultsByName.set(t.toolName, arr);
          }
          const nameCounters = new Map<string, number>();
          const toolCalls: CasperToolCall[] = event.tool_calls.map((tc) => {
            const count = nameCounters.get(tc.tool_name) || 0;
            nameCounters.set(tc.tool_name, count + 1);
            const match = toolResultsByName.get(tc.tool_name)?.[count];
            return {
              toolName: tc.tool_name,
              arguments: {},
              status: tc.success ? ("success" as const) : ("error" as const),
              durationMs: tc.duration_ms,
              error: tc.error ?? undefined,
              resultPreview: match?.resultPreview,
            };
          });
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: event.answer,
              tool_calls: toolCalls,
              thinking: event.thinking,
              thinking_enabled: event.thinking_enabled ?? false,
              created_at: new Date().toISOString(),
            },
          ]);
          // Persist the assistant turn to the active thread, then refresh the
          // list so its updated_at ordering reflects this turn.
          const threadId = activeThreadIdRef.current;
          if (threadId != null) {
            appendCasperMessage({
              threadId,
              role: "assistant",
              content: event.answer,
              thinking: event.thinking ?? undefined,
              thinkingEnabled: event.thinking_enabled ?? false,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            })
              .then(() => refreshThreads())
              .catch((err) =>
                console.error("Failed to persist assistant message:", err),
              );
          }
          break;
        }

        case "error":
          setState("error");
          setError(event.message);
          setProgress((prev) => ({
            ...prev,
            state: "error",
            error: event.message,
            currentTool: null,
          }));
          break;
      }
    },
    [refreshThreads],
  );

  /** Ask Casper a question */
  const askQuestion = useCallback(
    async (
      question: string,
      mentions: MentionedContact[] = [],
    ): Promise<void> => {
      if (isProcessing) {
        console.warn("Already processing a question");
        return;
      }

      // Store question + mentions for retry capability
      setLastQuestion(question);
      lastMentionsRef.current = mentions;

      // Reset state
      setProgress(initialProgress);
      setError(null);

      // Convert messages to history format
      const history: CasperHistoryMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Lazily create a thread on the first message, then persist the user turn.
      // Persistence is best-effort and must not block the actual query.
      try {
        let threadId = activeThreadIdRef.current;
        if (threadId == null) {
          threadId = await createCasperThread(deriveThreadTitle(question));
          activeThreadIdRef.current = threadId;
          setActiveThreadId(threadId);
        }
        await appendCasperMessage({
          threadId,
          role: "user",
          content: question,
        });
        void refreshThreads();
      } catch (err) {
        console.error("Failed to persist user message / create thread:", err);
      }

      try {
        // Call the streaming command (it will emit events)
        await askCasperStreaming({
          question,
          history,
          maxIterations: 5,
          enableThinking: thinkingEnabled,
          mentions,
        });
      } catch (err) {
        console.error("Failed to ask Casper:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setState("error");
        setError(errorMessage);
        setProgress((prev) => ({
          ...prev,
          state: "error",
          error: errorMessage,
        }));
      }
    },
    [messages, isProcessing, thinkingEnabled, refreshThreads],
  );

  /** Clear conversation and start a fresh (unsaved) thread */
  const clearConversation = useCallback(() => {
    setState("idle");
    setProgress(initialProgress);
    setMessages([]);
    setError(null);
    setLastQuestion(null);
    currentQuestionRef.current = "";
    completedToolsRef.current = [];
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
  }, []);

  /** Start a fresh conversation (alias for clearConversation) */
  const newThread = useCallback(() => {
    clearConversation();
  }, [clearConversation]);

  /** Load a saved thread into the conversation view */
  const loadThread = useCallback(async (threadId: number): Promise<void> => {
    try {
      const msgs = await loadCasperThread(threadId);
      setMessages(msgs);
      activeThreadIdRef.current = threadId;
      setActiveThreadId(threadId);
      setState(msgs.length > 0 ? "complete" : "idle");
      setProgress(initialProgress);
      setError(null);
      setLastQuestion(null);
      completedToolsRef.current = [];
    } catch (err) {
      console.error("Failed to load Casper thread:", err);
    }
  }, []);

  /** Rename a saved thread */
  const renameThread = useCallback(
    async (threadId: number, title: string): Promise<void> => {
      try {
        await renameCasperThread(threadId, title);
        await refreshThreads();
      } catch (err) {
        console.error("Failed to rename Casper thread:", err);
      }
    },
    [refreshThreads],
  );

  /** Delete a saved thread (starting a fresh conversation if it was active) */
  const deleteThread = useCallback(
    async (threadId: number): Promise<void> => {
      try {
        await deleteCasperThread(threadId);
        if (activeThreadIdRef.current === threadId) {
          clearConversation();
        }
        await refreshThreads();
      } catch (err) {
        console.error("Failed to delete Casper thread:", err);
      }
    },
    [refreshThreads, clearConversation],
  );

  /** Stop the current request. The backend answers with a `cancelled` event. */
  const cancelRequest = useCallback(() => {
    cancelCasper().catch((err) =>
      console.error("Failed to cancel Casper request:", err),
    );
  }, []);

  /** Retry the last question after an error */
  const retryLastQuestion = useCallback(async () => {
    if (!lastQuestion) {
      console.warn("No question to retry");
      return;
    }
    // Remove the failed user message if present
    setMessages((prev) => {
      const lastUserMsgIndex = prev.length - 1;
      if (lastUserMsgIndex >= 0 && prev[lastUserMsgIndex].role === "user") {
        return prev.slice(0, -1);
      }
      return prev;
    });
    await askQuestion(lastQuestion, lastMentionsRef.current);
  }, [lastQuestion, askQuestion]);

  return {
    state,
    progress,
    messages,
    isProcessing,
    error,
    lastQuestion,
    threads,
    activeThreadId,
    askQuestion,
    clearConversation,
    cancelRequest,
    retryLastQuestion,
    refreshThreads,
    loadThread,
    newThread,
    renameThread,
    deleteThread,
    ghostVariant: CASPER_STATE_VARIANTS[state],
    statusMessage: getStatusMessage(state, progress, thinkingEnabled),
  };
}

export default useCasperAgent;

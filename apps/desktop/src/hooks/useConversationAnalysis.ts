/**
 * Hook for managing conversation analysis with LLM personality insights
 */
import { useState, useEffect, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getConversationAnalysis, analyzeConversation } from "@/services/tauri";

/** Analysis result from the backend */
export interface ConversationAnalysisResult {
  contact_id: string;
  analysis_markdown: string;
  model_id: string;
  generation_duration_secs: number | null;
  created_at: string;
  from_cache: boolean;
}

/** Mirrors `AnalysisProgressEvent` in `commands/analysis.rs`, which carries no serde rename. */
interface RawAnalysisProgressEvent {
  phase: string;
  content: string | null;
  is_complete: boolean;
  error: string | null;
}

export type AnalysisPhase =
  | "idle"
  | "loading_model"
  | "sampling"
  | "formatting"
  | "extracting_quotes"
  | "analyzing_personality"
  | "phase1_complete"
  | "generating"
  | "complete"
  | "error";

interface UseConversationAnalysisReturn {
  /** Cached analysis if it exists */
  analysis: ConversationAnalysisResult | null;
  /** Whether analysis is currently being generated */
  isGenerating: boolean;
  /** Current phase of analysis generation */
  phase: AnalysisPhase;
  /** Error message if analysis failed */
  error: string | null;
  /** Load cached analysis for a contact */
  loadCachedAnalysis: (contactId: string) => Promise<void>;
  /** Start generating a new analysis */
  startAnalysis: (
    contactId: string,
    contactName: string,
    forceRefresh?: boolean,
  ) => Promise<void>;
  /** Clear current analysis state */
  reset: () => void;
}

export function useConversationAnalysis(): UseConversationAnalysisReturn {
  const [analysis, setAnalysis] = useState<ConversationAnalysisResult | null>(
    null,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<AnalysisPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Listen for progress events from the backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<RawAnalysisProgressEvent>(
        "analysis-progress",
        (event) => {
          const payload = event.payload;

          // Update phase
          if (payload.phase) {
            setPhase(payload.phase as AnalysisPhase);
          }

          // Handle error
          if (payload.error) {
            setError(payload.error);
            setPhase("error");
            setIsGenerating(false);
          }

          // Handle completion (streaming content is handled by the command result)
          if (payload.is_complete && !payload.error) {
            setPhase("complete");
          }
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  /** Load cached analysis for a contact */
  const loadCachedAnalysis = useCallback(async (contactId: string) => {
    try {
      const result = await getConversationAnalysis(contactId);
      setAnalysis(result);
      setError(null);
      setPhase(result ? "complete" : "idle");
    } catch (e) {
      console.error("Failed to load cached analysis:", e);
      setError(String(e));
    }
  }, []);

  /** Start generating a new analysis */
  const startAnalysis = useCallback(
    async (
      contactId: string,
      contactName: string,
      forceRefresh: boolean = false,
    ) => {
      setIsGenerating(true);
      setError(null);
      setPhase("loading_model");

      try {
        const result = await analyzeConversation({
          contactId,
          contactName,
          forceRefresh,
        });

        setAnalysis(result);
        setPhase("complete");
      } catch (e) {
        console.error("Analysis failed:", e);
        setError(String(e));
        setPhase("error");
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  /** Reset state */
  const reset = useCallback(() => {
    setAnalysis(null);
    setIsGenerating(false);
    setPhase("idle");
    setError(null);
  }, []);

  return {
    analysis,
    isGenerating,
    phase,
    error,
    loadCachedAnalysis,
    startAnalysis,
    reset,
  };
}

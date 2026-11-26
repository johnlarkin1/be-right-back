/**
 * Hook for managing ingestion process with 5-stage progress tracking
 */
import { useState, useEffect, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  saveIngestionSettings as saveTauriSettings,
  runIngestion as runTauriIngestion,
  cancelIngestion as cancelTauriIngestion,
} from "@/services/tauri";
import type {
  IngestionResult,
  IngestionStage,
  StageProgress,
  StageStatus,
  ContactProgress,
  IngestionStatsEvent,
  IngestionSettings,
} from "@/types";

/** Stats interface matching internal hook state */
interface IngestionStats {
  messagesProcessed: number;
  totalMessages: number;
  contactsProcessed: number;
  totalContacts: number;
  currentContact: ContactProgress | null;
  chunksCreated: number;
  chunksEmbedded: number;
  elapsedSecs: number;
  estimatedRemainingSecs: number | null;
}

interface UseIngestionReturn {
  isRunning: boolean;
  stages: StageProgress[];
  currentStage: IngestionStage | null;
  stats: IngestionStats;
  error: string | null;
  isComplete: boolean;
  /**
   * Progress text for first-run Python environment setup, or null once it finishes.
   *
   * The backend extracts a bundled Python runtime and installs a ~1.5GB virtualenv before the
   * first ingestion can start. That can take several minutes; without this the UI sits on an
   * empty progress list and looks hung.
   */
  setupMessage: string | null;
  startIngestion: (
    settings?: IngestionSettings,
  ) => Promise<IngestionResult | null>;
  cancelIngestion: () => Promise<void>;
  reset: () => void;
}

/**
 * Payload of the `setup-progress` event (see `SetupProgress` in `crates/common/src/python_env.rs`).
 *
 * `running` messages are shown in the banner; `done` and `failed` are terminal and clear it.
 */
interface SetupProgressEvent {
  status: "running" | "done" | "failed";
  message: string;
}

/** Mirrors `IngestionProgressEvent` in `commands/system.rs`. */
interface RawIngestionProgressEvent {
  stages: {
    stage: IngestionStage;
    percent: number;
    status: StageStatus;
    message: string;
  }[];
  /** Null only on the cancellation event, which carries no stages. */
  current_stage: IngestionStage | null;
  is_complete: boolean;
  error: string | null;
  stats: IngestionStatsEvent | null;
}

const ALL_STAGES: IngestionStage[] = [
  "snapshot",
  "parsing",
  "chunking",
  "embedding",
  "saving",
  "analyzing",
];

const initialStages: StageProgress[] = ALL_STAGES.map((stage) => ({
  stage,
  percent: 0,
  status: "pending" as StageStatus,
  message: "",
}));

const initialStats: IngestionStats = {
  messagesProcessed: 0,
  totalMessages: 0,
  contactsProcessed: 0,
  totalContacts: 0,
  currentContact: null,
  chunksCreated: 0,
  chunksEmbedded: 0,
  elapsedSecs: 0,
  estimatedRemainingSecs: null,
};

/** Convert snake_case status to StageStatus type */
export function useIngestion(): UseIngestionReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [stages, setStages] = useState<StageProgress[]>(initialStages);
  const [currentStage, setCurrentStage] = useState<IngestionStage | null>(null);
  const [stats, setStats] = useState<IngestionStats>(initialStats);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);

  // First-run Python environment setup. Emitted by PythonEnvironment::ensure before any
  // ingestion stage reports in, so it is the only feedback during that window.
  //
  // The status tag is what decides whether the banner stays up, not the message text — an
  // earlier version compared against the display copy, which meant a failed setup (which emits
  // no completion message at all) left the spinner running forever.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<SetupProgressEvent>("setup-progress", (event) => {
      const { status, message } = event.payload;
      setSetupMessage(status === "running" ? message : null);
      if (status === "failed") {
        setError(message);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for progress events from Tauri backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      let lastUpdateTime = 0;
      const THROTTLE_MS = 500; // Max 2 updates/sec to avoid React re-render floods

      const applyUpdate = (payload: RawIngestionProgressEvent) => {
        setStages(payload.stages);

        // Update current stage
        setCurrentStage(payload.current_stage);

        // Update stats if provided
        if (payload.stats) {
          setStats({
            messagesProcessed: payload.stats.messages_processed ?? 0,
            totalMessages: payload.stats.total_messages ?? 0,
            contactsProcessed: payload.stats.contacts_processed ?? 0,
            totalContacts: payload.stats.total_contacts ?? 0,
            currentContact: payload.stats.current_contact ?? null,
            chunksCreated: payload.stats.chunks_created ?? 0,
            chunksEmbedded: payload.stats.chunks_embedded ?? 0,
            elapsedSecs: payload.stats.elapsed_secs ?? 0,
            estimatedRemainingSecs:
              payload.stats.estimated_remaining_secs ?? null,
          });
        }

        // Handle error
        if (payload.error) {
          setError(payload.error);
          setIsRunning(false);
        }

        // Handle completion
        if (payload.is_complete) {
          setIsComplete(true);
          setIsRunning(false);
        }
      };

      unlisten = await listen<RawIngestionProgressEvent>(
        "ingestion-progress",
        (event) => {
          const payload = event.payload;

          // Always process completion and errors immediately
          if (payload.is_complete || payload.error) {
            applyUpdate(payload);
            return;
          }

          // Throttle normal progress updates to avoid cascading re-renders
          const now = Date.now();
          if (now - lastUpdateTime < THROTTLE_MS) return;
          lastUpdateTime = now;
          applyUpdate(payload);
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

  // Start the ingestion process with optional settings
  const startIngestion = useCallback(
    async (settings?: IngestionSettings): Promise<IngestionResult | null> => {
      try {
        setIsRunning(true);
        setError(null);
        setIsComplete(false);
        setStages(initialStages);
        setCurrentStage("snapshot");
        setStats(initialStats);

        // Save settings before running if provided
        if (settings) {
          await saveTauriSettings(settings);
        }

        const result = await runTauriIngestion();

        if (result.success) {
          setIsComplete(true);
          // Mark all stages as complete
          setStages(
            ALL_STAGES.map((stage) => ({
              stage,
              percent: 100,
              status: "completed",
              message: "Complete",
            })),
          );
        } else if (result.error) {
          setError(result.error);
        }

        return result;
      } catch (err) {
        console.error("Ingestion failed:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        return null;
      } finally {
        setIsRunning(false);
      }
    },
    [],
  );

  // Cancel the ingestion process
  const cancelIngestion = useCallback(async (): Promise<void> => {
    try {
      await cancelTauriIngestion();
      setError("Ingestion cancelled");
      setIsRunning(false);
    } catch (err) {
      console.error("Failed to cancel ingestion:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to cancel: ${errorMessage}`);
    }
  }, []);

  // Reset state
  const reset = useCallback(() => {
    setIsRunning(false);
    setStages(initialStages);
    setCurrentStage(null);
    setStats(initialStats);
    setError(null);
    setIsComplete(false);
    setSetupMessage(null);
  }, []);

  return {
    isRunning,
    stages,
    currentStage,
    stats,
    error,
    isComplete,
    setupMessage,
    startIngestion,
    cancelIngestion,
    reset,
  };
}

export default useIngestion;

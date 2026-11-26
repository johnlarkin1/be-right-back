/**
 * TrainingModal - Confirmation + progress modal for persona training
 *
 * Two views:
 * 1. Confirmation: Shows contact info, estimated time, and Train/Cancel buttons
 * 2. Progress: Shows live training progress from backend events
 *
 * Follows the pattern of ConversationAnalysisModal for modal structure
 * and IngestionProgress for progress visualization.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Zap,
  AlertTriangle,
  MessageCircle,
  Sparkles,
  Check,
} from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  trainPersona,
  getTrainingPlan,
  cancelTraining,
} from "@/services/tauri";
import { Ghost } from "@/components/Ghost";
import { ModeAwareMascot } from "@/components/ModeAwareMascot";
import { StepStatusIcon } from "@/components/ui/StepStatusIcon";
import {
  TrainingLossChart,
  addLossPoint,
  type LossPoint,
} from "./TrainingLossChart";
import {
  TrainingSettingsPanel,
  sameSettings,
  validateSettings,
} from "./TrainingSettingsPanel";
import { useUIMode } from "@/stores/themeStore";
import type {
  ContactWithStatus,
  ContactDetailStats,
  TrainingProgressEvent,
  TrainingPlan,
  TrainingSettings,
  TrainingModalPhase,
  GhostVariant,
} from "@/types";
import { TRAINING_PHASE_LABELS } from "@/types";

type ModalView = "confirm" | "progress";

interface TrainingModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactWithStatus;
  stats: ContactDetailStats | null;
  /** If true, shows "retrain" warning instead of first-time message */
  isRetrain: boolean;
  /** Called when training completes successfully */
  onTrainingComplete: () => void;
  /** Opens a chat with the persona this modal just trained */
  onChatWithPersona?: () => void;
}

/** What the success view reports about a finished run. */
interface TrainingSummary {
  steps: number | null;
  firstLoss: number | null;
  finalLoss: number | null;
  durationMs: number;
}

/** Training phases in order for progress display */
const TRAINING_PHASES: TrainingModalPhase[] = [
  "exporting",
  "downloading",
  "training",
  "finalizing",
  "complete",
];

/**
 * Backend progress widened with the modal's own terminal phases. The backend
 * never emits "complete" or "error"; the modal sets them after `trainPersona()`
 * resolves or rejects, and those synthetic entries carry no step counts.
 */
type ModalProgress = Partial<
  Omit<TrainingProgressEvent, "phase" | "message">
> & {
  phase: TrainingModalPhase;
  message: string;
};

export function TrainingModal({
  isOpen,
  onClose,
  contact,
  stats,
  isRetrain,
  onTrainingComplete,
  onChatWithPersona,
}: TrainingModalProps) {
  const { isRetro } = useUIMode();
  const [view, setView] = useState<ModalView>("confirm");
  const [progress, setProgress] = useState<ModalProgress | null>(null);
  const [isTraining, setIsTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [baseModelDisplay, setBaseModelDisplay] = useState<string>("Qwen3.5");
  // `basePlan` holds the recommended settings. `plan` describes the settings
  // the user picked, so its time estimate follows the Advanced panel.
  const [basePlan, setBasePlan] = useState<TrainingPlan | null>(null);
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [settings, setSettings] = useState<TrainingSettings | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [lossPoints, setLossPoints] = useState<LossPoint[]>([]);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  // Collects step and loss values from progress events for the summary.
  const runStatsRef = useRef<Omit<TrainingSummary, "durationMs">>({
    steps: null,
    firstLoss: null,
    finalLoss: null,
  });
  const unlistenRef = useRef<UnlistenFn | null>(null);
  // Set when the user cancels, so the rejected trainPersona() call is not
  // reported as a failure.
  const cancelledRef = useRef(false);

  const displayName = contact.display_name || contact.contact_id;
  const messageCount = stats?.message_count ?? contact.message_count;

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setView("confirm");
      setProgress(null);
      setIsTraining(false);
      setError(null);
      setIsComplete(false);
      setPlan(null);
      setBasePlan(null);
      setSettings(null);
      setPlanError(null);
      setLossPoints([]);
      setSummary(null);
      // Fetch current base model name for display
      invoke<string>("get_recommended_base_model")
        .then((model) => {
          const short =
            model
              .split("/")
              .pop()
              ?.replace(/-\d+bit$/i, "") || "Qwen3.5";
          setBaseModelDisplay(short);
        })
        .catch(() => setBaseModelDisplay("Qwen3.5"));
      // Fetch the hardware-aware training plan so we can show an accurate,
      // machine-specific time estimate and a memory guard before training.
      getTrainingPlan({ messageCount })
        .then((p) => {
          setBasePlan(p);
          setPlan(p);
          setSettings(p.recommended ?? null);
        })
        .catch(() => setPlan(null));
    }
    return () => {
      // Clean up listener on unmount
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [isOpen, messageCount]);

  // User settings that differ from the recommended ones, or null.
  const customSettings =
    basePlan?.recommended &&
    settings &&
    !sameSettings(settings, basePlan.recommended)
      ? settings
      : null;
  const settingsInvalid =
    basePlan?.bounds != null &&
    settings != null &&
    Object.keys(validateSettings(settings, basePlan.bounds)).length > 0;

  // Re-plan when the Advanced panel changes, so the time estimate follows it.
  useEffect(() => {
    if (!isOpen || !basePlan) return;
    if (!customSettings) {
      setPlan(basePlan);
      setPlanError(null);
      return;
    }
    if (settingsInvalid) return;
    let stale = false;
    const timer = setTimeout(() => {
      getTrainingPlan({
        messageCount,
        settings: customSettings,
      })
        .then((p) => {
          if (stale) return;
          setPlan(p);
          setPlanError(null);
        })
        .catch((err) => {
          if (stale) return;
          setPlanError(err instanceof Error ? err.message : String(err));
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [isOpen, basePlan, customSettings, settingsInvalid, messageCount]);

  // Set up training-progress event listener
  const setupProgressListener = useCallback(async () => {
    // Clean up any existing listener
    if (unlistenRef.current) {
      unlistenRef.current();
    }

    // The backend only reports in-flight phases. Completion and failure are
    // driven by the `trainPersona()` promise in handleStartTraining.
    unlistenRef.current = await listen<TrainingProgressEvent>(
      "training-progress",
      (event) => {
        const { phase, step, loss, val_loss } = event.payload;
        const stats = runStatsRef.current;
        // Only training-phase events carry real step and loss values. The
        // final "finalizing" event repeats the planned step count, which is
        // wrong after an early stop.
        if (phase === "training" && step != null) {
          stats.steps = step;
          if (loss != null) {
            stats.firstLoss ??= loss;
            stats.finalLoss = loss;
          }
          setLossPoints((points) => addLossPoint(points, step, loss, val_loss));
        }
        setProgress(event.payload);
      },
    );
  }, []);

  // Handle starting training
  const handleStartTraining = useCallback(async () => {
    cancelledRef.current = false;
    runStatsRef.current = { steps: null, firstLoss: null, finalLoss: null };
    setLossPoints([]);
    const startedAt = Date.now();
    setView("progress");
    setIsTraining(true);
    setError(null);
    setIsComplete(false);
    setProgress({
      phase: "exporting",
      message: "Preparing training data...",
    });

    try {
      await setupProgressListener();

      const baseModel = await invoke<string>("get_recommended_base_model");
      await trainPersona({
        baseModel,
        maxSteps: 500,
        settings: customSettings ?? undefined,
      });

      // A resolved trainPersona() is the only completion signal — the backend
      // emits no terminal phase.
      setIsTraining(false);
      setSummary({
        ...runStatsRef.current,
        durationMs: Date.now() - startedAt,
      });
      setIsComplete(true);
      setProgress({
        phase: "complete",
        message: "Training complete!",
      });
      onTrainingComplete();
    } catch (err) {
      setIsTraining(false);
      if (cancelledRef.current) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg || "Training failed unexpectedly");
    }
  }, [customSettings, setupProgressListener, onTrainingComplete]);

  // Handle cancel during training
  const handleCancel = useCallback(() => {
    if (isTraining) {
      // Stop the backend trainer. Without this the Python process keeps
      // the GPU busy after the modal closes.
      cancelledRef.current = true;
      cancelTraining().catch((err) =>
        console.error("Failed to cancel training:", err),
      );
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
    onClose();
  }, [isTraining, onClose]);

  // Close on Escape key (only if not training)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTraining) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isTraining, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isTraining ? onClose : undefined}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className={`
                w-full max-w-lg flex flex-col overflow-hidden
                bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl
                ${isRetro ? "rounded-sm" : "rounded-2xl"}
              `}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className={`
                  flex items-center justify-between px-6 py-4 shrink-0
                  border-b border-[var(--color-border)]
                  bg-[var(--color-surface-elevated)]
                `}
              >
                <div className="flex items-center gap-3">
                  {isRetro ? (
                    <Ghost
                      size={28}
                      variant={getHeaderGhostVariant(
                        isComplete,
                        isTraining,
                        error,
                      )}
                      animate={isTraining}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                      <Zap size={20} className="text-[var(--color-accent)]" />
                    </div>
                  )}
                  <div>
                    <h2
                      className={`
                        text-lg text-[var(--color-text-primary)]
                        ${isRetro ? "font-mono" : "font-[var(--font-body)] font-semibold"}
                      `}
                    >
                      {isRetrain ? "Retrain Persona" : "Train Persona"}
                    </h2>
                    <p
                      className={`
                        text-xs text-[var(--color-text-muted)]
                        ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
                      `}
                    >
                      {displayName}
                    </p>
                  </div>
                </div>
                {!isTraining && (
                  <button
                    onClick={onClose}
                    className={`
                      w-8 h-8 flex items-center justify-center
                      text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                      hover:bg-[var(--color-surface)] transition-colors duration-200
                      ${isRetro ? "rounded-sm font-mono text-xl" : "rounded-lg"}
                    `}
                    aria-label="Close modal"
                  >
                    {isRetro ? "x" : <X size={20} />}
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="p-6 max-h-[80vh] overflow-y-auto">
                {view === "confirm" ? (
                  <ConfirmView
                    messageCount={messageCount}
                    isRetrain={isRetrain}
                    isRetro={isRetro}
                    baseModelDisplay={baseModelDisplay}
                    plan={plan}
                    basePlan={basePlan}
                    settings={settings}
                    planError={planError}
                    settingsInvalid={settingsInvalid}
                    onSettingsChange={setSettings}
                    onTrain={handleStartTraining}
                    onCancel={onClose}
                  />
                ) : (
                  <ProgressView
                    progress={progress}
                    isTraining={isTraining}
                    isComplete={isComplete}
                    error={error}
                    isRetro={isRetro}
                    summary={summary}
                    lossPoints={lossPoints}
                    messageCount={messageCount}
                    baseModelDisplay={baseModelDisplay}
                    onClose={onClose}
                    onChat={
                      onChatWithPersona
                        ? () => {
                            onClose();
                            onChatWithPersona();
                          }
                        : undefined
                    }
                    onRetry={handleStartTraining}
                    onCancel={handleCancel}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Get ghost variant for the modal header */
function getHeaderGhostVariant(
  isComplete: boolean,
  isTraining: boolean,
  error: string | null,
): GhostVariant {
  if (error) return "sad";
  if (isComplete) return "excited";
  if (isTraining) return "thinking";
  return "happy";
}

// ============================================
// Confirm View
// ============================================

/** Format the plan's minute range into a short human label. */
function formatEstimate(plan: TrainingPlan | null): string {
  if (!plan) return "Estimating…";
  const { est_minutes_low: low, est_minutes_high: high } = plan;
  if (low === high) return `~${low} min`;
  return `${low}-${high} min`;
}

function ConfirmView({
  messageCount,
  isRetrain,
  isRetro,
  baseModelDisplay,
  plan,
  basePlan,
  settings,
  planError,
  settingsInvalid,
  onSettingsChange,
  onTrain,
  onCancel,
}: {
  messageCount: number;
  isRetrain: boolean;
  isRetro: boolean;
  baseModelDisplay: string;
  plan: TrainingPlan | null;
  basePlan: TrainingPlan | null;
  settings: TrainingSettings | null;
  planError: string | null;
  settingsInvalid: boolean;
  onSettingsChange: (settings: TrainingSettings) => void;
  onTrain: () => void;
  onCancel: () => void;
}) {
  const cannotTrain = plan !== null && !plan.can_train;
  const trainDisabled = cannotTrain || settingsInvalid || planError !== null;
  return (
    <div className="space-y-5">
      {/* Description */}
      <p
        className={`
          text-sm text-[var(--color-text-primary)]
          ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
        `}
      >
        This trains an AI persona that texts like{" "}
        <span
          className={`
            ${isRetro ? "text-[var(--color-accent)]" : "font-semibold text-[var(--color-accent)]"}
          `}
        >
          you
        </span>
        .
      </p>

      {/* Stats summary */}
      <div
        className={`
          p-4 border space-y-2
          ${isRetro ? "border-[var(--color-border)] rounded-sm bg-[var(--color-surface-elevated)]" : "border-[var(--color-border)] rounded-xl bg-[var(--color-surface-elevated)]"}
        `}
      >
        <div className="flex justify-between items-center">
          <span
            className={`text-sm text-[var(--color-text-muted)] ${isRetro ? "font-mono" : "font-[var(--font-body)]"}`}
          >
            Messages
          </span>
          <span
            className={`text-sm text-[var(--color-text-primary)] ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}`}
          >
            {messageCount.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span
            className={`text-sm text-[var(--color-text-muted)] ${isRetro ? "font-mono" : "font-[var(--font-body)]"}`}
          >
            Base Model
          </span>
          <span
            className={`text-sm text-[var(--color-text-primary)] ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}`}
          >
            {baseModelDisplay}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span
            className={`text-sm text-[var(--color-text-muted)] ${isRetro ? "font-mono" : "font-[var(--font-body)]"}`}
          >
            Estimated Time
          </span>
          <span
            className={`text-sm text-[var(--color-text-primary)] ${isRetro ? "font-mono" : "font-[var(--font-body)] font-medium"}`}
          >
            {formatEstimate(plan)}
          </span>
        </div>
      </div>

      {/* Hardware-aware optimization note. Intentionally omits an exact step
          count: the plan is computed pre-export from an example-count estimate,
          while the real step budget is recomputed from the actual exported count
          at training time. We show the stable, machine-derived facts (memory,
          model tier, adapted layers) plus the time range above. */}
      {plan && plan.can_train && (
        <p
          className={`
            text-xs text-[var(--color-text-muted)] opacity-70
            ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
          `}
        >
          {isRetro ? "*" : "-"} Tuned for your Mac ({plan.system_memory_gb}GB,{" "}
          {plan.tier_name} model
          {plan.num_layers != null ? `, top ${plan.num_layers} layers` : ""}).
        </p>
      )}

      {/* Low-data advisory: honest heads-up that a thin history may over-fit. */}
      {plan && plan.can_train && plan.low_data && (
        <div
          className={`
            p-3 flex items-start gap-3 border
            ${
              isRetro
                ? "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 rounded-sm"
                : "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 rounded-lg"
            }
          `}
        >
          {isRetro ? (
            <span className="text-[var(--color-warning)] font-mono text-sm shrink-0">
              [!]
            </span>
          ) : (
            <AlertTriangle
              size={16}
              className="text-[var(--color-warning)] shrink-0 mt-0.5"
            />
          )}
          <p
            className={`
              text-xs text-[var(--color-warning)]
              ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
            `}
          >
            Limited message history — the persona may over-fit and sound less
            natural. More conversations make for a better persona.
          </p>
        </div>
      )}

      {/* Insufficient-memory guard */}
      {cannotTrain && (
        <div
          className={`
            p-3 flex items-start gap-3 border
            ${
              isRetro
                ? "border-[var(--color-error,#ff4444)]/30 bg-[var(--color-error,#ff4444)]/5 rounded-sm"
                : "border-[var(--color-error)]/30 bg-[var(--color-error)]/5 rounded-lg"
            }
          `}
        >
          {isRetro ? (
            <span className="text-[var(--color-error,#ff4444)] font-mono text-sm shrink-0">
              [x]
            </span>
          ) : (
            <AlertTriangle
              size={16}
              className="text-[var(--color-error)] shrink-0 mt-0.5"
            />
          )}
          <p
            className={`
              text-xs text-[var(--color-error,#ff4444)]
              ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
            `}
          >
            This Mac has {plan?.system_memory_gb}GB of memory — not enough to
            train a persona on-device. You can still chat with the base model
            and search your messages.
          </p>
        </div>
      )}

      {/* Retrain warning */}
      {isRetrain && (
        <div
          className={`
            p-3 flex items-start gap-3 border
            ${
              isRetro
                ? "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 rounded-sm"
                : "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 rounded-lg"
            }
          `}
        >
          {isRetro ? (
            <span className="text-[var(--color-warning)] font-mono text-sm shrink-0">
              [!]
            </span>
          ) : (
            <AlertTriangle
              size={16}
              className="text-[var(--color-warning)] shrink-0 mt-0.5"
            />
          )}
          <p
            className={`
              text-xs text-[var(--color-warning)]
              ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
            `}
          >
            This will replace the existing persona. The previous adapter will be
            overwritten.
          </p>
        </div>
      )}

      {/* Advanced training settings */}
      {basePlan?.can_train &&
        basePlan.recommended &&
        basePlan.bounds &&
        settings && (
          <TrainingSettingsPanel
            settings={settings}
            recommended={basePlan.recommended}
            bounds={basePlan.bounds}
            isRetro={isRetro}
            onChange={onSettingsChange}
          />
        )}
      {planError && (
        <p
          role="alert"
          className={`text-xs text-[var(--color-error)] ${isRetro ? "font-mono" : "font-[var(--font-body)]"}`}
        >
          {planError}
        </p>
      )}

      {/* Info text */}
      <div
        className={`
          text-xs space-y-1 text-[var(--color-text-muted)] opacity-60
          ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
        `}
      >
        <p>
          {isRetro ? "*" : "-"} LoRA fine-tuning runs locally on Apple Silicon
        </p>
        <p>{isRetro ? "*" : "-"} All processing stays on your device</p>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onCancel}
          className={`
            flex-1 px-4 py-2.5 text-sm transition-colors duration-200
            border text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
            ${
              isRetro
                ? "font-mono border-[var(--color-border)] hover:border-[var(--color-text-secondary)] rounded-sm"
                : "font-[var(--font-body)] border-[var(--color-border)] hover:border-[var(--color-text-secondary)] rounded-lg"
            }
          `}
        >
          Cancel
        </button>
        <motion.button
          whileHover={trainDisabled ? undefined : { scale: 1.02 }}
          whileTap={trainDisabled ? undefined : { scale: 0.98 }}
          onClick={onTrain}
          disabled={trainDisabled}
          className={`
            flex-1 px-4 py-2.5 text-sm font-medium
            transition-all duration-200
            disabled:opacity-40 disabled:cursor-not-allowed
            ${
              isRetro
                ? "bg-[var(--color-accent)] text-black font-mono rounded-sm shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-glow-strong)]"
                : "bg-[var(--color-accent)] text-black font-[var(--font-body)] rounded-lg hover:opacity-90"
            }
          `}
        >
          {isRetro ? "[TRAIN]" : "Train Persona"}
        </motion.button>
      </div>
    </div>
  );
}

// ============================================
// Progress View
// ============================================

function ProgressView({
  progress,
  isTraining,
  isComplete,
  error,
  isRetro,
  summary,
  lossPoints,
  messageCount,
  baseModelDisplay,
  onClose,
  onChat,
  onRetry,
  onCancel,
}: {
  progress: ModalProgress | null;
  isTraining: boolean;
  isComplete: boolean;
  error: string | null;
  isRetro: boolean;
  summary: TrainingSummary | null;
  lossPoints: LossPoint[];
  messageCount: number;
  baseModelDisplay: string;
  onClose: () => void;
  onChat?: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const currentPhase = progress?.phase ?? "exporting";

  // Error state
  if (error) {
    return (
      <div className="text-center space-y-4">
        <ModeAwareMascot size={48} variant="sad" modernVariant="sparkles" />
        <p
          className={`
            text-sm
            ${isRetro ? "font-mono text-[var(--color-error,#ff4444)]" : "font-[var(--font-body)] font-medium text-[var(--color-error)]"}
          `}
        >
          Training failed
        </p>
        <p
          className={`
            text-xs text-[var(--color-text-muted)]
            ${isRetro ? "font-mono" : "font-[var(--font-body)]"}
          `}
        >
          {error}
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={onClose}
            className={`
              px-4 py-2 text-sm transition-colors border
              text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
              ${isRetro ? "font-mono border-[var(--color-border)] rounded-sm" : "font-[var(--font-body)] border-[var(--color-border)] rounded-lg"}
            `}
          >
            Close
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onRetry}
            className={`
              px-4 py-2 text-sm font-medium transition-all
              ${
                isRetro
                  ? "bg-[var(--color-accent)] text-black font-mono rounded-sm"
                  : "bg-[var(--color-accent)] text-black font-[var(--font-body)] rounded-lg"
              }
            `}
          >
            Retry
          </motion.button>
        </div>
      </div>
    );
  }

  // Complete state
  if (isComplete) {
    return (
      <SuccessView
        isRetro={isRetro}
        summary={summary}
        lossPoints={lossPoints}
        messageCount={messageCount}
        baseModelDisplay={baseModelDisplay}
        onClose={onClose}
        onChat={onChat}
      />
    );
  }

  // Training in-progress
  return (
    <div className="space-y-6">
      {/* Header with mascot and message */}
      <div className="flex items-center gap-4">
        <ModeAwareMascot
          size={40}
          variant={getProgressGhostVariant(currentPhase)}
          modernVariant="sparkles"
          animate
        />
        <div>
          <p
            className={`text-sm ${
              isRetro
                ? "font-mono text-[var(--color-text-primary)]"
                : "font-[var(--font-body)] font-medium text-[var(--color-text-primary)]"
            }`}
          >
            {progress?.message ?? "Starting..."}
          </p>
          {progress?.step != null && progress?.total_steps != null && (
            <p
              className={`text-xs ${
                isRetro
                  ? "font-mono text-[var(--color-text-muted)]"
                  : "font-[var(--font-body)] text-[var(--color-text-muted)]"
              }`}
            >
              Step {progress.step} / {progress.total_steps}
            </p>
          )}
        </div>
      </div>

      {/* Phase progress steps */}
      <div className="space-y-3">
        {TRAINING_PHASES.filter((p) => p !== "complete").map((phase) => (
          <TrainingPhaseRow
            key={phase}
            phase={phase}
            currentPhase={currentPhase}
            isRetro={isRetro}
            progress={phase === currentPhase ? progress : null}
          />
        ))}
      </div>

      {/* Training step progress bar (shown during "training" phase) */}
      {currentPhase === "training" &&
        progress?.step != null &&
        progress?.total_steps != null && (
          <div className="space-y-1">
            <div className="flex justify-between">
              <span
                className={`text-xs ${isRetro ? "font-mono text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]"}`}
              >
                Training progress
              </span>
              <span
                className={`text-xs ${isRetro ? "font-mono text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]"}`}
              >
                {Math.round((progress.step / progress.total_steps) * 100)}%
              </span>
            </div>
            <div
              className={`h-2 overflow-hidden border ${
                isRetro
                  ? "bg-[var(--color-surface-elevated)] border-[var(--color-border)] rounded-none"
                  : "bg-[var(--color-surface-elevated)] border-[var(--color-border)] rounded-full"
              }`}
            >
              <motion.div
                className={`h-full ${isRetro ? "rounded-none" : "rounded-full"}`}
                initial={{ width: 0 }}
                animate={{
                  width: `${(progress.step / progress.total_steps) * 100}%`,
                }}
                transition={{ duration: 0.3 }}
                style={{
                  backgroundColor: isRetro
                    ? "var(--color-accent)"
                    : "var(--color-accent)",
                  boxShadow: isRetro
                    ? "0 0 8px var(--color-accent)"
                    : undefined,
                }}
              />
            </div>
          </div>
        )}

      {/* Live loss chart */}
      {(currentPhase === "training" || lossPoints.length > 0) && (
        <TrainingLossChart
          points={lossPoints}
          totalSteps={progress?.total_steps ?? null}
          isRetro={isRetro}
        />
      )}

      {/* Cancel button */}
      {isTraining && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onCancel}
            className={`
              px-4 py-2 text-sm transition-colors
              border text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
              ${
                isRetro
                  ? "font-mono border-[var(--color-border)] hover:border-[var(--color-text-secondary)] rounded-sm"
                  : "font-[var(--font-body)] border-[var(--color-border)] hover:border-[var(--color-text-secondary)] rounded-lg"
              }
            `}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// Success View
// ============================================

/** Format a run duration as "42s", "14m 32s", or "1h 05m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

interface SummaryStat {
  label: string;
  value: string;
  detail?: string;
}

/** Build the stat tiles. Values the run never reported are left out. */
function buildSummaryStats(
  summary: TrainingSummary | null,
  baseModelDisplay: string,
  isRetro: boolean,
): SummaryStat[] {
  const stats: SummaryStat[] = [];
  const digits = isRetro ? 4 : 2;
  if (summary?.steps != null) {
    stats.push({ label: "Steps", value: summary.steps.toLocaleString() });
  }
  if (summary?.finalLoss != null) {
    const { firstLoss, finalLoss } = summary;
    const dropped = firstLoss != null && firstLoss > finalLoss;
    stats.push({
      label: "Final loss",
      value: finalLoss.toFixed(digits),
      detail: dropped ? `from ${firstLoss.toFixed(digits)}` : undefined,
    });
  }
  if (summary) {
    stats.push({ label: "Time", value: formatDuration(summary.durationMs) });
  }
  stats.push({ label: "Base model", value: baseModelDisplay });
  return stats;
}

function SuccessView({
  isRetro,
  summary,
  lossPoints,
  messageCount,
  baseModelDisplay,
  onClose,
  onChat,
}: {
  isRetro: boolean;
  summary: TrainingSummary | null;
  lossPoints: LossPoint[];
  messageCount: number;
  baseModelDisplay: string;
  onClose: () => void;
  onChat?: () => void;
}) {
  const stats = buildSummaryStats(summary, baseModelDisplay, isRetro);
  const font = isRetro ? "font-mono" : "font-[var(--font-body)]";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex flex-col items-center text-center">
        {isRetro ? (
          <Ghost size={56} variant="excited" animate />
        ) : (
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-accent-subtle)] ring-1 ring-[var(--color-accent)]/30 flex items-center justify-center">
              <Sparkles size={28} className="text-[var(--color-accent)]" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-surface)] flex items-center justify-center">
              <Check size={12} strokeWidth={3} className="text-black" />
            </div>
          </div>
        )}
        <h3
          className={`
            mt-4
            ${isRetro ? "font-mono text-base text-[var(--color-accent)] [text-shadow:var(--shadow-glow)]" : "font-[var(--font-body)] text-lg font-semibold text-[var(--color-text-primary)]"}
          `}
        >
          {isRetro ? "> PERSONA ONLINE" : "Your persona is ready"}
        </h3>
        <p
          className={`mt-1 max-w-xs text-sm text-[var(--color-text-muted)] ${font}`}
        >
          It learned how you text from {messageCount.toLocaleString()} of your
          messages. Say hi and see how it sounds.
        </p>
      </div>

      {/* Run summary */}
      {isRetro ? (
        <dl className="p-4 space-y-1.5 border border-[var(--color-border)] rounded-sm bg-[var(--color-surface-elevated)] font-mono text-sm">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-2">
              <dt className="text-[var(--color-text-muted)] shrink-0">
                {stat.label.toLowerCase()}
              </dt>
              <span
                aria-hidden
                className="flex-1 overflow-hidden whitespace-nowrap text-[var(--color-border)]"
              >
                ..............................................
              </span>
              <dd className="text-[var(--color-text-primary)] shrink-0">
                {stat.value}
                {stat.detail && (
                  <span className="text-[var(--color-accent)]">
                    {" "}
                    ({stat.detail})
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]"
            >
              <dt className="font-[var(--font-body)] text-xs text-[var(--color-text-muted)]">
                {stat.label}
              </dt>
              <dd className="mt-1 flex items-baseline gap-2 font-[var(--font-body)]">
                <span className="text-base font-semibold tabular-nums text-[var(--color-text-primary)] truncate">
                  {stat.value}
                </span>
                {stat.detail && (
                  <span className="text-xs tabular-nums text-[var(--color-accent)] whitespace-nowrap">
                    {stat.detail}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Loss curve for the whole run */}
      {lossPoints.length > 1 && (
        <TrainingLossChart
          points={lossPoints}
          totalSteps={summary?.steps ?? null}
          isRetro={isRetro}
          height={110}
        />
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onChat && (
          <button
            onClick={onClose}
            className={`
              flex-1 px-4 py-2.5 text-sm transition-colors duration-200
              border border-[var(--color-border)] hover:border-[var(--color-text-secondary)]
              text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
              ${isRetro ? "font-mono rounded-sm" : "font-[var(--font-body)] rounded-lg"}
            `}
          >
            {isRetro ? "[DONE]" : "Done"}
          </button>
        )}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onChat ?? onClose}
          autoFocus
          className={`
            flex-1 px-4 py-2.5 text-sm font-medium transition-all duration-200
            flex items-center justify-center gap-2
            bg-[var(--color-accent)] text-black
            ${
              isRetro
                ? "font-mono rounded-sm shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-glow-strong)]"
                : "font-[var(--font-body)] rounded-lg hover:opacity-90"
            }
          `}
        >
          {onChat ? (
            isRetro ? (
              "[CHAT >]"
            ) : (
              <>
                <MessageCircle size={16} />
                Chat with your persona
              </>
            )
          ) : isRetro ? (
            "[DONE]"
          ) : (
            "Done"
          )}
        </motion.button>
      </div>
    </div>
  );
}

/** Single training phase row with status indicator */
function TrainingPhaseRow({
  phase,
  currentPhase,
  isRetro,
  progress,
}: {
  phase: TrainingModalPhase;
  currentPhase: TrainingModalPhase;
  isRetro: boolean;
  progress: ModalProgress | null;
}) {
  const phaseIndex = TRAINING_PHASES.indexOf(phase);
  const currentIndex = TRAINING_PHASES.indexOf(currentPhase);

  const isCompleted = phaseIndex < currentIndex || currentPhase === "complete";
  const isActive = phase === currentPhase;
  const isPending = phaseIndex > currentIndex;

  return (
    <div className={`flex items-center gap-3 ${isPending ? "opacity-40" : ""}`}>
      {/* Status icon */}
      <div className="flex-shrink-0">
        <StepStatusIcon
          status={isCompleted ? "completed" : isActive ? "active" : "pending"}
          size={20}
          checkSize={12}
          color="var(--color-accent)"
          isRetro={isRetro}
          checkFg="#000"
        />
      </div>

      {/* Label */}
      <span
        className={`text-sm ${
          isActive
            ? isRetro
              ? "font-mono text-[var(--color-accent)]"
              : "font-[var(--font-body)] font-medium text-[var(--color-text-primary)]"
            : isCompleted
              ? isRetro
                ? "font-mono text-[var(--color-text-primary)]"
                : "font-[var(--font-body)] text-[var(--color-text-primary)]"
              : isRetro
                ? "font-mono text-[var(--color-text-muted)]"
                : "font-[var(--font-body)] text-[var(--color-text-muted)]"
        }`}
      >
        {TRAINING_PHASE_LABELS[phase]}
      </span>

      {/* Active phase message */}
      {isActive && progress?.message && (
        <span
          className={`text-xs truncate ml-auto ${
            isRetro
              ? "font-mono text-[var(--color-text-muted)]"
              : "font-[var(--font-body)] text-[var(--color-text-muted)]"
          }`}
        >
          {progress.message}
        </span>
      )}
    </div>
  );
}

/** Get ghost variant for progress based on current training phase */
function getProgressGhostVariant(phase: TrainingModalPhase): GhostVariant {
  switch (phase) {
    case "exporting":
      return "excited";
    case "downloading":
      return "sleepy";
    case "training":
      return "thinking";
    case "finalizing":
      return "happy";
    case "complete":
      return "excited";
    case "error":
      return "sad";
    default:
      return "happy";
  }
}

export default TrainingModal;

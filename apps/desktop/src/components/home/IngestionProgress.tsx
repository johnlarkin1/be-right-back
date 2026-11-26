/**
 * IngestionProgress - 5-stage progress visualization with cancel support
 * Shows 5 independent progress bars, contact tracking, and cancel button
 */
import { motion } from "framer-motion";
import { Loader2, XCircle } from "lucide-react";
import { Casper, Ghost } from "@/components/Ghost";
import { ModeAwareMascot } from "@/components/ModeAwareMascot";
import { ResourceMonitor } from "@/components/home/ResourceMonitor";
import { StepStatusIcon } from "@/components/ui/StepStatusIcon";
import { useSystemResources } from "@/hooks/useSystemResources";
import { useUIMode } from "@/stores/themeStore";
import type {
  GhostVariant,
  StageProgress,
  IngestionStage,
  ContactProgress,
  StageStatus,
} from "@/types";
import { STAGE_LABELS, STAGE_COLORS, STAGE_GHOST_COLORS } from "@/types";

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

interface IngestionProgressProps {
  stages: StageProgress[];
  currentStage: IngestionStage | null;
  stats: IngestionStats;
  isComplete?: boolean;
  error?: string | null;
  isRunning?: boolean;
  /** First-run Python environment setup status, shown before any stage reports in. */
  setupMessage?: string | null;
  onCancel?: () => void;
  className?: string;
}

// Casper variants for different progress states
function getCasperVariant(
  stages: StageProgress[],
  isComplete: boolean,
): GhostVariant {
  if (isComplete) return "excited";

  const completedCount = stages.filter((s) => s.status === "completed").length;
  if (completedCount === 0) return "excited";
  if (completedCount <= 2) return "happy";
  if (completedCount <= 4) return "sleepy";
  return "happy";
}

// Get overall progress message
function getProgressMessage(
  stages: StageProgress[],
  currentStage: IngestionStage | null,
  isComplete: boolean,
): string {
  if (isComplete) return "All done!";

  const activeStage = stages.find((s) => s.status === "in_progress");
  if (activeStage?.message) return activeStage.message;
  if (currentStage) return `${STAGE_LABELS[currentStage]}...`;
  return "Starting...";
}

export function IngestionProgress({
  stages,
  currentStage,
  stats,
  isComplete = false,
  error = null,
  isRunning = false,
  setupMessage = null,
  onCancel,
  className = "",
}: IngestionProgressProps) {
  const { isRetro } = useUIMode();
  const casperVariant = getCasperVariant(stages, isComplete);
  const message = getProgressMessage(stages, currentStage, isComplete);
  const monitorActive = isRunning && !isComplete && !error;
  const resourceSamples = useSystemResources(monitorActive, currentStage);

  if (error) {
    return (
      <div className={`p-8 text-center ${className}`}>
        {isRetro ? (
          <Casper size={64} variant="sad" animate={true} />
        ) : (
          <div className="flex justify-center mb-2">
            <XCircle size={48} className="text-[var(--color-error)]" />
          </div>
        )}
        <p
          className={`mt-4 ${
            isRetro
              ? "font-mono text-[var(--color-crt-error)]"
              : "font-[var(--font-body)] font-medium text-[var(--color-error)]"
          }`}
        >
          Something went wrong
        </p>
        <p
          className={`text-sm mt-2 ${
            isRetro
              ? "font-mono text-[var(--color-crt-text-dim)]"
              : "text-[var(--color-text-secondary)]"
          }`}
        >
          {error}
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`p-6 ${className}`}
    >
      {/* First-run Python setup. Runs before any stage reports in and can take several
          minutes, so it gets its own banner rather than leaving the UI looking hung. */}
      {setupMessage && (
        <div
          className={`mb-6 flex items-center gap-3 rounded-[var(--radius-md)] p-3 ${
            isRetro
              ? "border border-[var(--color-crt-text-dim)] font-mono text-[var(--color-crt-text)]"
              : "bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]"
          }`}
        >
          <Loader2 size={16} className="shrink-0 animate-spin" />
          <div className="text-sm">
            <p>{setupMessage}</p>
            <p
              className={
                isRetro
                  ? "text-[var(--color-crt-text-dim)]"
                  : "text-[var(--color-text-muted)]"
              }
            >
              One-time setup — this only happens on first run.
            </p>
          </div>
        </div>
      )}

      {/* Header with Casper / modern icon */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <ModeAwareMascot
          size={48}
          variant={casperVariant}
          modernVariant="sparkles"
          animate={true}
        />
        <div className="text-left">
          <p
            className={`text-lg ${
              isRetro
                ? "font-mono text-[var(--color-crt-text)]"
                : "font-semibold text-[var(--color-text-primary)]"
            }`}
          >
            {message}
          </p>
          {!isComplete && stats.elapsedSecs > 0 && (
            <p
              className={`text-sm ${
                isRetro
                  ? "font-mono text-[var(--color-crt-text-dim)]"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              {formatTime(stats.elapsedSecs)} elapsed
              {stats.estimatedRemainingSecs &&
                ` • ~${formatTime(stats.estimatedRemainingSecs)} remaining`}
            </p>
          )}
        </div>
      </div>

      {/* 5 Stage Progress Bars */}
      <div className="space-y-4 mb-6">
        {stages.map((stage) => (
          <StageProgressBar
            key={stage.stage}
            stage={stage}
            isActive={stage.stage === currentStage}
            isRetro={isRetro}
          />
        ))}
      </div>

      {/* Live stats - fixed height container to prevent layout shifts */}
      <div className="h-[88px] mb-4">
        {currentStage &&
        ["chunking", "embedding", "saving"].includes(currentStage) ? (
          <div className="grid grid-cols-2 gap-4">
            <StatBox
              label="Chunks"
              current={stats.chunksEmbedded}
              total={stats.chunksCreated || 0}
              isRetro={isRetro}
            />
            {/* Contacts run heaviest first, so this count lags the chunk
                percentage badly. The label says so; do not read it as progress. */}
            <StatBox
              label="Contacts (largest first)"
              current={stats.contactsProcessed}
              total={stats.totalContacts}
              isRetro={isRetro}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 opacity-30">
            <StatBox label="Chunks" current={0} total={0} isRetro={isRetro} />
            <StatBox label="Contacts" current={0} total={0} isRetro={isRetro} />
          </div>
        )}
      </div>

      {/* Current contact - fixed height container */}
      <div className="h-[52px] mb-4">
        {stats.currentContact ? (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-3 rounded-[var(--radius-card)] border ${
              isRetro
                ? "bg-[var(--color-crt-bg-light)] border-[var(--color-crt-border)]"
                : "bg-[var(--color-surface-elevated)] border-[var(--color-border)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span
                  className={`text-xs ${
                    isRetro
                      ? "font-mono text-[var(--color-crt-text-dim)]"
                      : "text-[var(--color-text-muted)]"
                  }`}
                >
                  Processing:{" "}
                </span>
                <span
                  className={`text-sm ${
                    isRetro
                      ? "font-mono text-[var(--color-crt-text)]"
                      : "font-medium text-[var(--color-text-primary)]"
                  }`}
                >
                  {stats.currentContact.contact_name}
                </span>
              </div>
              <span
                className={`text-xs ${
                  isRetro
                    ? "font-mono text-[var(--color-crt-text-dim)]"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                {stats.currentContact.chunks_for_contact} chunks
              </span>
            </div>
          </motion.div>
        ) : (
          <div
            className={`p-3 rounded-[var(--radius-card)] border opacity-30 ${
              isRetro
                ? "bg-[var(--color-crt-bg-light)] border-[var(--color-crt-border)]"
                : "bg-[var(--color-surface-elevated)] border-[var(--color-border)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-xs ${
                  isRetro
                    ? "font-mono text-[var(--color-crt-text-dim)]"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                Waiting...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Ghost parade animation */}
      <GhostParade stages={stages} isActive={isRunning && !isComplete} />

      {/* Cancel button */}
      {isRunning && !isComplete && onCancel && (
        <div className="flex justify-center mt-2">
          <button
            onClick={onCancel}
            className={`px-4 py-2 text-sm rounded-[var(--radius-button)] transition-colors ${
              isRetro
                ? "font-mono text-[var(--color-crt-error)] border border-[var(--color-crt-error)] hover:bg-[var(--color-crt-error)] hover:text-[var(--color-crt-bg)]"
                : "font-medium text-[var(--color-error)] border border-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white"
            }`}
          >
            Cancel Ingestion
          </button>
        </div>
      )}

      {/* Docked resource strip. The spacer keeps the Cancel button clear of it. */}
      {monitorActive && (
        <>
          <div className="h-10" aria-hidden="true" />
          <ResourceMonitor samples={resourceSamples} />
        </>
      )}
    </motion.div>
  );
}

/** Single stage progress bar with indicator - uses stage-specific colors */
function StageProgressBar({
  stage,
  isActive,
  isRetro,
}: {
  stage: StageProgress;
  isActive: boolean;
  isRetro: boolean;
}) {
  const stageColor = STAGE_COLORS[stage.stage];
  const isPending = stage.status === "pending";
  const isInProgress = stage.status === "in_progress";
  const isCompleted = stage.status === "completed";

  const dimColor = isRetro
    ? "var(--color-crt-text-dim)"
    : "var(--color-text-muted)";

  return (
    <div className={`flex items-center gap-3 ${isPending ? "opacity-50" : ""}`}>
      {/* Status indicator */}
      <div className="flex-shrink-0">
        <StepStatusIcon
          status={
            isCompleted ? "completed" : isInProgress ? "active" : "pending"
          }
          size={24}
          color={stageColor}
          isRetro={isRetro}
          pendingColor={
            isRetro ? "var(--color-crt-border)" : "var(--color-border)"
          }
        />
      </div>

      {/* Label and progress bar */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span
            className={`text-xs ${isRetro ? "font-mono" : "font-medium"}`}
            style={{
              color:
                isActive || isCompleted
                  ? isRetro
                    ? stageColor
                    : "var(--color-text-primary)"
                  : dimColor,
            }}
          >
            {STAGE_LABELS[stage.stage]}
          </span>
          <span
            className={`text-xs ${isRetro ? "font-mono" : ""}`}
            style={{
              color:
                isActive || isCompleted
                  ? isRetro
                    ? stageColor
                    : "var(--color-text-primary)"
                  : dimColor,
            }}
          >
            {stage.percent}%
          </span>
        </div>
        <div
          className={`h-2 rounded-full overflow-hidden border ${
            isRetro
              ? "bg-[var(--color-crt-bg)] border-[var(--color-crt-border)]"
              : "bg-[var(--color-surface)] border-[var(--color-border)]"
          }`}
        >
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${stage.percent}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            style={{
              backgroundColor:
                isCompleted || isInProgress
                  ? isRetro
                    ? stageColor
                    : "var(--color-accent)"
                  : isRetro
                    ? "var(--color-crt-border)"
                    : "var(--color-border)",
              boxShadow:
                isInProgress && isRetro ? `0 0 8px ${stageColor}` : undefined,
            }}
          />
        </div>
        {/* Show message for active stage */}
        {isActive && stage.message && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`text-xs mt-1 truncate ${
              isRetro
                ? "font-mono text-[var(--color-crt-text-dim)]"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {stage.message}
          </motion.p>
        )}
      </div>
    </div>
  );
}

/** Stat counter — displays current value directly (no animation).
 *  With throttled progress events (2/sec), the numbers update smoothly
 *  without needing animated counters that cause cascading re-renders. */
function StatBox({
  label,
  current,
  total,
  isRetro,
}: {
  label: string;
  current: number;
  total: number;
  isRetro: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-[var(--radius-card)] border ${
        isRetro
          ? "bg-[var(--color-crt-bg-light)] border-[var(--color-crt-border)]"
          : "bg-[var(--color-surface-elevated)] border-[var(--color-border)]"
      }`}
    >
      <p
        className={`text-xs ${
          isRetro
            ? "font-mono text-[var(--color-crt-text-dim)]"
            : "text-[var(--color-text-muted)]"
        }`}
      >
        {label}
      </p>
      <div
        className={`mt-1 text-lg ${
          isRetro
            ? "font-mono text-[var(--color-crt-text)]"
            : "font-semibold text-[var(--color-text-primary)]"
        }`}
      >
        <span>{current.toLocaleString()}</span>
        {total > 0 && (
          <span
            className={
              isRetro
                ? "text-[var(--color-crt-text-dim)]"
                : "text-[var(--color-text-secondary)]"
            }
          >
            {" "}
            / {total.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

/** Format seconds to human readable time */
function formatTime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainingSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * GhostParade - 5 ghosts marching in a loop, one for each stage
 * Each ghost uses its stage's color and expression changes based on status
 */
function GhostParade({
  stages,
  isActive,
}: {
  stages: StageProgress[];
  isActive: boolean;
}) {
  if (!isActive) return null;

  // Get expression based on stage status
  const getGhostVariant = (status: StageStatus): GhostVariant => {
    switch (status) {
      case "completed":
        return "happy"; // Satisfied, not over-excited
      case "in_progress":
        return "excited"; // Working hard!
      case "pending":
        return "sleepy"; // Waiting for their turn
    }
  };

  return (
    <div className="flex justify-center py-4 mt-2">
      {/* Ghost parade - centered, bouncing in place */}
      <div className="flex gap-3 items-end px-4">
        {stages.map((stage, i) => (
          <motion.div
            key={stage.stage}
            animate={{ y: [0, -8, 0] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              delay: i * 0.2, // Staggered bounce for "walking" effect
              ease: "easeInOut",
            }}
          >
            <Ghost
              size={36}
              color={STAGE_GHOST_COLORS[stage.stage]}
              variant={getGhostVariant(stage.status)}
              animate={false} // We handle animation ourselves
              glowIntensity={
                stage.status === "in_progress" ? "strong" : "subtle"
              }
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default IngestionProgress;

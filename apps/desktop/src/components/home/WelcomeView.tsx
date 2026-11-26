/**
 * WelcomeView - First-run onboarding experience with Casper
 * Guides users through permissions, snapshot creation, and ingestion
 * Supports dual UI modes (retro/modern)
 */
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { openFdaSettings, getInitializationStatus } from "@/services/tauri";
import {
  Sparkles,
  ArrowRight,
  Shield,
  Lock,
  Settings,
  Check,
  Zap,
} from "lucide-react";
import { Casper } from "@/components/Ghost";
import { CasperWelcome } from "@/components/casper";
import { PrivacyBadge, PrivacyInfo } from "./PrivacyBadge";
import { IngestionCTA } from "./IngestionCTA";
import { IngestionProgress } from "./IngestionProgress";
import { useOnboarding, CASPER_DIALOGUES } from "@/hooks/useOnboarding";
import { useIngestion } from "@/hooks/useIngestion";
import { useUIMode } from "@/stores/themeStore";
import type { InitializationStatus } from "@/types";

interface WelcomeViewProps {
  initStatus: InitializationStatus | null;
  onComplete: () => void;
  className?: string;
}

export function WelcomeView({
  initStatus,
  onComplete,
  className = "",
}: WelcomeViewProps) {
  const { isRetro } = useUIMode();
  const { state, advance, goToStep, updateFromStatus } = useOnboarding();
  const ingestion = useIngestion();
  const [isFDAChecking, setIsFDAChecking] = useState(false);
  const ingestionStartedRef = useRef(false); // Prevent double-starts

  // Update onboarding state from init status
  useEffect(() => {
    if (initStatus) {
      updateFromStatus(initStatus);
    }
  }, [initStatus, updateFromStatus]);

  // Derive the actual step from backend status (source of truth)
  // This prevents showing stale localStorage state on initial render
  const derivedStep = (() => {
    if (!initStatus) return state.currentStep;

    // If user navigated to ingestion_running, stay there until complete or error
    // This takes priority over backend status checks
    if (state.currentStep === "ingestion_running") {
      // Only leave ingestion_running if we got an error or completed
      if (ingestion.error) {
        return "ingestion_ready" as const; // Go back to retry
      }
      if (ingestion.isComplete) {
        return "complete" as const;
      }
      // Stay on ingestion_running - show the progress UI
      return "ingestion_running" as const;
    }

    // If ingestion just completed, stay on complete even if initStatus hasn't refreshed yet
    if (state.currentStep === "complete" && ingestion.isComplete) {
      return "complete" as const;
    }

    // Backend is source of truth for what step we should be on
    // Require BOTH snapshot AND databases to be complete
    if (initStatus.has_snapshot && initStatus.has_sqlite_db) {
      return "complete" as const;
    } else if (initStatus.has_snapshot) {
      return "ingestion_ready" as const;
    } else if (initStatus.has_fda_permission) {
      return "first_snapshot" as const;
    } else {
      // No FDA - but preserve welcome/privacy flow
      if (
        state.currentStep === "welcome" ||
        state.currentStep === "privacy_intro"
      ) {
        return state.currentStep;
      }
      return "permissions" as const;
    }
  })();

  // Use derived step for rendering, but keep state for other purposes
  const currentStep = derivedStep;

  // Handle FDA permission check
  const handleCheckFDA = async () => {
    setIsFDAChecking(true);
    try {
      // Check if already granted before opening settings
      const status = await getInitializationStatus();
      updateFromStatus(status);
      if (status.has_fda_permission) {
        advance();
        setIsFDAChecking(false);
        return;
      }

      // Open System Preferences to FDA pane
      await openFdaSettings();

      // Poll for permission after user returns from System Preferences
      setTimeout(async () => {
        const refreshed = await getInitializationStatus();
        updateFromStatus(refreshed);
        if (refreshed.has_fda_permission) {
          advance();
        }
        setIsFDAChecking(false);
      }, 1000);
    } catch (err) {
      console.error("Failed to check FDA permission:", err);
      setIsFDAChecking(false);
    }
  };

  // Handle snapshot + ingestion
  const handleStartIngestion = async () => {
    // Prevent double-starts (can happen with re-renders)
    if (ingestionStartedRef.current || ingestion.isRunning) {
      console.log("Ingestion already in progress, ignoring duplicate call");
      return;
    }
    ingestionStartedRef.current = true;

    try {
      goToStep("ingestion_running");
      const result = await ingestion.startIngestion();
      if (result?.success) {
        goToStep("complete");
      }
    } finally {
      ingestionStartedRef.current = false;
    }
  };

  // Handle completion
  const handleComplete = () => {
    onComplete();
  };

  // Render based on current step (using derived step from backend status)
  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        if (isRetro) {
          return (
            <CasperWelcome
              step="welcome"
              variant="excited"
              message={CASPER_DIALOGUES.welcome.message}
              onContinue={advance}
            />
          );
        }
        // Modern welcome view
        return (
          <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">
            <div className="w-20 h-20 rounded-2xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
              <Sparkles size={40} className="text-[var(--color-accent)]" />
            </div>
            <div className="text-center">
              <h1 className="text-3xl font-semibold text-[var(--color-text-primary)] mb-3">
                Welcome to Be Right Back
              </h1>
              <p className="text-[var(--color-text-secondary)] max-w-md">
                Create AI personas from your conversations. Private, local, and
                personal.
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={advance}
              className="flex items-center gap-2 px-6 py-3 bg-[var(--color-accent)] text-white rounded-[var(--radius-button)] font-medium hover:brightness-110 shadow-lg transition-all"
            >
              <span>Get Started</span>
              <ArrowRight size={18} />
            </motion.button>
          </div>
        );

      case "privacy_intro":
        return (
          <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">
            {isRetro ? (
              <Casper size={64} variant="happy" animate={true} />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <Shield size={32} className="text-[var(--color-accent)]" />
              </div>
            )}

            <div className="text-center">
              <h2
                className={
                  isRetro
                    ? "font-mono text-xl text-[var(--color-crt-text)] mb-2"
                    : "text-xl font-semibold text-[var(--color-text-primary)] mb-2"
                }
              >
                Privacy First
              </h2>
              <p
                className={
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text-dim)]"
                    : "text-sm text-[var(--color-text-secondary)]"
                }
              >
                {CASPER_DIALOGUES.privacy_intro.message}
              </p>
            </div>

            <PrivacyInfo className="w-full" />

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={advance}
              className={`mt-4 px-6 py-2 rounded-[var(--radius-button)] font-medium transition-all ${
                isRetro
                  ? "bg-[var(--color-crt-text)] text-[var(--color-crt-bg)] font-mono font-bold"
                  : "bg-[var(--color-accent)] text-white hover:brightness-110"
              }`}
            >
              I understand, continue
            </motion.button>
          </div>
        );

      case "permissions":
        return (
          <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">
            {isRetro ? (
              <Casper size={64} variant="mischievous" animate={true} />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <Lock size={32} className="text-[var(--color-accent)]" />
              </div>
            )}

            <div className="text-center">
              <h2
                className={
                  isRetro
                    ? "font-mono text-xl text-[var(--color-crt-text)] mb-2"
                    : "text-xl font-semibold text-[var(--color-text-primary)] mb-2"
                }
              >
                Permission Required
              </h2>
              <p
                className={
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text-dim)]"
                    : "text-sm text-[var(--color-text-secondary)]"
                }
              >
                {CASPER_DIALOGUES.permissions.message}
              </p>
            </div>

            <div
              className={`w-full p-4 rounded-[var(--radius-card)] ${
                isRetro
                  ? "bg-[var(--color-crt-bg-light)] border border-[var(--color-crt-border)]"
                  : "bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
              }`}
            >
              <p
                className={`mb-3 ${
                  isRetro
                    ? "font-mono text-xs text-[var(--color-crt-text-dim)]"
                    : "text-xs text-[var(--color-text-muted)]"
                }`}
              >
                To grant Full Disk Access:
              </p>
              <ol
                className={`space-y-2 list-decimal list-inside ${
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text)]"
                    : "text-sm text-[var(--color-text-primary)]"
                }`}
              >
                <li>Click the button below</li>
                <li>Find "Be Right Back" in the list</li>
                <li>Toggle the switch to enable access</li>
                <li>Come back here when done</li>
              </ol>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleCheckFDA}
              disabled={isFDAChecking}
              className={`flex items-center gap-2 px-6 py-3 rounded-[var(--radius-button)] font-medium disabled:opacity-50 transition-all ${
                isRetro
                  ? "bg-[var(--color-crt-text)] text-[var(--color-crt-bg)] font-mono font-bold"
                  : "bg-[var(--color-accent)] text-white hover:brightness-110"
              }`}
            >
              {!isRetro && <Settings size={18} />}
              {isFDAChecking ? "Checking..." : "Open System Settings"}
            </motion.button>

            {initStatus?.has_fda_permission && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center"
              >
                <p
                  className={`flex items-center justify-center gap-2 ${
                    isRetro
                      ? "font-mono text-sm text-[var(--color-crt-text)]"
                      : "text-sm text-[var(--color-success)]"
                  }`}
                >
                  {!isRetro && <Check size={16} />}
                  Permission granted!
                </p>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={advance}
                  className={`mt-2 flex items-center gap-2 px-4 py-2 rounded-[var(--radius-button)] font-medium transition-all ${
                    isRetro
                      ? "bg-[var(--color-ghost-pink)] text-black font-mono font-bold"
                      : "bg-[var(--color-accent)] text-white hover:brightness-110"
                  }`}
                >
                  Continue
                  {!isRetro && <ArrowRight size={16} />}
                </motion.button>
              </motion.div>
            )}
          </div>
        );

      case "first_snapshot":
      case "ingestion_ready":
        return (
          <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">
            {isRetro ? (
              <Casper size={64} variant="excited" animate={true} />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent-subtle)] flex items-center justify-center">
                <Zap size={32} className="text-[var(--color-accent)]" />
              </div>
            )}

            <div className="text-center">
              <h2
                className={
                  isRetro
                    ? "font-mono text-xl text-[var(--color-crt-text)] mb-2"
                    : "text-xl font-semibold text-[var(--color-text-primary)] mb-2"
                }
              >
                Ready to Begin
              </h2>
              <p
                className={
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text-dim)]"
                    : "text-sm text-[var(--color-text-secondary)]"
                }
              >
                {currentStep === "first_snapshot"
                  ? CASPER_DIALOGUES.first_snapshot.message
                  : CASPER_DIALOGUES.ingestion_ready.message}
              </p>
            </div>

            <IngestionCTA
              onStart={handleStartIngestion}
              variant="primary"
              hasExistingSnapshot={false}
              isLoading={ingestion.isRunning}
              disabled={ingestion.isRunning}
            />

            <PrivacyBadge variant="inline" />
          </div>
        );

      case "ingestion_running":
        return (
          <div className="max-w-4xl w-full mx-auto px-6">
            <IngestionProgress
              stages={ingestion.stages}
              currentStage={ingestion.currentStage}
              stats={ingestion.stats}
              isComplete={ingestion.isComplete}
              error={ingestion.error}
              isRunning={ingestion.isRunning}
              onCancel={ingestion.cancelIngestion}
            />
          </div>
        );

      case "complete":
        return (
          <div className="flex flex-col items-center gap-6 p-8 max-w-lg mx-auto">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              {isRetro ? (
                <Casper size={96} variant="excited" animate={true} />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-[var(--color-success)]/10 flex items-center justify-center">
                  <Check size={48} className="text-[var(--color-success)]" />
                </div>
              )}
            </motion.div>

            <div className="text-center">
              <h2
                className={
                  isRetro
                    ? "font-mono text-xl text-[var(--color-crt-text)] mb-2"
                    : "text-xl font-semibold text-[var(--color-text-primary)] mb-2"
                }
              >
                All Done!
              </h2>
              <p
                className={
                  isRetro
                    ? "font-mono text-sm text-[var(--color-crt-text-dim)]"
                    : "text-sm text-[var(--color-text-secondary)]"
                }
              >
                {CASPER_DIALOGUES.complete.message}
              </p>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleComplete}
              className={`flex items-center gap-2 px-8 py-3 rounded-[var(--radius-button)] text-lg font-medium transition-all ${
                isRetro
                  ? "bg-[var(--color-ghost-pink)] text-black font-mono font-bold"
                  : "bg-[var(--color-accent)] text-white hover:brightness-110 shadow-lg"
              }`}
              style={
                isRetro
                  ? { boxShadow: "0 0 16px rgba(255, 105, 180, 0.4)" }
                  : undefined
              }
            >
              Go to Dashboard
              {!isRetro && <ArrowRight size={20} />}
            </motion.button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={`flex flex-col items-center justify-center min-h-full w-full ${className}`}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="w-full"
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default WelcomeView;

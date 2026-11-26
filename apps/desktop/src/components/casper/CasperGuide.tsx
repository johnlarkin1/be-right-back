/**
 * CasperGuide - Casper with dialogue bubble for onboarding
 * Manages the visual presentation of Casper during the onboarding flow
 */
import { motion } from "framer-motion";
import { Casper } from "@/components/Ghost";
import { CasperDialogue } from "./CasperDialogue";
import type { GhostVariant, OnboardingStep } from "@/types";

interface CasperGuideProps {
  step: OnboardingStep;
  variant?: GhostVariant;
  message: string;
  size?: "small" | "medium" | "large";
  minimized?: boolean;
  onExpand?: () => void;
  showDialogue?: boolean;
  dialoguePosition?: "top" | "bottom" | "left" | "right";
  className?: string;
}

const SIZE_MAP = {
  small: 48,
  medium: 64,
  large: 96,
};

export function CasperGuide({
  step: _step,
  variant = "happy",
  message,
  size = "large",
  minimized = false,
  onExpand,
  showDialogue = true,
  dialoguePosition = "right",
  className = "",
}: CasperGuideProps) {
  const ghostSize = SIZE_MAP[size];

  // Minimized state - small Casper in corner
  if (minimized) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={onExpand}
        className={`fixed bottom-4 right-4 z-50 cursor-pointer ${className}`}
        title="Click to expand Casper"
      >
        <Casper size={32} variant="happy" animate={true} />
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute -top-1 -right-1 w-3 h-3 bg-[var(--color-ghost-pink)] rounded-full"
        />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`relative inline-flex items-center ${className}`}
    >
      {/* Casper ghost */}
      <div className="relative">
        <Casper size={ghostSize} variant={variant} animate={true} />

        {/* Dialogue bubble */}
        {showDialogue && message && (
          <CasperDialogue
            message={message}
            isVisible={showDialogue}
            position={dialoguePosition}
          />
        )}
      </div>
    </motion.div>
  );
}

/** Casper with centered layout for welcome screens */
interface CasperWelcomeProps {
  step: OnboardingStep;
  variant?: GhostVariant;
  message: string;
  onContinue?: () => void;
  showContinue?: boolean;
  continueLabel?: string;
}

export function CasperWelcome({
  step: _step,
  variant = "excited",
  message,
  onContinue,
  showContinue = true,
  continueLabel = "Continue",
}: CasperWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      {/* Casper */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
      >
        <Casper size={96} variant={variant} animate={true} />
      </motion.div>

      {/* Message bubble below */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="max-w-md text-center"
      >
        <div
          className="bg-[var(--color-crt-bg-light)] border border-[var(--color-ghost-pink)] rounded-lg px-6 py-4"
          style={{ boxShadow: "0 0 16px rgba(255, 105, 180, 0.2)" }}
        >
          <p className="text-base font-mono text-[var(--color-crt-text)] leading-relaxed">
            {message}
          </p>
        </div>
      </motion.div>

      {/* Continue button */}
      {showContinue && onContinue && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onContinue}
          className="mt-4 px-6 py-2 bg-[var(--color-ghost-pink)] text-black font-mono font-bold rounded transition-all hover:brightness-110"
          style={{ boxShadow: "0 0 12px rgba(255, 105, 180, 0.4)" }}
        >
          {continueLabel}
        </motion.button>
      )}
    </div>
  );
}

export default CasperGuide;

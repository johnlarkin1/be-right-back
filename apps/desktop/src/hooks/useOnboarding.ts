/**
 * Hook for managing Casper onboarding state machine
 */
import { useState, useEffect, useCallback } from "react";
import type {
  OnboardingStep,
  OnboardingState,
  InitializationStatus,
} from "@/types";

const STORAGE_KEY = "brb-onboarding-state";

const initialState: OnboardingState = {
  currentStep: "welcome",
  hasSeenWelcome: false,
  hasGrantedFDA: false,
  hasFirstSnapshot: false,
  hasCompletedIngestion: false,
  casperMinimized: false,
};

/** Casper dialogue content for each step */
export const CASPER_DIALOGUES: Record<
  OnboardingStep,
  { variant: string; message: string }
> = {
  welcome: {
    variant: "excited",
    message:
      "Hi! I'm Casper, your friendly guide. I'll help you set up Be Right Back - everything stays on your device!",
  },
  privacy_intro: {
    variant: "happy",
    message:
      "Your privacy is my top priority. Your messages and trained models never leave your Mac. All processing happens locally.",
  },
  permissions: {
    variant: "mischievous",
    message:
      "I need Full Disk Access to read your iMessage history. Don't worry, I promise I'll be careful with your data!",
  },
  first_snapshot: {
    variant: "excited",
    message:
      "This makes a safe copy of your messages that I can work with. Again, 100% local. You can shut your wifi off for this portion if you want.",
  },
  ingestion_ready: {
    variant: "happy",
    message:
      "Great! Now let's process your messages and set up the database. This usually takes a few minutes.",
  },
  ingestion_running: {
    variant: "sleepy",
    message:
      "Working on it... I'm organizing all your messages so they're ready for later.",
  },
  complete: {
    variant: "excited",
    message:
      "All done! Your data is ready. Head to the Chat tab when you're ready to explore your conversations.",
  },
  hidden: {
    variant: "standard",
    message: "",
  },
};

interface UseOnboardingReturn {
  state: OnboardingState;
  currentDialogue: { variant: string; message: string };
  advance: () => void;
  goToStep: (step: OnboardingStep) => void;
  updateFromStatus: (status: InitializationStatus) => void;
  minimizeCasper: () => void;
  expandCasper: () => void;
  reset: () => void;
  isComplete: boolean;
}

export function useOnboarding(): UseOnboardingReturn {
  const [state, setState] = useState<OnboardingState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved) as OnboardingState;
      }
    } catch (e) {
      console.warn("Failed to parse onboarding state:", e);
    }
    return initialState;
  });

  // Persist state changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save onboarding state:", e);
    }
  }, [state]);

  // Determine next step based on current state
  const getNextStep = useCallback(
    (current: OnboardingState): OnboardingStep => {
      switch (current.currentStep) {
        case "welcome":
          return "privacy_intro";
        case "privacy_intro":
          return current.hasGrantedFDA ? "first_snapshot" : "permissions";
        case "permissions":
          return current.hasGrantedFDA ? "first_snapshot" : "permissions";
        case "first_snapshot":
          return current.hasFirstSnapshot
            ? "ingestion_ready"
            : "first_snapshot";
        case "ingestion_ready":
          return "ingestion_running";
        case "ingestion_running":
          return current.hasCompletedIngestion
            ? "complete"
            : "ingestion_running";
        case "complete":
          return "complete";
        case "hidden":
          return "hidden";
        default:
          return "welcome";
      }
    },
    [],
  );

  // Advance to next step
  const advance = useCallback(() => {
    setState((prev) => {
      const nextStep = getNextStep(prev);
      return {
        ...prev,
        currentStep: nextStep,
        hasSeenWelcome: prev.hasSeenWelcome || prev.currentStep === "welcome",
      };
    });
  }, [getNextStep]);

  // Jump to a specific step
  const goToStep = useCallback((step: OnboardingStep) => {
    setState((prev) => ({
      ...prev,
      currentStep: step,
    }));
  }, []);

  // Update state based on initialization status from backend
  // This syncs localStorage state with actual filesystem state
  const updateFromStatus = useCallback((status: InitializationStatus) => {
    setState((prev) => {
      const hasGrantedFDA = status.has_fda_permission;
      const hasFirstSnapshot = status.has_snapshot;
      const hasCompletedIngestion = status.has_sqlite_db;

      // Determine the correct step based on backend reality
      let newStep: OnboardingStep;

      // Backend is source of truth - determine step based on what actually exists
      // Need BOTH a snapshot AND ingested data to be truly complete
      if (hasFirstSnapshot && hasCompletedIngestion) {
        // We have both snapshot and ingested data - we're done
        newStep = "complete";
      } else if (hasFirstSnapshot) {
        // Have snapshot but no ingestion yet
        newStep = "ingestion_ready";
      } else if (hasGrantedFDA) {
        // Have FDA permission but no snapshot
        newStep = "first_snapshot";
      } else {
        // Need FDA permission - but preserve progress through welcome/privacy screens
        if (
          prev.currentStep === "welcome" ||
          prev.currentStep === "privacy_intro"
        ) {
          newStep = prev.currentStep;
        } else {
          newStep = "permissions";
        }
      }

      console.log("[useOnboarding] updateFromStatus:", {
        backend: { hasGrantedFDA, hasFirstSnapshot, hasCompletedIngestion },
        prev: {
          currentStep: prev.currentStep,
          hasCompletedIngestion: prev.hasCompletedIngestion,
        },
        newStep,
      });

      return {
        ...prev,
        hasGrantedFDA,
        hasFirstSnapshot,
        hasCompletedIngestion,
        currentStep: newStep,
      };
    });
  }, []);

  // Minimize Casper to corner
  const minimizeCasper = useCallback(() => {
    setState((prev) => ({
      ...prev,
      casperMinimized: true,
    }));
  }, []);

  // Expand Casper back
  const expandCasper = useCallback(() => {
    setState((prev) => ({
      ...prev,
      casperMinimized: false,
    }));
  }, []);

  // Reset onboarding
  const reset = useCallback(() => {
    setState(initialState);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const currentDialogue = CASPER_DIALOGUES[state.currentStep];
  // Need both a snapshot AND completed ingestion to be truly complete
  const isComplete =
    state.currentStep === "complete" ||
    (state.hasFirstSnapshot && state.hasCompletedIngestion);

  return {
    state,
    currentDialogue,
    advance,
    goToStep,
    updateFromStatus,
    minimizeCasper,
    expandCasper,
    reset,
    isComplete,
  };
}

export default useOnboarding;

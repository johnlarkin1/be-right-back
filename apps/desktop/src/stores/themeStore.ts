/**
 * Theme Store - Manages UI mode (retro/modern) with persistence
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UIMode = "retro" | "modern";

interface ThemeState {
  mode: UIMode;
  setMode: (mode: UIMode) => void;
  toggleMode: () => void;
}

/**
 * Apply theme to document root element
 */
function applyTheme(mode: UIMode) {
  document.documentElement.setAttribute("data-theme", mode);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "retro", // Default to existing retro experience

      setMode: (mode) => {
        set({ mode });
        applyTheme(mode);
      },

      toggleMode: () => {
        set((state) => {
          const newMode = state.mode === "retro" ? "modern" : "retro";
          applyTheme(newMode);
          return { mode: newMode };
        });
      },
    }),
    {
      name: "brb-ui-mode", // localStorage key
    },
  ),
);

// Apply initial theme from persisted storage (runs after hydration)
if (typeof window !== "undefined") {
  // Subscribe to rehydration to apply theme
  useThemeStore.persist.onFinishHydration((state) => {
    applyTheme(state.mode);
  });
}

/**
 * Hook for conditional rendering based on mode
 */
export function useUIMode() {
  const mode = useThemeStore((state) => state.mode);
  return {
    mode,
    isRetro: mode === "retro",
    isModern: mode === "modern",
  };
}

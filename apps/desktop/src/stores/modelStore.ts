/**
 * Zustand store for model tier selection.
 *
 * SQLite is the source of truth — this store is a frontend cache
 * that fetches from the backend on mount.
 */
import { create } from "zustand";
import type { ModelTierInfo, ModelChangeResult } from "@/types";
import {
  getAvailableModels,
  setModelPreference,
  resetModelPreference,
} from "@/services/tauri";

interface ModelState {
  tiers: ModelTierInfo[];
  isLoading: boolean;
  isChanging: boolean;

  /** Fetch all tiers from the backend. */
  fetchTiers: () => Promise<void>;

  /** Select a specific tier + optional quantization. Returns the change result. */
  selectTier: (
    tierName: string,
    quantization?: string,
  ) => Promise<ModelChangeResult>;

  /** Reset to auto-recommended model. */
  resetToAuto: () => Promise<ModelChangeResult>;
}

export const useModelStore = create<ModelState>((set, get) => ({
  tiers: [],
  isLoading: false,
  isChanging: false,

  fetchTiers: async () => {
    set({ isLoading: true });
    try {
      const tiers = await getAvailableModels();
      set({ tiers });
    } catch (err) {
      console.error("Failed to fetch model tiers:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  selectTier: async (tierName, quantization) => {
    set({ isChanging: true });
    try {
      const result = await setModelPreference(tierName, quantization);
      // Refresh tiers to reflect the new selection
      await get().fetchTiers();
      return result;
    } finally {
      set({ isChanging: false });
    }
  },

  resetToAuto: async () => {
    set({ isChanging: true });
    try {
      const result = await resetModelPreference();
      await get().fetchTiers();
      return result;
    } finally {
      set({ isChanging: false });
    }
  },
}));

// Derived selectors
export const useSelectedTier = () =>
  useModelStore((s) => s.tiers.find((t) => t.is_selected));

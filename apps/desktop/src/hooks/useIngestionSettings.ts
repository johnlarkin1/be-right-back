/**
 * Hook for managing ingestion settings
 *
 * Loads saved settings from the database and date range from the snapshot.
 * Provides methods to update and save settings.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getIngestionSettings as fetchSettings,
  getMessageDateRange as fetchDateRange,
  getInitializationStatus as fetchInitStatus,
  saveIngestionSettings as saveTauriSettings,
} from "@/services/tauri";
import type {
  IngestionSettings,
  AnalyticsSettings,
  MessageDateRange,
} from "@/types";
import {
  DEFAULT_INGESTION_SETTINGS,
  DEFAULT_ANALYTICS_SETTINGS,
} from "@/types";

interface UseIngestionSettingsReturn {
  /** Current settings state */
  settings: IngestionSettings;
  /** Date range of messages in the snapshot (for prepopulating date pickers) */
  dateRange: MessageDateRange | null;
  /** Total embedding chunks in DuckDB (for computing preview settings from target topics) */
  chunkCount: number;
  /** Whether settings are loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Update top-level settings (startDate, endDate, minMessagesPerContact) */
  updateSettings: (partial: Partial<IngestionSettings>) => void;
  /** Update analytics settings */
  updateAnalytics: (partial: Partial<AnalyticsSettings>) => void;
  /** Save settings to database */
  saveSettings: () => Promise<void>;
  /** Reset settings to defaults */
  resetToDefaults: () => void;
  /** Reset settings to the last-loaded saved state (discard unsaved changes) */
  resetToSaved: () => void;
}

export function useIngestionSettings(): UseIngestionSettingsReturn {
  const [settings, setSettings] = useState<IngestionSettings>(
    DEFAULT_INGESTION_SETTINGS,
  );
  const [dateRange, setDateRange] = useState<MessageDateRange | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of settings as loaded from the backend, used to discard unsaved changes
  const savedSettingsRef = useRef<IngestionSettings>(
    DEFAULT_INGESTION_SETTINGS,
  );

  // Load settings and date range on mount
  useEffect(() => {
    async function load() {
      try {
        // Load all in parallel
        const [savedSettings, range, initStatus] = await Promise.all([
          fetchSettings(),
          fetchDateRange().catch(() => null),
          fetchInitStatus().catch(() => null),
        ]);

        if (initStatus) {
          setChunkCount(initStatus.chunk_count);
        }

        // Merge saved settings with defaults, always defaulting dates to the current snapshot range.
        // The saved endDate may be stale (from a previous ingestion before new messages arrived),
        // so we always prefer the latest date from the snapshot.
        let loaded: IngestionSettings;
        if (savedSettings) {
          loaded = {
            ...DEFAULT_INGESTION_SETTINGS,
            ...savedSettings,
            // Always default to the full snapshot date range
            start_date:
              range?.earliest_date ?? savedSettings.start_date ?? null,
            end_date: range?.latest_date ?? savedSettings.end_date ?? null,
            analytics: savedSettings.analytics
              ? { ...DEFAULT_ANALYTICS_SETTINGS, ...savedSettings.analytics }
              : DEFAULT_ANALYTICS_SETTINGS,
          };
        } else if (range) {
          // No saved settings, use defaults with full date range
          loaded = {
            ...DEFAULT_INGESTION_SETTINGS,
            start_date: range.earliest_date,
            end_date: range.latest_date,
          };
        } else {
          loaded = DEFAULT_INGESTION_SETTINGS;
        }

        savedSettingsRef.current = loaded;
        setSettings(loaded);

        if (range) {
          setDateRange(range);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Update top-level settings
  const updateSettings = useCallback((partial: Partial<IngestionSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  // Update analytics settings
  const updateAnalytics = useCallback((partial: Partial<AnalyticsSettings>) => {
    setSettings((prev) => ({
      ...prev,
      analytics: prev.analytics
        ? { ...prev.analytics, ...partial }
        : { ...DEFAULT_ANALYTICS_SETTINGS, ...partial },
    }));
  }, []);

  // Save settings to database
  const saveSettings = useCallback(async () => {
    try {
      await saveTauriSettings(settings);
    } catch (err) {
      console.error("Failed to save settings:", err);
      throw err;
    }
  }, [settings]);

  // Reset to defaults (using current date range for date fields)
  const resetToDefaults = useCallback(() => {
    setSettings({
      ...DEFAULT_INGESTION_SETTINGS,
      start_date: dateRange?.earliest_date ?? null,
      end_date: dateRange?.latest_date ?? null,
    });
  }, [dateRange]);

  // Reset to the last-loaded saved state (discard unsaved changes)
  const resetToSaved = useCallback(() => {
    setSettings(savedSettingsRef.current);
  }, []);

  return {
    settings,
    dateRange,
    chunkCount,
    isLoading,
    error,
    updateSettings,
    updateAnalytics,
    saveSettings,
    resetToDefaults,
    resetToSaved,
  };
}

export default useIngestionSettings;

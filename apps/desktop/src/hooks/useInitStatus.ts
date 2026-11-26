/**
 * Hook for fetching initialization status from the Tauri backend.
 * Eliminates duplicated invoke("get_initialization_status") calls
 * across HomeLayout, ChatLayout, InsightsLayout, and DashboardView.
 */
import { useState, useEffect, useCallback } from "react";
import { getInitializationStatus } from "@/services/tauri";
import type { InitializationStatus } from "@/types";

interface UseInitStatusReturn {
  status: InitializationStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useInitStatus(): UseInitStatusReturn {
  const [status, setStatus] = useState<InitializationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getInitializationStatus();
      setStatus(result);
    } catch (err) {
      console.error("Failed to fetch initialization status:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refresh: fetchStatus,
  };
}

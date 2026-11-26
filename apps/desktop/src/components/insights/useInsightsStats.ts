/**
 * useInsightsStats - Hook for fetching stats data (aggregation-independent)
 *
 * Stats are fetched once on mount and cached until explicit invalidation.
 * Changing aggregation type does NOT refetch stats.
 */
import { useEffect, useCallback } from "react";
import { getInsightsStats } from "@/services/tauri";
import { useInsightsStore, useStatsFromStore } from "@/stores/insightsStore";

export function useInsightsStats() {
  const { stats, isLoading, error } = useStatsFromStore();

  // Get actions from store
  const setStats = useInsightsStore((s) => s.setStats);
  const setLoadingStats = useInsightsStore((s) => s.setLoadingStats);
  const setError = useInsightsStore((s) => s.setError);
  const needsStatsFetch = useInsightsStore((s) => s.needsStatsFetch);

  const fetchStats = useCallback(async () => {
    // Check if we need to fetch
    if (!needsStatsFetch()) {
      return;
    }

    setLoadingStats(true);
    setError(null);

    try {
      const data = await getInsightsStats();
      setStats(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch insights stats:", err);
    } finally {
      setLoadingStats(false);
    }
  }, [needsStatsFetch, setStats, setLoadingStats, setError]);

  // Fetch on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
  };
}

export default useInsightsStats;

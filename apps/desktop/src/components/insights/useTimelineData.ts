/**
 * useTimelineData - Hook for fetching timeline data (aggregation-dependent)
 *
 * Timeline is fetched per aggregation type and cached.
 * Changing aggregation triggers a new fetch only if we don't have data for that type.
 */
import { useEffect, useCallback } from "react";
import { getInsightsTimeline } from "@/services/tauri";
import { useInsightsStore, useTimelineFromStore } from "@/stores/insightsStore";
import type { AggregationType } from "@/types";

export function useTimelineData(aggregationType: AggregationType = "monthly") {
  const {
    timelineData,
    aggregationType: lastAggregationType,
    isLoading,
    error,
  } = useTimelineFromStore();

  // Get actions from store
  const setTimelineData = useInsightsStore((s) => s.setTimelineData);
  const setLoadingTimeline = useInsightsStore((s) => s.setLoadingTimeline);
  const setError = useInsightsStore((s) => s.setError);
  const needsTimelineFetch = useInsightsStore((s) => s.needsTimelineFetch);

  const fetchTimeline = useCallback(async () => {
    // Check if we need to fetch for this aggregation type
    if (!needsTimelineFetch(aggregationType)) {
      return;
    }

    setLoadingTimeline(true);
    setError(null);

    try {
      const response = await getInsightsTimeline(aggregationType);
      setTimelineData(
        response.timeline_data,
        response.aggregation_type as AggregationType,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch timeline data:", err);
    } finally {
      setLoadingTimeline(false);
    }
  }, [
    aggregationType,
    needsTimelineFetch,
    setTimelineData,
    setLoadingTimeline,
    setError,
  ]);

  // Fetch on mount or when aggregation changes
  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  return {
    timelineData,
    aggregationType: lastAggregationType,
    isLoading,
    error,
  };
}

export default useTimelineData;

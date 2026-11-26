/**
 * useCalendarData - Hook for fetching calendar data (GitHub-style contributions)
 *
 * Calendar is fetched once on mount and cached until explicit invalidation.
 * This is aggregation-independent. Year filtering is done on the frontend.
 */
import { useEffect, useCallback } from "react";
import { getInsightsCalendar } from "@/services/tauri";
import { useInsightsStore, useCalendarFromStore } from "@/stores/insightsStore";

export function useCalendarData() {
  const { calendarData, isLoading, error } = useCalendarFromStore();

  // Get actions from store
  const setCalendarData = useInsightsStore((s) => s.setCalendarData);
  const setLoadingCalendar = useInsightsStore((s) => s.setLoadingCalendar);
  const setError = useInsightsStore((s) => s.setError);
  const needsCalendarFetch = useInsightsStore((s) => s.needsCalendarFetch);

  const fetchCalendar = useCallback(async () => {
    // Check if we need to fetch
    if (!needsCalendarFetch()) {
      return;
    }

    setLoadingCalendar(true);
    setError(null);

    try {
      const response = await getInsightsCalendar();
      setCalendarData(response.calendar_data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch calendar data:", err);
    } finally {
      setLoadingCalendar(false);
    }
  }, [needsCalendarFetch, setCalendarData, setLoadingCalendar, setError]);

  // Fetch on mount
  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  return {
    calendarData,
    isLoading,
    error,
  };
}

export default useCalendarData;

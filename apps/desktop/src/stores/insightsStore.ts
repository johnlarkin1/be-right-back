/**
 * Insights Store - Manages insights data with granular state
 *
 * Split state allows independent loading/caching of:
 * - Stats (fetch once, aggregation-independent)
 * - Timeline (per aggregation type)
 * - Calendar (fetch once)
 * - Words (fetch once, plus filtered by date range)
 * - Embeddings (already separate)
 *
 * Data is NOT persisted to localStorage - it resets on app restart.
 * Data is invalidated only on explicit user action ("Re-analyze" button).
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  InsightsStats,
  AggregatedCount,
  CalendarCell,
  WordFrequency,
  EmbeddingVizData,
  AggregationType,
} from "@/types";

interface InsightsStore {
  // Stats (fetch once, aggregation-independent)
  stats: InsightsStats | null;
  isLoadingStats: boolean;

  // Timeline (per aggregation type)
  timelineData: AggregatedCount[] | null;
  lastAggregationType: AggregationType | null;
  isLoadingTimeline: boolean;

  // Calendar (fetch once)
  calendarData: CalendarCell[] | null;
  isLoadingCalendar: boolean;

  // Word frequencies (full + filtered by date range)
  wordFrequencies: WordFrequency[];
  filteredWords: WordFrequency[];
  isLoadingWords: boolean;

  // Embeddings (already separate, kept for compatibility)
  embeddingsData: EmbeddingVizData | null;
  isLoadingEmbeddings: boolean;
  lastUse3d: boolean | null;
  lastMaxPoints: number | null;

  // Error state
  error: string | null;

  // Actions - Stats
  setStats: (stats: InsightsStats) => void;
  setLoadingStats: (loading: boolean) => void;

  // Actions - Timeline
  setTimelineData: (
    data: AggregatedCount[],
    aggregationType: AggregationType,
  ) => void;
  setLoadingTimeline: (loading: boolean) => void;

  // Actions - Calendar
  setCalendarData: (data: CalendarCell[]) => void;
  setLoadingCalendar: (loading: boolean) => void;

  // Actions - Words
  setWordFrequencies: (words: WordFrequency[]) => void;
  setFilteredWords: (words: WordFrequency[]) => void;
  setLoadingWords: (loading: boolean) => void;

  // Actions - Embeddings
  setEmbeddingsData: (
    data: EmbeddingVizData,
    use3d: boolean,
    maxPoints?: number,
  ) => void;
  setLoadingEmbeddings: (loading: boolean) => void;

  // Actions - Error
  setError: (error: string | null) => void;

  // Actions - Invalidation
  invalidateAll: () => void;
  invalidateEmbeddings: () => void;

  // Computed helpers
  needsStatsFetch: () => boolean;
  needsTimelineFetch: (aggregationType: AggregationType) => boolean;
  needsCalendarFetch: () => boolean;
  needsWordsFetch: () => boolean;
  needsEmbeddingsFetch: (use3d: boolean, maxPoints?: number) => boolean;
}

export const useInsightsStore = create<InsightsStore>((set, get) => ({
  // Initial state
  stats: null,
  isLoadingStats: false,

  timelineData: null,
  lastAggregationType: null,
  isLoadingTimeline: false,

  calendarData: null,
  isLoadingCalendar: false,

  wordFrequencies: [],
  filteredWords: [],
  isLoadingWords: false,

  embeddingsData: null,
  isLoadingEmbeddings: false,
  lastUse3d: null,
  lastMaxPoints: null,

  error: null,

  // Actions - Stats
  setStats: (stats) => set({ stats, error: null }),
  setLoadingStats: (loading) => set({ isLoadingStats: loading }),

  // Actions - Timeline
  setTimelineData: (data, aggregationType) =>
    set({
      timelineData: data,
      lastAggregationType: aggregationType,
      error: null,
    }),
  setLoadingTimeline: (loading) => set({ isLoadingTimeline: loading }),

  // Actions - Calendar
  setCalendarData: (data) => set({ calendarData: data, error: null }),
  setLoadingCalendar: (loading) => set({ isLoadingCalendar: loading }),

  // Actions - Words
  setWordFrequencies: (words) =>
    set({
      wordFrequencies: words,
      filteredWords: words, // Initially, filtered = full
      error: null,
    }),
  setFilteredWords: (words) => set({ filteredWords: words }),
  setLoadingWords: (loading) => set({ isLoadingWords: loading }),

  // Actions - Embeddings
  setEmbeddingsData: (data, use3d, maxPoints) =>
    set({
      embeddingsData: data,
      lastUse3d: use3d,
      lastMaxPoints: maxPoints ?? null,
      error: null,
    }),
  setLoadingEmbeddings: (loading) => set({ isLoadingEmbeddings: loading }),

  // Actions - Error
  setError: (error) => set({ error }),

  // Actions - Invalidation
  invalidateAll: () =>
    set({
      stats: null,
      timelineData: null,
      lastAggregationType: null,
      calendarData: null,
      wordFrequencies: [],
      filteredWords: [],
      embeddingsData: null,
      lastUse3d: null,
      lastMaxPoints: null,
      error: null,
    }),

  invalidateEmbeddings: () =>
    set({ embeddingsData: null, lastUse3d: null, lastMaxPoints: null }),

  // Computed helpers
  needsStatsFetch: () => get().stats === null,
  needsTimelineFetch: (aggregationType) => {
    const state = get();
    return (
      state.timelineData === null ||
      state.lastAggregationType !== aggregationType
    );
  },
  needsCalendarFetch: () => get().calendarData === null,
  needsWordsFetch: () => get().wordFrequencies.length === 0,
  needsEmbeddingsFetch: (use3d, maxPoints) => {
    const state = get();
    return (
      state.embeddingsData === null ||
      state.lastUse3d !== use3d ||
      state.lastMaxPoints !== (maxPoints ?? null)
    );
  },
}));

// ============================================
// Selector hooks for fine-grained subscriptions
// Uses useShallow to prevent infinite loops with object selectors
// ============================================

export function useStatsFromStore() {
  return useInsightsStore(
    useShallow((state) => ({
      stats: state.stats,
      isLoading: state.isLoadingStats,
      error: state.error,
    })),
  );
}

export function useTimelineFromStore() {
  return useInsightsStore(
    useShallow((state) => ({
      timelineData: state.timelineData,
      aggregationType: state.lastAggregationType,
      isLoading: state.isLoadingTimeline,
      error: state.error,
    })),
  );
}

export function useCalendarFromStore() {
  return useInsightsStore(
    useShallow((state) => ({
      calendarData: state.calendarData,
      isLoading: state.isLoadingCalendar,
      error: state.error,
    })),
  );
}

export function useWordsFromStore() {
  return useInsightsStore(
    useShallow((state) => ({
      wordFrequencies: state.wordFrequencies,
      filteredWords: state.filteredWords,
      isLoading: state.isLoadingWords,
      error: state.error,
    })),
  );
}

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useInsightsStore,
  useStatsFromStore,
  useTimelineFromStore,
} from "./insightsStore";
import { createInsightsStats } from "@/test/fixtures";
import type {
  AggregatedCount,
  WordFrequency,
  EmbeddingVizData,
  AggregationType,
} from "@/types";

// ── Helpers ──────────────────────────────────────────────────

function makeTimelineData(
  aggregationType: AggregationType = "daily",
): AggregatedCount[] {
  return [
    {
      period: "2025-01-01",
      display_period: "Jan 1",
      from_me: 10,
      from_them: 8,
      total: 18,
      aggregation_type: aggregationType,
    },
  ];
}

function makeWordFrequencies(): WordFrequency[] {
  return [
    { word: "hello", count: 50, weight: 1.0 },
    { word: "world", count: 30, weight: 0.6 },
  ];
}

function makeEmbeddingsData(): EmbeddingVizData {
  return {
    points: [],
    clusters: [],
    total_points: 100,
    sampled: false,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("useInsightsStore", () => {
  beforeEach(() => {
    useInsightsStore.getState().invalidateAll();
  });

  // ── Initial state ──────────────────────────────────────────

  it("has correct initial state", () => {
    const state = useInsightsStore.getState();
    expect(state.stats).toBeNull();
    expect(state.isLoadingStats).toBe(false);
    expect(state.isLoadingTimeline).toBe(false);
    expect(state.isLoadingCalendar).toBe(false);
    expect(state.isLoadingWords).toBe(false);
    expect(state.isLoadingEmbeddings).toBe(false);
    expect(state.wordFrequencies).toEqual([]);
    expect(state.filteredWords).toEqual([]);
    expect(state.timelineData).toBeNull();
    expect(state.embeddingsData).toBeNull();
    expect(state.error).toBeNull();
  });

  // ── setStats ───────────────────────────────────────────────

  it("setStats updates stats and clears error", () => {
    const store = useInsightsStore.getState();
    store.setError("some error");
    store.setStats(createInsightsStats());

    const state = useInsightsStore.getState();
    expect(state.stats).toEqual(createInsightsStats());
    expect(state.error).toBeNull();
  });

  // ── setTimelineData ────────────────────────────────────────

  it("setTimelineData updates data and lastAggregationType", () => {
    const data = makeTimelineData("weekly");
    useInsightsStore.getState().setTimelineData(data, "weekly");

    const state = useInsightsStore.getState();
    expect(state.timelineData).toEqual(data);
    expect(state.lastAggregationType).toBe("weekly");
  });

  // ── setWordFrequencies / setFilteredWords ──────────────────

  it("setWordFrequencies sets both wordFrequencies and filteredWords", () => {
    const words = makeWordFrequencies();
    useInsightsStore.getState().setWordFrequencies(words);

    const state = useInsightsStore.getState();
    expect(state.wordFrequencies).toEqual(words);
    expect(state.filteredWords).toEqual(words);
  });

  it("setFilteredWords only updates filteredWords", () => {
    const allWords = makeWordFrequencies();
    const filtered = [allWords[0]];
    useInsightsStore.getState().setWordFrequencies(allWords);
    useInsightsStore.getState().setFilteredWords(filtered);

    const state = useInsightsStore.getState();
    expect(state.wordFrequencies).toEqual(allWords);
    expect(state.filteredWords).toEqual(filtered);
  });

  // ── setEmbeddingsData ──────────────────────────────────────

  it("setEmbeddingsData updates data, lastUse3d, and lastMaxPoints", () => {
    const data = makeEmbeddingsData();
    useInsightsStore.getState().setEmbeddingsData(data, true, 500);

    const state = useInsightsStore.getState();
    expect(state.embeddingsData).toEqual(data);
    expect(state.lastUse3d).toBe(true);
    expect(state.lastMaxPoints).toBe(500);
  });

  // ── needsStatsFetch ────────────────────────────────────────

  it("needsStatsFetch() returns true when stats is null", () => {
    expect(useInsightsStore.getState().needsStatsFetch()).toBe(true);
  });

  it("needsStatsFetch() returns false after setStats", () => {
    useInsightsStore.getState().setStats(createInsightsStats());
    expect(useInsightsStore.getState().needsStatsFetch()).toBe(false);
  });

  // ── needsTimelineFetch ─────────────────────────────────────

  it("needsTimelineFetch returns true when data is null", () => {
    expect(useInsightsStore.getState().needsTimelineFetch("daily")).toBe(true);
  });

  it("needsTimelineFetch returns true for different aggregation type", () => {
    useInsightsStore
      .getState()
      .setTimelineData(makeTimelineData("daily"), "daily");
    expect(useInsightsStore.getState().needsTimelineFetch("weekly")).toBe(true);
  });

  it("needsTimelineFetch returns false for same aggregation type", () => {
    useInsightsStore
      .getState()
      .setTimelineData(makeTimelineData("daily"), "daily");
    expect(useInsightsStore.getState().needsTimelineFetch("daily")).toBe(false);
  });

  // ── needsWordsFetch ────────────────────────────────────────

  it("needsWordsFetch returns true when empty", () => {
    expect(useInsightsStore.getState().needsWordsFetch()).toBe(true);
  });

  it("needsWordsFetch returns false after setWordFrequencies", () => {
    useInsightsStore.getState().setWordFrequencies(makeWordFrequencies());
    expect(useInsightsStore.getState().needsWordsFetch()).toBe(false);
  });

  // ── invalidateAll ──────────────────────────────────────────

  it("invalidateAll resets everything", () => {
    // Populate state
    useInsightsStore.getState().setStats(createInsightsStats());
    useInsightsStore.getState().setTimelineData(makeTimelineData(), "daily");
    useInsightsStore.getState().setWordFrequencies(makeWordFrequencies());
    useInsightsStore
      .getState()
      .setEmbeddingsData(makeEmbeddingsData(), true, 500);
    useInsightsStore.getState().setError("something broke");

    // Invalidate
    useInsightsStore.getState().invalidateAll();

    const state = useInsightsStore.getState();
    expect(state.stats).toBeNull();
    expect(state.timelineData).toBeNull();
    expect(state.lastAggregationType).toBeNull();
    expect(state.calendarData).toBeNull();
    expect(state.wordFrequencies).toEqual([]);
    expect(state.filteredWords).toEqual([]);
    expect(state.embeddingsData).toBeNull();
    expect(state.lastUse3d).toBeNull();
    expect(state.lastMaxPoints).toBeNull();
    expect(state.error).toBeNull();
  });

  // ── setError / setLoadingStats ─────────────────────────────

  it("setError sets the error string", () => {
    useInsightsStore.getState().setError("fetch failed");
    expect(useInsightsStore.getState().error).toBe("fetch failed");
  });

  it("setError with null clears the error", () => {
    useInsightsStore.getState().setError("fetch failed");
    useInsightsStore.getState().setError(null);
    expect(useInsightsStore.getState().error).toBeNull();
  });

  it("setLoadingStats updates isLoadingStats", () => {
    useInsightsStore.getState().setLoadingStats(true);
    expect(useInsightsStore.getState().isLoadingStats).toBe(true);

    useInsightsStore.getState().setLoadingStats(false);
    expect(useInsightsStore.getState().isLoadingStats).toBe(false);
  });
});

// ── Selector hook tests ──────────────────────────────────────

describe("useStatsFromStore", () => {
  beforeEach(() => {
    useInsightsStore.getState().invalidateAll();
  });

  it("returns correct shape with default state", () => {
    const { result } = renderHook(() => useStatsFromStore());

    expect(result.current).toEqual({
      stats: null,
      isLoading: false,
      error: null,
    });
  });

  it("reflects stats after setStats", () => {
    const stats = createInsightsStats({ total_messages: 999 });
    useInsightsStore.getState().setStats(stats);

    const { result } = renderHook(() => useStatsFromStore());

    expect(result.current.stats).toEqual(stats);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useTimelineFromStore", () => {
  beforeEach(() => {
    useInsightsStore.getState().invalidateAll();
  });

  it("returns correct shape with default state", () => {
    const { result } = renderHook(() => useTimelineFromStore());

    expect(result.current).toEqual({
      timelineData: null,
      aggregationType: null,
      isLoading: false,
      error: null,
    });
  });

  it("reflects timeline data after setTimelineData", () => {
    const data = makeTimelineData("monthly");
    useInsightsStore.getState().setTimelineData(data, "monthly");

    const { result } = renderHook(() => useTimelineFromStore());

    expect(result.current.timelineData).toEqual(data);
    expect(result.current.aggregationType).toBe("monthly");
  });
});

/**
 * useWordFrequencies - Hook for fetching word frequency data
 *
 * Words are fetched once on mount and cached until explicit invalidation.
 * This hook also supports fetching filtered words for a date range (brush selection).
 */
import { useEffect, useCallback } from "react";
import {
  getWordFrequencies as fetchWordFreqs,
  getWordFrequenciesForRange,
} from "@/services/tauri";
import { useInsightsStore, useWordsFromStore } from "@/stores/insightsStore";
import type { WordFrequency, InsightsDateRange } from "@/types";

export function useWordFrequencies() {
  const { wordFrequencies, filteredWords, isLoading, error } =
    useWordsFromStore();

  // Get actions from store
  const setWordFrequencies = useInsightsStore((s) => s.setWordFrequencies);
  const setFilteredWords = useInsightsStore((s) => s.setFilteredWords);
  const setLoadingWords = useInsightsStore((s) => s.setLoadingWords);
  const setError = useInsightsStore((s) => s.setError);
  const needsWordsFetch = useInsightsStore((s) => s.needsWordsFetch);

  const fetchWords = useCallback(async () => {
    // Check if we need to fetch
    if (!needsWordsFetch()) {
      return;
    }

    setLoadingWords(true);
    setError(null);

    try {
      const words = await fetchWordFreqs();
      setWordFrequencies(words);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch word frequencies:", err);
    } finally {
      setLoadingWords(false);
    }
  }, [needsWordsFetch, setWordFrequencies, setLoadingWords, setError]);

  // Fetch filtered words for a date range (brush selection)
  const fetchWordsForRange = useCallback(
    async (range: InsightsDateRange): Promise<WordFrequency[]> => {
      try {
        const words = await getWordFrequenciesForRange(
          range.startDate,
          range.endDate,
        );
        setFilteredWords(words);
        return words;
      } catch (err) {
        console.error("Failed to fetch word frequencies for range:", err);
        // Fall back to full dataset
        return wordFrequencies;
      }
    },
    [wordFrequencies, setFilteredWords],
  );

  // Reset filtered words to full dataset
  const resetFilter = useCallback(() => {
    setFilteredWords(wordFrequencies);
  }, [wordFrequencies, setFilteredWords]);

  // Fetch on mount
  useEffect(() => {
    fetchWords();
  }, [fetchWords]);

  return {
    wordFrequencies,
    filteredWords,
    isLoading,
    error,
    fetchWordsForRange,
    resetFilter,
  };
}

export default useWordFrequencies;

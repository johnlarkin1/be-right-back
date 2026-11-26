/**
 * useEmbeddingsData - Lazy loading hook for embeddings visualization data
 *
 * This hook is separate from useInsightsData to enable:
 * - Lazy loading of embeddings only when SemanticSpace is visible
 * - Independent fetch lifecycle from insights data
 * - 2D/3D mode switching without refetching insights data
 */
import { useCallback } from "react";
import { getEmbeddingsForViz } from "@/services/tauri";
import { useInsightsStore } from "@/stores/insightsStore";
import type { EmbeddingVizData } from "@/types";

interface UseEmbeddingsDataResult {
  embeddingsData: EmbeddingVizData | null;
  isLoading: boolean;
  error: string | null;
  fetchEmbeddings: () => Promise<void>;
  needsFetch: boolean;
}

export function useEmbeddingsData(
  use3d: boolean,
  maxPoints?: number,
): UseEmbeddingsDataResult {
  const embeddingsData = useInsightsStore((state) => state.embeddingsData);
  const isLoading = useInsightsStore((state) => state.isLoadingEmbeddings);
  const error = useInsightsStore((state) => state.error);
  const setEmbeddingsData = useInsightsStore(
    (state) => state.setEmbeddingsData,
  );
  const setLoadingEmbeddings = useInsightsStore(
    (state) => state.setLoadingEmbeddings,
  );
  const setError = useInsightsStore((state) => state.setError);
  const needsEmbeddingsFetch = useInsightsStore(
    (state) => state.needsEmbeddingsFetch,
  );
  const invalidateEmbeddings = useInsightsStore(
    (state) => state.invalidateEmbeddings,
  );

  const needsFetch = needsEmbeddingsFetch(use3d, maxPoints);

  const fetchEmbeddings = useCallback(async () => {
    // Check if we already have valid data for this mode
    const store = useInsightsStore.getState();
    if (!store.needsEmbeddingsFetch(use3d, maxPoints)) {
      return;
    }

    // Prevent duplicate concurrent fetches
    if (store.isLoadingEmbeddings) {
      return;
    }

    // If mode or maxPoints changed, invalidate existing embeddings
    if (
      store.embeddingsData !== null &&
      (store.lastUse3d !== use3d || store.lastMaxPoints !== (maxPoints ?? null))
    ) {
      invalidateEmbeddings();
    }

    setLoadingEmbeddings(true);
    setError(null);

    try {
      const data = await getEmbeddingsForViz(use3d, maxPoints);
      setEmbeddingsData(data, use3d, maxPoints);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error("Failed to fetch embeddings data:", err);
    } finally {
      setLoadingEmbeddings(false);
    }
  }, [
    use3d,
    maxPoints,
    setEmbeddingsData,
    setLoadingEmbeddings,
    setError,
    invalidateEmbeddings,
  ]);

  return {
    embeddingsData,
    isLoading,
    error,
    fetchEmbeddings,
    needsFetch,
  };
}

export default useEmbeddingsData;

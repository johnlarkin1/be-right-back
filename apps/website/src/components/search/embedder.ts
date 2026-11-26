/**
 * Lazy in-browser query embedder.
 *
 * Loads `Xenova/all-MiniLM-L6-v2` (quantized, ~23MB) and runs it client-side
 * (WASM). The model is a static, public file fetched once from the Hugging Face
 * CDN and cached by the browser thereafter — there is no API key and no
 * per-query cost. MODEL and DTYPE MUST match scripts/build-search-index.mts, or
 * the query vector won't be comparable to the precomputed passage vectors.
 *
 * Optional self-hosting (avoid the external CDN entirely): copy the model files
 * into `public/models/Xenova/all-MiniLM-L6-v2/` and set
 *   env.allowRemoteModels = false;
 *   env.localModelPath = "/models";
 * See scripts/build-search-index.mts for how the files are produced.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DTYPE = "q8" as const;

let pipePromise: Promise<FeatureExtractionPipeline> | null = null;

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipePromise) {
    // Dynamic import keeps the ~MBs of transformers.js out of the shared client
    // bundle — it loads as a lazy chunk only when a semantic query first runs.
    pipePromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL, { dtype: DTYPE }),
    );
  }
  return pipePromise;
}

/** Embed a query string into a normalized 384-dim vector (cosine == dot product). */
export async function embedQuery(text: string): Promise<Float32Array> {
  const extractor = await getEmbedder();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return out.data as Float32Array;
}

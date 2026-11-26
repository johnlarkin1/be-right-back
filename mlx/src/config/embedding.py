from dataclasses import dataclass

import psutil


def get_optimal_batch_size() -> int:
    """Pick the embedding batch size from total RAM.

    Measured 2026-11-22 on a 16-core Mac (bench_ingestion.py, 2,048 real chunks,
    3 repeats, median chunks/s):

    * batch 32: 218 chunks/s, 1.3 GB peak Metal, 3.8% NaN rows
    * batch 64: 214 chunks/s, 1.4 GB peak Metal, 2.4% NaN rows
    * batch 128: 184 chunks/s, 2.1 GB peak Metal, 5.5% NaN rows

    Batch 128 is slower and returns the most NaN rows. Each NaN row costs a
    one-chunk retry in `attach_embeddings`, so 64 wins on time and memory.
    """
    ram_gb = psutil.virtual_memory().total / (1024**3)
    return 64 if ram_gb >= 16 else 32


@dataclass
class EmbeddingConfig:
    model_name: str = "mlx-community/nomicai-modernbert-embed-base-8bit"
    embedding_dims: int = 768

    prefix_document: str = "search_document: "
    prefix_query: str = "search_query: "

    # Chunking: 8-message windows, no overlap.
    # Eight messages capture a conversation thread (e.g. dinner planning) and stay
    # within ModernBERT's 512-token limit (~528 chars avg). Stride 4 (50% overlap)
    # embedded 59% more chunks for the same recall: on the synthetic eval
    # (`make eval-stride`, 2026-11-22), stride 4, 6 and 8 all scored hit@10 0.789.
    chunk_window_size: int = 8
    chunk_stride: int = 8

    min_chunk_chars: int = 50
    batch_size: int = 0

    # User ingestion filters (from the ingestion_settings row in brb.db).
    # None means "no filter". Dates are ISO YYYY-MM-DD and inclusive.
    start_date: str | None = None
    end_date: str | None = None
    min_messages_per_contact: int | None = None

    def __post_init__(self):
        if self.batch_size == 0:
            self.batch_size = get_optimal_batch_size()

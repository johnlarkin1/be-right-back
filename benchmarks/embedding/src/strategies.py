"""Different embedding write strategies for benchmarking.

Uses mlx-embeddings for proper model loading and embedding generation.
Imports shared utilities from the main mlx source to avoid duplication.
"""

import json
import sys
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# Add mlx/src to path for imports from main application code
_MLX_SRC = Path(__file__).parent.parent.parent.parent / "mlx" / "src"
if str(_MLX_SRC) not in sys.path:
    sys.path.insert(0, str(_MLX_SRC))

# Import from main application code instead of duplicating
from ml.embeddings import embed_batch_mlx, load_embedding_model
from utils.time import apple_timestamp_to_datetime

from .sample_data import Message

# Constants - match production values
MODEL_NAME = "mlx-community/nomicai-modernbert-embed-base-8bit"
EMBEDDING_DIMS = 768
CHUNK_WINDOW_SIZE = 5
CHUNK_STRIDE = 5  # Non-overlapping (stride = window_size)


@dataclass
class Chunk:
    """A chunk of messages ready for embedding."""

    chunk_id: int
    text: str
    contact_id: str
    contact_display: str
    start_message_id: int
    end_message_id: int
    message_ids: list[int]
    start_timestamp: int
    end_timestamp: int
    message_count: int
    embedding: list[float] | None = None


def create_chunks(
    messages: list[Message],
    window_size: int = CHUNK_WINDOW_SIZE,
    stride: int = CHUNK_STRIDE,
) -> list[Chunk]:
    """Create non-overlapping chunks from messages."""
    chunks = []
    chunk_id = 0

    for i in range(0, len(messages), stride):
        window = messages[i : i + window_size]
        if not window:
            continue

        # Combine message texts
        texts = []
        for msg in window:
            sender = "You" if msg.is_from_me else msg.contact_display
            texts.append(f"{sender}: {msg.text}")

        chunk_text = "\n".join(texts)

        chunks.append(
            Chunk(
                chunk_id=chunk_id,
                text=chunk_text,
                contact_id=window[0].contact_id,
                contact_display=window[0].contact_display,
                start_message_id=window[0].message_id,
                end_message_id=window[-1].message_id,
                message_ids=[m.message_id for m in window],
                start_timestamp=window[0].timestamp,
                end_timestamp=window[-1].timestamp,
                message_count=len(window),
            )
        )
        chunk_id += 1

    return chunks


# NOTE: Embedding functions are imported from mlx source (ml.embeddings, utils.time)
# to avoid code duplication with the main application.


class WriteStrategy(ABC):
    """Base class for database write strategies."""

    name: str

    @abstractmethod
    def write_chunks(
        self, conn: duckdb.DuckDBPyConnection, chunks: list[Chunk], run_id: int
    ) -> int:
        """Write chunks to database. Returns number of chunks written."""
        pass


class PandasInsertStrategy(WriteStrategy):
    """Original pandas DataFrame + INSERT SELECT strategy."""

    name = "pandas_insert"

    def write_chunks(
        self, conn: duckdb.DuckDBPyConnection, chunks: list[Chunk], run_id: int
    ) -> int:
        rows = []
        for chunk in chunks:
            text = chunk.text
            rows.append(
                {
                    "chunk_id": chunk.chunk_id,
                    "chunk_data": json.dumps({"messages": [], "formatted": text}),
                    "embedding": chunk.embedding,
                    "start_message_id": chunk.start_message_id,
                    "end_message_id": chunk.end_message_id,
                    "message_ids": chunk.message_ids,
                    "contact_id": chunk.contact_id,
                    "contact_name": chunk.contact_display,
                    "start_timestamp": apple_timestamp_to_datetime(chunk.start_timestamp),
                    "end_timestamp": apple_timestamp_to_datetime(chunk.end_timestamp),
                    "message_count": chunk.message_count,
                    "total_chars": len(text),
                    "has_from_me": "You:" in text,
                    "has_from_them": chunk.contact_display in text,
                    "has_questions": "?" in text,
                    "ingestion_id": run_id,
                }
            )

        df = pd.DataFrame(rows)
        conn.execute("INSERT INTO message_chunks SELECT * FROM df")
        return len(rows)


class ParquetBulkStrategy(WriteStrategy):
    """PyArrow Parquet + COPY strategy (per-batch writes)."""

    name = "parquet_bulk"

    def write_chunks(
        self, conn: duckdb.DuckDBPyConnection, chunks: list[Chunk], run_id: int
    ) -> int:
        if not chunks:
            return 0

        # Build Arrow arrays
        chunk_ids = []
        chunk_data_list = []
        embeddings = []
        start_message_ids = []
        end_message_ids = []
        message_ids_list = []
        contact_ids = []
        contact_names = []
        start_timestamps = []
        end_timestamps = []
        message_counts = []
        total_chars_list = []
        has_from_me_list = []
        has_from_them_list = []
        has_questions_list = []
        ingestion_ids = []

        for chunk in chunks:
            text = chunk.text
            chunk_ids.append(chunk.chunk_id)
            chunk_data_list.append(json.dumps({"messages": [], "formatted": text}))
            embeddings.append(chunk.embedding)
            start_message_ids.append(chunk.start_message_id)
            end_message_ids.append(chunk.end_message_id)
            message_ids_list.append(chunk.message_ids)
            contact_ids.append(chunk.contact_id)
            contact_names.append(chunk.contact_display)
            start_timestamps.append(apple_timestamp_to_datetime(chunk.start_timestamp))
            end_timestamps.append(apple_timestamp_to_datetime(chunk.end_timestamp))
            message_counts.append(chunk.message_count)
            total_chars_list.append(len(text))
            has_from_me_list.append("You:" in text)
            has_from_them_list.append(chunk.contact_display in text)
            has_questions_list.append("?" in text)
            ingestion_ids.append(run_id)

        table = pa.table(
            {
                "chunk_id": pa.array(chunk_ids, type=pa.int64()),
                "chunk_data": pa.array(chunk_data_list, type=pa.string()),
                "embedding": pa.array(embeddings, type=pa.list_(pa.float32())),
                "start_message_id": pa.array(start_message_ids, type=pa.int64()),
                "end_message_id": pa.array(end_message_ids, type=pa.int64()),
                "message_ids": pa.array(message_ids_list, type=pa.list_(pa.int64())),
                "contact_id": pa.array(contact_ids, type=pa.string()),
                "contact_name": pa.array(contact_names, type=pa.string()),
                "start_timestamp": pa.array(start_timestamps, type=pa.timestamp("us", tz="UTC")),
                "end_timestamp": pa.array(end_timestamps, type=pa.timestamp("us", tz="UTC")),
                "message_count": pa.array(message_counts, type=pa.int32()),
                "total_chars": pa.array(total_chars_list, type=pa.int32()),
                "has_from_me": pa.array(has_from_me_list, type=pa.bool_()),
                "has_from_them": pa.array(has_from_them_list, type=pa.bool_()),
                "has_questions": pa.array(has_questions_list, type=pa.bool_()),
                "ingestion_id": pa.array(ingestion_ids, type=pa.int32()),
            }
        )

        with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as f:
            parquet_path = f.name
            pq.write_table(table, parquet_path)

        try:
            conn.execute(f"COPY message_chunks FROM '{parquet_path}'")
            return len(chunks)
        finally:
            Path(parquet_path).unlink(missing_ok=True)


class ParquetBufferedStrategy(WriteStrategy):
    """Parquet with buffered writes (only write every N chunks)."""

    name = "parquet_buffered"

    def __init__(self, buffer_size: int = 5000):
        self.buffer_size = buffer_size
        self._parquet_strategy = ParquetBulkStrategy()

    def write_chunks(
        self, conn: duckdb.DuckDBPyConnection, chunks: list[Chunk], run_id: int
    ) -> int:
        # This is called with already-buffered chunks
        return self._parquet_strategy.write_chunks(conn, chunks, run_id)


class DirectExecutemanyStrategy(WriteStrategy):
    """Direct DuckDB executemany without intermediate formats."""

    name = "direct_executemany"

    def write_chunks(
        self, conn: duckdb.DuckDBPyConnection, chunks: list[Chunk], run_id: int
    ) -> int:
        if not chunks:
            return 0

        # Prepare data as list of tuples
        data = []
        for chunk in chunks:
            text = chunk.text
            data.append(
                (
                    chunk.chunk_id,
                    json.dumps({"messages": [], "formatted": text}),
                    chunk.embedding,
                    chunk.start_message_id,
                    chunk.end_message_id,
                    chunk.message_ids,
                    chunk.contact_id,
                    chunk.contact_display,
                    apple_timestamp_to_datetime(chunk.start_timestamp),
                    apple_timestamp_to_datetime(chunk.end_timestamp),
                    chunk.message_count,
                    len(text),
                    "You:" in text,
                    chunk.contact_display in text,
                    "?" in text,
                    run_id,
                )
            )

        conn.executemany(
            """
            INSERT INTO message_chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            data,
        )
        return len(chunks)


# Registry of all strategies
STRATEGIES: dict[str, type[WriteStrategy]] = {
    "pandas_insert": PandasInsertStrategy,
    "parquet_bulk": ParquetBulkStrategy,
    "parquet_buffered": ParquetBufferedStrategy,
    "direct_executemany": DirectExecutemanyStrategy,
}


def get_strategy(name: str) -> WriteStrategy:
    """Get a strategy instance by name."""
    if name not in STRATEGIES:
        raise ValueError(f"Unknown strategy: {name}. Available: {list(STRATEGIES.keys())}")
    return STRATEGIES[name]()

"""Generate deterministic test data for DuckDB index compatibility testing.

Produces 100 synthetic message chunks with:
- Deterministic 768-dim embeddings (seeded numpy)
- Known text content for FTS testing
- Parquet output for bulk loading (matching production pattern)
"""

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

EMBEDDING_DIMS = 768
NUM_CHUNKS = 100
SEED = 42


def generate_embedding(chunk_id: int, rng: np.random.Generator) -> list[float]:
    """Generate a deterministic 768-dim embedding for a chunk.

    Strategy: start with a sparse "signature" vector for the chunk_id,
    then add small random noise. This ensures each chunk has a unique
    nearest-neighbor while keeping distances meaningful.
    """
    vec = rng.normal(0, 0.1, EMBEDDING_DIMS).astype(np.float32)
    # Plant a strong signal in a few dimensions based on chunk_id
    sig_dims = [(chunk_id * 7 + i * 13) % EMBEDDING_DIMS for i in range(5)]
    for d in sig_dims:
        vec[d] += 1.0
    # L2 normalize for cosine similarity
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def generate_query_embedding(chunk_id: int, rng_seed: int = 999) -> list[float]:
    """Generate a query embedding that should be nearest to the given chunk_id.

    Uses the same signature pattern but with slight perturbation.
    """
    rng = np.random.default_rng(rng_seed + chunk_id)
    vec = rng.normal(0, 0.01, EMBEDDING_DIMS).astype(np.float32)
    sig_dims = [(chunk_id * 7 + i * 13) % EMBEDDING_DIMS for i in range(5)]
    for d in sig_dims:
        vec[d] += 1.0
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


# Text templates for FTS testing - each chunk gets unique searchable content
TEXT_TEMPLATES = [
    "hello world this is a test message about greeting friends",
    "how are you doing today hope everything is going well",
    "let's grab coffee sometime this week maybe tuesday",
    "did you see the game last night it was incredible",
    "working late tonight on the project deadline is friday",
    "happy birthday hope you have an amazing celebration",
    "running late to the meeting be there in ten minutes",
    "just got back from vacation the beach was beautiful",
    "can you pick up groceries on the way home please",
    "movie night this weekend what do you want to watch",
    "thanks for dinner last night the restaurant was great",
    "need to schedule a dentist appointment this month",
    "have you tried that new restaurant downtown its amazing",
    "sending you the photos from the trip they turned out well",
    "reminder about the dinner party on saturday evening",
    "good morning hope you slept well see you at work",
    "traffic is terrible today might take the train instead",
    "just finished reading that book you recommended loved it",
    "planning a surprise party for mom need your help",
    "the weather forecast says rain all week so annoying",
    "got the promotion at work so excited to share the news",
    "dont forget to water the plants while im away please",
    "thinking about getting a dog what breed do you suggest",
    "concert tickets are on sale should we go this time",
    "finally fixed the bug in the code it was a null pointer",
    "weather forecast shows sunny skies for the weekend trip",
    "lets plan the dinner at that new restaurant friday",
    "meeting tomorrow at nine dont forget to bring the report",
    "just saw the funniest video going to send it to you now",
    "need help moving this saturday can you bring your truck",
]


def generate_text(chunk_id: int) -> str:
    """Generate formatted text for a chunk. Deterministic based on chunk_id."""
    base = TEXT_TEMPLATES[chunk_id % len(TEXT_TEMPLATES)]
    # Add chunk-specific markers
    text = f"[chunk {chunk_id}] {base}"
    # Add unique token to chunk 42 for exact-match FTS testing
    if chunk_id == 42:
        text += " unique_token_xyz"
    return text


def generate_chunk_data(chunk_id: int) -> str:
    """Generate the JSON chunk_data blob."""
    text = generate_text(chunk_id)
    data = {
        "messages": [
            {
                "sender": "Alice" if chunk_id % 2 == 0 else "Bob",
                "text": text,
                "ts": (datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=chunk_id)).isoformat(),
                "message_id": chunk_id * 10,
            }
        ],
        "formatted": text,
    }
    return json.dumps(data)


def generate_all_chunks(rng: np.random.Generator) -> list[dict]:
    """Generate all 100 test chunks."""
    chunks = []
    base_time = datetime(2024, 1, 1, tzinfo=timezone.utc)

    for i in range(NUM_CHUNKS):
        ts = base_time + timedelta(hours=i)
        chunks.append(
            {
                "chunk_id": i,
                "chunk_data": generate_chunk_data(i),
                "embedding": generate_embedding(i, rng),
                "start_message_id": i * 10,
                "end_message_id": i * 10 + 9,
                "message_ids": list(range(i * 10, i * 10 + 10)),
                "contact_id": f"contact_{i % 5}",
                "contact_name": f"Contact {i % 5}",
                "start_timestamp": ts.isoformat(),
                "end_timestamp": (ts + timedelta(minutes=30)).isoformat(),
                "message_count": 10,
                "total_chars": len(generate_text(i)),
                "has_from_me": i % 2 == 0,
                "has_from_them": i % 2 == 1,
                "has_questions": i % 3 == 0,
                "ingestion_id": 1,
                "formatted_text": generate_text(i),
            }
        )
    return chunks


def write_parquet(chunks: list[dict], output_path: Path) -> None:
    """Write chunks to Parquet file for bulk DuckDB loading."""
    # Convert embeddings to fixed-size list format
    embeddings = [chunk["embedding"] for chunk in chunks]

    # Build PyArrow table matching the DuckDB schema
    table = pa.table(
        {
            "chunk_id": pa.array([c["chunk_id"] for c in chunks], type=pa.int64()),
            "chunk_data": pa.array([c["chunk_data"] for c in chunks], type=pa.string()),
            "embedding": pa.array(embeddings, type=pa.list_(pa.float32(), EMBEDDING_DIMS)),
            "start_message_id": pa.array([c["start_message_id"] for c in chunks], type=pa.int64()),
            "end_message_id": pa.array([c["end_message_id"] for c in chunks], type=pa.int64()),
            "message_ids": pa.array([c["message_ids"] for c in chunks], type=pa.list_(pa.int64())),
            "contact_id": pa.array([c["contact_id"] for c in chunks], type=pa.string()),
            "contact_name": pa.array([c["contact_name"] for c in chunks], type=pa.string()),
            "start_timestamp": pa.array(
                [c["start_timestamp"] for c in chunks], type=pa.string()
            ),
            "end_timestamp": pa.array([c["end_timestamp"] for c in chunks], type=pa.string()),
            "message_count": pa.array([c["message_count"] for c in chunks], type=pa.int32()),
            "total_chars": pa.array([c["total_chars"] for c in chunks], type=pa.int32()),
            "has_from_me": pa.array([c["has_from_me"] for c in chunks], type=pa.bool_()),
            "has_from_them": pa.array([c["has_from_them"] for c in chunks], type=pa.bool_()),
            "has_questions": pa.array([c["has_questions"] for c in chunks], type=pa.bool_()),
            "ingestion_id": pa.array([c["ingestion_id"] for c in chunks], type=pa.int32()),
            "formatted_text": pa.array([c["formatted_text"] for c in chunks], type=pa.string()),
        }
    )

    pq.write_table(table, str(output_path))
    print(f"Wrote {len(chunks)} chunks to {output_path}", file=sys.stderr)


def get_hnsw_query_vectors() -> list[dict]:
    """Return the 5 HNSW test query vectors with expected top-1 chunk IDs."""
    rng = np.random.default_rng(SEED)
    return [
        {"id": "q1", "vector": generate_query_embedding(0), "expected_top1": 0},
        {"id": "q2", "vector": generate_query_embedding(50), "expected_top1": 50},
        {"id": "q3", "vector": generate_query_embedding(99), "expected_top1": 99},
        {"id": "q4", "vector": generate_query_embedding(25), "expected_top1": 25},
        {"id": "q5", "vector": generate_query_embedding(75), "expected_top1": 75},
    ]


if __name__ == "__main__":
    # Generate and write test data parquet
    rng = np.random.default_rng(SEED)
    chunks = generate_all_chunks(rng)
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/test_chunks.parquet")
    write_parquet(chunks, output)
    print(f"Generated {NUM_CHUNKS} test chunks", file=sys.stderr)

    # Also dump query vectors for Rust side to consume
    queries = get_hnsw_query_vectors()
    query_path = output.parent / "query_vectors.json"
    with open(query_path, "w") as f:
        json.dump(queries, f)
    print(f"Wrote query vectors to {query_path}", file=sys.stderr)

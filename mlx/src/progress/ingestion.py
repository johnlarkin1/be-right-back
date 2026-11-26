"""Progress reporting protocol for Be Right Back ingestion pipeline.

Stage Progress Format (5 independent stages):
    {"type": "stage_progress", "stage": "chunking|embedding|saving", "percent": 0-100,
     "message": "...", "stats": {...}, "current_contact": {...}}

The Rust subprocess handler parses these lines and:
1. Emits Tauri events for progress updates
2. Returns the final result/error
3. Logs messages to tracing

Note: Snapshot stage is handled in Rust.
Python handles Parsing, Chunking, Embedding, and Saving.
"""

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any

import ujson as json


class IngestionStage(Enum):
    """5 distinct ingestion stages with independent 0-100% progress."""

    PARSING = "parsing"  # Stage 2: Reading messages from snapshot DB
    CHUNKING = "chunking"  # Stage 3: Creating message chunks
    EMBEDDING = "embedding"  # Stage 4: Generating embeddings
    SAVING = "saving"  # Stage 5: Writing to DuckDB + indexing


@dataclass
class ContactProgress:
    """Track which contact is currently being processed."""

    contact_id: str
    contact_name: str
    messages_in_contact: int = 0
    chunks_for_contact: int = 0


@dataclass
class ProgressStats:
    """Statistics for the current operation."""

    items_processed: int = 0
    total_items: int = 0
    current_item: str | None = None
    elapsed_secs: float = 0.0
    estimated_remaining_secs: float | None = None
    # Embedding-specific
    chunks_created: int = 0
    chunks_embedded: int = 0
    # Contact tracking
    contacts_processed: int = 0
    total_contacts: int = 0


def emit_stage_progress(
    stage: IngestionStage,
    percent: int,
    message: str,
    stats: ProgressStats | None = None,
    current_contact: ContactProgress | None = None,
):
    """Emit stage progress with independent 0-100% scale.

    Args:
        stage: The current ingestion stage (PARSING, CHUNKING, EMBEDDING, or SAVING)
        percent: Progress 0-100 for THIS stage only
        message: Human-readable status message
        stats: Optional statistics about the operation
        current_contact: Optional info about the contact being processed
    """
    data: dict[str, Any] = {
        "type": "stage_progress",
        "stage": stage.value,
        "percent": min(100, max(0, percent)),
        "message": message,
        "stats": asdict(stats) if stats else asdict(ProgressStats()),
    }
    if current_contact:
        data["current_contact"] = asdict(current_contact)
    print(json.dumps(data), flush=True)

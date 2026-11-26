"""Embedding pipeline: message chunking and vector generation."""

import gc
import time
from pathlib import Path

import duckdb
import mlx.core as mx
import numpy as np

from config.embedding import EmbeddingConfig
from data.loaders import (
    build_contact_name_lookup,
    get_contact_display_name,
    get_contact_ids_and_counts,
    group_by_contact,
    read_messages_for_contacts,
)
from data.storage import (
    compute_daily_messages_to_conn,
    configure_duckdb_memory,
    ensure_vss_extension,
    finalize_ingestion,
    is_valid_embedding,
    write_chunks_bulk,
)
from ml.embeddings import embed_batch_mlx, load_embedding_model
from progress.base import emit_result, log_error, log_info, log_warn
from progress.ingestion import (
    IngestionStage,
    ProgressStats,
    emit_stage_progress,
)
from queries import duckdb as duckdb_queries
from utils.memprof import MemoryProfiler
from utils.time import apple_timestamp_to_date, iso_date_to_apple_seconds


def attach_embeddings(
    model,
    tokenizer,
    batch: list[dict],
    embeddings,
    config: EmbeddingConfig,
) -> tuple[list[dict], int, int]:
    """Pair each chunk with its embedding, retrying any that came back NaN/inf.

    A NaN result comes from the batch a chunk was embedded in, not from its text:
    re-embedding the same chunk alone has so far always returned a healthy vector
    (2,897 retries in one 470-contact run, none of which failed twice). It used to
    be squashed to an all-zero vector by `np.nan_to_num`, which
    `is_valid_embedding` then accepted because the NaNs were gone, so the chunk
    was stored permanently invisible to semantic search.

    Returns `(chunks, retried, unusable)`. Counting rather than logging per chunk
    is deliberate: NaN arrives in bursts of hundreds per minute, and a line each
    buries the rest of the ingestion log.
    """
    out: list[dict] = []
    retried = 0
    unusable = 0
    for chunk, embedding in zip(batch, embeddings):
        if not np.isfinite(embedding).all():
            retried += 1
            retry = embed_batch_mlx(
                model, tokenizer, [chunk["text"]], prefix=config.prefix_document
            )
            embedding = retry[0]

        embedded_chunk = dict(chunk)
        if np.isfinite(embedding).all() and np.any(embedding):
            embedded_chunk["embedding"] = np.asarray(embedding, dtype=np.float32)
        else:
            unusable += 1
            embedded_chunk["embedding"] = np.zeros(config.embedding_dims, dtype=np.float32)
        out.append(embedded_chunk)
    return out, retried, unusable


def split_into_conversations(
    messages: list[dict],
    gap_hours: float = 4.0,
) -> list[list[dict]]:
    if not messages:
        return []

    gap_ns = int(gap_hours * 60 * 60 * 1e9)
    conversations = []
    current_conv = [messages[0]]

    for msg in messages[1:]:
        prev_ts = current_conv[-1].get("timestamp", 0) or 0
        curr_ts = msg.get("timestamp", 0) or 0

        if curr_ts - prev_ts > gap_ns:
            conversations.append(current_conv)
            current_conv = [msg]
        else:
            current_conv.append(msg)

    if current_conv:
        conversations.append(current_conv)

    return conversations


def create_chunks(
    messages: list[dict],
    window_size: int = 8,
    stride: int = 8,
    min_chunk_chars: int = 10,
    contact_name: str | None = None,
) -> list[dict]:
    """Create conversation-aware chunks from messages.

    Slides a window of `window_size` messages forward by `stride`. A stride below
    `window_size` makes chunks overlap. Chunks never cross a conversation break.
    """
    chunks = []
    conversations = split_into_conversations(messages)

    for conversation in conversations:
        for i in range(0, len(conversation), stride):
            window = conversation[i : i + window_size]
            if not window:
                continue

            texts = []
            msg_metadata = []
            for msg in window:
                msg_text = msg.get("text", "")
                if msg_text:
                    is_from_me = msg.get("is_from_me", False)
                    sender = (
                        "Me"
                        if is_from_me
                        else (contact_name or msg.get("contact_display", "Contact"))
                    )
                    texts.append(f"{sender}: {msg_text}")
                    msg_metadata.append(
                        {
                            "sender": sender,
                            "text": msg_text,
                            "ts": msg.get("timestamp"),
                            "message_id": msg.get("message_id", 0),
                        }
                    )

            if not texts:
                continue

            # Add metadata header with contact name and date
            first_msg = window[0]
            last_msg = window[-1]
            ts = first_msg.get("timestamp")
            date_str = _format_timestamp_date(ts) if ts else "unknown"
            header = f"[Contact: {contact_name or first_msg.get('contact_display', 'Contact')} | {date_str}]"
            chunk_text = header + "\n" + "\n".join(texts)

            if len(chunk_text) < min_chunk_chars:
                continue

            chunks.append(
                {
                    "text": chunk_text,
                    "contact_id": first_msg.get("contact_id"),
                    "contact_display": first_msg.get("contact_display"),
                    "start_message_id": first_msg.get("message_id"),
                    "end_message_id": last_msg.get("message_id"),
                    "message_count": len(window),
                    "start_timestamp": first_msg.get("timestamp"),
                    "end_timestamp": last_msg.get("timestamp"),
                    "messages": msg_metadata,
                }
            )

    return chunks


def _format_timestamp_date(ts: int | None) -> str:
    """Convert an Apple Cocoa nanosecond timestamp to YYYY-MM-DD."""
    if ts is None:
        return "unknown"
    try:
        return apple_timestamp_to_date(ts) or "unknown"
    except Exception as e:
        import sys

        sys.stderr.write(f"debug: timestamp conversion failed for {ts}: {e}\n")
        return "unknown"


# Adaptive contact batch sizing: the first N contacts (sorted by message count
# DESC) use smaller batches to keep peak RSS lower on the heaviest contacts.
# After the heavy contacts, larger batches amortize Python/DuckDB overhead.
_HEAVY_CONTACT_BATCH_SIZE = 10  # For top contacts with the most messages
_NORMAL_CONTACT_BATCH_SIZE = 50  # For typical contacts
_HEAVY_CONTACT_COUNT = 50  # Top N contacts by message count use smaller batches


def _embed_and_write_batch(
    model,
    tokenizer,
    chunks: list[dict],
    conn: duckdb.DuckDBPyConnection,
    ingestion_id: int,
    config: EmbeddingConfig,
    chunk_id_offset: int,
    # Global progress tracking across all batches
    global_chunks_embedded: int,
    global_total_chunks_est: int,
    global_contacts_done: int,
    global_total_contacts: int,
    pipeline_start_time: float,
    last_emitted_pct: int = -1,
) -> tuple[int, int]:
    """Embed a batch of chunks and write to DuckDB.

    Returns:
        Tuple of (chunks_inserted, last_emitted_pct) so the caller can
        thread progress-emission state across batches.

    Sorts chunks by text length within the batch for efficient GPU utilization,
    then embeds in micro-batches and flushes to DuckDB periodically.
    """
    if not chunks:
        return 0, last_emitted_pct

    # Sort by text length for efficient GPU batching (similar-length texts
    # minimize padding waste in the tokenizer)
    chunks.sort(key=lambda c: len(c.get("text", "")))

    write_buffer_size = 2000
    all_embedded: list[dict] = []
    total_inserted = 0
    local_offset = chunk_id_offset
    nan_retried = 0
    nan_unusable = 0

    batch_size = config.batch_size
    for batch_start in range(0, len(chunks), batch_size):
        batch_end = min(batch_start + batch_size, len(chunks))
        batch = chunks[batch_start:batch_end]

        texts = [chunk["text"] for chunk in batch]
        embeddings = embed_batch_mlx(model, tokenizer, texts, prefix=config.prefix_document)

        # Yield GPU to allow WebKit/compositor to render (~10ms per micro-batch).
        # Across ~1,900 micro-batches this adds ~19s total — negligible vs the
        # 30+ min embedding pipeline, but prevents Metal compute from starving
        # the window server.
        time.sleep(0.01)

        embedded, retried, unusable = attach_embeddings(model, tokenizer, batch, embeddings, config)
        all_embedded.extend(embedded)
        nan_retried += retried
        nan_unusable += unusable

        if len(all_embedded) >= write_buffer_size:
            valid = [c for c in all_embedded if is_valid_embedding(c.get("embedding"))]
            if valid:
                inserted = write_chunks_bulk(conn, valid, ingestion_id, local_offset)
                total_inserted += inserted
                local_offset += len(valid)
            all_embedded = []
            gc.collect()

        # Emit progress only when the integer percent changes (reduces ~1,900
        # events to ~100, avoiding frontend event floods)
        chunks_done = global_chunks_embedded + batch_end
        elapsed = time.time() - pipeline_start_time

        if global_total_chunks_est > 0:
            progress_pct = min(int((chunks_done / global_total_chunks_est) * 100), 99)
        else:
            progress_pct = 0

        if progress_pct > last_emitted_pct:
            last_emitted_pct = progress_pct

            rate = chunks_done / elapsed if elapsed > 0 else 0
            remaining = (global_total_chunks_est - chunks_done) / rate if rate > 0 else None

            emit_stage_progress(
                IngestionStage.EMBEDDING,
                progress_pct,
                f"Embedded {chunks_done:,}/{global_total_chunks_est:,} chunks ({rate:.0f}/sec)"
                if elapsed > 0
                else f"Embedded {chunks_done:,}/{global_total_chunks_est:,} chunks",
                ProgressStats(
                    items_processed=chunks_done,
                    total_items=global_total_chunks_est,
                    chunks_embedded=chunks_done,
                    chunks_created=global_total_chunks_est,
                    contacts_processed=global_contacts_done,
                    total_contacts=global_total_contacts,
                    elapsed_secs=elapsed,
                    estimated_remaining_secs=remaining,
                ),
            )

    # Final flush
    if all_embedded:
        valid = [c for c in all_embedded if is_valid_embedding(c.get("embedding"))]
        if valid:
            inserted = write_chunks_bulk(conn, valid, ingestion_id, local_offset)
            total_inserted += inserted
        all_embedded = []
        gc.collect()

    if nan_retried:
        # One line per call, not per chunk: bursts of several hundred a minute are
        # normal for the 8-bit model and a line each drowns the ingestion log.
        log_warn(
            f"{nan_retried} of {len(chunks)} embeddings came back NaN/inf and were "
            f"re-embedded individually ({nan_unusable} still unusable)"
        )

    return total_inserted, last_emitted_pct


def run_embedding_pipeline(
    snapshot_db: Path,
    output_db: Path,
    addressbook_db: Path | None = None,
    config: EmbeddingConfig | None = None,
    ingestion_id: int = 0,
) -> dict:
    """Run the embedding pipeline with contact-batch processing.

    MEMORY OPTIMIZATION: Instead of loading all messages, creating all chunks,
    then embedding everything, this processes contacts in batches of
    _CONTACT_BATCH_SIZE. Each batch: read → chunk → embed → write → free.
    Combined with streaming cursors in read_messages_for_contacts(), this keeps
    peak memory bounded to ~200MB per batch instead of scaling with dataset size.

    Args:
        snapshot_db: Path to snapshot SQLite database
        output_db: Path to output DuckDB file
        addressbook_db: Optional path to AddressBook database for contact names
        config: Embedding configuration
        ingestion_id: Ingestion ID from SQLite metadata database

    Returns:
        Result dictionary with embedding statistics
    """
    if config is None:
        config = EmbeddingConfig()

    profiler = MemoryProfiler()
    profiler.snapshot("pipeline:start")

    start_time = time.time()
    contact_name_lookup = build_contact_name_lookup(addressbook_db)

    try:
        model, tokenizer = load_embedding_model(config)
        profiler.snapshot("pipeline:model_loaded")

        # Phase 1: Discover contacts (lightweight query — no message data loaded)
        # The user's ingestion filters are applied here and nowhere else: the
        # contact list is already date-filtered and min-count-filtered, so every
        # later batch read only sees messages inside the window.
        start_seconds = iso_date_to_apple_seconds(config.start_date)
        end_seconds = iso_date_to_apple_seconds(config.end_date, end_of_day=True)
        if start_seconds is not None or end_seconds is not None or config.min_messages_per_contact:
            log_info(
                f"Ingestion filters: start={config.start_date or 'none'}, "
                f"end={config.end_date or 'none'}, "
                f"min_messages_per_contact={config.min_messages_per_contact or 'none'}"
            )

        emit_stage_progress(IngestionStage.PARSING, 0, "Discovering contacts...")
        contact_info = get_contact_ids_and_counts(
            snapshot_db, start_seconds, end_seconds, config.min_messages_per_contact
        )
        total_contacts = len(contact_info)
        total_messages_est = sum(count for _, count in contact_info)
        # Rough chunk estimate: messages / stride. Refined after first batch.
        total_chunks_est = max(1, total_messages_est // config.chunk_stride)

        if total_contacts == 0:
            reason = (
                "No messages match the ingestion filters"
                if (
                    start_seconds is not None
                    or end_seconds is not None
                    or config.min_messages_per_contact
                )
                else "No messages found in snapshot"
            )
            log_error(reason)
            emit_result(False, error=reason)
            return {}

        emit_stage_progress(
            IngestionStage.PARSING,
            100,
            f"Found {total_contacts} contacts with {total_messages_est:,} messages",
            ProgressStats(total_items=total_messages_est, total_contacts=total_contacts),
        )

        log_info(
            f"Contact-batch pipeline: {total_contacts} contacts, "
            f"~{total_messages_est:,} messages, "
            f"batch sizes={_HEAVY_CONTACT_BATCH_SIZE} (heavy) / {_NORMAL_CONTACT_BATCH_SIZE} (normal)"
        )

        # Phase 2: Setup DuckDB once (shared across all batches)
        conn = duckdb.connect(str(output_db))
        configure_duckdb_memory(conn)
        ensure_vss_extension(conn)
        conn.execute("SET hnsw_enable_experimental_persistence = true")
        conn.execute("PRAGMA enable_progress_bar=false")

        # Clear existing data once before processing
        conn.execute(duckdb_queries.DELETE_CHUNK_PROJECTIONS)
        conn.execute(duckdb_queries.DELETE_MESSAGE_CHUNKS)
        conn.execute(duckdb_queries.DELETE_DAILY_MESSAGES)

        emit_stage_progress(IngestionStage.CHUNKING, 0, "Starting contact-batch processing...")

        # Log initial Metal memory state
        try:
            active_mb = mx.metal.get_active_memory() / (1024 * 1024)
            cache_mb = mx.metal.get_cache_memory() / (1024 * 1024)
            log_info(
                f"Metal memory before embedding: active={active_mb:.0f}MB, cache={cache_mb:.0f}MB"
            )
        except AttributeError:
            pass

        # Phase 3: Process contacts in batches
        # Adaptive batch sizing: heaviest contacts (first N, sorted by msg count
        # DESC) use smaller batches to keep peak RSS lower. Remaining contacts
        # use normal-sized batches to amortize overhead.
        chunk_id_offset = 0
        total_chunks_written = 0
        total_messages_read = 0
        contacts_processed = 0
        unique_contact_ids: set[str] = set()
        last_emitted_pct = -1

        # Build adaptive batch boundaries
        batch_boundaries: list[tuple[int, int]] = []
        pos = 0
        while pos < total_contacts:
            if pos < _HEAVY_CONTACT_COUNT:
                size = _HEAVY_CONTACT_BATCH_SIZE
            else:
                size = _NORMAL_CONTACT_BATCH_SIZE
            end = min(pos + size, total_contacts)
            batch_boundaries.append((pos, end))
            pos = end

        num_batches = len(batch_boundaries)
        for batch_idx, (batch_start, batch_end_contacts) in enumerate(batch_boundaries):
            batch_contacts = contact_info[batch_start:batch_end_contacts]
            batch_contact_ids = [cid for cid, _ in batch_contacts]
            batch_msg_count = sum(count for _, count in batch_contacts)

            log_info(
                f"Batch {batch_idx + 1}/{num_batches}: "
                f"{len(batch_contacts)} contacts (~{batch_msg_count:,} messages)"
            )

            # 3a. Read messages for this batch (streaming cursor — no blob spike)
            batch_messages = read_messages_for_contacts(
                snapshot_db, batch_contact_ids, start_seconds, end_seconds
            )
            total_messages_read += len(batch_messages)

            # 3b. Compute daily messages for this batch (append to existing rows)
            compute_daily_messages_to_conn(conn, batch_messages)

            # 3c. Create chunks for this batch
            batch_contact_groups = group_by_contact(batch_messages)
            batch_chunks: list[dict] = []

            for contact_id, contact_messages in batch_contact_groups.items():
                contact_display = contact_messages[0].get("contact_display", contact_id)
                contact_name = get_contact_display_name(
                    contact_id, contact_display, contact_name_lookup
                )
                chunks = create_chunks(
                    contact_messages,
                    config.chunk_window_size,
                    config.chunk_stride,
                    config.min_chunk_chars,
                    contact_name=contact_name,
                )
                for chunk in chunks:
                    chunk["contact_name"] = contact_name
                batch_chunks.extend(chunks)
                unique_contact_ids.add(contact_id)

            # Refine total chunk estimate after first batch
            if batch_idx == 0 and batch_messages:
                ratio = len(batch_chunks) / max(1, len(batch_messages))
                total_chunks_est = max(1, int(total_messages_est * ratio))
                log_info(f"Refined chunk estimate: ~{total_chunks_est:,} total chunks")

            contacts_processed += len(batch_contacts)

            # Report chunking progress
            chunk_pct = int((contacts_processed / total_contacts) * 100)
            emit_stage_progress(
                IngestionStage.CHUNKING,
                chunk_pct,
                f"Chunked {contacts_processed}/{total_contacts} contacts "
                f"({total_chunks_written + len(batch_chunks):,} chunks)",
                ProgressStats(
                    contacts_processed=contacts_processed,
                    total_contacts=total_contacts,
                    chunks_created=total_chunks_written + len(batch_chunks),
                    # Carry the embedded count too. Without it the UI reads 0 and
                    # falls back to chunks_created, so the Chunks tile flashes
                    # "N / N" at the start of every batch.
                    chunks_embedded=total_chunks_written,
                    total_items=total_messages_est,
                ),
            )

            # 3d. Free messages before embedding — chunks have their own text copies
            del batch_messages, batch_contact_groups

            # 3e. Embed and write this batch to DuckDB
            if batch_chunks:
                inserted, last_emitted_pct = _embed_and_write_batch(
                    model,
                    tokenizer,
                    batch_chunks,
                    conn,
                    ingestion_id,
                    config,
                    chunk_id_offset=chunk_id_offset,
                    global_chunks_embedded=total_chunks_written,
                    global_total_chunks_est=total_chunks_est,
                    global_contacts_done=contacts_processed,
                    global_total_contacts=total_contacts,
                    pipeline_start_time=start_time,
                    last_emitted_pct=last_emitted_pct,
                )
                chunk_id_offset += inserted
                total_chunks_written += inserted

            # 3f. Force DuckDB to flush WAL and free buffers periodically.
            # This prevents unbounded WAL growth and returns memory to the OS.
            if (batch_idx + 1) % 5 == 0:
                try:
                    conn.execute("CHECKPOINT")
                except Exception as e:
                    log_warn(f"DuckDB CHECKPOINT failed (non-fatal): {e}")

            # 3g. Free batch data and run GC to reclaim memory before next batch
            del batch_chunks
            gc.collect()

            profiler.snapshot(
                f"pipeline:batch_{batch_idx + 1}_complete "
                f"({contacts_processed}/{total_contacts} contacts)"
            )

        log_info(
            f"All batches complete: {total_chunks_written:,} chunks "
            f"from {contacts_processed} contacts"
        )
        profiler.snapshot("pipeline:all_batches_complete")

        conn.close()

        # Free embedding model before finalization — no longer needed.
        # Clear Metal cache to release GPU memory used by model weights.
        del model, tokenizer
        try:
            mx.metal.clear_cache()
        except AttributeError:
            pass
        gc.collect()
        profiler.snapshot("pipeline:model_freed")

        # Log final Metal memory state
        try:
            active_mb = mx.metal.get_active_memory() / (1024 * 1024)
            peak_mb = mx.metal.get_peak_memory() / (1024 * 1024)
            cache_mb = mx.metal.get_cache_memory() / (1024 * 1024)
            log_info(
                f"Metal memory after embedding: active={active_mb:.0f}MB, "
                f"peak={peak_mb:.0f}MB, cache={cache_mb:.0f}MB"
            )
        except AttributeError:
            pass

        finalize_ingestion(output_db, ingestion_id, total_chunks_written, len(unique_contact_ids))
        profiler.snapshot("pipeline:finalized")

        elapsed = time.time() - start_time

        emit_stage_progress(
            IngestionStage.SAVING,
            100,
            "Embedding complete!",
            ProgressStats(
                total_items=total_messages_read,
                chunks_embedded=total_chunks_written,
                chunks_created=total_chunks_written,
                contacts_processed=total_contacts,
                total_contacts=total_contacts,
                elapsed_secs=elapsed,
            ),
        )

        result_data = {
            "message_count": total_messages_read,
            "contact_count": total_contacts,
            "chunk_count": total_chunks_written,
            "embedding_dims": config.embedding_dims,
            "elapsed_secs": elapsed,
            "output_db": str(output_db),
            "embedding_model": config.model_name,
            "chunk_window_size": config.chunk_window_size,
            "chunk_stride": config.chunk_stride,
        }

        emit_result(True, data=result_data)
        log_info(f"Embedding complete in {elapsed:.1f}s")

        profiler.log_report()

        return result_data

    except KeyboardInterrupt:
        log_error("Interrupted by user")
        emit_result(False, error="Interrupted by user")
        return {}
    except Exception as e:
        log_error(f"Embedding failed: {e}")
        emit_result(False, error=str(e))
        return {}

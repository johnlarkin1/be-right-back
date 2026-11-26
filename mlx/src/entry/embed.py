#!/usr/bin/env python3
"""Embedding generation for message chunks using MLX."""

import argparse
import sys
from pathlib import Path

# Add mlx/src/ to path so entry points can import sibling packages.
# This is necessary because entry point scripts are invoked directly by the Rust
# subprocess runner (not via `python -m`), so the package root isn't automatically
# on sys.path. Imports below this block depend on this path setup.
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from config.embedding import EmbeddingConfig  # noqa: E402
from pipelines.embedding import run_embedding_pipeline  # noqa: E402
from progress.base import emit_result, log_error  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Generate embeddings for message chunks using MLX")
    parser.add_argument(
        "--snapshot-db",
        type=str,
        required=True,
        help="Path to snapshot SQLite database (chat_snapshot.db)",
    )
    parser.add_argument(
        "--output-db",
        type=str,
        required=True,
        help="Path to output DuckDB database (brb.duckdb)",
    )
    parser.add_argument(
        "--window-size",
        type=int,
        default=8,
        help="Messages per chunk (default: 8)",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=8,
        help="Stride between chunks. Below window-size, chunks overlap (default: 8)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=0,
        help="Embedding batch size (default: auto-detect)",
    )
    parser.add_argument(
        "--addressbook-db",
        type=str,
        default=None,
        help="Path to AddressBook.sqlitedb for contact name lookup (optional)",
    )
    parser.add_argument(
        "--ingestion-id",
        type=int,
        required=True,
        help="Ingestion ID from SQLite metadata database",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="Only ingest messages on or after this date (ISO YYYY-MM-DD, inclusive)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="Only ingest messages on or before this date (ISO YYYY-MM-DD, inclusive)",
    )
    parser.add_argument(
        "--min-messages-per-contact",
        type=int,
        default=None,
        help="Skip contacts with fewer messages than this inside the date range",
    )

    args = parser.parse_args()

    snapshot_db = Path(args.snapshot_db).expanduser()
    output_db = Path(args.output_db).expanduser()

    if not snapshot_db.exists():
        log_error(f"Snapshot database not found: {snapshot_db}")
        emit_result(False, error=f"Snapshot database not found: {snapshot_db}")
        sys.exit(1)

    config = EmbeddingConfig(
        chunk_window_size=args.window_size,
        chunk_stride=args.stride,
        batch_size=args.batch_size,
        start_date=args.start_date,
        end_date=args.end_date,
        min_messages_per_contact=args.min_messages_per_contact,
    )

    addressbook_db = Path(args.addressbook_db).expanduser() if args.addressbook_db else None

    try:
        run_embedding_pipeline(snapshot_db, output_db, addressbook_db, config, args.ingestion_id)
    except Exception as e:
        log_error(f"Embedding failed: {e}")
        emit_result(False, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()

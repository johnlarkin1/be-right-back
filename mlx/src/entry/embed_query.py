#!/usr/bin/env python3
"""Standalone query embedding helper for Be Right Back.

Lightweight one-shot script that embeds a single query string using the
ModernBERT embedding model. Designed to be called from Rust via subprocess.

Protocol:
  - Reads one line of query text from stdin
  - Loads the embedding model
  - Embeds with "search_query: " prefix (matching the ingestion pipeline)
  - Outputs a JSON object to stdout:
    {"type": "embedding", "vector": [...], "dims": 768}
  - On error, outputs:
    {"type": "error", "message": "..."}
  - All human-readable logs go to stderr

This is intentionally minimal. For repeated embeddings, prefer the
inference daemon's embed_query command (inference_daemon.py) which keeps
the model loaded in memory across calls.
"""

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
from ml.embeddings import embed_batch_mlx, load_embedding_model  # noqa: E402
from utils.ipc import send_response  # noqa: E402


def main() -> None:
    try:
        # Read query from stdin (one line)
        query = sys.stdin.readline().strip()
        if not query:
            send_response({"type": "error", "message": "No query text provided on stdin"})
            sys.exit(1)

        sys.stderr.write(f"Embedding query: {query[:80]}...\n")
        sys.stderr.flush()

        # Load model
        sys.stderr.write("Loading embedding model...\n")
        sys.stderr.flush()

        config = EmbeddingConfig()
        model, tokenizer = load_embedding_model(config)

        sys.stderr.write("Model loaded, generating embedding...\n")
        sys.stderr.flush()

        # Generate embedding with search_query prefix
        embedding = embed_batch_mlx(
            model,
            tokenizer,
            [query],
            prefix=config.prefix_query,
        )

        # Convert to list for JSON serialization
        vector = embedding[0].tolist()
        dims = len(vector)

        sys.stderr.write(f"Embedding generated: {dims} dimensions\n")
        sys.stderr.flush()

        send_response({"type": "embedding", "vector": vector, "dims": dims})

    except Exception as e:
        send_response({"type": "error", "message": f"Embedding failed: {e}"})
        sys.exit(1)


if __name__ == "__main__":
    main()

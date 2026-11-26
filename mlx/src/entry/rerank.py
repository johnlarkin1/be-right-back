#!/usr/bin/env python3
"""Standalone cross-encoder reranking entry point.

Reads a JSON request from stdin and writes reranked scores to stdout.
The cross-encoder model is loaded on first call and cached for the
duration of the process.

Input format (JSON on stdin):
    {
        "query": "what is my favorite food",
        "candidates": [
            {"chunk_id": 1, "text": "We talked about pizza..."},
            {"chunk_id": 2, "text": "The weather was nice..."}
        ]
    }

Output format (JSON on stdout):
    {
        "scores": [
            {"chunk_id": 1, "score": 0.95},
            {"chunk_id": 2, "score": 0.12}
        ]
    }

On error, outputs:
    {"error": "description of what went wrong"}
"""

import json
import sys
from pathlib import Path

# Add mlx/src/ to path so entry points can import sibling packages.
# This is necessary because entry point scripts are invoked directly by the Rust
# subprocess runner (not via `python -m`), so the package root isn't automatically
# on sys.path. Imports below this block depend on this path setup.
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from ml.reranker import get_reranker  # noqa: E402


def _write(obj: dict) -> None:
    """Write a single JSON response line and flush (one response per request)."""
    json.dump(obj, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def _handle(request: dict, reranker) -> dict:
    query = request.get("query")
    candidates = request.get("candidates", [])
    if not query:
        return {"error": "query is required"}
    if not candidates:
        return {"scores": []}
    results = reranker.rerank(query, candidates, text_key="text", id_key="chunk_id")
    return {"scores": results}


def main() -> None:
    """Process newline-delimited JSON rerank requests from stdin.

    Reads one request per line and writes one response per line, keeping the
    cross-encoder model resident across requests (warm ~50-150ms reranks). This
    serves both the persistent daemon (Rust keeps the process alive and streams
    many request lines) and one-shot callers (a single request line + EOF runs
    once and exits). The model is loaded lazily on the first real request via the
    shared `get_reranker()` singleton, so it is reused for the process lifetime.
    """
    reranker = None
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            _write({"error": f"invalid JSON: {e}"})
            continue
        try:
            if reranker is None:
                reranker = get_reranker()
            _write(_handle(request, reranker))
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"Reranking failed: {e}\n")
            sys.stderr.flush()
            _write({"error": str(e)})


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Semantic search with dynamic MLX embeddings in DuckDB.

Registers an `embed_query(text)` UDF that you can use in SQL queries.

Usage:
    # One-shot query (prints SQL with embedded vector for DBeaver)
    python search.py --db <path> "your query"

    # Interactive mode (keeps model loaded, run SQL with embed_query())
    python search.py --db <path> --interactive

Example interactive session:
    sql> SELECT contact_name, array_cosine_similarity(embedding, embed_query('plan a trip')) AS sim
         FROM message_chunks ORDER BY sim DESC LIMIT 5;
"""

import argparse
import sys
from pathlib import Path

import duckdb
import mlx.core as mx
import numpy as np
from mlx_embeddings.utils import load

# Must match the model used for indexing in embed.py
MODEL_NAME = "mlx-community/nomicai-modernbert-embed-base-8bit"
EMBEDDING_DIMS = 768
PREFIX_QUERY = "search_query: "


def mean_pooling(outputs, attention_mask):
    last_hidden = outputs.last_hidden_state
    mask_expanded = mx.expand_dims(attention_mask, -1)
    mask_expanded = mx.broadcast_to(mask_expanded, last_hidden.shape)
    sum_embeddings = mx.sum(last_hidden * mask_expanded, axis=1)
    sum_mask = mx.clip(mx.sum(mask_expanded, axis=1), a_min=1e-9, a_max=None)
    return sum_embeddings / sum_mask


def normalize_embeddings(embeddings):
    norms = mx.sqrt(mx.sum(embeddings * embeddings, axis=-1, keepdims=True))
    return embeddings / mx.clip(norms, a_min=1e-9, a_max=None)


def create_embed_query_fn(model, tokenizer):
    """Create the embed_query function that will be registered as a UDF."""

    def embed_query(text: str) -> list[float]:
        prefixed = f"{PREFIX_QUERY}{text}"
        inputs = tokenizer.batch_encode_plus(
            [prefixed],
            return_tensors="mlx",
            padding=True,
            truncation=True,
            max_length=512,
        )
        outputs = model(inputs["input_ids"], attention_mask=inputs["attention_mask"])

        if hasattr(outputs, "text_embeds") and outputs.text_embeds is not None:
            emb = outputs.text_embeds
        else:
            emb = mean_pooling(outputs, inputs["attention_mask"])
            emb = normalize_embeddings(emb)

        mx.eval(emb)
        arr = np.nan_to_num(np.array(emb[0]), nan=0.0, posinf=0.0, neginf=0.0)
        return arr.tolist()

    return embed_query


def register_embed_query(conn, model, tokenizer):
    """Register embed_query as a DuckDB UDF returning FLOAT[768]."""
    embed_fn = create_embed_query_fn(model, tokenizer)
    conn.create_function(
        "embed_query",
        embed_fn,
        ["VARCHAR"],
        f"FLOAT[{EMBEDDING_DIMS}]",
    )


def run_interactive(conn):
    """Run an interactive SQL REPL with embed_query() available."""
    print("\n=== DuckDB Interactive Mode ===")
    print("The embed_query(text) function is registered and ready to use.")
    print("Type SQL queries, or 'quit' to exit. Use ';' to end multi-line queries.\n")

    print("Example:")
    print(
        "  SELECT contact_name, array_cosine_similarity(embedding, embed_query('weekend plans')) AS sim"
    )
    print("  FROM message_chunks ORDER BY sim DESC LIMIT 5;\n")

    buffer = []
    while True:
        try:
            prompt = "sql> " if not buffer else "...> "
            line = input(prompt)

            if line.strip().lower() in ("quit", "exit", "q", "\\q"):
                break

            buffer.append(line)
            full_query = "\n".join(buffer)

            # Execute when we see a semicolon
            if ";" in full_query:
                query = full_query.strip().rstrip(";")
                buffer = []

                if not query:
                    continue

                try:
                    result = conn.execute(query).fetchdf()
                    if result.empty:
                        print("(no results)")
                    else:
                        print(result.to_string())
                    print()
                except Exception as e:
                    print(f"Error: {e}\n")

        except KeyboardInterrupt:
            print("\n(use 'quit' to exit)")
            buffer = []
        except EOFError:
            break

    print("Goodbye!")


def main():
    parser = argparse.ArgumentParser(
        description="Semantic search with dynamic MLX embeddings in DuckDB"
    )
    parser.add_argument(
        "query", nargs="?", help="Search query string (for one-shot mode)"
    )
    parser.add_argument("--db", type=str, required=True, help="Path to DuckDB database")
    parser.add_argument("--top-k", type=int, default=5, help="Number of results")
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Start interactive SQL REPL with embed_query() available",
    )
    args = parser.parse_args()

    if not args.interactive and not args.query:
        parser.error("Either provide a query or use --interactive mode")

    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        print(f"Database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    # Load model
    print(f"Loading model: {MODEL_NAME}", file=sys.stderr)
    model, tokenizer = load(MODEL_NAME)

    # Connect and register UDF (read_only=False needed for UDF registration)
    conn = duckdb.connect(str(db_path), read_only=False)
    conn.execute("LOAD vss")
    conn.execute("SET hnsw_enable_experimental_persistence = true")
    register_embed_query(conn, model, tokenizer)
    print("Registered embed_query() UDF", file=sys.stderr)

    if args.interactive:
        run_interactive(conn)
        conn.close()
        return

    # One-shot mode: embed and print SQL
    query_embedding = conn.execute("SELECT embed_query(?)", [args.query]).fetchone()[0]

    # Format embedding as SQL array literal
    arr_str = "[" + ",".join(f"{v:.6f}" for v in query_embedding) + "]"

    # Print the full SQL statement
    sql = f"""-- Semantic search for: "{args.query}"
-- Run this in DBeaver after: LOAD vss;

SELECT
    mc.chunk_id,
    mc.contact_name,
    array_cosine_similarity(mc.embedding, {arr_str}::FLOAT[768]) AS similarity,
    json_extract_string(mc.chunk_data, '$.formatted') AS text
FROM message_chunks mc
WHERE mc.embedding IS NOT NULL
ORDER BY similarity DESC
LIMIT {args.top_k};
"""
    print(sql)

    conn.close()


if __name__ == "__main__":
    main()

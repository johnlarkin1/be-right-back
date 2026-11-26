"""Main benchmark runner for embedding strategies."""

import argparse
import json
import platform
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import duckdb
import mlx.core as mx
import numpy as np
import psutil
from rich.console import Console
from rich.table import Table
from tabulate import tabulate

from .sample_data import Message, load_sample_data
from .strategies import (
    STRATEGIES,
    Chunk,
    WriteStrategy,
    create_chunks,
    embed_batch_mlx,
    get_strategy,
    load_embedding_model,
    MODEL_NAME,
    EMBEDDING_DIMS,
)

console = Console()

# DuckDB schema for benchmark database
SCHEMA = """
CREATE TABLE IF NOT EXISTS message_chunks (
    chunk_id BIGINT PRIMARY KEY,
    chunk_data JSON NOT NULL,
    embedding FLOAT[768] NOT NULL,
    start_message_id BIGINT NOT NULL,
    end_message_id BIGINT NOT NULL,
    message_ids BIGINT[] NOT NULL,
    contact_id VARCHAR NOT NULL,
    contact_name VARCHAR,
    start_timestamp TIMESTAMP WITH TIME ZONE,
    end_timestamp TIMESTAMP WITH TIME ZONE,
    message_count INTEGER NOT NULL,
    total_chars INTEGER NOT NULL,
    has_from_me BOOLEAN NOT NULL,
    has_from_them BOOLEAN NOT NULL,
    has_questions BOOLEAN NOT NULL,
    ingestion_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    id INTEGER PRIMARY KEY,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    snapshot_dir VARCHAR,
    total_chunks INTEGER,
    total_contacts INTEGER,
    embedding_model VARCHAR,
    embedding_dims INTEGER,
    window_size INTEGER,
    stride INTEGER
);
"""


@dataclass
class BenchmarkConfig:
    """Configuration for a single benchmark run."""

    batch_size: int
    write_method: str
    sample_size: int = 10000
    write_buffer_size: int = 5000  # For parquet_buffered


@dataclass
class BenchmarkResult:
    """Result from a single benchmark run."""

    config: BenchmarkConfig
    total_time_sec: float
    chunks_per_sec: float
    total_chunks: int
    total_messages: int
    peak_memory_mb: float
    embedding_time_sec: float
    write_time_sec: float
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class SystemInfo:
    """System information for benchmark context."""

    platform: str
    processor: str
    python_version: str
    mlx_device: str
    total_ram_gb: float
    cpu_count: int


def get_system_info() -> SystemInfo:
    """Collect system information."""
    return SystemInfo(
        platform=platform.platform(),
        processor=platform.processor(),
        python_version=platform.python_version(),
        mlx_device=str(mx.default_device()),
        total_ram_gb=psutil.virtual_memory().total / (1024**3),
        cpu_count=psutil.cpu_count(),
    )


def create_benchmark_db(scratch_dir: Path, config: BenchmarkConfig) -> Path:
    """Create a fresh DuckDB database for benchmarking."""
    db_name = f"benchmark_{config.batch_size}_{config.write_method}.duckdb"
    db_path = scratch_dir / db_name

    # Remove existing file
    if db_path.exists():
        db_path.unlink()

    conn = duckdb.connect(str(db_path))
    conn.execute("INSTALL vss")
    conn.execute("LOAD vss")
    conn.execute(SCHEMA)
    conn.close()

    return db_path


def run_single_benchmark(
    config: BenchmarkConfig,
    messages: list[Message],
    model,
    tokenizer,
    scratch_dir: Path,
) -> BenchmarkResult:
    """Run a single benchmark with the given configuration."""
    console.print(
        f"\n[bold]Running: batch_size={config.batch_size}, write_method={config.write_method}[/bold]"
    )

    # Create fresh database
    db_path = create_benchmark_db(scratch_dir, config)
    conn = duckdb.connect(str(db_path))
    conn.execute("LOAD vss")

    # Create ingestion run (use explicit ID since we only have one per benchmark)
    run_id = 1
    conn.execute(
        """
        INSERT INTO ingestion_runs (id, embedding_model, embedding_dims, window_size, stride)
        VALUES (?, ?, ?, 5, 3)
        """,
        [run_id, MODEL_NAME, EMBEDDING_DIMS],
    )

    # Create chunks
    chunks = create_chunks(messages)
    total_chunks = len(chunks)

    # Sort chunks by text length to minimize padding waste in batches
    # Similar-length texts get batched together
    chunks = sorted(chunks, key=lambda c: len(c.text))

    # Show length distribution
    lengths = [len(c.text) for c in chunks]
    console.print(
        f"  Created {total_chunks} chunks from {len(messages)} messages (sorted by length)"
    )
    console.print(
        f"  Chunk lengths: min={min(lengths)}, median={sorted(lengths)[len(lengths) // 2]}, max={max(lengths)} chars"
    )

    # Get write strategy
    strategy = get_strategy(config.write_method)

    # Track memory before
    process = psutil.Process()
    mem_before = process.memory_info().rss / (1024 * 1024)

    # Benchmark embedding + writing
    start_time = time.perf_counter()
    embedding_time = 0.0
    write_time = 0.0

    # Buffer for parquet_buffered strategy
    write_buffer: list[Chunk] = []

    for batch_start in range(0, len(chunks), config.batch_size):
        batch_end = min(batch_start + config.batch_size, len(chunks))
        batch = chunks[batch_start:batch_end]

        # Embed batch
        embed_start = time.perf_counter()
        texts = [chunk.text for chunk in batch]
        embeddings = embed_batch_mlx(model, tokenizer, texts)
        embedding_time += time.perf_counter() - embed_start

        # Attach embeddings
        for chunk, embedding in zip(batch, embeddings):
            embedding = np.nan_to_num(embedding, nan=0.0, posinf=0.0, neginf=0.0)
            chunk.embedding = embedding.tolist()

        # Write strategy
        write_start = time.perf_counter()

        if config.write_method == "parquet_buffered":
            write_buffer.extend(batch)
            if len(write_buffer) >= config.write_buffer_size:
                strategy.write_chunks(conn, write_buffer, run_id)
                write_buffer = []
        else:
            strategy.write_chunks(conn, batch, run_id)

        write_time += time.perf_counter() - write_start

        # Progress
        progress = batch_end / len(chunks) * 100
        console.print(f"  Progress: {batch_end}/{len(chunks)} ({progress:.0f}%)", end="\r")

    # Flush remaining buffer for parquet_buffered
    if write_buffer:
        write_start = time.perf_counter()
        strategy.write_chunks(conn, write_buffer, run_id)
        write_time += time.perf_counter() - write_start

    total_time = time.perf_counter() - start_time

    # Track memory after
    mem_after = process.memory_info().rss / (1024 * 1024)
    peak_memory = mem_after - mem_before

    # Finalize
    conn.execute(
        "UPDATE ingestion_runs SET completed_at = CURRENT_TIMESTAMP, total_chunks = ? WHERE id = ?",
        [total_chunks, run_id],
    )
    conn.close()

    chunks_per_sec = total_chunks / total_time if total_time > 0 else 0

    result = BenchmarkResult(
        config=config,
        total_time_sec=total_time,
        chunks_per_sec=chunks_per_sec,
        total_chunks=total_chunks,
        total_messages=len(messages),
        peak_memory_mb=peak_memory,
        embedding_time_sec=embedding_time,
        write_time_sec=write_time,
    )

    console.print(f"  ✓ Completed in {total_time:.1f}s ({chunks_per_sec:.0f} chunks/sec)")

    return result


def run_full_matrix(
    sample_size: int = 10000,
    batch_sizes: list[int] | None = None,
    write_methods: list[str] | None = None,
    scratch_dir: Path | None = None,
    results_dir: Path | None = None,
) -> list[BenchmarkResult]:
    """Run full benchmark matrix."""
    if batch_sizes is None:
        batch_sizes = [32, 64, 128, 256]

    if write_methods is None:
        write_methods = list(STRATEGIES.keys())

    if scratch_dir is None:
        scratch_dir = Path(__file__).parent.parent / "scratch"

    if results_dir is None:
        results_dir = Path(__file__).parent.parent / "results"

    scratch_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)

    # Load sample data
    console.print("[bold blue]Loading sample data...[/bold blue]")
    sample_data = load_sample_data(sample_size)

    # Load model (once, reuse for all benchmarks)
    console.print("[bold blue]Loading embedding model...[/bold blue]")
    model, tokenizer = load_embedding_model(MODEL_NAME)
    console.print(f"  MLX device: {mx.default_device()}")

    # Get system info
    sys_info = get_system_info()

    # Run all combinations
    results: list[BenchmarkResult] = []
    total_runs = len(batch_sizes) * len(write_methods)
    current_run = 0

    console.print(f"\n[bold green]Running {total_runs} benchmark configurations[/bold green]")

    for batch_size in batch_sizes:
        for write_method in write_methods:
            current_run += 1
            console.print(f"\n[bold]Run {current_run}/{total_runs}[/bold]")

            config = BenchmarkConfig(
                batch_size=batch_size,
                write_method=write_method,
                sample_size=sample_size,
            )

            result = run_single_benchmark(
                config=config,
                messages=sample_data.messages,
                model=model,
                tokenizer=tokenizer,
                scratch_dir=scratch_dir,
            )
            results.append(result)

    # Sort by chunks_per_sec (best first)
    results.sort(key=lambda r: r.chunks_per_sec, reverse=True)

    # Save results to JSON
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = results_dir / f"benchmark_{timestamp}.json"

    output = {
        "system_info": asdict(sys_info),
        "sample_size": sample_size,
        "total_messages": sample_data.message_count,
        "contact": sample_data.contact_display,
        "results": [asdict(r) for r in results],
    }

    with open(results_file, "w") as f:
        json.dump(output, f, indent=2, default=str)

    console.print(f"\n[bold green]Results saved to: {results_file}[/bold green]")

    return results


def print_results_table(results: list[BenchmarkResult], sys_info: SystemInfo | None = None):
    """Print a formatted results table."""
    if sys_info:
        console.print(f"\n[bold]System: {sys_info.platform}[/bold]")
        console.print(f"RAM: {sys_info.total_ram_gb:.1f}GB, MLX Device: {sys_info.mlx_device}")

    # Create rich table
    table = Table(title="\n🏁 Embedding Benchmark Results")

    table.add_column("Rank", style="cyan", justify="right")
    table.add_column("Batch", style="magenta", justify="right")
    table.add_column("Write Method", style="green")
    table.add_column("Chunks/sec", style="yellow", justify="right")
    table.add_column("Total Time", style="blue", justify="right")
    table.add_column("Embed Time", justify="right")
    table.add_column("Write Time", justify="right")
    table.add_column("Memory", justify="right")

    for i, r in enumerate(results):
        rank = "🏆" if i == 0 else str(i + 1)
        table.add_row(
            rank,
            str(r.config.batch_size),
            r.config.write_method,
            f"{r.chunks_per_sec:.0f}",
            f"{r.total_time_sec:.1f}s",
            f"{r.embedding_time_sec:.1f}s",
            f"{r.write_time_sec:.1f}s",
            f"{r.peak_memory_mb:.0f}MB",
        )

    console.print(table)

    # Print winner
    winner = results[0]
    console.print(
        f"\n[bold green]🏆 Winner: batch_size={winner.config.batch_size}, "
        f"write_method={winner.config.write_method} ({winner.chunks_per_sec:.0f} chunks/sec)[/bold green]"
    )


def main():
    parser = argparse.ArgumentParser(description="Benchmark embedding strategies")
    parser.add_argument(
        "--sample-size",
        type=int,
        default=10000,
        help="Number of messages to use for benchmarking (default: 10000)",
    )
    parser.add_argument(
        "--batch-sizes",
        type=str,
        default="32,64,128,256",
        help="Comma-separated batch sizes to test (default: 32,64,128,256)",
    )
    parser.add_argument(
        "--write-methods",
        type=str,
        default=None,
        help=f"Comma-separated write methods to test (default: all). Available: {','.join(STRATEGIES.keys())}",
    )
    parser.add_argument(
        "--visualize",
        action="store_true",
        help="Generate visualization charts after benchmarking",
    )

    args = parser.parse_args()

    batch_sizes = [int(x) for x in args.batch_sizes.split(",")]
    write_methods = args.write_methods.split(",") if args.write_methods else None

    console.print(
        "[bold blue]═══════════════════════════════════════════════════════════════[/bold blue]"
    )
    console.print(
        "[bold blue]              Embedding Strategy Benchmark Suite                [/bold blue]"
    )
    console.print(
        "[bold blue]═══════════════════════════════════════════════════════════════[/bold blue]"
    )

    results = run_full_matrix(
        sample_size=args.sample_size,
        batch_sizes=batch_sizes,
        write_methods=write_methods,
    )

    sys_info = get_system_info()
    print_results_table(results, sys_info)

    if args.visualize:
        from .visualize import generate_visualizations

        results_dir = Path(__file__).parent.parent / "results"
        generate_visualizations(results, sys_info, results_dir)


if __name__ == "__main__":
    main()

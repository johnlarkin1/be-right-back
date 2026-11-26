#!/usr/bin/env python3
"""
HDBSCAN Clustering Pipeline Benchmark (Python)

Benchmarks the full clustering pipeline:
    Load embeddings → PCA (768D→50D) → HDBSCAN → UMAP (50D→3D)

Usage:
    python -m src.benchmark --scales 10000,50000 --synthetic
    python -m src.benchmark --scales 10000,50000,100000 --real
"""

import argparse
import json
import platform
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import hdbscan
import numpy as np
import psutil
import umap
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from sklearn.decomposition import PCA

from .data_loader import (
    count_real_embeddings,
    generate_synthetic_embeddings,
    get_default_db_path,
    load_real_embeddings,
)

console = Console()


@dataclass
class BenchmarkConfig:
    """Configuration for a benchmark run."""

    pca_dims: int = 50
    min_cluster_size: int = 100
    min_samples: int = 10
    umap_n_components: int = 3
    umap_n_neighbors: int = 15
    umap_min_dist: float = 0.1
    random_state: int = 42


@dataclass
class BenchmarkResult:
    """Results from a single benchmark run."""

    n_points: int
    pca_time_sec: float
    hdbscan_time_sec: float
    umap_time_sec: float
    total_time_sec: float
    peak_memory_mb: float
    n_clusters: int
    noise_ratio: float
    config: dict


def get_system_info() -> dict:
    """Collect system information for the benchmark report."""
    mem = psutil.virtual_memory()
    return {
        "platform": platform.platform(),
        "processor": platform.processor(),
        "cpu_count": psutil.cpu_count(),
        "ram_gb": round(mem.total / (1024**3), 1),
        "python_version": platform.python_version(),
    }


def benchmark_pipeline(
    embeddings: np.ndarray,
    config: BenchmarkConfig,
    progress: Progress | None = None,
    task_id: int | None = None,
) -> BenchmarkResult:
    """
    Run the full clustering pipeline and measure performance.

    Pipeline: PCA (768D→50D) → HDBSCAN → UMAP (50D→3D)

    Args:
        embeddings: Input embeddings of shape (n_samples, 768)
        config: Benchmark configuration
        progress: Optional Rich progress bar
        task_id: Optional task ID for progress updates

    Returns:
        BenchmarkResult with timing and quality metrics
    """
    proc = psutil.Process()
    mem_before = proc.memory_info().rss
    n_points = len(embeddings)

    # Stage 1: PCA (768D → 50D)
    if progress and task_id:
        progress.update(task_id, description=f"[cyan]PCA ({n_points:,} points)...")

    t0 = time.perf_counter()
    pca = PCA(
        n_components=config.pca_dims, svd_solver="randomized", random_state=config.random_state
    )
    X_reduced = pca.fit_transform(embeddings)
    pca_time = time.perf_counter() - t0

    # Stage 2: HDBSCAN clustering
    if progress and task_id:
        progress.update(task_id, description=f"[yellow]HDBSCAN ({n_points:,} points)...")

    t0 = time.perf_counter()
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=config.min_cluster_size,
        min_samples=config.min_samples,
        core_dist_n_jobs=-1,  # Use all cores
    )
    labels = clusterer.fit_predict(X_reduced)
    hdbscan_time = time.perf_counter() - t0

    # Stage 3: UMAP (50D → 3D)
    if progress and task_id:
        progress.update(task_id, description=f"[magenta]UMAP ({n_points:,} points)...")

    t0 = time.perf_counter()
    reducer = umap.UMAP(
        n_components=config.umap_n_components,
        n_neighbors=config.umap_n_neighbors,
        min_dist=config.umap_min_dist,
        metric="euclidean",
        random_state=config.random_state,
    )
    coords_3d = reducer.fit_transform(X_reduced)
    umap_time = time.perf_counter() - t0

    # Compute metrics
    mem_after = proc.memory_info().rss
    peak_memory_mb = (mem_after - mem_before) / (1024 * 1024)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_ratio = float((labels == -1).mean())

    return BenchmarkResult(
        n_points=n_points,
        pca_time_sec=round(pca_time, 3),
        hdbscan_time_sec=round(hdbscan_time, 3),
        umap_time_sec=round(umap_time, 3),
        total_time_sec=round(pca_time + hdbscan_time + umap_time, 3),
        peak_memory_mb=round(peak_memory_mb, 1),
        n_clusters=n_clusters,
        noise_ratio=round(noise_ratio, 4),
        config=asdict(config),
    )


def run_benchmarks(
    scales: list[int],
    use_synthetic: bool = True,
    db_path: Path | None = None,
    config: BenchmarkConfig | None = None,
) -> list[BenchmarkResult]:
    """
    Run benchmarks at multiple scales.

    Args:
        scales: List of sample sizes to benchmark
        use_synthetic: If True, use synthetic data. If False, use real embeddings.
        db_path: Path to DuckDB database (for real data)
        config: Benchmark configuration

    Returns:
        List of BenchmarkResult objects
    """
    if config is None:
        config = BenchmarkConfig()

    results = []

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        for scale in scales:
            task = progress.add_task(f"[green]Loading {scale:,} points...", total=None)

            # Load or generate data
            if use_synthetic:
                embeddings, _ = generate_synthetic_embeddings(
                    n_samples=scale,
                    random_state=config.random_state,
                )
            else:
                embeddings = load_real_embeddings(db_path=db_path, limit=scale)

            # Run benchmark
            result = benchmark_pipeline(embeddings, config, progress, task)
            results.append(result)

            progress.update(
                task, description=f"[green]Done: {scale:,} points in {result.total_time_sec:.1f}s"
            )
            progress.remove_task(task)

            # Print result
            console.print(
                f"  [bold]{scale:>7,}[/bold] points: "
                f"[cyan]{result.pca_time_sec:>5.2f}s[/cyan] PCA + "
                f"[yellow]{result.hdbscan_time_sec:>5.2f}s[/yellow] HDBSCAN + "
                f"[magenta]{result.umap_time_sec:>5.2f}s[/magenta] UMAP = "
                f"[bold green]{result.total_time_sec:>6.2f}s[/bold green] total | "
                f"{result.n_clusters} clusters, {result.noise_ratio:.1%} noise"
            )

    return results


def print_results_table(results: list[BenchmarkResult]) -> None:
    """Print a summary table of benchmark results."""
    table = Table(title="Benchmark Results Summary")

    table.add_column("Points", justify="right", style="cyan")
    table.add_column("PCA (s)", justify="right")
    table.add_column("HDBSCAN (s)", justify="right")
    table.add_column("UMAP (s)", justify="right")
    table.add_column("Total (s)", justify="right", style="bold green")
    table.add_column("Memory (MB)", justify="right")
    table.add_column("Clusters", justify="right")
    table.add_column("Noise %", justify="right")

    for r in results:
        table.add_row(
            f"{r.n_points:,}",
            f"{r.pca_time_sec:.2f}",
            f"{r.hdbscan_time_sec:.2f}",
            f"{r.umap_time_sec:.2f}",
            f"{r.total_time_sec:.2f}",
            f"{r.peak_memory_mb:.0f}",
            str(r.n_clusters),
            f"{r.noise_ratio:.1%}",
        )

    console.print()
    console.print(table)


def save_results(results: list[BenchmarkResult], output_path: Path) -> None:
    """Save benchmark results to JSON file."""
    report = {
        "language": "python",
        "timestamp": datetime.now().isoformat(),
        "system": get_system_info(),
        "results": [asdict(r) for r in results],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    console.print(f"\n[green]Results saved to:[/green] {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Benchmark HDBSCAN clustering pipeline (Python implementation)"
    )
    parser.add_argument(
        "--scales",
        type=str,
        default="10000,50000,100000",
        help="Comma-separated list of sample sizes to benchmark (default: 10000,50000,100000)",
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        default=True,
        help="Use synthetic data (default)",
    )
    parser.add_argument(
        "--real",
        action="store_true",
        help="Use real embeddings from DuckDB",
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=None,
        help="Path to DuckDB database (for real data)",
    )
    parser.add_argument(
        "--pca-dims",
        type=int,
        default=50,
        help="PCA dimensions (default: 50)",
    )
    parser.add_argument(
        "--min-cluster-size",
        type=int,
        default=100,
        help="HDBSCAN min_cluster_size (default: 100)",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=10,
        help="HDBSCAN min_samples (default: 10)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent.parent
        / "results"
        / f"benchmark_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        help="Output path for JSON results",
    )

    args = parser.parse_args()

    # Parse scales
    scales = [int(s.strip()) for s in args.scales.split(",")]

    # Determine data source
    use_synthetic = not args.real

    # Print header
    console.print("\n[bold]HDBSCAN Clustering Pipeline Benchmark (Python)[/bold]")
    console.print("=" * 60)

    system_info = get_system_info()
    console.print(f"System: {system_info['platform']}")
    console.print(f"CPU: {system_info['processor']} ({system_info['cpu_count']} cores)")
    console.print(f"RAM: {system_info['ram_gb']} GB")
    console.print(f"Python: {system_info['python_version']}")

    if use_synthetic:
        console.print("\n[yellow]Data source:[/yellow] Synthetic embeddings (768D)")
    else:
        db_path = args.db_path or get_default_db_path()
        n_available = count_real_embeddings(db_path)
        console.print(f"\n[yellow]Data source:[/yellow] Real embeddings from {db_path}")
        console.print(f"[yellow]Available:[/yellow] {n_available:,} embeddings")

    console.print(f"\n[yellow]Scales:[/yellow] {', '.join(f'{s:,}' for s in scales)}")
    console.print(f"[yellow]PCA dims:[/yellow] {args.pca_dims}")
    console.print(
        f"[yellow]HDBSCAN:[/yellow] min_cluster_size={args.min_cluster_size}, min_samples={args.min_samples}"
    )
    console.print()

    # Create config
    config = BenchmarkConfig(
        pca_dims=args.pca_dims,
        min_cluster_size=args.min_cluster_size,
        min_samples=args.min_samples,
    )

    # Run benchmarks
    results = run_benchmarks(
        scales=scales,
        use_synthetic=use_synthetic,
        db_path=args.db_path,
        config=config,
    )

    # Print and save results
    print_results_table(results)
    save_results(results, args.output)


if __name__ == "__main__":
    main()

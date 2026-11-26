# HDBSCAN Clustering Pipeline Benchmark

Benchmarks comparing Python vs Rust implementations of the clustering pipeline for the Be Right Back insights backend.

## Pipeline

Both implementations follow the same pipeline:

```
Load embeddings → PCA (768D→50D) → HDBSCAN → UMAP (50D→3D)
```

- **PCA**: Reduces 768-dimensional embeddings to 50D (HDBSCAN struggles with high dimensions)
- **HDBSCAN**: Density-based clustering that automatically determines cluster count
- **UMAP**: Reduces 50D to 3D for visualization

## Quick Start

### Python Benchmark

```bash
cd python

# Create virtual environment
uv venv
source .venv/bin/activate

# Install dependencies
uv pip install -e .

# Run benchmark with synthetic data
python -m src.benchmark --scales 10000,50000 --synthetic

# Run benchmark with real embeddings from DuckDB
python -m src.benchmark --scales 10000,50000,100000 --real
```

### Rust Benchmark

```bash
cd rust

# Build in release mode (important for performance!)
cargo build --release

# Run benchmark with synthetic data
./target/release/hdbscan-benchmark --scales 10000,50000 --synthetic

# Run benchmark with real embeddings
./target/release/hdbscan-benchmark --scales 10000,50000,100000 --real
```

**Note**: The Rust benchmark requires Python with `umap-learn` installed (UMAP is called via PyO3).

## Configuration

Both benchmarks accept the same parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--scales` | `10000,50000,100000` | Comma-separated sample sizes |
| `--synthetic` | `true` | Use synthetic embeddings |
| `--real` | `false` | Use real embeddings from DuckDB |
| `--db-path` | `~/.be-right-back/data/db/brb.duckdb` | Path to DuckDB database |
| `--pca-dims` | `50` | PCA target dimensions |
| `--min-cluster-size` | `100` | HDBSCAN min_cluster_size |
| `--min-samples` | `10` | HDBSCAN min_samples |
| `--output` | `results/benchmark_*.json` | Output JSON path |

## Output

Both benchmarks produce JSON results with the same schema:

```json
{
  "language": "python",
  "timestamp": "2025-12-09T12:00:00Z",
  "system": {
    "platform": "Darwin-24.5.0-arm64",
    "cpu_count": 12,
    "ram_gb": 32.0,
    "python_version": "3.11.5"
  },
  "results": [
    {
      "n_points": 10000,
      "pca_time_sec": 0.15,
      "hdbscan_time_sec": 1.23,
      "umap_time_sec": 8.45,
      "total_time_sec": 9.83,
      "peak_memory_mb": 150.0,
      "n_clusters": 15,
      "noise_ratio": 0.12,
      "config": {...}
    }
  ]
}
```

## Metrics

| Metric | Description |
|--------|-------------|
| `pca_time_sec` | Time for PCA dimensionality reduction |
| `hdbscan_time_sec` | Time for HDBSCAN clustering |
| `umap_time_sec` | Time for UMAP visualization |
| `total_time_sec` | End-to-end pipeline time |
| `peak_memory_mb` | Memory usage during run |
| `n_clusters` | Number of clusters found (excluding noise) |
| `noise_ratio` | Fraction of points labeled as noise (-1) |

## Implementation Notes

### Python
- Uses `hdbscan` library (Cython-accelerated)
- Uses `sklearn.PCA` with randomized SVD
- Uses `umap-learn` for dimensionality reduction
- Multi-core support via `core_dist_n_jobs=-1`

### Rust
- Uses `hdbscan` crate (pure Rust, K-d tree for NN search)
- Uses `nalgebra` for PCA (full SVD - could be optimized with randomized SVD)
- **Uses Python UMAP via PyO3** (no good Rust UMAP implementation exists)

### UMAP in Rust

Since there's no mature Rust UMAP implementation, the Rust benchmark calls Python's `umap-learn` via PyO3. This means:

1. UMAP performance will be similar in both benchmarks
2. The Rust benchmark requires Python with umap-learn installed
3. The meaningful comparison is **PCA + HDBSCAN** performance

## Expected Results

Based on algorithm characteristics:

- **PCA**: Rust (nalgebra) may be slower due to full SVD vs sklearn's randomized SVD
- **HDBSCAN**: Python's hdbscan is heavily optimized (Cython + parallelization). Rust may be competitive but unlikely faster.
- **UMAP**: Same in both (Python called via FFI in Rust)

The benchmark will reveal actual numbers for your specific hardware and data scale.

## Directory Structure

```
benchmarks/hdbscan-impls/
├── README.md                 # This file
├── python/
│   ├── pyproject.toml        # Python dependencies
│   ├── src/
│   │   ├── __init__.py
│   │   ├── benchmark.py      # Main benchmark runner
│   │   └── data_loader.py    # Data loading utilities
│   └── results/              # JSON benchmark results
└── rust/
    ├── Cargo.toml            # Rust dependencies
    ├── src/
    │   ├── main.rs           # Main benchmark binary
    │   └── data_loader.rs    # Data loading utilities
    └── results/              # JSON benchmark results
```

## Comparing Results

After running both benchmarks, compare the JSON files in `python/results/` and `rust/results/`:

```bash
# Quick comparison
cat python/results/benchmark_*.json | jq '.results[] | {n_points, total_time_sec, n_clusters}'
cat rust/results/benchmark_*.json | jq '.results[] | {n_points, total_time_sec, n_clusters}'
```

## Next Steps

Based on benchmark results, update `scripts/compute_viz_clusters.py` to use the faster implementation for production clustering.

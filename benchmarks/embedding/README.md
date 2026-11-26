# Embedding Benchmark Suite

Benchmark suite for testing different embedding strategies in Be Right Back.

## Setup

```bash
cd benchmarks/embedding

# Create virtual environment
uv venv

# Install dependencies
uv pip install -e .
```

## Usage

### Run Full Benchmark Matrix

```bash
# Default: 10,000 messages, all batch sizes, all write methods
uv run python -m src.benchmark

# With visualizations
uv run python -m src.benchmark --visualize

# Custom configuration
uv run python -m src.benchmark \
    --sample-size 5000 \
    --batch-sizes 64,128,256 \
    --write-methods pandas_insert,parquet_bulk \
    --visualize
```

### Options

- `--sample-size`: Number of messages to use (default: 10000)
- `--batch-sizes`: Comma-separated batch sizes (default: 32,64,128,256)
- `--write-methods`: Comma-separated write methods (default: all)
  - `pandas_insert`: Original pandas DataFrame + INSERT SELECT
  - `parquet_bulk`: PyArrow Parquet + COPY (per-batch)
  - `parquet_buffered`: Parquet with 5000-chunk write buffer
  - `direct_executemany`: DuckDB executemany
- `--visualize`: Generate charts and HTML report

## Output

### Console Output

```
Embedding Benchmark Results
===========================
Sample: 10,000 messages → ~3,333 chunks (stride=3)
Hardware: Apple M2 Max, 48GB RAM

| Batch | Write Method       | Chunks/sec | Time    | Memory  |
|-------|--------------------|------------|---------|---------|
| 128   | pandas_insert      | 245        | 13.6s   | 1.2GB   |
| 256   | parquet_buffered   | 312        | 10.7s   | 1.8GB   |
| ...   | ...                | ...        | ...     | ...     |

🏆 Winner: batch_size=128, write_method=pandas_insert (245 chunks/sec)
```

### Generated Files

- `results/benchmark_YYYYMMDD_HHMMSS.json` - Raw benchmark data
- `results/benchmark_report.html` - Interactive HTML report
- `results/charts/` - PNG visualizations
  - `throughput_comparison.png` - Bar chart of all strategies
  - `batch_size_scaling.png` - Line chart showing batch size effects
  - `strategy_heatmap.png` - Matrix view of all combinations
  - `memory_vs_throughput.png` - Scatter plot of trade-offs
  - `time_breakdown.png` - Embedding vs writing time

## Strategies Tested

### Write Methods

1. **pandas_insert** (baseline)
   - Build pandas DataFrame
   - `INSERT INTO ... SELECT * FROM df`
   - Simple, well-understood

2. **parquet_bulk**
   - Build PyArrow table
   - Write to temp Parquet file
   - `COPY ... FROM parquet_file`
   - Per-batch writes

3. **parquet_buffered**
   - Same as parquet_bulk
   - Buffers 5000 chunks before writing
   - Reduces file I/O overhead

4. **direct_executemany**
   - DuckDB `executemany()`
   - No intermediate formats
   - Direct parameter binding

### Batch Sizes

- **32**: Conservative, low memory
- **64**: Moderate
- **128**: Good balance
- **256**: High throughput, more memory

## Interpreting Results

1. **Chunks/sec**: Primary metric - higher is better
2. **Total Time**: Wall clock time for complete benchmark
3. **Embed Time**: Time spent in MLX embedding
4. **Write Time**: Time spent writing to DuckDB
5. **Memory**: Peak memory delta during benchmark

If embedding time dominates, focus on batch size optimization.
If write time dominates, focus on write method optimization.

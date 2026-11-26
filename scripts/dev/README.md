# Be Right Back - Visualization Scripts

Python scripts for generating visualizations from iMessage conversation analytics.

## Setup

This project uses [uv](https://github.com/astral-sh/uv) for Python dependency management.

### Install uv (if not already installed)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Install dependencies

```bash
cd scripts
uv sync
```

## Usage

### Standalone Script

You can run the visualization script directly:

```bash
uv run python visualize.py \
  --stats-json ~/.be-right-back/data/stats/_15555550142_distribution.json \
  --output-dir ~/.be-right-back/data/stats \
  --contact-id "+15555550142"
```

### Via CLI Command

Use the integrated CLI command (recommended):

```bash
# From the project root
cargo run -p ingest -- visualize +15555550142
```

This will:
1. Compute stats and generate distribution JSON
2. Automatically invoke the Python visualization script
3. Save timeline and histogram plots to `~/.be-right-back/data/stats/`

## Generated Visualizations

### 1. Timeline Plot (`{contact_id}_timeline.png`)

Shows messaging activity over time:
- **Top panel**: Scatter plot where dot size represents messages per day
- **Bottom panel**: 7-day rolling average of message counts (overall, from you, from them)

### 2. Histogram Plot (`{contact_id}_histogram.png`)

Shows message length distribution:
- **Left panel**: Overall distribution with percentile annotations
- **Right panel**: Side-by-side comparison of message lengths (you vs them)

## Interactive Cluster Visualization

The `interactive_cluster_viz.py` script creates interactive 2D/3D visualizations of message clusters using Plotly.

### Features

- **2D and 3D views** of UMAP-projected message embeddings
- **Topic clustering** with colored clusters and semantic labels
- **Interactive hover** showing message previews, contact names, and dates
- **Filtering** by contact, cluster, or date range
- **Export** to standalone HTML files

### Usage

```bash
# Basic usage (opens in browser)
uv run python interactive_cluster_viz.py

# Export to HTML file
uv run python interactive_cluster_viz.py --output clusters.html

# View types
uv run python interactive_cluster_viz.py --view 2d      # 2D only
uv run python interactive_cluster_viz.py --view 3d      # 3D only
uv run python interactive_cluster_viz.py --view combined # Both (default)
uv run python interactive_cluster_viz.py --view contacts # By contact

# Filter to specific contact
uv run python interactive_cluster_viz.py --contact "John"

# Filter by date range
uv run python interactive_cluster_viz.py --start-date 2024-01-01 --end-date 2024-06-30

# Sample large datasets
uv run python interactive_cluster_viz.py --sample 5000
```

### Prerequisites

Make sure you've run both the ingestion and analytics pipelines first:

```bash
# 1. Run ingestion (from desktop app or CLI)
# 2. Run analytics
python mlx/src/analytics.py --db-path ~/.be-right-back/data/db/brb.duckdb
```

## Dependencies

- Python 3.11+
- matplotlib (plotting)
- pandas (data manipulation)
- numpy (numerical operations)
- seaborn (styling)
- plotly (interactive visualizations)
- duckdb (database access)

## Development

To add new visualization types:

1. Add new function to `visualize.py` or create a new script
2. Update `main()` to call your function
3. Update CLI command in `crates/ingest/src/cli/commands.rs` if needed
4. Add dependencies to `pyproject.toml`

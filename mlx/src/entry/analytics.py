#!/usr/bin/env python3
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

from config.analytics import AnalyticsConfig  # noqa: E402
from pipelines.analytics import run_analytics  # noqa: E402
from progress.base import emit_result, log_error  # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        description="Analytics pipeline for Be Right Back Insights page"
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        required=True,
        help="Path to DuckDB database (brb.duckdb)",
    )
    # PCA settings
    parser.add_argument(
        "--pca-dims",
        type=int,
        default=50,
        help="PCA dimensions before clustering and UMAP (default: 50)",
    )
    # UMAP settings
    parser.add_argument(
        "--umap-n-neighbors",
        type=int,
        default=20,
        help="UMAP n_neighbors (default: 20)",
    )
    parser.add_argument(
        "--umap-min-dist",
        type=float,
        default=0.25,
        help="UMAP min_dist (default: 0.25)",
    )
    parser.add_argument(
        "--umap-spread",
        type=float,
        default=1.5,
        help="UMAP spread (default: 1.5)",
    )
    # Random state for reproducibility
    parser.add_argument(
        "--random-state",
        type=int,
        default=42,
        help="Random state seed for reproducibility (default: 42)",
    )
    # Target topics (simple mode)
    parser.add_argument(
        "--target-topics",
        type=int,
        default=AnalyticsConfig.n_topics,
        help=f"Number of topic clusters (default: {AnalyticsConfig.n_topics})",
    )

    args = parser.parse_args()

    if not args.db_path.exists():
        log_error(f"Database not found: {args.db_path}")
        emit_result(False, error=f"Database not found: {args.db_path}")
        sys.exit(1)

    config = AnalyticsConfig(
        n_topics=args.target_topics,
        pca_dims=args.pca_dims,
        umap_n_neighbors=args.umap_n_neighbors,
        umap_min_dist=args.umap_min_dist,
        umap_spread=args.umap_spread,
        random_state=args.random_state,
    )

    try:
        run_analytics(args.db_path, config)
    except Exception as e:
        log_error(f"Analytics failed: {e}")
        emit_result(False, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()

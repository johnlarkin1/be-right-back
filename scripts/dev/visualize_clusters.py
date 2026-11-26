#!/usr/bin/env python3
"""
Quick visualization of UMAP clusters from brb.duckdb.

Usage:
    python scripts/visualize_clusters.py
    python scripts/visualize_clusters.py --db-path /path/to/brb.duckdb
    python scripts/visualize_clusters.py --3d  # 3D visualization
"""

import argparse
from pathlib import Path

import duckdb
import matplotlib.pyplot as plt
import numpy as np


def main():
    parser = argparse.ArgumentParser(description="Visualize UMAP clusters")
    parser.add_argument(
        "--db-path",
        type=Path,
        default=Path.home() / ".be-right-back/data/db/brb.duckdb",
        help="Path to brb.duckdb",
    )
    parser.add_argument("--3d", dest="three_d", action="store_true", help="3D plot")
    parser.add_argument(
        "--sample", type=int, default=None, help="Sample N points (for large datasets)"
    )
    args = parser.parse_args()

    if not args.db_path.exists():
        print(f"Database not found: {args.db_path}")
        return 1

    conn = duckdb.connect(str(args.db_path), read_only=True)

    # Check what we have
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
    ).fetchall()
    print(f"Tables: {[t[0] for t in tables]}")

    # Get cluster data from chunk_projections table
    query = """
        SELECT
            cp.x_2d,
            cp.y_2d,
            cp.x_3d,
            cp.y_3d,
            cp.z_3d,
            cp.cluster_id,
            cp.cluster_label,
            cp.cluster_color,
            cp.contact_id,
            cp.contact_name,
            cp.message_preview
        FROM chunk_projections cp
    """

    if args.sample:
        query += f" USING SAMPLE {args.sample}"

    df = conn.execute(query).fetchdf()
    conn.close()

    if df.empty:
        print("No UMAP coordinates found. Run analytics pipeline first.")
        return 1

    print(f"Loaded {len(df)} points")
    print(f"Clusters: {sorted(df['cluster_id'].unique())}")
    print(f"Contacts: {df['contact_id'].nunique()}")

    # Color by cluster
    clusters = df["cluster_id"].values
    unique_clusters = np.unique(clusters)
    n_clusters = len(unique_clusters[unique_clusters >= 0])  # Exclude noise (-1)
    print(f"Found {n_clusters} clusters (excluding noise)")

    # Create colormap
    cmap = plt.cm.tab20 if n_clusters <= 20 else plt.cm.nipy_spectral
    colors = []
    for c in clusters:
        if c == -1:
            colors.append((0.7, 0.7, 0.7, 0.3))  # Gray for noise
        else:
            colors.append(cmap(c % 20 / 20))

    if args.three_d:
        fig = plt.figure(figsize=(14, 10))
        ax = fig.add_subplot(111, projection="3d")

        ax.scatter(
            df["x_3d"],
            df["y_3d"],
            df["z_3d"],
            c=colors,
            s=10,
            alpha=0.6,
        )

        ax.set_xlabel("UMAP 1")
        ax.set_ylabel("UMAP 2")
        ax.set_zlabel("UMAP 3")
        ax.set_title(f"Message Clusters (3D) - {n_clusters} clusters, {len(df)} points")
    else:
        fig, axes = plt.subplots(1, 2, figsize=(16, 7))

        # Left: Color by cluster
        ax1 = axes[0]
        scatter1 = ax1.scatter(
            df["x_2d"],
            df["y_2d"],
            c=colors,
            s=8,
            alpha=0.6,
        )
        ax1.set_xlabel("UMAP 1")
        ax1.set_ylabel("UMAP 2")
        ax1.set_title(f"By Cluster ({n_clusters} clusters)")

        # Right: Color by contact
        ax2 = axes[1]
        contact_ids = df["contact_id"].astype("category").cat.codes
        scatter2 = ax2.scatter(
            df["x_2d"],
            df["y_2d"],
            c=contact_ids,
            cmap="tab20",
            s=8,
            alpha=0.6,
        )
        ax2.set_xlabel("UMAP 1")
        ax2.set_ylabel("UMAP 2")
        ax2.set_title(f"By Contact ({df['contact_id'].nunique()} contacts)")

        fig.suptitle(f"Message Embeddings - {len(df)} chunks", fontsize=14)

    plt.tight_layout()
    plt.show()

    return 0


if __name__ == "__main__":
    exit(main())

#!/usr/bin/env python3
"""
Compute t-SNE + HDBSCAN clustering for embedding visualization.

This script is called after ingestion completes to pre-compute the 3D visualization
data for the Insights page's Semantic Space component.

## Usage

    python scripts/compute_viz_clusters.py [--db-path PATH]

If --db-path is not provided, defaults to ~/.be-right-back/data/db/brb.duckdb

## What it does

1. Loads all embedding vectors from DuckDB (768-dimensional)
2. Runs t-SNE to reduce to 3D coordinates for visualization
3. Runs HDBSCAN to automatically cluster without specifying k
4. Generates cluster labels (based on sample messages or generic names)
5. Saves results to embedding_viz_cache table in DuckDB

## Dependencies

Requires these packages in the Python environment:
- duckdb
- numpy
- scikit-learn (for t-SNE)
- hdbscan

Install with:
    pip install duckdb numpy scikit-learn hdbscan

## Integration with ingestion

This script should be called from the Rust ingestion code after embeddings are saved:

    // In apps/desktop/src-tauri/src/commands/system.rs, after run_ingestion completes:
    Command::new(&python_path)
        .arg("scripts/compute_viz_clusters.py")
        .arg("--db-path")
        .arg(&db_path)
        .status()?;

Or add a new ingestion stage for "clustering" in the 5-stage progress system.

## TODO: Implementation

Below is the skeleton - implement each section.
"""

import argparse
import sys
from pathlib import Path

# TODO: Uncomment and implement
# import duckdb
# import numpy as np
# from sklearn.manifold import TSNE
# import hdbscan


def get_default_db_path() -> Path:
    """Get the default DuckDB path."""
    return Path.home() / ".be-right-back" / "data" / "db" / "brb.duckdb"


def create_viz_cache_table(conn) -> None:
    """
    Create the embedding_viz_cache table if it doesn't exist.

    TODO: Execute this SQL:

    CREATE TABLE IF NOT EXISTS embedding_viz_cache (
        id INTEGER PRIMARY KEY,
        chunk_id INTEGER NOT NULL,
        x DOUBLE NOT NULL,
        y DOUBLE NOT NULL,
        z DOUBLE NOT NULL,
        cluster_id INTEGER NOT NULL,
        cluster_label VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id)
    );

    -- Index for fast lookups
    CREATE INDEX IF NOT EXISTS idx_viz_cache_cluster ON embedding_viz_cache(cluster_id);
    """
    pass


def load_embeddings(conn) -> tuple:
    """
    Load embeddings from DuckDB.

    TODO: Query embeddings table and return:
    - chunk_ids: list of chunk IDs
    - vectors: numpy array of shape (n_samples, 768)

    SQL:
        SELECT id, vector FROM embeddings
        -- or wherever embeddings are stored

    The vector column may be stored as:
    - BLOB (binary)
    - FLOAT[] (array)
    - JSON string

    Handle accordingly.
    """
    # chunk_ids = []
    # vectors = np.array([])
    # return chunk_ids, vectors
    raise NotImplementedError("TODO: Implement load_embeddings")


def compute_tsne(vectors, n_components: int = 3, perplexity: int = 30) -> "np.ndarray":
    """
    Reduce embedding dimensions using t-SNE.

    TODO: Implement:

    from sklearn.manifold import TSNE

    tsne = TSNE(
        n_components=n_components,
        perplexity=min(perplexity, len(vectors) - 1),  # perplexity must be < n_samples
        random_state=42,
        n_iter=1000,
        metric='cosine',  # or 'euclidean'
    )
    coords_3d = tsne.fit_transform(vectors)
    return coords_3d

    Note: For large datasets (>10k points), consider using:
    - openTSNE (faster, supports GPU)
    - UMAP as alternative (faster, often better)
    """
    raise NotImplementedError("TODO: Implement compute_tsne")


def compute_hdbscan_clusters(coords_3d) -> tuple:
    """
    Cluster the 3D coordinates using HDBSCAN.

    TODO: Implement:

    import hdbscan

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=15,      # Minimum points to form a cluster
        min_samples=5,            # Core point threshold
        cluster_selection_epsilon=0.0,
        metric='euclidean',
    )
    labels = clusterer.fit_predict(coords_3d)

    Returns:
    - labels: array of cluster IDs (-1 = noise/unclustered)
    - n_clusters: number of clusters found (excluding noise)

    Note: HDBSCAN automatically determines the number of clusters.
    Points with label -1 are considered noise and won't be assigned to any cluster.
    """
    raise NotImplementedError("TODO: Implement compute_hdbscan_clusters")


def generate_cluster_labels(conn, cluster_ids: list, chunk_ids: list, labels) -> dict:
    """
    Generate human-readable labels for each cluster.

    TODO: Options:
    1. Generic labels: "Cluster 1", "Cluster 2", etc.
    2. Sample-based: Pick representative messages from each cluster
    3. LLM-generated: Send samples to an LLM for naming

    For now, use generic + color assignment:

    CLUSTER_COLORS = [
        "#00ff41",  # green
        "#00d4ff",  # cyan
        "#ff6b9d",  # pink
        "#ffb000",  # amber
        "#a855f7",  # purple
        "#06b6d4",  # teal
        "#f43f5e",  # rose
        "#84cc16",  # lime
    ]

    return {
        0: {"label": "Cluster 1", "color": "#00ff41"},
        1: {"label": "Cluster 2", "color": "#00d4ff"},
        ...
    }
    """
    raise NotImplementedError("TODO: Implement generate_cluster_labels")


def save_viz_cache(
    conn, chunk_ids: list, coords_3d, labels, cluster_labels: dict
) -> int:
    """
    Save visualization data to DuckDB.

    TODO: Implement:

    1. Clear existing cache:
       DELETE FROM embedding_viz_cache;

    2. Insert new data:
       INSERT INTO embedding_viz_cache (chunk_id, x, y, z, cluster_id, cluster_label)
       VALUES (?, ?, ?, ?, ?, ?);

    3. Return number of rows inserted

    Handle noise points (cluster_id = -1) by either:
    - Assigning to a special "Other" cluster
    - Excluding from visualization
    """
    raise NotImplementedError("TODO: Implement save_viz_cache")


def main():
    parser = argparse.ArgumentParser(
        description="Compute t-SNE + HDBSCAN clustering for embedding visualization"
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=get_default_db_path(),
        help="Path to DuckDB database",
    )
    parser.add_argument(
        "--perplexity",
        type=int,
        default=30,
        help="t-SNE perplexity parameter (default: 30)",
    )
    parser.add_argument(
        "--min-cluster-size",
        type=int,
        default=15,
        help="HDBSCAN min_cluster_size (default: 15)",
    )
    args = parser.parse_args()

    db_path = args.db_path
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}", file=sys.stderr)
        print("Run ingestion first to create the database.", file=sys.stderr)
        sys.exit(1)

    print(f"Loading embeddings from {db_path}...")

    # TODO: Implement the pipeline
    #
    # conn = duckdb.connect(str(db_path))
    #
    # # Ensure table exists
    # create_viz_cache_table(conn)
    #
    # # Load embeddings
    # chunk_ids, vectors = load_embeddings(conn)
    # print(f"Loaded {len(chunk_ids)} embeddings")
    #
    # if len(chunk_ids) < 10:
    #     print("Not enough embeddings for visualization (need at least 10)")
    #     sys.exit(0)
    #
    # # Compute t-SNE
    # print("Computing t-SNE (this may take a few minutes)...")
    # coords_3d = compute_tsne(vectors, perplexity=args.perplexity)
    #
    # # Compute clusters
    # print("Computing HDBSCAN clusters...")
    # labels, n_clusters = compute_hdbscan_clusters(coords_3d)
    # print(f"Found {n_clusters} clusters")
    #
    # # Generate labels
    # cluster_labels = generate_cluster_labels(conn, list(range(n_clusters)), chunk_ids, labels)
    #
    # # Save to database
    # print("Saving visualization cache...")
    # n_saved = save_viz_cache(conn, chunk_ids, coords_3d, labels, cluster_labels)
    # print(f"Saved {n_saved} points to embedding_viz_cache")
    #
    # conn.close()
    # print("Done!")

    print("TODO: Implement compute_viz_clusters.py")
    print(
        "See the docstring and function stubs in this file for implementation details."
    )


if __name__ == "__main__":
    main()

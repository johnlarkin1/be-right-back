"""Data loading utilities for HDBSCAN benchmarks."""

from pathlib import Path

import duckdb
import numpy as np
from sklearn.datasets import make_blobs


def get_default_db_path() -> Path:
    """Get the default DuckDB path for Be Right Back."""
    return Path.home() / ".be-right-back" / "data" / "db" / "brb.duckdb"


def load_real_embeddings(db_path: Path | None = None, limit: int | None = None) -> np.ndarray:
    """
    Load embeddings from the Be Right Back DuckDB database.

    Args:
        db_path: Path to the DuckDB database. Defaults to ~/.be-right-back/data/db/brb.duckdb
        limit: Maximum number of embeddings to load. None for all.

    Returns:
        numpy array of shape (n_samples, 768) with float32 embeddings
    """
    if db_path is None:
        db_path = get_default_db_path()

    if not db_path.exists():
        raise FileNotFoundError(
            f"Database not found at {db_path}. Run ingestion first or use synthetic data."
        )

    conn = duckdb.connect(str(db_path), read_only=True)

    query = "SELECT embedding FROM message_chunks"
    if limit:
        query += f" LIMIT {limit}"

    result = conn.execute(query).fetchall()
    conn.close()

    if not result:
        raise ValueError("No embeddings found in database")

    # Convert list of tuples containing arrays to numpy array
    embeddings = np.array([list(row[0]) for row in result], dtype=np.float32)
    return embeddings


def generate_synthetic_embeddings(
    n_samples: int,
    n_dims: int = 768,
    n_clusters: int = 20,
    cluster_std: float = 0.5,
    random_state: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic clustered embeddings for reproducible benchmarking.

    Creates blob-like clusters in high-dimensional space, then normalizes
    to unit sphere (like real embeddings from embedding models).

    Args:
        n_samples: Number of samples to generate
        n_dims: Number of dimensions (default 768 to match real embeddings)
        n_clusters: Number of clusters to generate
        cluster_std: Standard deviation of clusters
        random_state: Random seed for reproducibility

    Returns:
        Tuple of (embeddings, ground_truth_labels)
        - embeddings: shape (n_samples, n_dims), float32, L2-normalized
        - ground_truth_labels: shape (n_samples,), int labels 0 to n_clusters-1
    """
    X, y = make_blobs(
        n_samples=n_samples,
        n_features=n_dims,
        centers=n_clusters,
        cluster_std=cluster_std,
        random_state=random_state,
    )

    # Normalize to unit sphere (like real embeddings)
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    X = X / norms

    return X.astype(np.float32), y


def count_real_embeddings(db_path: Path | None = None) -> int:
    """Count the number of embeddings in the database."""
    if db_path is None:
        db_path = get_default_db_path()

    if not db_path.exists():
        return 0

    conn = duckdb.connect(str(db_path), read_only=True)
    result = conn.execute("SELECT COUNT(*) FROM message_chunks").fetchone()
    conn.close()

    return result[0] if result else 0

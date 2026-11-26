"""Clustering: contact-offset removal, PCA, Leiden topics, UMAP projections."""

import time

import igraph as ig
import leidenalg as la
import numpy as np
import umap
from pynndescent import NNDescent
from sklearn.decomposition import PCA

from config.analytics import AnalyticsConfig
from progress.analytics import AnalyticsStage, AnalyticsStats, emit_progress
from progress.base import log_info


def run_pca(embeddings: np.ndarray, config: AnalyticsConfig) -> np.ndarray:
    log_info(f"Running PCA: {embeddings.shape[1]}D → {config.pca_dims}D")
    emit_progress(
        AnalyticsStage.PCA,
        0,
        f"PCA reduction ({embeddings.shape[1]}D → {config.pca_dims}D)...",
    )

    start = time.perf_counter()
    pca = PCA(
        n_components=config.pca_dims,
        svd_solver="randomized",
        random_state=config.random_state,
    )
    reduced = pca.fit_transform(embeddings)
    elapsed = time.perf_counter() - start

    log_info(
        f"PCA complete: {elapsed:.2f}s, explained variance: {pca.explained_variance_ratio_.sum():.2%}"
    )
    emit_progress(
        AnalyticsStage.PCA,
        100,
        f"PCA complete ({elapsed:.1f}s)",
        AnalyticsStats(elapsed_secs=elapsed),
    )

    return reduced


def remove_contact_offsets(
    embeddings: np.ndarray, contact_ids: list[str], shrinkage: float
) -> np.ndarray:
    """Subtract each contact's mean embedding, so chunks cluster by topic.

    Every chunk embeds its contact header and sender names. That shared text
    pulls all chunks of one contact together, so clusters formed per person.
    Subtracting the contact's mean removes that pull. Small contacts have
    noisy means, so the offset shrinks by n / (n + shrinkage).
    Returns L2-normalized rows.
    """
    _, idx = np.unique(np.asarray(contact_ids), return_inverse=True)
    counts = np.bincount(idx).astype(np.float64)
    means = np.zeros((counts.size, embeddings.shape[1]), dtype=np.float64)
    np.add.at(means, idx, embeddings)
    means /= counts[:, None]
    weights = (counts / (counts + shrinkage))[:, None]
    # One offset row per contact; index it per chunk only in the subtraction.
    offsets = (weights * (means - means.T @ counts / counts.sum())).astype(embeddings.dtype)
    centered = embeddings - offsets[idx]
    centered /= np.maximum(np.linalg.norm(centered, axis=1, keepdims=True), 1e-10)
    return centered


def build_knn_graph(unit: np.ndarray, n_neighbors: int, seed: int) -> ig.Graph:
    """Undirected kNN graph over unit vectors. Euclidean order equals cosine order."""
    k = min(n_neighbors, len(unit) - 1)
    index = NNDescent(unit, n_neighbors=k + 1, metric="euclidean", random_state=seed)
    neighbors, _ = index.neighbor_graph
    src = np.repeat(np.arange(len(unit)), k)
    dst = neighbors[:, 1:].reshape(-1)
    pairs = np.unique(np.sort(np.stack([src, dst], axis=1), axis=1), axis=0)
    # NNDescent marks unfilled neighbor slots with -1.
    pairs = pairs[(pairs[:, 0] >= 0) & (pairs[:, 0] != pairs[:, 1])]
    return ig.Graph(n=len(unit), edges=pairs.tolist())


def merge_small_clusters(labels: np.ndarray, unit: np.ndarray, min_size: int) -> np.ndarray:
    """Move chunks of clusters below `min_size` to the nearest remaining centroid.

    Returns labels renumbered 0..k-1, largest cluster first.
    """
    ids, sizes = np.unique(labels, return_counts=True)
    keep = ids[sizes >= min_size]
    if keep.size == 0:
        keep = ids[[np.argmax(sizes)]]
    out = labels.copy()
    small = ~np.isin(labels, keep)
    if small.any():
        centroids = np.stack([unit[labels == i].mean(axis=0) for i in keep])
        centroids /= np.maximum(np.linalg.norm(centroids, axis=1, keepdims=True), 1e-10)
        out[small] = keep[np.argmax(unit[small] @ centroids.T, axis=1)]
    ids, sizes = np.unique(out, return_counts=True)
    order = ids[np.argsort(-sizes, kind="stable")]
    remap = np.empty(int(ids.max()) + 1, dtype=np.int64)
    remap[order] = np.arange(order.size)
    return remap[out]


def run_leiden(embeddings_50d: np.ndarray, config: AnalyticsConfig) -> np.ndarray:
    """Leiden communities on a kNN graph, tuned to about `n_topics` topics.

    Leiden assigns every chunk and follows the graph, so topic sizes vary.
    HDBSCAN left ~65% of real chunks uncategorized; k-means forced equal-ish
    cuts through a continuum. The resolution is searched on a log scale until
    the count of topics (after merging tiny ones) is near `n_topics`.
    """
    n_points = len(embeddings_50d)
    norms = np.maximum(np.linalg.norm(embeddings_50d, axis=1, keepdims=True), 1e-10)
    unit = (embeddings_50d / norms).astype(np.float32)
    if n_points < 2 * config.min_topic_size:
        return np.zeros(n_points, dtype=np.int64)
    target = max(2, min(config.n_topics, n_points // config.min_topic_size))
    min_size = max(config.min_topic_size, n_points // config.max_topics_cap)

    log_info(f"Running Leiden: about {target} topics on {n_points:,} points")
    emit_progress(AnalyticsStage.CLUSTERING, 0, f"Clustering into about {target} topics...")
    start = time.perf_counter()

    graph = build_knn_graph(unit, config.knn_neighbors, config.random_state)
    emit_progress(AnalyticsStage.CLUSTERING, 30, "Neighbor graph built")

    def partition(resolution: float) -> np.ndarray:
        found = la.find_partition(
            graph,
            la.RBConfigurationVertexPartition,
            resolution_parameter=resolution,
            seed=config.random_state,
        )
        return merge_small_clusters(np.asarray(found.membership), unit, min_size)

    low, high = np.log(0.05), np.log(20.0)
    best, best_gap = None, None
    for step in range(config.leiden_search_steps):
        mid = (low + high) / 2
        labels = partition(float(np.exp(mid)))
        count = int(labels.max()) + 1
        gap = abs(count - target)
        if best_gap is None or gap < best_gap:
            best, best_gap = labels, gap
        log_info(f"  resolution {np.exp(mid):.3f}: {count} topics")
        emit_progress(
            AnalyticsStage.CLUSTERING,
            30 + 70 * (step + 1) // config.leiden_search_steps,
            f"Tuning topic count ({count} found, target {target})",
        )
        if gap <= max(1, target // 10):
            break
        if count < target:
            low = mid
        else:
            high = mid
    assert best is not None
    k = int(best.max()) + 1
    elapsed = time.perf_counter() - start

    log_info(f"Leiden complete: {elapsed:.2f}s, {k} clusters")
    emit_progress(
        AnalyticsStage.CLUSTERING,
        100,
        f"Found {k} topics",
        AnalyticsStats(n_clusters=k, noise_ratio=0.0, elapsed_secs=elapsed),
    )
    return best


def run_umap_2d(embeddings_50d: np.ndarray, config: AnalyticsConfig) -> np.ndarray:
    log_info("Running UMAP: 50D → 2D")
    emit_progress(AnalyticsStage.UMAP_2D, 0, "UMAP projection (50D → 2D)...")

    start = time.perf_counter()
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=config.umap_n_neighbors,
        min_dist=config.umap_min_dist,
        spread=config.umap_spread,
        metric="euclidean",
        random_state=config.random_state,
    )
    coords_2d = reducer.fit_transform(embeddings_50d)
    elapsed = time.perf_counter() - start

    log_info(f"UMAP 2D complete: {elapsed:.2f}s")
    emit_progress(
        AnalyticsStage.UMAP_2D,
        100,
        f"UMAP 2D complete ({elapsed:.1f}s)",
        AnalyticsStats(elapsed_secs=elapsed),
    )

    return coords_2d


def run_umap_3d(embeddings_50d: np.ndarray, config: AnalyticsConfig) -> np.ndarray:
    log_info("Running UMAP: 50D → 3D")
    emit_progress(AnalyticsStage.UMAP_3D, 0, "UMAP projection (50D → 3D)...")

    start = time.perf_counter()
    reducer = umap.UMAP(
        n_components=3,
        n_neighbors=config.umap_n_neighbors,
        min_dist=config.umap_min_dist,
        spread=config.umap_spread,
        metric="euclidean",
        random_state=config.random_state,
    )
    coords_3d = reducer.fit_transform(embeddings_50d)
    elapsed = time.perf_counter() - start

    log_info(f"UMAP 3D complete: {elapsed:.2f}s")
    emit_progress(
        AnalyticsStage.UMAP_3D,
        100,
        f"UMAP 3D complete ({elapsed:.1f}s)",
        AnalyticsStats(elapsed_secs=elapsed),
    )

    return coords_3d

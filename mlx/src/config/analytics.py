from dataclasses import dataclass


@dataclass
class AnalyticsConfig:
    # Target topic count. Leiden tunes its resolution to land near it.
    n_topics: int = 15

    # Topics below this size merge into their nearest neighbor topic.
    min_topic_size: int = 20
    # Also merge topics below n_points / this, so big corpora stay readable.
    max_topics_cap: int = 600
    knn_neighbors: int = 15
    leiden_search_steps: int = 8

    # Contact offset shrinkage: a contact with n chunks loses n / (n + this)
    # of its mean embedding. See ml.clustering.remove_contact_offsets.
    contact_shrinkage: float = 20.0

    pca_dims: int = 50

    umap_n_neighbors: int = 20
    umap_min_dist: float = 0.25
    umap_spread: float = 1.5

    random_state: int = 42

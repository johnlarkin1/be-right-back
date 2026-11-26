"""Progress reporting for Be Right Back analytics pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any

import ujson as json


class AnalyticsStage(Enum):
    LOADING = "loading"
    PCA = "pca"
    CLUSTERING = "clustering"
    UMAP_2D = "umap_2d"
    UMAP_3D = "umap_3d"
    LABELING = "labeling"
    SAVING_CLUSTERS = "saving_clusters"
    ACTIVITY = "activity"
    WORDS = "words"
    COMPLETE = "complete"


@dataclass
class AnalyticsStats:
    chunks_processed: int = 0
    total_chunks: int = 0
    n_clusters: int = 0
    noise_ratio: float = 0.0
    elapsed_secs: float = 0.0
    estimated_remaining_secs: float | None = None


def emit_progress(
    stage: AnalyticsStage,
    percent: int,
    message: str,
    stats: AnalyticsStats | None = None,
):
    """Emit analytics-specific progress with independent 0-100% scale."""
    payload: dict[str, Any] = {
        "type": "analytics_progress",
        "stage": stage.value,
        "percent": min(100, max(0, percent)),
        "message": message,
    }
    if stats:
        payload["stats"] = asdict(stats)
    print(json.dumps(payload), flush=True)

"""Size the MLX buffer cache from the Mac's GPU working set.

MLX keeps freed buffers in a cache until active plus cache reaches the GPU
working set (about 75% of RAM). During training that left under 2 GB for
macOS on a 48 GB Mac, and a Metal out-of-memory error aborted the run.
A cache limit returns freed buffers to the OS instead.
"""

from typing import Any

GB = 1024**3
# Cache at most this share of the working set, and never more than MAX_CACHE.
CACHE_FRACTION = 0.10
MAX_CACHE_BYTES = 4 * GB
MIN_CACHE_BYTES = 512 * 1024**2


def cache_limit_for(working_set_bytes: int) -> int:
    """Return the cache limit in bytes for a GPU working set."""
    limit = int(working_set_bytes * CACHE_FRACTION)
    return max(MIN_CACHE_BYTES, min(MAX_CACHE_BYTES, limit))


def _mx_fn(name: str) -> Any:
    import mlx.core as mx

    fn = getattr(mx, name, None)
    if fn is None:
        fn = getattr(getattr(mx, "metal", None), name, None)
    return fn


def configure_cache_limit() -> dict[str, Any]:
    """Set the MLX cache limit from this device. Return what was set.

    Returns an empty dict when the device reports no working set (CPU builds).
    """
    device_info = _mx_fn("device_info")
    set_cache_limit = _mx_fn("set_cache_limit")
    if device_info is None or set_cache_limit is None:
        return {}
    working_set = device_info().get("max_recommended_working_set_size")
    if not working_set:
        return {}
    limit = cache_limit_for(int(working_set))
    set_cache_limit(limit)
    return {
        "working_set_gb": round(working_set / GB, 2),
        "cache_limit_gb": round(limit / GB, 2),
    }

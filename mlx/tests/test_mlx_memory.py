"""Tests for the MLX cache limit."""

from utils.mlx_memory import GB, MAX_CACHE_BYTES, MIN_CACHE_BYTES, cache_limit_for


def test_cache_limit_scales_with_working_set() -> None:
    # 16 GB Mac: working set about 10.7 GB, so about 1.07 GB of cache.
    assert cache_limit_for(int(10.7 * GB)) == int(10.7 * GB * 0.10)


def test_cache_limit_caps_on_large_macs() -> None:
    # 48 GB Mac (37.4 GB working set): 3.7 GB. A 128 GB Mac hits the 4 GB cap.
    assert cache_limit_for(int(37.44 * GB)) == int(37.44 * GB * 0.10)
    assert cache_limit_for(96 * GB) == MAX_CACHE_BYTES


def test_cache_limit_has_a_floor() -> None:
    assert cache_limit_for(2 * GB) == MIN_CACHE_BYTES

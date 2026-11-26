"""Tests for utility modules: data, time, constants."""

from datetime import UTC

from constants import (
    APPLE_EPOCH_OFFSET,
    CLUSTER_COLORS,
    NOISE_COLOR,
    get_cluster_color,
    is_label_specific,
)
from utils.data import get_data_stats, load_jsonl
from utils.time import apple_timestamp_to_date, apple_timestamp_to_datetime, format_time

# ---------------------------------------------------------------------------
# format_time
# ---------------------------------------------------------------------------


class TestFormatTime:
    def test_seconds(self):
        assert format_time(30) == "30s"

    def test_seconds_fraction(self):
        assert format_time(0.5) == "0s"

    def test_minutes(self):
        assert format_time(90) == "1.5m"

    def test_hours(self):
        assert format_time(7200) == "2.0h"

    def test_boundary_60(self):
        assert format_time(60) == "1.0m"

    def test_boundary_3600(self):
        assert format_time(3600) == "1.0h"


# ---------------------------------------------------------------------------
# apple_timestamp_to_datetime / apple_timestamp_to_date
# ---------------------------------------------------------------------------


class TestAppleTimestamp:
    def test_none_input(self):
        assert apple_timestamp_to_datetime(None) is None
        assert apple_timestamp_to_date(None) is None

    def test_known_timestamp(self):
        # 2024-01-01 00:00:00 UTC
        # Unix timestamp for 2024-01-01: 1704067200
        # Apple nanoseconds: (1704067200 - 978307200) * 1_000_000_000
        apple_ns = (1704067200 - APPLE_EPOCH_OFFSET) * 1_000_000_000
        dt = apple_timestamp_to_datetime(apple_ns)
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 1
        assert dt.day == 1
        assert dt.tzinfo == UTC

    def test_date_string_format(self):
        apple_ns = (1704067200 - APPLE_EPOCH_OFFSET) * 1_000_000_000
        date_str = apple_timestamp_to_date(apple_ns)
        assert date_str == "2024-01-01"

    def test_epoch_start(self):
        # Apple epoch itself: 0 nanoseconds = 2001-01-01 00:00:00 UTC
        dt = apple_timestamp_to_datetime(0)
        assert dt is not None
        assert dt.year == 2001
        assert dt.month == 1
        assert dt.day == 1


# ---------------------------------------------------------------------------
# get_cluster_color / is_label_specific
# ---------------------------------------------------------------------------


class TestClusterColor:
    def test_valid_cluster_ids(self):
        for i in range(len(CLUSTER_COLORS)):
            assert get_cluster_color(i) == CLUSTER_COLORS[i]

    def test_wraps_around(self):
        n = len(CLUSTER_COLORS)
        assert get_cluster_color(n) == CLUSTER_COLORS[0]
        assert get_cluster_color(n + 1) == CLUSTER_COLORS[1]

    def test_noise_cluster(self):
        assert get_cluster_color(-1) == NOISE_COLOR
        assert get_cluster_color(-99) == NOISE_COLOR


class TestIsLabelSpecific:
    def test_generic_label(self):
        assert is_label_specific("general discussion") is False

    def test_specific_label(self):
        assert is_label_specific("weekend hiking trip") is True

    def test_mixed_label(self):
        # "weekend hiking plans" -- "plans" is generic but 2/3 words are specific
        assert is_label_specific("weekend hiking plans") is True

    def test_all_generic(self):
        assert is_label_specific("general chat updates") is False


# ---------------------------------------------------------------------------
# get_data_stats
# ---------------------------------------------------------------------------


class TestGetDataStats:
    def test_empty_list(self):
        stats = get_data_stats([])
        assert stats["total_examples"] == 0

    def test_basic_stats(self, sample_jsonl_data):
        stats = get_data_stats(sample_jsonl_data)
        assert stats["total_examples"] == 2
        assert stats["total_messages"] == 5  # 2 + 3
        assert stats["user_messages"] == 3  # "Hi", "How are you?", "Fine"
        assert stats["assistant_messages"] == 2  # "Hello!", "Good, you?"
        assert stats["avg_messages_per_example"] == 2.5

    def test_single_example(self):
        data = [{"messages": [{"role": "user", "content": "Hi"}]}]
        stats = get_data_stats(data)
        assert stats["total_examples"] == 1
        assert stats["total_messages"] == 1
        assert stats["user_messages"] == 1
        assert stats["assistant_messages"] == 0


# ---------------------------------------------------------------------------
# load_jsonl
# ---------------------------------------------------------------------------


class TestLoadJsonl:
    def test_valid_jsonl(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text(
            '{"messages": [{"role": "user", "content": "Hi"}]}\n'
            '{"messages": [{"role": "user", "content": "Bye"}]}\n'
        )
        data = load_jsonl(path)
        assert len(data) == 2

    def test_skips_blank_lines(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text(
            '{"messages": [{"role": "user", "content": "Hi"}]}\n'
            "\n"
            '{"messages": [{"role": "user", "content": "Bye"}]}\n'
        )
        data = load_jsonl(path)
        assert len(data) == 2

    def test_skips_invalid_json(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text(
            '{"messages": [{"role": "user", "content": "Hi"}]}\n'
            "not valid json\n"
            '{"messages": [{"role": "user", "content": "Bye"}]}\n'
        )
        data = load_jsonl(path)
        assert len(data) == 2

    def test_skips_missing_messages_key(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text(
            '{"messages": [{"role": "user", "content": "Hi"}]}\n{"other_key": "value"}\n'
        )
        data = load_jsonl(path)
        assert len(data) == 1

    def test_empty_file(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text("")
        data = load_jsonl(path)
        assert len(data) == 0

from datetime import UTC, datetime, timedelta

from constants import APPLE_EPOCH_OFFSET


def format_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.1f}m"
    hours = seconds / 3600
    return f"{hours:.1f}h"


def apple_timestamp_to_datetime(apple_ts: int | None) -> datetime | None:
    if apple_ts is None:
        return None
    unix_ts = (apple_ts / 1_000_000_000) + APPLE_EPOCH_OFFSET
    return datetime.fromtimestamp(unix_ts, tz=UTC)


def apple_timestamp_to_date(apple_ts: int | None) -> str | None:
    dt = apple_timestamp_to_datetime(apple_ts)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%d")


def iso_date_to_apple_seconds(date_str: str | None, *, end_of_day: bool = False) -> int | None:
    """Convert an ISO ``YYYY-MM-DD`` date to seconds since the Apple epoch.

    Both bounds are inclusive. A start date maps to 00:00:00 UTC of that day,
    an end date to 23:59:59 UTC of that day. Returns None for a missing date,
    which the callers read as "no bound".
    """
    if not date_str:
        return None
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=UTC)
    if end_of_day:
        day += timedelta(days=1, seconds=-1)
    return int(day.timestamp()) - APPLE_EPOCH_OFFSET

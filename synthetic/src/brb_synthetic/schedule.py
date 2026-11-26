"""Turning authored ``(day_offset, slot)`` pairs into Apple timestamps.

All timing realism lives here so arcs stay readable. Two properties matter more
than the specific numbers:

*   **Determinism.** Every timestamp derives from a seeded RNG plus a fixed
    timezone, so the same manifest always produces the same database. A
    committed eval fixture is worthless if its timestamps drift per machine.
*   **Local-clock fidelity.** Insights bucket messages by hour-of-day, so an
    "evening" message must land in the evening of a *specific* zone rather than
    UTC. We pin the zone rather than reading the host's, for the reason above.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from brb_synthetic.models import Slot

#: Seconds between the Unix epoch and the Apple/Cocoa epoch (2001-01-01).
#: Mirrors ``COCOA_TO_UNIX_OFFSET`` in ``crates/common``.
COCOA_EPOCH_OFFSET = 978_307_200

#: The corpus is authored as if the user lives here. Pinned for determinism.
DEFAULT_TIMEZONE = "America/New_York"

#: Half-open local-hour windows for each slot.
SLOT_HOURS: dict[Slot, tuple[int, int]] = {
    Slot.EARLY: (6, 8),
    Slot.MORNING: (9, 12),
    Slot.LUNCH: (12, 14),
    Slot.AFTERNOON: (14, 18),
    Slot.EVENING: (18, 21),
    Slot.NIGHT: (21, 23),
    Slot.LATE: (23, 24),
}

#: Gap between consecutive messages in an exchange, in seconds. The long tail
#: models someone putting their phone down mid-conversation.
_TYPICAL_GAP = (25, 210)
_LONG_GAP = (600, 2700)
_LONG_GAP_CHANCE = 0.12


def unix_to_apple_ns(unix_seconds: int) -> int:
    """Convert Unix seconds to the Apple-epoch nanoseconds ``message.date`` uses."""
    return (unix_seconds - COCOA_EPOCH_OFFSET) * 1_000_000_000


def apple_ns_to_unix(apple_ns: int) -> int:
    return apple_ns // 1_000_000_000 + COCOA_EPOCH_OFFSET


class Clock:
    """Assigns concrete, globally unique timestamps to authored exchanges."""

    def __init__(
        self,
        anchor: datetime,
        seed: int = 20260726,
        timezone: str = DEFAULT_TIMEZONE,
    ) -> None:
        """
        Args:
            anchor: The date ``day_offset == 0`` refers to. Only the date part is
                used; the time comes from the slot.
            seed: RNG seed. Same seed plus same manifest equals same database.
            timezone: IANA zone the authored slots are expressed in.
        """
        self._zone = ZoneInfo(timezone)
        self._anchor_date = anchor.date()
        self._rng = random.Random(seed)
        #: Every timestamp handed out, so we never emit a duplicate. Duplicate
        #: dates would make ROWID-vs-date ordering ambiguous, and the chunker
        #: sorts by ``date ASC, ROWID ASC``.
        self._issued: set[int] = set()

    @property
    def timezone(self) -> ZoneInfo:
        return self._zone

    def anchor_unix(self) -> int:
        """Unix seconds for the anchor date at local midnight."""
        midnight = datetime.combine(self._anchor_date, datetime.min.time(), tzinfo=self._zone)
        return int(midnight.timestamp())

    def exchange(self, day_offset: int, slot: Slot, count: int) -> list[int]:
        """Timestamps (Apple ns) for ``count`` messages exchanged in one sitting.

        Returns a strictly increasing list. An exchange that would run past
        midnight is allowed to spill into the small hours -- that is realistic,
        and clamping would pile messages up on the hour boundary.
        """
        if count < 1:
            return []

        start = self._slot_start(day_offset, slot)
        stamps: list[int] = []
        cursor = start
        for index in range(count):
            if index > 0:
                cursor += self._gap()
            stamps.append(self._issue(cursor))
        return stamps

    def single(self, day_offset: int, slot: Slot) -> int:
        return self.exchange(day_offset, slot, 1)[0]

    def _slot_start(self, day_offset: int, slot: Slot) -> int:
        """Unix seconds for a jittered moment inside the slot on that day."""
        start_hour, end_hour = SLOT_HOURS[slot]
        day = self._anchor_date + timedelta(days=day_offset)
        window_seconds = (end_hour - start_hour) * 3600
        # Bias toward the front of the window so exchanges have room to run.
        offset = int(self._rng.triangular(0, window_seconds, window_seconds * 0.3))
        base = datetime.combine(day, datetime.min.time(), tzinfo=self._zone) + timedelta(
            hours=start_hour, seconds=offset
        )
        return int(base.timestamp())

    def _gap(self) -> int:
        if self._rng.random() < _LONG_GAP_CHANCE:
            return self._rng.randint(*_LONG_GAP)
        return self._rng.randint(*_TYPICAL_GAP)

    def _issue(self, unix_seconds: int) -> int:
        """Reserve a unique Unix second and return it as Apple ns."""
        while unix_seconds in self._issued:
            unix_seconds += 1
        self._issued.add(unix_seconds)
        return unix_to_apple_ns(unix_seconds)


def weekday_weight(unix_seconds: int, zone: ZoneInfo) -> float:
    """Relative messaging volume for the day of week, used by the filler layer.

    Real inboxes are lumpy: weekends and Friday evenings carry more social
    traffic than a Tuesday morning. Flat filler reads as machine-generated the
    moment you look at an activity heatmap.
    """
    weekday = datetime.fromtimestamp(unix_seconds, tz=zone).weekday()
    return {0: 0.85, 1: 0.9, 2: 0.9, 3: 0.95, 4: 1.15, 5: 1.25, 6: 1.0}[weekday]

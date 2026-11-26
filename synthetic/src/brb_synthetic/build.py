"""Turning a validated ``World`` into a schema-accurate chat.db and AddressBook.

Schema emission is delegated to ``imessage-data-foundry``'s ``DatabaseBuilder``
and ``AddressBookBuilder``. We drive them directly and never touch that
package's LLM conversation generator -- content is authored under ``world/``.

Two ordering properties matter and are easy to get wrong:

*   **ROWIDs must be chronological.** ``DatabaseBuilder.add_message`` assigns
    ROWIDs in call order, so we sort the entire corpus by timestamp before
    inserting anything. Real ``chat.db`` files have this property, the chunker
    relies on ``ORDER BY date ASC, ROWID ASC``, and the eval plan uses ROWIDs as
    stable gold keys.
*   **Gold is resolved after insertion.** Authors reference facts by symbolic
    label; only once ROWIDs exist can those become the numeric gold sets the
    eval harness consumes.
"""

from __future__ import annotations

import hashlib
import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from imessage_data_foundry.db.addressbook import AddressBookBuilder
from imessage_data_foundry.db.builder import DatabaseBuilder

from brb_synthetic.filler import FillerMessage, generate_filler
from brb_synthetic.models import SELF_KEY, Arc, IdentifierType, Slot, World
from brb_synthetic.schedule import Clock, apple_ns_to_unix, weekday_weight

#: Filenames the app expects inside a snapshot directory. Mirrors
#: ``CHAT_SNAPSHOT_FILENAME`` / ``ADDRESSBOOK_SNAPSHOT_FILENAME`` in
#: ``crates/common/src/constants.rs``.
CHAT_SNAPSHOT_FILENAME = "chat_snapshot.db"
ADDRESSBOOK_SNAPSHOT_FILENAME = "addressbook_snapshot.db"

#: Schema flavour to emit. Pinned rather than auto-detected so a corpus built on
#: one macOS version is byte-identical to one built on another.
DEFAULT_SCHEMA_VERSION = "sequoia"

#: Slots filler can be scheduled into, weighted toward evenings.
_FILLER_SLOTS: list[Slot] = [
    Slot.MORNING,
    Slot.LUNCH,
    Slot.AFTERNOON,
    Slot.AFTERNOON,
    Slot.EVENING,
    Slot.EVENING,
    Slot.EVENING,
    Slot.NIGHT,
    Slot.EARLY,
    Slot.LATE,
]

#: Messages per filler exchange when slicing a contact's stream into sittings.
_FILLER_RUN_SIZE = 4


@dataclass
class PendingMessage:
    """A message with a timestamp but not yet a ROWID."""

    apple_date: int
    chat_key: str
    contact_key: str | None
    from_me: bool
    text: str
    fact: str | None = None
    distractor_for: str | None = None


@dataclass
class BuildReport:
    """What was produced, for the CLI to print and for the manifest sidecar."""

    chat_db: Path
    addressbook_db: Path
    anchor: datetime
    timezone: str
    seed: int
    schema_version: str
    message_count: int
    authored_count: int
    filler_count: int
    contact_count: int
    group_count: int
    earliest_unix: int
    latest_unix: int
    resolved_gold: list[dict[str, object]] = field(default_factory=list)
    fact_rowids: dict[str, int] = field(default_factory=dict)


def build_corpus(
    world: World,
    output_dir: Path,
    *,
    anchor: datetime,
    total_target: int = 8000,
    seed: int = 20260726,
    timezone: str | None = None,
    schema_version: str = DEFAULT_SCHEMA_VERSION,
) -> BuildReport:
    """Build ``chat_snapshot.db`` and ``addressbook_snapshot.db`` in ``output_dir``.

    Args:
        world: Validated manifest.
        output_dir: Destination directory, created if absent.
        anchor: The date ``day_offset == 0`` maps to.
        total_target: Approximate total message count, authored plus filler.
        seed: Master RNG seed.
        timezone: IANA zone the authored slots mean. Defaults to the pinned zone.
        schema_version: ``sonoma`` | ``sequoia`` | ``tahoe``.

    Returns:
        A ``BuildReport`` including gold resolved to real ROWIDs.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    clock = Clock(anchor, seed=seed, timezone=timezone) if timezone else Clock(anchor, seed=seed)

    pending = _schedule_authored(world, clock)
    authored_count = len(pending)

    filler_by_contact = generate_filler(world, total_target=total_target, seed=seed)
    pending.extend(_schedule_filler(world, filler_by_contact, clock, seed=seed))
    filler_count = len(pending) - authored_count

    # The whole point: ROWID order must equal chronological order.
    pending.sort(key=lambda message: (message.apple_date, message.chat_key))

    chat_path = output_dir / CHAT_SNAPSHOT_FILENAME
    addressbook_path = output_dir / ADDRESSBOOK_SNAPSHOT_FILENAME
    for path in (chat_path, addressbook_path):
        path.unlink(missing_ok=True)

    fact_rowids = _write_chat_db(world, pending, chat_path, schema_version)
    _write_addressbook(world, addressbook_path)

    resolved = _resolve_gold(world, fact_rowids, pending)

    return BuildReport(
        chat_db=chat_path,
        addressbook_db=addressbook_path,
        anchor=anchor,
        timezone=str(clock.timezone),
        seed=seed,
        schema_version=schema_version,
        message_count=len(pending),
        authored_count=authored_count,
        filler_count=filler_count,
        contact_count=len(world.cast.contacts),
        group_count=len(world.cast.groups),
        earliest_unix=apple_ns_to_unix(pending[0].apple_date),
        latest_unix=apple_ns_to_unix(pending[-1].apple_date),
        resolved_gold=resolved,
        fact_rowids=fact_rowids,
    )


def _chat_key_for_arc(arc: Arc) -> str:
    return f"group:{arc.group}" if arc.is_group else f"direct:{arc.contact}"


def _stable_message_guid(index: int, message: PendingMessage) -> str:
    """A deterministic stand-in for the foundry's ``uuid4``-based message GUID.

    The foundry mints random GUIDs, which alone is enough to make every build
    produce a different file. Committing a manifest instead of a binary is only
    worth doing if anyone can regenerate the *same* corpus, so the GUID is
    derived from the message itself. Shape matches real iMessage:
    ``p:0/<UPPERCASE-UUID>``.
    """
    digest = hashlib.sha256(
        f"{index}|{message.chat_key}|{message.apple_date}|{message.text}".encode()
    ).digest()
    return f"p:0/{uuid.UUID(bytes=digest[:16], version=4)!s}".upper().replace("P:0/", "p:0/")


def _stable_group_identifier(group_key: str) -> str:
    """Deterministic group chat identifier.

    Keeping the ``chat`` prefix is not cosmetic: ``create_chat`` builds the GUID
    as ``iMessage;+;<identifier>``, and this repo's peer-to-peer CTEs exclude
    group chats via ``guid NOT LIKE '%;chat%'``. Drop the prefix and every group
    conversation leaks into the 1:1 contact list.
    """
    return f"chat{hashlib.sha256(group_key.encode()).hexdigest()[:12]}"


def _schedule_authored(world: World, clock: Clock) -> list[PendingMessage]:
    """Assign timestamps to every hand-authored arc message."""
    pending: list[PendingMessage] = []
    for arc in world.arcs:
        chat_key = _chat_key_for_arc(arc)
        for day in arc.days:
            stamps = clock.exchange(day.day_offset, day.slot, len(day.messages))
            for message, stamp in zip(day.messages, stamps, strict=True):
                from_me = message.sender == SELF_KEY
                pending.append(
                    PendingMessage(
                        apple_date=stamp,
                        chat_key=chat_key,
                        contact_key=None if from_me else message.sender,
                        from_me=from_me,
                        text=message.text,
                        fact=message.fact,
                        distractor_for=message.distractor_for,
                    )
                )
    return pending


def _schedule_filler(
    world: World,
    filler_by_contact: dict[str, list[FillerMessage]],
    clock: Clock,
    *,
    seed: int,
) -> list[PendingMessage]:
    """Spread each contact's filler across their active window.

    Exchanges are placed on weekday-weighted random days so an activity heatmap
    shows the Friday/Saturday lift a real inbox has.
    """
    earliest = world.earliest_day_offset
    pending: list[PendingMessage] = []

    for contact in world.cast.contacts:
        messages = filler_by_contact.get(contact.key, [])
        if not messages:
            continue

        rng = random.Random(f"{seed}:sched:{contact.key}")
        start_day = contact.first_contact_day if contact.first_contact_day is not None else earliest
        runs = [
            messages[index : index + _FILLER_RUN_SIZE]
            for index in range(0, len(messages), _FILLER_RUN_SIZE)
        ]
        # One sampled day per run, so every generated message gets placed. Days
        # may repeat; that is fine and realistic.
        days = _weighted_days(start_day, clock, rng, count=len(runs))

        for run, day_offset in zip(runs, days, strict=True):
            stamps = clock.exchange(day_offset, rng.choice(_FILLER_SLOTS), len(run))
            for message, stamp in zip(run, stamps, strict=True):
                pending.append(
                    PendingMessage(
                        apple_date=stamp,
                        chat_key=f"direct:{contact.key}",
                        contact_key=None if message.from_me else contact.key,
                        from_me=message.from_me,
                        text=message.text,
                    )
                )

    return pending


def _weighted_days(start_day: int, clock: Clock, rng: random.Random, *, count: int) -> list[int]:
    """Sample ``count`` day offsets in ``[start_day, 0]``, weighted by weekday."""
    span = list(range(start_day, 1))
    if not span:
        return [0] * count
    anchor_unix = clock.anchor_unix()
    weights = [weekday_weight(anchor_unix + day * 86400, clock.timezone) for day in span]
    return sorted(rng.choices(span, weights=weights, k=count))


def _write_chat_db(
    world: World,
    pending: list[PendingMessage],
    path: Path,
    schema_version: str,
) -> dict[str, int]:
    """Insert handles, chats and messages. Returns fact label -> ROWID."""
    fact_rowids: dict[str, int] = {}

    with DatabaseBuilder(path, version=schema_version) as builder:
        handle_rowids: dict[str, int] = {}
        for contact in world.cast.contacts:
            handle_rowids[contact.key] = builder.add_handle(
                identifier=contact.identifier,
                country="US" if contact.identifier_type is IdentifierType.PHONE else None,
            )

        chat_rowids: dict[str, int] = {}
        for contact in world.cast.contacts:
            chat_rowids[f"direct:{contact.key}"] = builder.create_chat(
                handles=[handle_rowids[contact.key]],
                chat_type="direct",
                identifier=contact.identifier,
            )
        for group in world.cast.groups:
            chat_rowids[f"group:{group.key}"] = builder.create_chat(
                handles=[handle_rowids[member] for member in group.members],
                chat_type="group",
                display_name=group.display_name,
                identifier=_stable_group_identifier(group.key),
            )

        for index, message in enumerate(pending):
            handle_rowid = (
                None if message.contact_key is None else handle_rowids[message.contact_key]
            )
            rowid = builder.add_message(
                chat_id=chat_rowids[message.chat_key],
                handle_id=handle_rowid,
                text=message.text,
                is_from_me=message.from_me,
                date=message.apple_date,
                guid=_stable_message_guid(index, message),
                # Real conversations show a read receipt shortly after delivery.
                date_read=message.apple_date + 45_000_000_000 if not message.from_me else None,
                date_delivered=message.apple_date if message.from_me else None,
            )
            if message.fact is not None:
                fact_rowids[message.fact] = rowid
            elif message.distractor_for is not None:
                fact_rowids[f"distractor:{message.distractor_for}"] = rowid

        builder.commit()

    return fact_rowids


def _write_addressbook(world: World, path: Path) -> None:
    """Write the AddressBook so contacts resolve to display names, not numbers."""
    with AddressBookBuilder(path) as book:
        for contact in world.cast.contacts:
            first, _, last = contact.name.partition(" ")
            record = book.add_contact(first_name=first, last_name=last or None)
            if contact.identifier_type is IdentifierType.PHONE:
                book.add_phone_number(record, contact.identifier)
            else:
                book.add_email_address(record, contact.identifier)
        book.commit()


def _resolve_gold(
    world: World,
    fact_rowids: dict[str, int],
    pending: list[PendingMessage],
) -> list[dict[str, object]]:
    """Convert symbolic gold into the numeric records the eval harness consumes.

    Emits ``gold_message_ids`` plus a ``gold_content_sha256`` anchor, matching
    ``docs/casper-rag-eval-plan.md`` §3.1, so gold can be re-resolved if the
    corpus is ever renumbered.
    """
    text_by_rowid: dict[int, str] = {}
    for label, rowid in fact_rowids.items():
        for message in pending:
            marker = message.fact or (
                f"distractor:{message.distractor_for}" if message.distractor_for else None
            )
            if marker == label:
                text_by_rowid[rowid] = message.text
                break

    contact_identifier = {c.key: c.identifier for c in world.cast.contacts}
    resolved: list[dict[str, object]] = []

    for query in world.gold:
        gold_ids = [fact_rowids[label] for label in query.gold_facts]
        negative_ids = [
            fact_rowids[f"distractor:{label}"]
            for label in query.hard_negative_facts
            if f"distractor:{label}" in fact_rowids
        ]
        resolved.append(
            {
                "id": query.id,
                "query": query.query,
                "stratum": query.stratum,
                "source": "synthetic",
                "surface": "agent",
                "gold_message_ids": gold_ids,
                "gold_content_sha256": [_sha256(text_by_rowid[rowid]) for rowid in gold_ids],
                "hard_negative_message_ids": negative_ids,
                "metric": query.metric,
                "k": query.k,
                "contact_scope": (
                    contact_identifier[query.contact_scope] if query.contact_scope else None
                ),
                "gold_contacts": (
                    [contact_identifier[key] for key in query.gold_contacts]
                    if query.gold_contacts
                    else None
                ),
                "expected_plan": query.expected_plan,
                "notes": query.notes,
            }
        )
    return resolved


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_sidecars(report: BuildReport, output_dir: Path) -> None:
    """Write the eval gold set and a build manifest next to the databases."""
    (output_dir / "gold.resolved.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in report.resolved_gold),
        encoding="utf-8",
    )
    # The instant an eval run should treat as "now": local midnight ending the
    # anchor day, so every message in the corpus is in the past (an exchange
    # scheduled in the evening of day_offset 0 legitimately spills past 22:00).
    # Emitted rather than derived by the harness -- the corpus owns its own clock,
    # and a consumer guessing at it would drift the moment the anchor moves.
    frozen_now = datetime.combine(
        report.anchor.date() + timedelta(days=1), time.min, tzinfo=ZoneInfo(report.timezone)
    ).astimezone(UTC)

    manifest = {
        "anchor": report.anchor.date().isoformat(),
        "frozen_now": frozen_now.isoformat(),
        "timezone": report.timezone,
        "seed": report.seed,
        "schema_version": report.schema_version,
        "message_count": report.message_count,
        "authored_count": report.authored_count,
        "filler_count": report.filler_count,
        "contact_count": report.contact_count,
        "group_count": report.group_count,
        "earliest_message_utc": datetime.fromtimestamp(report.earliest_unix, tz=UTC).isoformat(),
        "latest_message_utc": datetime.fromtimestamp(report.latest_unix, tz=UTC).isoformat(),
        "gold_query_count": len(report.resolved_gold),
        "fact_rowids": report.fact_rowids,
    }
    (output_dir / "build-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

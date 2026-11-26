"""Typed manifest for the synthetic iMessage world.

The world is authored as JSON under ``world/`` and loaded into these models.
Nothing here talks to SQLite -- ``build.py`` owns that. Keeping the manifest a
pure data structure is what lets the same authored content produce both the
demo database and the eval gold set.

Two vocabulary notes, because they are easy to conflate:

*   ``key`` is our stable, human-authored handle for a cast member (``"maya"``).
    It never reaches the database.
*   ``identifier`` is the iMessage handle (``"+15550111"``). This is what lands
    in ``handle.id`` and is what the rest of the app calls a ``contact_id``.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field, model_validator

#: Author-facing sender key meaning "the user whose phone this is".
SELF_KEY = "me"


class Slot(StrEnum):
    """Coarse time-of-day bucket for an authored exchange.

    Authors pick a slot rather than a clock time; ``schedule.py`` turns a slot
    into a concrete timestamp with jitter. This keeps arcs readable and keeps
    timing realism in one place.
    """

    EARLY = "early"
    MORNING = "morning"
    LUNCH = "lunch"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"
    LATE = "late"


class IdentifierType(StrEnum):
    PHONE = "phone"
    EMAIL = "email"


class Cadence(StrEnum):
    """How often a contact texts, used to size the procedural filler layer."""

    DAILY = "daily"
    FREQUENT = "frequent"
    WEEKLY = "weekly"
    OCCASIONAL = "occasional"
    RARE = "rare"


class Style(BaseModel):
    """Per-contact texting fingerprint.

    Used by the filler generator so procedural chatter still sounds like the
    person, and by the persona-training demo so different contacts produce
    visibly different adapters.
    """

    model_config = {"extra": "forbid"}

    lowercase: bool = False
    emoji: float = Field(default=0.0, ge=0.0, le=1.0, description="P(message carries an emoji)")
    emoji_pool: list[str] = Field(default_factory=list)
    abbreviations: bool = False
    punctuation: bool = True
    avg_words: int = Field(default=9, ge=1, le=80)
    sign_offs: list[str] = Field(default_factory=list)
    verbal_tics: list[str] = Field(default_factory=list)


class FillerBank(BaseModel):
    """Templates and word banks for procedurally generated background chatter.

    Filler exists to give the corpus realistic *volume* without hand-writing
    8,000 messages. Templates are slot-filled from ``banks`` so a couple of dozen
    authored patterns expand into thousands of distinct lines -- important
    because verbatim repetition would collapse under MMR dedup and make the
    corpus useless for testing it.

    Filler carries no ground truth. ``filler.py`` hard-fails if a rendered line
    collides with any gold or query vocabulary.
    """

    model_config = {"extra": "forbid"}

    #: Conversation starters, sent by either party.
    openers: list[str] = Field(default_factory=list)
    #: Follow-ups. Kept separate so exchanges open plausibly.
    replies: list[str] = Field(default_factory=list)
    #: ``{placeholder}`` -> candidate substitutions.
    banks: dict[str, list[str]] = Field(default_factory=dict)


class Contact(BaseModel):
    """One cast member (never the user)."""

    model_config = {"extra": "forbid"}

    key: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    name: str
    identifier: str
    identifier_type: IdentifierType = IdentifierType.PHONE
    relationship: str
    cadence: Cadence = Cadence.WEEKLY
    style: Style = Field(default_factory=Style)
    topics: list[str] = Field(default_factory=list)
    filler: FillerBank = Field(default_factory=FillerBank)
    #: Set when the contact should not exist before this day offset (e.g. someone
    #: met partway through the timeline). Filler respects it; arcs are trusted.
    first_contact_day: int | None = None

    @model_validator(mode="after")
    def _check_identifier(self) -> Contact:
        if self.identifier_type is IdentifierType.PHONE:
            if not self.identifier.startswith("+"):
                raise ValueError(f"{self.key}: phone identifier must be E.164 ('+1555...')")
        elif "@" not in self.identifier:
            raise ValueError(f"{self.key}: email identifier must contain '@'")
        return self


class SelfContact(BaseModel):
    """The user. Gets an AddressBook entry but no handle of its own."""

    model_config = {"extra": "forbid"}

    name: str
    identifier: str
    style: Style = Field(default_factory=Style)
    #: The user's own filler voice. Kept separate from every contact's so that
    #: sent messages never borrow a contact's characteristic lines -- sent
    #: messages are exactly what persona training learns from.
    filler: FillerBank = Field(default_factory=FillerBank)


class Group(BaseModel):
    """A group chat.

    Group messages are deliberately excluded from this repo's default 1:1
    contact queries, so groups exist to prove that exclusion works -- and to
    give the ``include_groups()`` path something to find.
    """

    model_config = {"extra": "forbid"}

    key: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    display_name: str
    members: list[str] = Field(min_length=2, description="Contact keys, excluding the user")


class Cast(BaseModel):
    model_config = {"extra": "forbid"}

    self_contact: SelfContact = Field(alias="self")
    contacts: list[Contact]
    groups: list[Group] = Field(default_factory=list)
    #: Filler material available to every contact, merged with their own. Holds
    #: the universal small talk ("otw", "sounds good") that would be tedious to
    #: repeat per person.
    shared_filler: FillerBank = Field(default_factory=FillerBank)

    @model_validator(mode="after")
    def _check_unique_and_resolvable(self) -> Cast:
        keys = [c.key for c in self.contacts]
        _reject_duplicates(keys, "contact key")
        _reject_duplicates([c.identifier for c in self.contacts], "contact identifier")
        _reject_duplicates([g.key for g in self.groups], "group key")

        if SELF_KEY in keys:
            raise ValueError(f"'{SELF_KEY}' is reserved for the user and cannot be a contact key")

        known = set(keys)
        for group in self.groups:
            unknown = sorted(set(group.members) - known)
            if unknown:
                raise ValueError(f"group '{group.key}' references unknown contacts: {unknown}")
        return self

    def contact_by_key(self, key: str) -> Contact:
        for contact in self.contacts:
            if contact.key == key:
                return contact
        raise KeyError(f"unknown contact key: {key!r}")


class AuthoredMessage(BaseModel):
    """A single hand-written message inside an arc."""

    model_config = {"extra": "forbid"}

    sender: str = Field(alias="from", description=f"A contact key, or '{SELF_KEY}'")
    text: str = Field(min_length=1)
    #: Symbolic label marking this message as the answer to one or more gold
    #: queries. Resolved to a real ROWID at build time. See gold.jsonl.
    fact: str | None = None
    #: Marks this message as a deliberate confusable -- topically adjacent but
    #: the wrong answer. Gold must outrank it.
    distractor_for: str | None = None

    @model_validator(mode="after")
    def _check_exclusive_roles(self) -> AuthoredMessage:
        if self.fact and self.distractor_for:
            raise ValueError(
                f"message {self.text[:40]!r} is both gold ({self.fact}) and a distractor; pick one"
            )
        return self


class ArcDay(BaseModel):
    """One day's worth of exchange within an arc."""

    model_config = {"extra": "forbid"}

    day_offset: int = Field(le=0, description="Days before the anchor date; 0 is anchor day")
    slot: Slot = Slot.EVENING
    messages: list[AuthoredMessage] = Field(min_length=1)


class Arc(BaseModel):
    """A themed thread with one contact or group, spread over days.

    Arcs are the *gold spine* of the corpus: every planted fact lives in an arc,
    never in procedural filler.
    """

    model_config = {"extra": "forbid"}

    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    title: str
    #: Exactly one of contact / group is set.
    contact: str | None = None
    group: str | None = None
    days: list[ArcDay] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_target(self) -> Arc:
        if (self.contact is None) == (self.group is None):
            raise ValueError(f"arc '{self.id}' must set exactly one of 'contact' or 'group'")
        offsets = [day.day_offset for day in self.days]
        if offsets != sorted(offsets):
            raise ValueError(f"arc '{self.id}' days must be in chronological order")
        return self

    @property
    def is_group(self) -> bool:
        return self.group is not None


class GoldQuery(BaseModel):
    """An eval query record, authored against symbolic fact labels.

    Mirrors the schema in ``docs/casper-rag-eval-plan.md`` §3.1, but references
    ``gold_facts`` (symbolic) instead of ``gold_message_ids`` (numeric). The
    builder resolves facts to ROWIDs and emits the numeric form, so authored
    gold survives renumbering of the corpus.
    """

    model_config = {"extra": "forbid"}

    id: str
    query: str
    stratum: str
    gold_facts: list[str] = Field(min_length=1)
    hard_negative_facts: list[str] = Field(default_factory=list)
    metric: str = "mrr@10"
    k: int = 10
    #: Restrict search to one contact, by key. Resolved to an identifier.
    contact_scope: str | None = None
    #: For cross_contact queries: which contacts must appear in results.
    gold_contacts: list[str] | None = None
    expected_plan: dict[str, object] = Field(default_factory=dict)
    notes: str = ""


class World(BaseModel):
    """Everything needed to build a corpus, fully validated."""

    model_config = {"extra": "forbid"}

    cast: Cast
    arcs: list[Arc]
    gold: list[GoldQuery]

    @model_validator(mode="after")
    def _check_cross_references(self) -> World:
        _reject_duplicates([arc.id for arc in self.arcs], "arc id")
        _reject_duplicates([q.id for q in self.gold], "gold query id")

        contact_keys = {c.key for c in self.cast.contacts}
        group_keys = {g.key for g in self.cast.groups}

        for arc in self.arcs:
            if arc.contact is not None and arc.contact not in contact_keys:
                raise ValueError(f"arc '{arc.id}' targets unknown contact {arc.contact!r}")
            if arc.group is not None and arc.group not in group_keys:
                raise ValueError(f"arc '{arc.id}' targets unknown group {arc.group!r}")
            allowed = self._allowed_senders(arc, contact_keys)
            for day in arc.days:
                for message in day.messages:
                    if message.sender not in allowed:
                        raise ValueError(
                            f"arc '{arc.id}' day {day.day_offset}: sender {message.sender!r} "
                            f"is not a participant (allowed: {sorted(allowed)})"
                        )

        _reject_duplicates(list(self.fact_labels()), "fact label")

        known_facts = set(self.fact_labels())
        for query in self.gold:
            missing = sorted(set(query.gold_facts) - known_facts)
            if missing:
                raise ValueError(f"gold query '{query.id}' references unknown facts: {missing}")
            missing_negatives = sorted(set(query.hard_negative_facts) - self._distractor_labels())
            if missing_negatives:
                raise ValueError(
                    f"gold query '{query.id}' references unknown distractors: {missing_negatives}"
                )
            if query.contact_scope is not None and query.contact_scope not in contact_keys:
                raise ValueError(
                    f"gold query '{query.id}' scopes to unknown contact {query.contact_scope!r}"
                )
            for contact_key in query.gold_contacts or []:
                if contact_key not in contact_keys:
                    raise ValueError(
                        f"gold query '{query.id}' expects unknown contact {contact_key!r}"
                    )
        return self

    def _allowed_senders(self, arc: Arc, contact_keys: set[str]) -> set[str]:
        if arc.group is not None:
            group = next(g for g in self.cast.groups if g.key == arc.group)
            return {SELF_KEY, *group.members}
        assert arc.contact is not None
        return {SELF_KEY, arc.contact}

    def fact_labels(self) -> list[str]:
        return [
            message.fact
            for arc in self.arcs
            for day in arc.days
            for message in day.messages
            if message.fact is not None
        ]

    def _distractor_labels(self) -> set[str]:
        return {
            message.distractor_for
            for arc in self.arcs
            for day in arc.days
            for message in day.messages
            if message.distractor_for is not None
        }

    @property
    def earliest_day_offset(self) -> int:
        return min(day.day_offset for arc in self.arcs for day in arc.days)


def _reject_duplicates(values: list[str], label: str) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    if duplicates:
        raise ValueError(f"duplicate {label}(s): {sorted(duplicates)}")

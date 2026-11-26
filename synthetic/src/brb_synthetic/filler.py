"""Procedural background chatter, and the guard that keeps it honest.

The corpus needs thousands of messages to exercise HNSW recall, BM25 scoring,
contact-diversity penalties and the analytics views, but only a few hundred
hand-authored ones carry ground truth. Filler closes that gap.

The load-bearing invariant is **filler must never answer a gold query.** If a
generated line happened to mention the restaurant a gold query asks about, that
query's gold set would be silently incomplete and the eval would score a correct
retrieval as a miss. Rather than hope, we extract the distinctive vocabulary of
every gold answer and query and hard-fail on overlap. An author who trips the
guard gets told which template and which term.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

from brb_synthetic.models import Cadence, Contact, FillerBank, Style, World

#: Weekly message volume per cadence tier, before weekday weighting.
CADENCE_MESSAGES_PER_WEEK: dict[Cadence, int] = {
    Cadence.DAILY: 34,
    Cadence.FREQUENT: 18,
    Cadence.WEEKLY: 8,
    Cadence.OCCASIONAL: 3,
    Cadence.RARE: 1,
}

#: Messages per filler exchange.
_EXCHANGE_SIZE = (2, 7)

#: Ordinary English. A term only threatens a gold query if it is *distinctive* --
#: "Nobu" or "Halyard" or "Vanderbilt", not "morning" or "tonight". Filler is
#: built from exactly this kind of everyday vocabulary, so without a real common
#: word list the guard fires on almost every template and becomes noise.
#:
#: Erring toward a longer list is the right trade here: a false negative on a
#: genuinely common word is harmless (a filler message saying "tonight" cannot
#: become the answer to "what japanese restaurant did we want to try"), whereas
#: a guard that cries wolf gets disabled.
_COMMON_WORDS = frozenset(
    """
    able about above actually after again against ahead all almost alone along already also
    although always among another answer anybody anymore anyone anything anyway anywhere apart
    appreciate approximately area around arrive ask asked asking away back bad barely because
    been before began begin behind being believe below best better between beyond both bring
    brought busy call called calling came cannot care carry case catch caught cause certain chance
    change check checked checking city class clean clear close closed coffee cold come comes coming
    company complete cool corner could couple course cover create current cute daily date day days
    dead deal dear decide decided definitely did didn different dinner does doesn doing done don
    door down draw drive dropped drop during each early easier easy eat eating either else email
    end ended enough entire especially even evening ever every everybody everyone everything exact
    exactly example excited expect expected extra face fact fair fall family far fast feel feeling
    feels felt few figure fill final finally find fine finish finished first five fix fixed follow
    followed following food foot forget forgot form forward found four free fresh friday friend
    friends from front full fully fun funny gave general get gets getting girl give given glad
    goes going gone gonna good got gotta grab great group guess guy guys had half hand happen
    happened happening happy hard has hate have haven having head hear heard hearing help her here
    hey high him himself his hold home honest honestly hope hoping hot hour hours house how
    however hundred hurry idea imagine important inside instead interested interesting into
    isn issue just keep keeping kept kid kids kind knew know knowing known large last late later
    laugh lead learn least leave leaving left less let letting life light like liked likely line
    listen little live lived living local long longer look looked looking lose lost lot lots love
    loved lovely low lunch made make makes making man many march matter maybe mean means meant
    meet meeting meh mention message middle might mind mine minute minutes miss missed moment
    monday money month months more morning most mostly move moved moving much must myself name
    near nearly need needed needs neither never new news next nice night nights nobody none noon
    nope normal not note nothing notice now number obviously off offer office often okay old once
    one only open opened order other others otherwise ought our ours out outside over own pack
    page pain part particular pass past pay people perfect perhaps person phone pick picked picking
    place plan planning play please point possible post prefer pretty probably problem promise pull
    push put quick quickly quiet quite ran rain rather reach read ready real realize really reason
    receive received recent remember remind reply rest return right room round run running said
    same saturday saw say saying says schedule second see seeing seem seemed seems seen send sending
    sense sent serious set seven several share short should show showed side sign simple since
    single sit sitting six size sleep slow small some somebody somehow someone something sometime
    sometimes somewhere soon sorry sort sound sounds space speak special spend spent stand start
    started starting stay step still stop stopped store story straight street strong stuck stuff
    such sudden suddenly sunday super suppose supposed sure sweet table take taken taking talk
    talked talking tell telling ten than thank thanks that their them themselves then there these
    they thing things think thinking third this those though thought three through throw thursday
    till time times tired today together told tomorrow tonight too took top total totally touch
    toward town track train travel tried tries trip true truly try trying tuesday turn turned
    twenty twice two type under understand unfortunately until update upon upset use used using
    usual usually very view visit wait waiting walk walked walking want wanted wants warm was
    watch watching water way ways wear wednesday week weekend weeks welcome well went were what
    whatever when whenever where whether which while white who whole whom whose why wide will
    willing win window wish with within without woke woman women wonder wonderful word words work
    worked working works world worried worry worse worst worth would wrong yeah year years yes
    yesterday yet you young your yours yourself
    apparently basically completely constantly currently entirely eventually frankly generally
    genuinely immediately incredibly literally objectively originally personally possibly
    practically previously rarely recently regularly seriously significantly simply slightly
    specifically strangely surely typically ultimately weirdly
    """.split()
)

_WORD_RE = re.compile(r"[a-z][a-z'’-]*")
_PLACEHOLDER_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


class FillerCollisionError(RuntimeError):
    """A generated filler line reuses gold or query vocabulary."""


class FillerTemplateError(RuntimeError):
    """A template references a word bank that does not exist."""


@dataclass(frozen=True)
class FillerMessage:
    """One generated message, not yet timestamped."""

    contact_key: str
    from_me: bool
    text: str


def protected_terms(world: World) -> frozenset[str]:
    """Distinctive vocabulary that filler is forbidden to use.

    Drawn from both sides of every gold pair: the answer messages (so filler
    cannot become an alternate answer) and the query strings (so filler cannot
    become a lexical match that BM25 ranks above real gold).

    Cast names are deliberately *not* protected. People say each other's names
    constantly in a real inbox, and "Alex" appearing in small talk tells you
    nothing about which message answers a question.
    """
    texts: list[str] = [query.query for query in world.gold]
    gold_labels = {label for query in world.gold for label in query.gold_facts}

    for arc in world.arcs:
        for day in arc.days:
            for message in day.messages:
                if message.fact in gold_labels or message.distractor_for is not None:
                    texts.append(message.text)

    allowed = _cast_vocabulary(world)
    return frozenset(word for text in texts for word in _content_words(text) if word not in allowed)


def _cast_vocabulary(world: World) -> frozenset[str]:
    """Every name token in the cast, in lowercase."""
    names = [world.cast.self_contact.name] + [c.name for c in world.cast.contacts]
    names += [group.display_name for group in world.cast.groups]
    return frozenset(word for name in names for word in _content_words(name))


def _content_words(text: str) -> set[str]:
    """Distinctive lowercase tokens in ``text``.

    Contractions are reduced to their stem ("phone's" -> "phone") so they match
    the common word list instead of looking rare.
    """
    words = set()
    for raw in _WORD_RE.findall(text.lower()):
        word = raw.split("'")[0].split("’")[0]
        if len(word) > 3 and word not in _COMMON_WORDS:
            words.add(word)
    return words


def generate_filler(
    world: World,
    *,
    total_target: int,
    seed: int = 20260726,
) -> dict[str, list[FillerMessage]]:
    """Generate filler exchanges per contact, keyed by contact key.

    Args:
        world: The validated world, used for the cast and the collision guard.
        total_target: Desired total corpus size including authored arcs. Filler
            is scaled to make up the difference.
        seed: RNG seed, for reproducibility.

    Returns:
        Mapping of contact key to that contact's filler messages, in the order
        they should be scheduled. Timestamps are assigned later by ``build.py``.

    Raises:
        FillerCollisionError: A rendered line reused gold vocabulary.
        FillerTemplateError: A template referenced an undefined bank.
    """
    forbidden = protected_terms(world)
    authored_count = sum(len(day.messages) for arc in world.arcs for day in arc.days)
    filler_budget = max(0, total_target - authored_count)

    weights = {
        contact.key: CADENCE_MESSAGES_PER_WEEK[contact.cadence] for contact in world.cast.contacts
    }
    weight_total = sum(weights.values()) or 1

    result: dict[str, list[FillerMessage]] = {}
    # Collisions are collected across the whole run rather than raised on the
    # first hit: an author fixing templates wants the full list, not one
    # rebuild per offending word.
    collisions: list[_Collision] = []

    shared = world.cast.shared_filler
    for contact in world.cast.contacts:
        share = int(filler_budget * weights[contact.key] / weight_total)
        result[contact.key] = _generate_for_contact(
            contact,
            shared_bank=shared,
            self_own=world.cast.self_contact.filler,
            budget=share,
            self_style=world.cast.self_contact.style,
            forbidden=forbidden,
            collisions=collisions,
            # Per-contact seed so adding one contact does not reshuffle everyone
            # else's filler -- keeps manifest edits reviewable in a diff.
            rng=random.Random(f"{seed}:{contact.key}"),
        )

    if collisions:
        raise FillerCollisionError(_format_collisions(collisions))
    return result


@dataclass(frozen=True)
class _Collision:
    contact_key: str
    template: str
    terms: tuple[str, ...]


def _format_collisions(collisions: list[_Collision]) -> str:
    """One line per offending template, deduplicated, with the terms to fix."""
    by_template: dict[tuple[str, str], set[str]] = {}
    for collision in collisions:
        key = (collision.contact_key, collision.template)
        by_template.setdefault(key, set()).update(collision.terms)

    lines = [
        f"{len(by_template)} filler template(s) reuse gold vocabulary. "
        "Filler must never mention anything a gold query asks about, or that "
        "query's gold set would be silently incomplete.",
        "",
    ]
    for (contact_key, template), terms in sorted(by_template.items()):
        lines.append(f"  [{contact_key}] {template!r}")
        lines.append(f"      offending terms: {sorted(terms)}")
    lines.append("")
    lines.append("Reword the template, or the bank entry it pulled from.")
    return "\n".join(lines)


def _merge_banks(shared: FillerBank, own: FillerBank) -> FillerBank:
    banks = {key: list(values) for key, values in shared.banks.items()}
    for key, values in own.banks.items():
        banks.setdefault(key, [])
        banks[key] = list(dict.fromkeys(banks[key] + values))
    return FillerBank(
        openers=list(dict.fromkeys(shared.openers + own.openers)),
        replies=list(dict.fromkeys(shared.replies + own.replies)),
        banks=banks,
    )


def _generate_for_contact(
    contact: Contact,
    *,
    shared_bank: FillerBank,
    self_own: FillerBank,
    budget: int,
    self_style: Style,
    forbidden: frozenset[str],
    collisions: list[_Collision],
    rng: random.Random,
) -> list[FillerMessage]:
    """Generate ``budget`` messages for one contact.

    Both the vocabulary and the styling follow the *sender*, not the thread.
    Getting this backwards would give the user's own sent messages each
    contact's voice -- and sent messages are exactly what persona training
    learns from, so the "Digital You" demo would train on a blend of twelve
    other people.

    Scheduling -- including honouring ``first_contact_day`` -- is ``build.py``'s
    job; this only decides who says what, in what order.
    """
    if budget <= 0:
        return []
    for label, own in (("their", contact.filler), ("the user's", self_own)):
        if not (own.openers or shared_bank.openers) or not (own.replies or shared_bank.replies):
            raise FillerTemplateError(
                f"contact '{contact.key}' has budget {budget} but {label} filler "
                "bank has no openers/replies, and neither does the shared bank"
            )

    # Placeholder banks are pooled -- a contact's own templates may reference a
    # shared bank and vice versa. Only the *lines* are voice-specific.
    contact_banks = _merge_banks(shared_bank, contact.filler).banks
    self_banks = _merge_banks(shared_bank, self_own).banks

    messages: list[FillerMessage] = []

    while len(messages) < budget:
        exchange_size = min(rng.randint(*_EXCHANGE_SIZE), budget - len(messages))
        # Who opens alternates unevenly -- one-sided threads look fake.
        from_me = rng.random() < 0.45
        for index in range(exchange_size):
            own = self_own if from_me else contact.filler
            style = self_style if from_me else contact.style
            banks = self_banks if from_me else contact_banks
            template = (
                _pick_line(rng, own.openers, shared_bank.openers)
                if index == 0
                else _pick_line(rng, own.replies, shared_bank.replies)
            )
            text = _render(template, banks, contact, style, rng, forbidden, collisions)
            messages.append(FillerMessage(contact.key, from_me, text))
            if rng.random() < 0.75:
                from_me = not from_me

    return messages


#: How often a speaker uses one of their own characteristic lines rather than
#: the universal small talk. Without this the shared pool swamps everyone and
#: all twelve contacts read identically -- which would quietly undercut the
#: whole premise that different people produce different personas.
_OWN_VOICE_BIAS = 0.6


def _pick_line(rng: random.Random, own: list[str], shared: list[str]) -> str:
    if own and (not shared or rng.random() < _OWN_VOICE_BIAS):
        return rng.choice(own)
    return rng.choice(shared)


def _render(
    template: str,
    banks: dict[str, list[str]],
    contact: Contact,
    style: Style,
    rng: random.Random,
    forbidden: frozenset[str],
    collisions: list[_Collision],
) -> str:
    """Fill placeholders, apply the sender's style, then check the guard."""

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        options = banks.get(name)
        if not options:
            raise FillerTemplateError(
                f"contact '{contact.key}': template {template!r} references "
                f"unknown or empty bank {{{name}}}"
            )
        return rng.choice(options)

    text = _PLACEHOLDER_RE.sub(substitute, template)
    text = _apply_style(text, style, rng)
    overlap = _content_words(text) & forbidden
    if overlap:
        collisions.append(_Collision(contact.key, template, tuple(sorted(overlap))))
    return text


def _apply_style(text: str, style: Style, rng: random.Random) -> str:
    if style.lowercase:
        text = text.lower()
    if not style.punctuation:
        text = text.rstrip(".!")
    if style.emoji_pool and rng.random() < style.emoji:
        text = f"{text} {rng.choice(style.emoji_pool)}"
    return text

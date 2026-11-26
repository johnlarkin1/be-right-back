# Synthetic iMessage corpus

Builds a schema-accurate `chat.db` + AddressBook from an authored manifest, so
the whole app — ingest, embed, hybrid search, Casper, insights, persona training
— can be demoed and evaluated without touching anyone's real messages.

```bash
make synthetic-install    # build and install; the app now runs on fake data
make synthetic-verify     # prove the app's own SQL accepts it
make synthetic-uninstall  # remove it; real snapshots are never touched
```

## Why this exists twice over

It serves two jobs that would otherwise need two corpora:

1. **Demo.** Screenshots, videos and a clean first-run experience need an inbox
   that looks lived-in: real names, 18 months of history, lumpy weekday activity,
   group chats, a contact who only texts twice a year.
2. **Eval.** `docs/casper-rag-eval-plan.md` needs gold — query → known-correct
   message — expressed as stable ROWIDs, with hard negatives, across seven
   retrieval strata. That has to be *authored*; you cannot mine it from chatter.

Both come out of the same `world/` manifest, so the thing you demo is the thing
you measure.

## How it plugs in without touching production code

Nothing downstream reads `~/Library/Messages/chat.db` directly. Ingestion,
contacts and Casper all consume a **snapshot directory**:

- `get_all_snapshots()` (`crates/messages-db/src/db/snapshot.rs:206`) accepts any
  directory under `~/.be-right-back/data/raw/` named `YYYYMMDD_HHMMSS`.
- `get_or_create_snapshot()` returns the newest one and only touches the live
  database if none exists.

So `install` just writes a correctly-named directory there. No Rust changes, no
feature flags, no fake-data code paths shipping in the binary.

### Two hazards

- **`MAX_SNAPSHOTS = 1`.** Anything that calls `create_snapshot()` deletes the
  synthetic snapshot as "old". Re-run `make synthetic-install` if that happens.
- **Staleness checks read the real database.** `latest_live_message_date()`
  queries the actual `chat.db`, so on a machine with real messages the app will
  consider the synthetic index stale and may offer to re-ingest — which would
  replace the synthetic snapshot with a real one.

`install` never deletes a snapshot it did not create: it drops a `.brb-synthetic`
marker file and only reclaims directories carrying it. Your real snapshots are
safe, including through `uninstall`.

## What the foundry does and does not do

The writer layer is [`imessage-data-foundry`](https://github.com/johnlarkin1/imessage-data-foundry),
driven as a library. Its schema fidelity is the reason to use it: it emits
`item_type`, `is_system_message`, `associated_message_guid`, `attributedBody`,
`person_centric_id`, `cache_roomnames` and `chat.room_name`, and gets the GUID
conventions right — direct chats as `iMessage;-;+1555…`, groups as
`iMessage;+;chat…`, which is exactly what this repo's peer-to-peer CTEs key on.

We do **not** use its LLM conversation generator. That is a rolling-window loop
with a random topic-shift chance; it produces plausible chatter with no ground
truth, and ground truth is the entire point here. Content comes from `world/`.

## Layout

```
world/
  cast.json        12 contacts + the user, 3 group chats, filler vocabulary
  arcs/*.json      hand-authored threads — the gold spine
  gold.jsonl       queries, referencing facts by symbolic label
build/             generated, gitignored
```

Everything under `world/` is committed; the databases are not. The manifest is
the source of truth and builds are byte-reproducible — which holds only because
`make synthetic-build` pins `--anchor`, since the CLI itself defaults to `today`
and weekday-weighted filler renumbers every ROWID when the weekday moves. In a
repo that rebuilds anyway, a binary in git would be redundant and unreviewable.

The built databases *are* published, but elsewhere: `scripts/sync-to-public.sh`
Step 3c pushes them, the gold set and this generator to a standalone dataset
repo, where the artifact is the product and requiring uv plus the foundry to get
at the data would be a wall. Its front page is `README_CORPUS.md`, authored here
so it is reviewed next to the data it describes.

## Authoring

### Arcs and facts

An arc is a themed thread with one contact or group, spread over days. Days use
`day_offset` (0 = the anchor date, negative = further back) and a coarse `slot`
rather than clock times; `schedule.py` handles jitter and circadian placement.

Mark a message as the answer to a query with `fact`, and a deliberate wrong
answer with `distractor_for`:

```json
{ "from": "maya", "text": "you have to get the black cod at Nobu", "fact": "nobu-black-cod" },
{ "from": "maya", "text": "skip the conveyor belt spot near the station", "distractor_for": "nobu-black-cod" }
```

Gold queries reference those labels, never ROWIDs:

```json
{"id": "sem-001", "query": "what japanese restaurant did we want to try",
 "stratum": "semantic", "gold_facts": ["nobu-black-cod"],
 "hard_negative_facts": ["nobu-black-cod"]}
```

`build` resolves labels to real ROWIDs and emits `gold.resolved.jsonl` in the
schema from the eval plan (§3.1), including a `gold_content_sha256` anchor so
gold survives a renumbered corpus. Symbolic labels mean re-authoring the corpus
never silently invalidates the gold set — a missing label is a load-time error,
where a stale ROWID would just score zero and look like a retrieval regression.

### Filler, and the guard on it

180 authored messages carry the ground truth; the remaining ~7,800 are
procedural, generated from per-contact templates and word banks so the corpus has
realistic volume without being repetitive enough to collapse under MMR dedup.

Filler carries no ground truth, and **must never accidentally answer a gold
query** — if a generated line mentioned the restaurant a query asks about, that
query's gold set would be silently incomplete and the eval would score a correct
retrieval as a miss. So `filler.py` extracts the distinctive vocabulary of every
gold answer and query and hard-fails on overlap, reporting all offending
templates at once:

```
2 filler template(s) reuse gold vocabulary.
  [maya] 'hey, how was {place}'
      offending terms: ['nobu']
```

"Distinctive" excludes ordinary English and cast names — "tonight" or "Alex"
appearing in small talk tells you nothing about which message answers a question.

### Voice follows the sender

Both the line pool and the styling are chosen by *who is speaking*, not by whose
thread it is. The user has their own filler bank alongside every contact's, and
each speaker draws from their own lines 60% of the time before falling back to
the shared small talk.

This is not cosmetic. Persona training learns from **sent** messages, so if the
user's own messages borrowed each contact's voice, "Digital You" would train on a
blend of twelve other people — and the per-contact analytics would show twelve
identical writing styles.

### Honest limitations

- Filler exchanges are **locally incoherent**: replies are drawn from a pool, not
  generated in response to the previous line. Skim a filler thread and it reads
  as small talk that does not quite track. The authored arcs carry all the
  coherence, and all the gold.
- No attachments, reactions, edits, or read-receipt variety.
- The 18-month timeline is one continuous, evenly-active stretch. Real inboxes
  have gaps — a dead phone, a breakup, a job change.

## Reproducibility

`build` is deterministic: same manifest, seed and anchor produce a byte-identical
database. Timestamps come from a seeded RNG and a **pinned** timezone
(`America/New_York`) rather than the host's, and message GUIDs and group chat
identifiers are content-derived rather than the foundry's `uuid4`.

Pick the anchor to match the job:

```bash
# demo: history ends today, so the app looks freshly used
python -m brb_synthetic.cli build --anchor today

# eval fixture: frozen, so "last month" means the same thing forever
python -m brb_synthetic.cli build --anchor 2026-07-26
```

The frozen anchor is what makes the temporal and recency strata testable — those
queries assert against a fixed `now`, matching the injected-clock seam in
`search.rs` and `query_planner.rs`.

## Verification

`verify` does not reimplement the app's queries — it extracts them from
`crates/messages-db/src/db/query_strs.rs` and runs the real thing, so it cannot
drift:

```
the app's contact query returns 12 contacts:
  +15550111                   1,555 messages
  ...
group-only messages correctly excluded from 1:1: 28
ROWID order matches date order: True
AddressBook resolves display names for 12/12 contacts
```

ROWID ordering is checked because real `chat.db` files have ROWIDs in
chronological order, the chunker sorts by `date ASC, ROWID ASC`, and the eval
plan uses ROWIDs as stable gold keys. A corpus where those disagree would behave
subtly differently from a real one.

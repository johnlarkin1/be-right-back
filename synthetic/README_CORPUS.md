# be-right-back-corpus

A synthetic iMessage corpus with an authored gold set, for evaluating retrieval
over **multi-party personal message history**.

79,995 messages across 12 contacts and 3 group chats, spanning 505 days, with 19
gold queries whose answers are known by construction rather than by annotation.

> Every message here is fabricated. No real person's data was used to build it,
> and none is needed to use it.

## Why this exists

Every public long-term-memory benchmark — LongMemEval, LoCoMo, BEAM, ConvoMem,
PERMA, KnowMe — evaluates a **single user talking to a single assistant**. Not
one of them covers the structure of an actual inbox: many people, overlapping
topics, the same fact mentioned by two contacts a year apart, group threads
alongside DMs.

So there is no public way to measure the things that make retrieval over a real
message history hard:

- **person-scoped** retrieval ("what did *mom* say about the surgery")
- **cross-contact** multi-hop, where the answer is assembled from several people
- **contact diversity** — whether a search reaches past the two people you text most
- **aggregation** and **superlative** ("the *most* expensive", "the *latest* from")

This corpus is built to measure exactly those. It is small and it is synthetic;
it is not a replacement for LongMemEval, and it does not pretend to be a
leaderboard. It is a regression set for an axis nothing else covers.

## Layout

```
data/
  chat_snapshot.db          schema-accurate chat.db (macOS Sequoia schema)
  addressbook_snapshot.db   matching AddressBook
  gold.resolved.jsonl       19 gold queries, keyed to stable ROWIDs
  build-manifest.json       anchor, frozen clock, counts, fact -> ROWID map
world/                      the authored manifest — source of truth
generator/                  rebuilds data/ from world/
```

## The gold set

| stratum | n | primary metric | what it probes |
|---|---|---|---|
| `fact` | 5 | `mrr@10` | a specific stated fact, sometimes with a stale distractor |
| `semantic` | 5 | `mrr@10` | no lexical bridge — query and answer share no words |
| `temporal_range` | 2 | `mrr@10` | date-window extraction, and surviving a recency prior |
| `superlative` | 2 | `rank_of_argmax@1` | argmax over time; rank 2 is a wrong answer |
| `recency` | 2 | `rank_of_argmax@1` / `mrr@10` | "latest" without an explicit date |
| `cross_contact` | 2 | `contact_recall@k` | breadth across the people who know |
| `aggregation` | 1 | `recall@10` | evidence spread across a conversation |

7 queries are contact-scoped. 3 carry mined hard negatives — a wrong answer that
is *lexically closer* than the right one, so bag-of-words matching ranks it first.

Each record:

```jsonc
{
  "id": "sem-001",
  "query": "what japanese restaurant did we want to try",
  "stratum": "semantic",
  "gold_message_ids": [473],            // stable chat.db ROWIDs
  "gold_content_sha256": ["a1b2…"],     // re-anchor if the corpus is renumbered
  "hard_negative_message_ids": [733],   // gold must outrank this
  "contact_scope": null,
  "metric": "mrr@10",
  "k": 10,
  "notes": "query says 'japanese restaurant', gold says 'black cod at Nobu'."
}
```

**Gold is `message_id`, never a chunk id.** Chunk ids depend on how you chunk;
ROWIDs come from the source database and survive re-chunking, so the same gold
scores any pipeline. Resolve gold to whatever unit your system retrieves, and
score **coverage**: a hit is the gold *message* appearing in any retrieved unit.
If your chunks overlap, one gold message lands in several of them — counting
those separately measures your deduplication, not your retrieval.

## The clock

`build-manifest.json` carries `frozen_now`. **Use it.**

Retrieval over messages is almost never time-invariant — recency priors, "last
month", "the latest" all read a clock. Scored against the wall clock, a corpus
with fixed timestamps drifts a little further from its expected ranking every
day, and the temporal strata quietly stop meaning anything. Pin every
time-dependent stage to `frozen_now` and the numbers reproduce.

## Rebuilding

`data/` is byte-reproducible from `world/`: the anchor date, the RNG seed and the
message ordering are all pinned, so a rebuild yields identical file hashes. Ship
the artifacts *and* the recipe; they cannot disagree.

```bash
cd generator && uv sync
uv run python -m brb_synthetic.cli build --anchor 2026-07-26 --output ../data
```

The `--anchor` matters. Filler placement is weekday-weighted, so building on a
different anchor lands messages on different days, renumbers every ROWID, and
invalidates every gold key. Change it only if you intend to re-resolve gold.

Schema emission is delegated to
[`imessage-data-foundry`](https://github.com/johnlarkin1/imessage-data-foundry),
which gets the parts that matter right: `item_type`, `is_system_message`,
`associated_message_guid`, `attributedBody`, `person_centric_id`,
`cache_roomnames`, and the GUID conventions (`iMessage;-;+1555…` for direct
chats, `iMessage;+;chat…` for groups) that peer-to-peer queries key on.

Content is **not** LLM-generated. The upstream conversation generator is a
rolling-window loop with a random topic-shift chance — plausible chatter with no
ground truth. Ground truth is the whole point here, so every gold-bearing thread
under `world/arcs/` is hand-authored, and only the surrounding filler is
templated.

## Known limitations

Read these before quoting a number from it.

- **19 queries.** Small enough that any aggregate rate has a wide confidence
  interval. Gate on named queries, not on thresholds over the mean.
- **Synthetic.** Authored English text with a deliberate gold spine. Real
  messages are messier, and a system tuned to this corpus has not been shown to
  transfer.
- **One persona.** A single fictional inbox, one writing style per contact. It
  does not sample the space of how people text.
- **Still a small haystack.** ~20k chunks at the default `--target 80000`,
  against ~229k for a real multi-year inbox. Distractor density is the variable
  retrieval scores are most sensitive to: on this corpus, going from 8k to 80k
  messages left hit@10 nearly flat (0.632 → 0.579) while MRR halved (0.421 →
  0.268) and hit@1 fell to zero. Any score measured here is an *upper bound* on
  what the same system does at real scale. Rebuild larger to probe further —
  it costs seconds.
- **Retrieval only.** There are no reference answers, so this measures whether
  the right evidence is found — not whether a model then uses it correctly.
- **No abstention set.** Every query has an answer in the corpus. It cannot tell
  you whether a system correctly says "I don't know."

## Verifying schema fidelity

The corpus claims to be schema-accurate, and you can check that claim rather
than take it. `verify` runs a real consumer's real SQL against the built
database — extracted from the Rust source at runtime, not copied, so it cannot
fall out of date:

```bash
git clone https://github.com/johnlarkin1/be-right-back ../be-right-back
cd generator && uv run python -m brb_synthetic.cli verify \
  --built ../data --repo-root ../../be-right-back
```

Without that checkout it stops with a clear error naming the file it wanted.

## Provenance

Built for [Be Right Back](https://github.com/johnlarkin1/be-right-back), a
local-first macOS app that answers questions about your own iMessage history
entirely on-device. The generator here is a copy of that repo's `synthetic/`.

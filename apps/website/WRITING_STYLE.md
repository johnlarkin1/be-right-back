# Writing Style: How It's Built

This guide covers the prose in `content/how-its-built/`. The chapters are JL's own writing. Edits polish that voice for a wide audience. They do not replace it.

Do not write chapters or sections that JL has not written. Polish existing prose only.

## What stays: the voice

- **First person.** "I", "my laptop", "I'm not convinced I'd do it again."
- **Opinions with reasons.** The data-moat take, the contact-diversity product call, regex-first date parsing.
- **Honest admissions.** What failed, what was a shortcut, what an agent could not one-shot.
- **Real numbers from JL's machine.** ~1M messages, ~250K chunks, `0.124 s vs 6.9 s`.
- **Light humor.** About one aside per section.
- **Direct address.** "Feel free to run this on your Mac."
- **Asides.** Blockquote tangents, `[!NOTE]` callouts, and screenshots like the group-chat one.
- **Verbal tics.** Sentence-opening "So", "Alright so", "Ok so", and "basically", "literally", "kinda", "really" are part of the voice. Keep them.

## What changes: the rules

1. **No profanity or slang.** Replace "shit ton", "thicc boi", "dope", "jank", "gen'd" with plain words. Casual is fine; crude is not. Keep one or two lines across the series where profanity lands as a joke.
2. **One hedge per claim.** A hedge is a softening word like "maybe", "perhaps", "a bit", or "most likely". Keep one, or none when you are sure.
3. **One exclamation mark at most per section.** No "!!". Bold carries emphasis better.
4. **Fix mechanics.** Typos, capital "I", and product names: macOS, SQLite, DuckDB, iCloud, VRAM, MLX.
5. **Same word for the same thing.** `brb.db` and `brb.duckdb` are databases, not tables. Pick "chunk" and keep it.
6. **Spell out shorthand.** Insider phrases in prose ("deep research -> agent hook") become a sentence a stranger can follow. When an arrow fits, such as a chain of tables, write ASCII `->`, never the Unicode arrow.
7. **Lead with what the component does, then why.**
8. **Emoji: rare.** About one per chapter, where it adds tone.
9. **Short sentences by default.** The repo's 20-word cap is a target for blog prose, not a hard limit.

## Leave alone

Code blocks, numbers, links, diagrams, `:term[...]` markup, images, and frontmatter. Reviewer notes in HTML comments stay in place.

## Before and after

**Before:** The queries can get a bit complex for pulling information, and I'll walk you through one for example. This was something that even our lovely Claude Code/Codex agents failed at "one-shotting". Sure context problem and didn't fully go deep research -> agent hook, but validation was required (at basically all points of this problem).

**After:** The queries get complex, so I'll walk through one. Even Claude Code and Codex failed to write this one in a single shot. Part of that was missing context, since I skipped a research pass before handing it to the agent. Either way, I had to validate basically every step.

**Before:** The ingestion pipeline left us with our indexed chunks in DuckDB. For me personally, ~250K chunks. That's dope, but no one cares if we can't use them.

**After:** The ingestion pipeline left us with indexed chunks in DuckDB, about 250K of them for me. Those chunks are worthless until we can find the right ones.

**Before:** This is maybe a bit of a 🌶️ product take perhaps, but most likely there are people that you text very frequently and they dominate the distribution of your iMessaging contact.

**After:** This one is a 🌶️ product call. A few people you text constantly tend to dominate your message history.

**Before:** That will be slower!! It's all a fucking tradeoff.

**After:** That will be slower. Every choice here is a tradeoff.

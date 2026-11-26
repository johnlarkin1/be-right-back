---
slug: data-foundation
---

<div class="callout-ai"><span class="callout-icon">🤖</span><span><span class="callout-label">AI-translated</span> - This is a simplified version of the technical article, translated by AI to be more accessible. Switch to Technical mode for the full version with code samples. While I reviewed this portion, I did not write it. </span></div>

# Data Foundation

This whole project really starts with the data. I'm a believer that [data will be a company's moat][data-is-the-moat] in the future, and given this one doesn't capture any data, not a great moat.

Before we can do anything interesting — train models, build embeddings — we need to understand where iMessages actually live on your computer.

## The iMessage Database

### Where Messages Live

If you've ever used iMessage on a Mac, there's a database sitting on your disk right now at `~/Library/Messages/chat.db`. That's the file this whole project depends on.

A quick note on iCloud: iCloud Messages is a _sync_ system, not just a backup. Apple only guarantees that your most recently accessed messages are stored locally — older ones might live only in the cloud. In practice, I (and most other engineers who've poked at this) find the vast majority of messages are sitting right there on disk. Not perfect, but good enough — and most of the questions I care about skew toward recent conversations anyway.

One gotcha: since macOS Mojave, Apple has locked down `~/Library/Messages` behind :term[TCC] (transparency, consent, and control). That's why you need to grant _Full Disk Access_ to [Be Right Back][brb] during setup — [BRB][brb] literally cannot read your messages without it. That's a [Full Disk Access (FDA)][fda] thing.

### Database Schema

Apple's schema is... complex. Probably for good reason — iMessage handles [roughly 8.4B messages a day in 2024][imessage-volume] across every Apple OS — but the growing pains show.

[BRB][brb] really only cares about four tables:

- **`message`** — every message is a row here. Over 100 columns, but the ones that matter are the text of the message, whether you sent it or received it, when it was sent, and whether it was iMessage/SMS/[RCS][imessage-rcs].
- **`handle`** — contact identifiers. Each phone number or email is a row. Annoyingly, the same person on iMessage vs SMS shows up as two separate rows.
- **`chat`** — conversation metadata. Group chats have a `room_name`; 1:1 chats don't. That's how you tell them apart.
- **`chat_handle_join`** — the little connector table that says "these people are in this conversation."

The relationship chain is: `message` → `chat` → `handle`. That's a lot of hops just to answer "who sent this?" I'm sure Apple has better internal ways of navigating this, but from the outside it's a bit of a maze.

Pulling the right data out gets tricky. I had a query for "give me every 1:1 message with this person" that even the AI coding tools couldn't one-shot. The core challenge: a single person might have multiple handles (their iPhone number, their email), so you need to cluster those together, then filter down to conversations that only involve you and them, then skip out system messages ("X left the chat") and reactions/tapbacks (which are stored as weird phantom messages). It required real validation.

One reason the handle-clustering matters is this situation, which happens all the time:

<img src="/blog/02-data-foundation/icloud-woahs.webp" alt="icloud woahs" class="center-super-shrink" />

### Apple's Timestamp Format

One interesting and very annoying callout: Apple doesn't use [Unix timestamps][unix-ts] like basically every other system on earth. They use [**Cocoa time**][cocoa-ts] — seconds since January 1, 2001, instead of January 1, 1970. So there's a magic offset of 978,307,200 that shows up scattered through the code.

It gets worse. At some point [Apple switched from seconds to nanoseconds][apple-ts-pivot] without changing the column. So the same column can hold two completely different units depending on when the message was sent and which macOS version wrote it.

Our fix is a simple heuristic: if the number looks too big to be seconds, divide by a billion. This technically breaks in the year 2064, and I am at peace with that.

## Message Decoding Challenges

This was a real pain. Even the AI coding tools couldn't get this right on the first try, and honestly I doubt the next generation would either.

### Plain Text vs `NSAttributedString`

I very incorrectly assumed that every message's text lives in the `text` column. It does not. Anything with rich links, formatting, or any modern flourish gets shoved into a different column called `attributedBody` instead — and that column stores the message as a binary blob, not text. If you don't know to look there, you're silently dropping huge chunks of your conversation history. Which is exactly what I was doing at first.

### Decoding Binary Blobs

The `attributedBody` column holds Apple's binary serialization format — basically an Objective-C object stuffed inside a :term[plist]. And ohhhh boy do I not like working with Objective-C.

To make it more fun, Apple has used _three_ different serialization formats over the years: a modern secure one, a legacy less-strict one, and an ancient one called `NSArchiver`. We try all three in order and fall through to the next if one fails.

#### Blob Example

So what does this look like in practice? A real `attributedBody` for the message "Yeah " — five characters — weighs in at around 180 bytes on disk. Most of those bytes are Objective-C class-hierarchy metadata wrapped around the tiny bit of actual text. Think of it like putting a Post-it note inside a filing cabinet with three layers of labeled folders. The overhead is roughly fixed, so longer messages are much more storage-efficient than short ones.

### Objective-C FFI from Rust

Here's the headache: to decode these blobs correctly, we need Apple's own runtime to do it. Which means calling directly into Objective-C from Rust — one programming language reaching across to another (:term[FFI] is the general term for this). We link against Apple's Foundation and AppKit frameworks, and pass an explicit allowlist of classes we trust the unarchiver to deserialize.

Interestingly, every single one of my messages hit the old `streamtyped` format — the ancient one. My guess is it's a legacy quirk from migrating across a lot of Macs over the years.

The code that does all this is entirely `unsafe` Rust, which sounds alarming but just means "we're talking to a foreign runtime and Rust can't verify any of it for us." We're reaching across a language boundary, handing raw pointers back and forth, and hoping Apple's runtime returns what we expect. It works. It's just not pretty.

This is also why Be Right Back is macOS-only. We need Apple's own tools to decode Apple's own format. There's no reasonable way to do this on Windows or Linux.

## Snapshot Strategy

Okay, changing gears to talk about snapshotting.

### Why Not Query Live?

Querying the live `chat.db` while Messages.app is using it is a bad idea. Briefly: locking, data consistency fears, safety, and performance. I don't want to be the thing that corrupts your message history.

### Safe Database Access

Instead, I take a snapshot — I copy the database file to a safe location and work off that copy. Critically, I copy three files together, not just the main one: the database engine uses companion files (the :term[WAL] and shared-memory files) for crash recovery and concurrent access, and if you only grab the main file you'll lose recently committed messages.

I also snag your AddressBook, so we can resolve phone numbers and emails into real names like "Mom" instead of "+15551234567". If your AddressBook is empty or unavailable, no big deal — we fall back to the raw phone numbers.

#### Multiple Snapshots

Currently... I don't manage multiple. Only ever one. I started out saving multiple snapshots for diffing and version control, but the disk usage got silly fast and I figured the average user wouldn't care.

---

With the data foundation in place — we can read iMessages, decode Apple's binary formats, and safely snapshot the database — the next step is turning all that raw data into something useful. That's the [ingestion pipeline][ingestion-pipeline].

[comment]: <> (Bibliography)
[ingestion-pipeline]: /how-its-built/ingestion-pipeline
[data-is-the-moat]: https://frontierai.substack.com/p/data-is-your-only-moat
[brb]: https://www.berightback.xyz/
[fda]: https://support.apple.com/en-lb/guide/mac-help/mchlccb25729/mac
[imessage-volume]: https://usesignhouse.com/blog/imessage-stats/#:~:text=In%202022%2C%20iMessage%20users%20accounted,shared%20on%20iMessage%20each%20day
[imessage-rcs]: https://support.apple.com/en-us/104972
[cocoa-ts]: https://developer.apple.com/documentation/Foundation/NSDate
[unix-ts]: https://www.unixtimestamp.com/
[apple-ts-pivot]: https://apple.stackexchange.com/questions/114168/dates-format-in-messages-chat-db

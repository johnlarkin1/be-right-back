---
title: "Data Foundation - Understanding iMessage"
shortTitle: "Data Foundation"
slug: data-foundation
order: 3
description: "Deep dive into the iMessage database schema, message decoding, and snapshot strategy."
---

## Overview

Alright so this whole project really starts with the data. I'm a believer that [data will be a company's moat][data-is-the-moat]. Be Right Back never collects your data, so by that logic it has no moat. That is totally ok by me.

Before we train models or build vector embeddings, we need to know where iMessage data lives on disk.

## The iMessage Database

### Where Messages Live

If you've ever used iMessage on a Mac, there's a SQLite database sitting on your disk right now at:

```
~/Library/Messages/chat.db
```

You should literally try to `ls` it right now. It's a good sanity check, because this project falls apart if that file doesn't exist. A few factors shape what is in this [SQLite][sqlite] database. You'll most likely need iCloud Messages enabled. iCloud is a sync system, so it keeps a large share of your iMessages locally. It does not guarantee all of them. Apple states:

> When you set up iCloud for Messages, your messages are stored in the cloud, with only the most recently accessed Messages stored locally on your device. You can see them on any device that's set up for iCloud and Messages, including your iPhone, iPad, and Mac.

So basically, with iCloud storage off, messages stay on the Mac. I keep iCloud sync on, and the vast majority of my messages are still in this local database. Other engineers report the same thing. It's not definitive, because Apple's sync strategy for `chat.db` is opaque. That is good enough here. I expect most questions to be about recent events anyway.

One note: since macOS Mojave (10.14), Apple has put `~/Library/Messages` behind :term[TCC] (transparency, consent, and control). Any process that reads from it needs _Full Disk Access_. That's why you grant [Be Right Back][brb] [Full Disk Access (FDA)][fda] during setup.

### Database Schema

Apple's schema is rather... complex? Probably with good reason. I don't know the full story, but I'd guess the range of supported operating systems and the sheer volume ([roughly 8.4B messages a day in 2024][imessage-volume]) caused some growing pains.

We'll take a simpler first pass and focus on the four tables that [BRB][brb] cares about. This output comes straight from my laptop and its macOS version:

```bash
╭─johnlarkin@Larkins-Unit ~/Documents/coding/be-right-back/code/be-right-back ‹feat-blog-work-pt3*›
╰─➤  sw_vers
ProductName:		macOS
ProductVersion:		26.4
BuildVersion:		25E246

╭─johnlarkin@Larkins-Unit ~/Documents/coding/be-right-back/code/be-right-back ‹feat-blog-work-pt3*›
╰─➤  sqlite3 ~/Library/Messages/chat.db ".tables"
_SqliteDatabaseProperties
attachment
chat
chat_handle_join
chat_lookup
chat_message_join
chat_recoverable_message_join
chat_service
deleted_messages
handle
index_state_metrics
kvtable
message
message_attachment_join
message_processing_task
persistent_tasks
recoverable_message_part
scheduled_messages_pending_cloudkit_delete
sync_chat_slice
sync_deleted_attachments
sync_deleted_chats
sync_deleted_messages
unsynced_removed_recoverable_messages
```

Feel free to run this on your Mac:

```bash
  sqlite3 ~/Library/Messages/chat.db ".schema message"
  sqlite3 ~/Library/Messages/chat.db ".schema handle"
  sqlite3 ~/Library/Messages/chat.db ".schema chat"
  sqlite3 ~/Library/Messages/chat.db ".schema chat_handle_join"
```

**`message`** - the core one, every message is a row

It has nearly 100 columns, so here are the important ones:

| col                       | description                                                         |
| ------------------------- | ------------------------------------------------------------------- |
| `ROWID`                   | Primary key                                                         |
| `text`                    | Plain text content (nullable - more on this)                        |
| `attributedBody`          | Binary blob containing an `NSAttributedString` (also nullable)      |
| `is_from_me`              | 1 if you sent it, 0 if you received it                              |
| `date`                    | Timestamp in Apple's Cocoa format (more on this below)               |
| `service`                 | `"iMessage"` or `"SMS"` or `"RCS"` ([RCS is new][imessage-rcs])     |
| `associated_message_guid` | Non-null for reactions/tapbacks, links back to the original message |

**`handle`** - contact identifiers (phone numbers, email addresses)

| col                  | description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `ROWID`              | Primary key                                                        |
| `id`                 | The actual identifier - phone number or email address              |
| `service`            | `"iMessage"` or `"SMS"` - same person on both is two separate rows |
| `country`            | Country code (e.g. `"us"`), nullable                               |
| `uncanonicalized_id` | The original un-normalized identifier, nullable                    |
| `person_centric_id`  | Apple's attempt to merge duplicates of the same contact, nullable  |

**`chat`** - conversation metadata. Group chats have a non-null `room_name`

It has more than 30 columns, so here are the important ones:

| col               | description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `ROWID`           | Primary key                                                          |
| `guid`            | Unique string identifier (e.g. `iMessage;-;+15551234567`)            |
| `chat_identifier` | Human-readable identifier (phone/email for 1:1, group id for groups) |
| `service_name`    | `"iMessage"` or `"SMS"`                                              |
| `room_name`       | `NULL` for 1:1, non-null for group chats (this is how we detect)     |
| `display_name`    | Custom group chat name if the user set one, nullable                 |
| `style`           | Chat style flag (1:1 vs group encoding)                              |
| `is_archived`     | 1 if the user archived the conversation                              |

**`chat_handle_join`** - the junction table mapping participants to conversations

Tiny table, just the join:

| col         | description                               |
| ----------- | ----------------------------------------- |
| `chat_id`   | FK to `chat.ROWID` (cascades on delete)   |
| `handle_id` | FK to `handle.ROWID` (cascades on delete) |

The relationship chain is `message` -> `chat_message_join` -> `chat` -> `chat_handle_join` -> `handle`. I'm sure Apple has its own tooling for this, but that is a lot of joins to answer "who sent this message?"

The column tables above are the abridged tour. Here's the _complete_ schema instead - every column, all 98 of them on `message` alone, dumped straight from `chat.db` on my laptop. Drag the tables around, zoom in, and hover the connectors to trace the foreign keys. This is the real complexity Apple is carrying:

::dbdiagram[https://dbdiagram.io/e/6a0a25e19f1f8ec47b35a748/6a0a25e6697f99c16795eaff]{title="iMessage chat.db — full schema"}

A couple of things worth noticing once you're in there. The `message` table is almost entirely `is_*` and `*_ck_*` columns — booleans for every message state Apple has ever shipped, plus CloudKit sync bookkeeping. Only a handful (`text`, `attributedBody`, `handle_id`, `date`, `is_from_me`) actually matter to [BRB][brb]. And the only _declared_ foreign keys live on the three join tables. One piece of tribal knowledge: `message.handle_id` points at `handle.ROWID`, but Apple never declared it as a constraint.

The queries get complex, so I'll walk through one. Even Claude Code and Codex failed to write this one in a single shot. Part of that was missing context, since I skipped a research pass before handing it to the agent. Either way, I had to validate basically every step.

```rust
/// Query to get all one on one messages for a specific contact
pub const GET_MESSAGES_FOR_CONTACT: &str = r#"
    WITH the_handle AS (
      SELECT ROWID AS handle_rowid,
            COALESCE(person_centric_id, id) AS persona_key
      FROM handle
      WHERE id = ?
    ),
    p2p_chats_for_person AS (
      SELECT ch.ROWID AS chat_id
      FROM chat ch
      JOIN chat_handle_join chj ON chj.chat_id = ch.ROWID
      JOIN handle h             ON h.ROWID     = chj.handle_id
      JOIN the_handle th        ON COALESCE(h.person_centric_id, h.id) = th.persona_key
      WHERE ch.room_name IS NULL
        AND ch.guid NOT LIKE '%;chat%'
      GROUP BY ch.ROWID
      HAVING COUNT(DISTINCT COALESCE(h.person_centric_id, h.id)) = 1
    )
    SELECT DISTINCT
      m.ROWID  AS rowid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.service
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id IN (SELECT chat_id FROM p2p_chats_for_person)
      AND m.item_type = 0
      AND m.is_system_message = 0
      -- keep inline replies; drop pure reactions/tapbacks:
      AND NOT (
        m.associated_message_guid IS NOT NULL
        AND m.text IS NULL
        AND m.attributedBody IS NULL
      )
    ORDER BY m.date ASC, m.ROWID ASC
    "#;
```

To walk through this a bit:

- `the_handle` answers the question "ok, who is this number?"
- `p2p_chats_for_person` finds one-on-one chats with this person across all of their handles. This works around the split between a person's phone number and their email. Like my dear friend who got roasted in our group chat recently:

<img src="/blog/02-data-foundation/icloud-woes.webp" alt="icloud woes" class="center-super-shrink" />

- the main `SELECT` is pretty self-explanatory
- the filters are as follows:
  - `m.item_type = 0` keeps regular messages
  - `m.is_system_message = 0` drops system rows like the "x left the chat" line in the screenshot above
  - `NOT (...)` drops tapback reactions. Apple stores them as full message rows with `associated_message_guid` set.

### Apple's Timestamp Format

One interesting and very annoying detail: Apple doesn't use [Unix timestamps][unix-ts]. It uses [**Cocoa/Foundation time**][cocoa-ts], which counts seconds since Jan 1, 2001 instead of 1970. The offset is **978,307,200**, so you'll see that constant stashed in Python and Rust code.

Even more annoying, at some point [Apple switched from storing seconds to nanoseconds][apple-ts-pivot]. So the same column can hold values in two different units, depending on when the message was sent and on which macOS version.

Our conversion logic uses a simple heuristic:

```rust
const COCOA_TO_UNIX_OFFSET: i64 = 978_307_200;

pub fn cocoa_to_unix(cocoa_ts: i64) -> i64 {
    normalize_cocoa_timestamp(cocoa_ts) + COCOA_TO_UNIX_OFFSET
}

fn normalize_cocoa_timestamp(ts: i64) -> i64 {
    if ts > 2_000_000_000 {
        ts / 1_000_000_000  // nanoseconds -> seconds
    } else {
        ts                   // already seconds
    }
}
```

The threshold is safe for a long time. Cocoa timestamps in seconds won't exceed it until 2064. So yes, candidly, this parsing breaks in 2064. I'm fine with that. Given how fast engineering is changing, I'd bet my life no one is running this in 2064.

## Message Decoding Challenges

This was a real pain. Opus 4.6 certainly didn't get it in one shot, and I doubt 4.7 would have either. Here's why.

### Plain Text vs `NSAttributedString`

I wrongly assumed that every message keeps its text in the `text` column. That fails for lots of newer messages: basically anything with rich links or formatting. I think `attributedBody` is just the default now. `attributedBody` is a SQLite column that holds a serialized [`NSAttributedString`][nsattributedstring].

So the rule is: if `text` is null, decode the binary blob in `attributedBody` to get the message content. I didn't do this at first, and I dropped a vast amount of conversation context.

### Decoding Binary Blobs

Here is what the `attributedBody` column looks like on disk.

The column holds an :term[NSAttributedString] encoded with [NSKeyedArchiver][nskeyedarchive], Apple's binary serialization format. It's basically a :term[plist] wrapping some Objective-C objects, and oh boy, do I not like working with Objective-C.

Working with the data, I found _three_ serialization formats that Apple has used over the years:

1. **Modern `NSKeyedArchive`** - starts with magic bytes `bplist00`, uses the secure coding API
2. **Legacy `NSKeyedArchive`** - same format, less restrictive unarchiving API
3. **`NSArchiver`** - ancient format, starts with `streamtyped` around byte 2

We try all three in order, falling back through each if the previous one fails.

#### Blob Example

Here's what these blobs actually look like. This is a real `attributedBody` for the message "Yeah ":

```bash
╭─johnlarkin@Larkins-Unit ~ ‹main›
╰─➤  xxd /tmp/attributed_body_sample.bin | head -8
00000000: 040b 7374 7265 616d 7479 7065 6481 e803  ..streamtyped...
00000010: 8401 4084 8484 124e 5341 7474 7269 6275  ..@....NSAttribu
00000020: 7465 6453 7472 696e 6700 8484 084e 534f  tedString....NSO
00000030: 626a 6563 7400 8592 8484 8408 4e53 5374  bject.......NSSt
00000040: 7269 6e67 0194 8401 2b05 5965 6168 2086  ring....+.Yeah .
00000050: 8402 6949 0105 9284 8484 0c4e 5344 6963  ..iI.......NSDic
00000060: 7469 6f6e 6172 7900 8484 084e 534f 626a  tionary....NSObj
00000070: 6563 7400 8596 9284 8484 084e 5353 7472  ect........NSStr
```

So a 5-character message takes ~180 bytes on disk. You can see the structure: the `streamtyped` magic at byte 2, the Objective-C class hierarchy in the middle (`NSAttributedString`, `NSObject`, `NSString`), and then the actual `Yeah` text. The overhead is mostly fixed, so longer messages pay proportionally less.

::playground[attributed-body]{label="Decode an attributedBody blob" preview="Type a message and watch it become the streamtyped bytes Apple writes to disk — then watch the decoder pull your text back out."}

::excalidraw[/diagrams/02-attributed-body-byte-layout.excalidraw]{title="attributedBody — Three Serialization Formats"}

### Objective-C FFI from Rust

This was part of the headache. We need Apple's own runtime to decode these blobs, so we call Objective-C directly from Rust through :term[FFI] with the [`objc`][objc-crate] crate. It links against the `Foundation` and `AppKit` frameworks. For safety, the unarchiver needs an explicit allowlist of classes it may deserialize. We allow the basics (`NSString`, `NSDictionary`, and so on), plus a few optional AppKit classes for newer rich-text message features.

Here is the staged approach that tries all three. Interestingly, all of my messages hit the `streamtyped` format. I'm not sure why. My guess is that it's a legacy of migrating across many Macs over the years.

```rust
/// Internal unsafe implementation of attributedBody decoding
///
/// Tries multiple archiver formats:
/// 1. NSKeyedUnarchiver modern secure API (for "bplist00" format)
/// 2. NSKeyedUnarchiver legacy API (fallback)
/// 3. NSUnarchiver (for old NSArchiver "streamtyped" format)
unsafe fn try_decode_attributed_body(bytes: &[u8]) -> Option<String> {
    // Create NSData from bytes
    let data = NSData::from_vec(bytes.to_vec());

    // Try NSKeyedUnarchiver first (for modern archives starting with "bplist00")
    let keyed_unarchiver_class: *const Class = class!(NSKeyedUnarchiver);
    let attr_string_class: *const Class = class!(NSAttributedString);

    // Try modern secure API first (requires allowed classes set)
    if let Some(text) = unsafe { try_modern_unarchive(keyed_unarchiver_class, attr_string_class, &data) } {
        debug!("NSKeyedUnarchiver modern API succeeded");
        return Some(text);
    }

    // Try legacy NSKeyedUnarchiver API
    if let Some(text) = unsafe { try_legacy_keyed_unarchive(keyed_unarchiver_class, &data) } {
        debug!("NSKeyedUnarchiver legacy API succeeded");
        return Some(text);
    }

    // Try NSUnarchiver for old NSArchiver format (starts with "streamtyped")
    let unarchiver_class: *const Class = class!(NSUnarchiver);
    if let Some(text) = unsafe { try_nsunarchiver(unarchiver_class, &data) } {
        debug!("NSUnarchiver succeeded");
        return Some(text);
    }

    None
}
```

Once any unarchiver succeeds, we extract the plain text through another chain of null-checked Objective-C calls. All three paths use this function.

```rust
unsafe fn extract_string_from_nsattributed(attr_obj: *mut Object) -> Option<String> {
    if attr_obj.is_null() { return None; }

    // [attributedString string] -> NSString
    let nsstring: *mut Object = msg_send![attr_obj, string];
    if nsstring.is_null() { return None; }

    // [nsstring UTF8String] -> *const c_char
    let c_str_ptr: *const c_char = msg_send![nsstring, UTF8String];
    if c_str_ptr.is_null() { return None; }

    // C string -> Rust String
    match unsafe { CStr::from_ptr(c_str_ptr) }.to_str() {
        Ok(s) => Some(s.to_owned()),
        Err(e) => {
            debug!(error = ?e, "Failed to convert C string to Rust String");
            None
        }
    }
}
```

If you write Rust, you'll notice that this is all `unsafe`. We're calling into the Objective-C runtime through raw :term[FFI]. The compiler knows nothing about the `attr_obj` pointer, and it can't know the return types either, so we have to declare them ourselves.

## Snapshot Strategy

Ok, changing gears to the snapshot strategy.

### Why Not Query Live?

This is probably intuitive to some, but I did not want to open `chat.db` and query it live. My reasons boiled down to:

1. **locking**
2. **fears of data consistency**
3. **safety**
4. **performance**

I won't go into more detail than that.

### Safe Database Access

Instead, I snapshot. The process copies three files atomically:

```
~/Library/Messages/chat.db      -> ~/.be-right-back/data/raw/{timestamp}/chat_snapshot.db
~/Library/Messages/chat.db-wal  -> ~/.be-right-back/data/raw/{timestamp}/chat_snapshot.db-wal
~/Library/Messages/chat.db-shm  -> ~/.be-right-back/data/raw/{timestamp}/chat_snapshot.db-shm
```

Those `-wal` and `-shm` files are critical. SQLite uses a :term[WAL] for crash recovery and concurrent access. Copying only the `.db` file would lose recently committed transactions.

I also snag the `AddressBook`, so we can resolve phone numbers and email addresses to display names. We join on this data in a few places. It's optional: if your address book is missing or empty, we fall back to phone numbers.

#### Multiple Snapshots

Currently... I don't manage multiple. We only ever keep one. I started with several, for diffing and versioning, but they ate too much disk space. I also doubt a typical user would care.

---

With the data foundation in place, we can read iMessages, decode Apple's binary formats, and safely snapshot the database. The next step is turning that raw data into something useful. That's the [ingestion pipeline][ingestion-pipeline].

[comment]: <> (Bibliography)
[tcc]: https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_personal-information_photos-library
[nsattributedstring]: https://developer.apple.com/documentation/foundation/nsattributedstring
[nskeyedarchive]: https://developer.apple.com/documentation/foundation/nskeyedarchiver
[objc-crate]: https://crates.io/crates/objc
[ingestion-pipeline]: /how-its-built/ingestion-pipeline
[data-is-the-moat]: https://frontierai.substack.com/p/data-is-your-only-moat
[apple-imessage-storage]: https://support.apple.com/guide/icloud/what-you-can-do-with-icloud-and-messages-mma17ed475f7/icloud
[brb]: https://www.berightback.xyz/
[fda]: https://support.apple.com/en-lb/guide/mac-help/mchlccb25729/mac
[imessage-volume]: https://usesignhouse.com/blog/imessage-stats/#:~:text=In%202022%2C%20iMessage%20users%20accounted,shared%20on%20iMessage%20each%20day
[imessage-rcs]: https://support.apple.com/en-us/104972
[cocoa-ts]: https://developer.apple.com/documentation/Foundation/NSDate
[unix-ts]: https://www.unixtimestamp.com/
[apple-ts-pivot]: https://apple.stackexchange.com/questions/114168/dates-format-in-messages-chat-db
[sqlite]: https://sqlite.org/

# Research Report: iMessage Database Reverse Engineering

> Reference material for writing about safely accessing 25 years of Apple messages
> Generated: 2026-04-03

---

## What You Built

Read-only access to the macOS iMessage database using Objective-C FFI from Rust, with three fallback decode paths for NSAttributedString, Cocoa epoch timestamp conversion, AddressBook integration, and snapshot-based isolation.

---

## The iMessage Database

### Location
- `~/Library/Messages/chat.db` — SQLite database
- Requires Full Disk Access permission (macOS security)
- WAL mode — includes `chat.db-wal` and `chat.db-shm` files

### Key Tables
- `message` — individual messages (text, date, handle_id, associated_message_guid for reactions)
- `handle` — phone numbers, email addresses, iCloud IDs
- `chat` — conversations (1:1 and groups)
- `chat_message_join` — many-to-many join between chats and messages
- `chat_handle_join` — many-to-many join between chats and handles

### AddressBook
- `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v*.abcddb`
- Also SQLite, contains contact display names
- File found by scanning for highest version number `AddressBook-v*.abcddb`
- Best-effort: gracefully degrades if unavailable

---

## The Attributed Body Problem

### What It Is
Modern iMessage stores the message body in the `attributedBody` BLOB column as a serialized `NSAttributedString`, not in the plain `text` column. The `text` column is often NULL for messages sent from modern macOS/iOS.

### Why It's Hard
- Binary format: Apple's `NSKeyedArchive` or legacy `NSArchiver` serialization
- Not documented — reverse-engineered from behavior
- Contains rich text attributes (fonts, links, mention metadata)
- You only want the plain text content

### Three Decode Paths

Your code (`crates/messages-db/src/utils/attributed_body.rs`, 339 lines) tries three strategies:

**Path 1: Modern Secure Unarchiver (macOS 12+)**
- Uses `NSKeyedUnarchiver` with `requiresSecureCoding = YES`
- Explicit allowlist of 19 Foundation/AppKit classes:
  - `NSAttributedString`, `NSMutableAttributedString`
  - `NSDictionary`, `NSMutableDictionary`
  - `NSArray`, `NSMutableArray`
  - `NSString`, `NSMutableString`
  - `NSNumber`, `NSData`, `NSDate`, `NSSet`
  - `NSURL`, `NSColor`
  - `NSFont`, `NSParagraphStyle`, `NSMutableParagraphStyle`
  - `NSTextAttachment`, `NSValue`
- Most restrictive, preferred for security

**Path 2: Legacy Keyed Unarchiver**
- Falls back to `NSKeyedUnarchiver` without secure coding requirement
- Works with older archive formats
- Less restrictive allowlist

**Path 3: Old NSUnarchiver**
- For very old "streamtyped" blobs (pre-NSKeyedArchive)
- Detects via magic bytes: `bytes[4..15] == b"streamtyped"`
- Uses deprecated `NSUnarchiver` API
- Needed for messages from early macOS versions

### Format Detection
```rust
if bytes[0..8] == b"bplist00" → NSKeyedArchive (Path 1 or 2)
if bytes[4..15] == b"streamtyped" → NSArchiver (Path 3)
else → unknown format
```

### Safety
All ObjC code is `unsafe` blocks using the `objc` crate:
- Every ObjC pointer is null-checked before use
- Objects are autoreleased by ObjC runtime
- Rust copies UTF-8 string data via `to_owned()` before returning
- Audited 2026-03-15 (noted in source header comment)

---

## Cocoa Timestamps

### The Problem
Apple stores `message.date` in the iMessage database using the Cocoa epoch (2001-01-01 00:00:00 UTC), not Unix epoch (1970-01-01).

Additionally, the precision varies:
- **Older macOS**: seconds since Cocoa epoch
- **Newer macOS**: nanoseconds since Cocoa epoch

### The Heuristic
```rust
if timestamp > 2_000_000_000 {
    // Nanoseconds — divide by 1_000_000_000 first
} else {
    // Seconds
}
```

Then add `COCOA_TO_UNIX_OFFSET` (978,307,200 seconds = difference between Unix and Cocoa epochs) to convert to Unix timestamp.

### Why 2 Billion?
- 2 billion seconds since Cocoa epoch ≈ year 2064
- 2 billion nanoseconds since Cocoa epoch ≈ 2 seconds after epoch (Jan 1, 2001)
- Any real message date as nanoseconds will be >> 2 billion
- Any real message date as seconds will be << 2 billion (until 2064)
- So the threshold cleanly separates the two formats

---

## 1:1 Chat Detection

### The SQL Filter
```sql
WHERE room_name IS NULL
  AND guid NOT LIKE '%;chat%'
HAVING COUNT(DISTINCT persona) = 1
```

- `room_name IS NULL` — filters out named group chats
- `guid NOT LIKE '%;chat%'` — filters out multi-person chats
- `HAVING COUNT(DISTINCT persona) = 1` — ensures only one other person

### Why It's Tricky
- Apple merges handles via `person_centric_id` — same person might have phone + email
- Group chats that lost members can look like 1:1 chats
- Some service types (SMS vs iMessage) create separate chat entries for same person

---

## Reaction Filtering

Pure tapback reactions (Loved, Liked, Disliked, etc.) are stored as separate message rows with:
- `associated_message_guid IS NOT NULL` (points to the reacted-to message)
- `text IS NULL AND attributedBody IS NULL` (no content of their own)

These are filtered out of all message queries to avoid corrupting training data with non-conversational content.

---

## Snapshot Strategy

### Why Snapshots
- Never modify the original `chat.db` — read-only access only
- WAL mode means you need `chat.db` + `chat.db-wal` + `chat.db-shm` together
- Consistent point-in-time view (messages arriving during ingestion don't cause inconsistency)

### Implementation
- `create_snapshot()` copies `chat.db` + WAL + SHM to `~/.be-right-back/data/raw/YYYYMMDD_HHMMSS/`
- Also copies AddressBook database to same snapshot directory
- Auto-cleans to keep `MAX_SNAPSHOTS` most recent
- `get_or_create_snapshot()` reuses latest if recent enough

### Disk Space Concern
Each snapshot is a full copy of `chat.db` (can be 1-10GB depending on message history). Tech debt item: "Snapshot disk space accumulation" — tracked in NEXT_UP.md.

---

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| NSAttributedString decode (ObjC FFI) | `crates/messages-db/src/utils/attributed_body.rs` | 339 |
| Snapshot management | `crates/messages-db/src/db/snapshot.rs` | — |
| Message queries | `crates/messages-db/src/db/queries.rs` | — |
| Contact queries + AddressBook | `crates/messages-db/src/db/queries.rs` | — |
| Display name resolution | `crates/messages-db/src/utils/names.rs` | — |
| Date parsing / Cocoa conversion | `crates/messages-db/src/utils/date.rs` | — |
| Phone normalization | `crates/messages-db/src/db/queries.rs` | — |

---

## Narrative Angles

1. **"The 339 lines of unsafe Rust that read your messages"** — ObjC FFI from Rust to decode a proprietary binary format Apple never documented. Three fallback paths spanning 20+ years of macOS serialization formats.

2. **"2001: A Timestamp Odyssey"** — Apple's Cocoa epoch, the nanosecond/second ambiguity, and the 2-billion heuristic. A tiny detail that corrupts every date in your dataset if you get it wrong.

3. **"Reading the unreadable"** — The `attributedBody` BLOB that modern iMessage uses instead of plain text. How to decode it, what the 19-class allowlist means, and why "streamtyped" blobs from 2005 still matter.

4. **"Privacy as architecture"** — Snapshot-based isolation, read-only access, Full Disk Access requirement, and why the app never writes to `~/Library/Messages/`.

5. **"The phone number problem"** — E.164 normalization, person_centric_id merging, why the same person appears as 3 different handles, and AddressBook as best-effort name resolution.

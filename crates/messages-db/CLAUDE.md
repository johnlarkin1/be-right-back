# messages-db

Read-only access to the macOS iMessage database (`~/Library/Messages/chat.db`) and AddressBook (`~/Library/Application Support/AddressBook/Sources/`).

## Public API

**Snapshot management** (`db::snapshot`):
- `create_snapshot() -> Result<PathBuf>` -- copies chat.db + WAL/SHM + AddressBook into a timestamped dir under `~/.be-right-back/data/raw/YYYYMMDD_HHMMSS/`. Auto-cleans to keep `MAX_SNAPSHOTS` (from `common`).
- `get_or_create_snapshot()` -- returns latest snapshot or creates one.
- `get_latest_snapshot() -> Result<Option<PathBuf>>` -- returns newest snapshot dir or None.
- `open_chat_snapshot(path) -> Result<Connection>` -- accepts either snapshot dir or direct .db path.
- `open_addressbook_snapshot(dir) -> Result<Connection>`

**Queries** (`db::queries`):
- `list_contacts(snapshot_dir, ContactQueryOptions) -> Vec<Contact>` -- the main entry point; joins AddressBook for display names unless `skip_display_names()` is set.
- `get_conversation(snapshot_dir, contact_id) -> Conversation` -- convenience: opens connection, fetches messages, resolves display name.
- `get_self_conversations(snapshot_dir, min_messages) -> Vec<Conversation>` -- every 1:1 conversation with enough messages, for "You" training. Drops a message already seen under another handle of the same person.
- `get_messages_for_contact(conn, contact_id) -> Vec<Message>` -- respects `BRB_DEV_MESSAGE_LIMIT` env var.
- `get_messages_for_contact_paginated(conn, contact_id, limit, offset)`
- `get_message_rows_for_contact(conn, contact_id) -> Vec<MessageRow>` -- raw rows with `attributed_body` bytes.
- `get_reactions_count(conn, contact_id) -> (total, from_me, from_them)`
- `build_phone_lookup(conn) -> HashMap<String, String>` / `build_email_lookup(conn)` -- for batch display-name resolution.
- `populate_display_names_with_cache(contacts, phone_map, email_map)` -- apply pre-built maps to a contact slice.
- `normalize_phone_number(phone) -> Option<String>` -- E.164 via `phonenumber` crate, defaults to US. ~30ms per call, cache results in batch.

**Tapbacks** (`db::tapbacks`):
- `list_tapbacks(conn) -> Vec<Tapback>` -- every Tapback in 1:1 and group chats, with its target resolved and removals netted out.
- `TapbackKind` -- love, like, dislike, laugh, emphasize, question, emoji, sticker (`associated_message_type - 2000`).

**`ContactQueryOptions`** -- builder pattern: `.min_messages(n)`, `.include_groups()`, `.skip_display_names()`. Default: 1:1 chats only, min 1 message, with AddressBook lookup.

**Utils** (`utils::*`, re-exported):
- `decode_attributed_body(bytes) -> Option<String>` -- ObjC FFI to decode NSAttributedString blobs (see below).
- `parse_date(date_str) -> Result<DateTime<Utc>>` -- "YYYY-MM-DD" to midnight UTC.
- `build_display_name(first, last, middle, nickname) -> String`

The crate re-exports `common::*` from `lib.rs`.

## Gotchas

**attributedBody decoding**: nearly every blob is a `streamtyped` NSArchiver archive (tag at byte 2, after `04 0B`). `utils::typedstream::extract_text` reads the NSString bytes directly in ~1 µs. Anything it does not recognise falls back to `utils::attributed_body`, which uses raw `objc`/`objc-foundation` bindings (~140 µs per blob). For a `streamtyped` blob that fallback calls `NSUnarchiver` first. Otherwise it tries the modern secure keyed API (explicit allowlist of ~19 classes), the legacy keyed unarchiver, then `NSUnarchiver`. `mlx/src/utils/attributed_body.py` mirrors the same fast path. This is `unsafe` code and macOS-only. Messages without decodable text are silently skipped (logged at `debug`).

**Cocoa timestamps**: Apple stores `message.date` as either nanoseconds or seconds since 2001-01-01 depending on macOS version. The threshold heuristic is `> 2_000_000_000` means nanoseconds. Conversion adds `COCOA_TO_UNIX_OFFSET` (978307200s) from `common`.

**1:1 chat detection**: SQL queries filter for peer-to-peer chats by requiring `room_name IS NULL`, `guid NOT LIKE '%;chat%'`, and `HAVING COUNT(DISTINCT persona) = 1`. The `person_centric_id` field merges handles that Apple has linked to the same person.

**Tapbacks filtered out**: All message queries exclude `associated_message_type` 2000-3999 (Tapbacks and their removals). Do not filter on empty text: every real Tapback row has an `attributedBody` such as `Loved “…”`.

**Full Disk Access required**: Reading `chat.db` fails with `BrbError::PermissionDenied` if the calling process lacks FDA. The error message tells users to grant it in System Settings.

**AddressBook is best-effort**: Snapshot creation and display-name lookup gracefully degrade if AddressBook is unavailable (warns and continues). The AddressBook file is found by scanning for `AddressBook-v*.abcddb` and picking the highest version number.

## Workspace Role

Depended on by: `ingestion`, `inference`, `cli`, `desktop` (Tauri). Depends on: `common` (for `Message`, `Contact`, `Conversation`, `BrbError`, constants).

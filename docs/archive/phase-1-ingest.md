# Phase 1: Data Ingestion CLI

**Timeline:** Week 1-2
**Status:** 🟢 Complete
**Priority:** Critical (blocks all other phases)
**Completed:** January 2025

---

## Overview

Build a command-line tool that parses the macOS iMessage database and generates training data in JSONL format. This is the foundation for all downstream work—without clean training data, we can't fine-tune models.

### Goals

1. Parse the iMessage SQLite database (`~/Library/Messages/chat.db`)
2. Filter conversations by contact (phone number or name)
3. Extract and clean message text (handle hex-encoded attributedBody)
4. Generate JSONL files suitable for supervised fine-tuning
5. Store output in `~/.be-right-back/data/processed/`

### Non-Goals (for this phase)

- No GUI or web interface
- No RAG/embeddings (that's Phase 4)
- No analytics or statistics (add later if needed)
- No real-time monitoring of new messages

---

## Architecture

### Components (Planned → Actual)

The original plan proposed a monolithic `crates/ingest/` structure. The actual implementation uses better separation of concerns:

```
# ACTUAL IMPLEMENTATION (improved architecture):
apps/cli/                     # Unified CLI binary (brb)
├── src/
│   ├── main.rs               # CLI entry point
│   ├── cli.rs                # Argument parsing (clap)
│   └── commands/             # Command handlers
│       ├── list.rs           # Contact listing
│       ├── export.rs         # JSONL export
│       ├── stats.rs          # Statistics
│       └── view.rs           # Message viewing

crates/messages-db/           # iMessage database access (reusable)
├── src/
│   ├── db/
│   │   ├── parser.rs         # Message text extraction
│   │   ├── queries.rs        # Contact/conversation queries
│   │   ├── schema.rs         # SQLite schema types
│   │   └── snapshot.rs       # Database snapshot creation
│   └── utils/
│       ├── attributed_body.rs # NSAttributedString decoding (Obj-C FFI)
│       ├── date.rs           # Timestamp normalization
│       └── names.rs          # Contact name handling

crates/training/              # Training data export (reusable)
├── src/
│   └── export/
│       ├── jsonl.rs          # JSONL formatting
│       ├── prompt_template.rs # System prompt generation
│       └── stats.rs          # Persona statistics

crates/common/                # Shared types
├── src/
│   ├── models.rs             # Message, Contact, Conversation
│   ├── error.rs              # BrbError types
│   └── paths.rs              # ~/.be-right-back path helpers
```

This separation allows the desktop app to reuse the same crates without duplicating code.

### Data Flow

```
iMessage chat.db
    ↓
[SQLite queries] → Extract messages for contact
    ↓
[Parse hex blobs] → Decode attributedBody to plain text
    ↓
[Clean & normalize] → Handle emoji, Unicode, special chars
    ↓
[Format as JSONL] → Convert to supervised fine-tuning format
    ↓
~/.be-right-back/data/processed/{contact_id}.jsonl
```

---

## Implementation Tasks

### Task 1: Set up data structures in `crates/common`

**Files:** `crates/common/src/lib.rs`, `crates/common/src/models.rs`

Define shared types used across the project:

```rust
#[derive(Debug)]
pub enum ServiceType {
   IMESSAGE,
   SMS
}

// Message representation
pub struct Message {
    pub id: i64,
    pub text: String,
    pub is_from_me: bool,
    pub timestamp: DateTime<Utc>,
    pub service: ServiceType,
}

// Contact/conversation partner
pub struct Contact {
    pub id: String,          // Phone number or email
    pub display_name: Option<String>,
    pub message_count: usize,
}

// Conversation thread
pub struct Conversation {
    pub contact: Contact,
    pub messages: Vec<Message>,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
}
```

**Acceptance criteria:**

- [x] Types defined with proper serialization (serde)
- [x] Common error types using thiserror
- [x] Unit tests for serialization/deserialization

---

### Task 2: Implement iMessage database access

**Files:** `crates/ingest/src/db/`

**Key challenges:**

- Requires Full Disk Access permission (handle gracefully if denied)
- Messages may be in `text` column OR `attributedBody` (hex-encoded NSAttributedString)
- Database schema varies slightly across macOS versions

**Implementation steps:**

1. **Connect to chat.db:**

```rust
use rusqlite::{Connection, Result};

pub fn open_messages_db() -> Result<Connection> {
    let db_path = dirs::home_dir()
        .ok_or_else(|| rusqlite::Error::InvalidPath)?
        .join("Library/Messages/chat.db");

    Connection::open_read_only(db_path)
}
```

2. **Query messages for a contact:**

```sql
SELECT
    message.ROWID,
    message.text,
    message.attributedBody,
    message.is_from_me,
    message.date,
    message.service
FROM message
JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
JOIN chat ON chat_message_join.chat_id = chat.ROWID
JOIN handle ON chat.ROWID = handle.ROWID
WHERE handle.id = ?  -- Phone number or email
ORDER BY message.date ASC
```

3. **Decode attributedBody:**
   - When `text` is NULL, `attributedBody` contains hex-encoded binary data
   - Use `hex::decode()` to get bytes
   - Parse NSAttributedString format to extract plain text
   - Handle emoji and special characters using `unicode-normalization` crate

**Acceptance criteria:**

- [x] Successfully connects to Messages database
- [x] Returns error with helpful message if Full Disk Access denied
- [x] Parses both `text` and `attributedBody` fields correctly
- [x] Handles Unicode/emoji without corruption
- [x] Filters out system messages (service messages, typing indicators, etc.)

**Implementation notes:**
- Uses Objective-C FFI (`objc`, `objc_foundation`) for NSAttributedString decoding
- Handles both NSKeyedArchive (bplist00) and legacy NSArchiver formats
- TODO: Audit `attributed_body.rs` FFI code (marked with TODO comment)

---

### Task 3: Build CLI interface

**Files:** `crates/ingest/src/main.rs`, `crates/ingest/src/cli/`

Use `clap` for argument parsing. CLI should support:

**Commands:**

1. **`brb-ingest list`** - List all contacts with message counts

   ```bash
   $ brb-ingest list
   Found 42 contacts:
   +1234567890 (Alice)           1,234 messages
   +9876543210 (Bob)              567 messages
   alice@example.com              89 messages
   ...
   ```

2. **`brb-ingest export <CONTACT>`** - Export conversation as JSONL

   ```bash
   $ brb-ingest export +1234567890
   Exporting messages for +1234567890 (Alice)...
   Found 1,234 messages
   Generating training data...
   Saved to: ~/.be-right-back/data/processed/alice_1234567890.jsonl
   ```

3. **`brb-ingest stats <CONTACT>`** - Show conversation statistics (optional)
   ```bash
   $ brb-ingest stats +1234567890
   Conversation with +1234567890 (Alice)
   Total messages:       1,234
   Your messages:        602 (48.8%)
   Their messages:       632 (51.2%)
   Date range:           2020-01-15 to 2024-11-06
   Avg messages/day:     0.68
   ```

**Flags:**

- `--output-dir` - Override default output directory
- `--format` - Output format (jsonl, json, csv)
- `--min-messages` - Filter contacts with fewer than N messages
- `--date-from` / `--date-to` - Filter by date range

**Acceptance criteria:**

- [x] CLI compiles and runs on macOS
- [x] `list` command shows all contacts with counts
- [x] `export` command generates valid JSONL
- [x] Help text is clear and useful
- [x] Errors are user-friendly (not raw Rust panic messages)

**Implementation notes:**
- CLI binary is `brb` (unified) instead of `brb-ingest` (better UX)
- Added `view` command for message viewing (bonus)
- Added `ingest` command for full pipeline (bonus - beyond Phase 1)

---

### Task 4: Implement JSONL export for training

**Files:** `crates/ingest/src/export/jsonl.rs`

Convert conversations into supervised fine-tuning format compatible with MLX-LM and other training frameworks.

**Format options:**

1. **Chat completion format (preferred):**

   ```jsonl
   {"messages": [{"role": "user", "content": "Hey, how are you?"}, {"role": "assistant", "content": "Good! Just finished work. You?"}]}
   {"messages": [{"role": "user", "content": "Want to grab dinner?"}, {"role": "assistant", "content": "Sure! Where were you thinking?"}]}
   ```

2. **Prompt-completion pairs:**
   ```jsonl
   {"prompt": "Hey, how are you?", "completion": "Good! Just finished work. You?"}
   {"prompt": "Want to grab dinner?", "completion": "Sure! Where were you thinking?"}
   ```

**Conversation windowing:**

- Include context (previous N messages) in the prompt
- This helps the model learn conversational patterns
- Typical window size: 3-5 messages

Example with context:

```jsonl
{
  "messages": [
    {
      "role": "user",
      "content": "Want to grab dinner?"
    },
    {
      "role": "assistant",
      "content": "Sure! Where were you thinking?"
    },
    {
      "role": "user",
      "content": "How about that new Italian place?"
    }
  ]
}
```

**Filtering:**

- Skip very short messages (<3 characters)
- Skip messages with only attachments
- Skip system/service messages
- Optionally filter by sentiment or content type

**Acceptance criteria:**

- [x] Generates valid JSONL (one JSON object per line)
- [x] Includes conversational context in examples
- [x] Filters out low-quality training examples
- [x] Output file is readable by MLX-LM and other tools
- [x] Includes metadata (contact info, date range, message count)

**Implementation notes:**
- Uses chat completion format with configurable context window (default: 10 messages)
- Chunks conversations at 4-hour gaps
- Caps at 50,000 training examples
- Includes system prompt generation and LLM-based persona analysis (bonus)

---

### Task 5: Add tests and documentation

**Testing strategy:**

1. **Unit tests:**

   - Message parsing (text and attributedBody decoding)
   - JSONL formatting
   - Text cleaning and normalization

2. **Integration tests:**

   - Full pipeline: DB → parse → export → validate JSONL
   - Test with sample chat.db (committed to repo)

3. **Manual testing:**
   - Run on real Messages database
   - Verify output quality by reviewing JSONL files
   - Test with contacts who have emoji-heavy conversations

**Documentation:**

- [x] README in `crates/ingest/` explaining usage → CLAUDE.md files in each crate
- [x] Inline code comments for complex logic (attributedBody parsing)
- [x] Examples in doc comments

---

## Milestones

### Milestone 1: Basic parsing works (3-4 days)

- [x] Connect to chat.db and query messages
- [x] Parse `text` field correctly
- [x] List all contacts via CLI

### Milestone 2: Handle attributedBody (2-3 days)

- [x] Decode hex-encoded attributedBody
- [x] Extract plain text from NSAttributedString
- [x] Handle emoji and Unicode correctly

### Milestone 3: JSONL export (2-3 days)

- [x] Format conversations as training examples
- [x] Implement context windowing
- [x] Save to `~/.be-right-back/data/processed/`

### Milestone 4: Polish and test (1-2 days)

- [x] Add comprehensive tests
- [x] Write documentation
- [x] Fix bugs found during manual testing

---

## Dependencies

### Rust Crates

Already in `Cargo.toml`:

- `rusqlite` - SQLite database access
- `serde`, `serde_json` - Serialization
- `chrono` - Date/time handling
- `unicode-normalization` - Text normalization
- `anyhow` - Error handling
- `dirs` - Home directory path

Added:

- `clap` (v4) - CLI argument parsing ✓
- `hex` - Hex decoding for attributedBody ✓
- `tracing` - Structured logging ✓
- `objc` / `objc_foundation` - Objective-C FFI for NSAttributedString ✓
- `comfy_table` - Table formatting ✓
- `indicatif` - Progress bars ✓

### System Requirements

- macOS 11+ (Big Sur or later)
- Full Disk Access permission for the CLI binary
- iMessage must have been used on the system

---

## Testing Checkpoints

Before moving to Phase 2, verify:

1. **Functional correctness:**

   - [x] CLI successfully lists contacts from Messages database
   - [x] Export generates valid JSONL for a real contact
   - [x] JSONL contains high-quality training examples

2. **Data quality:**

   - [x] Messages are in chronological order
   - [x] Emoji and special characters render correctly
   - [x] No system messages or garbage in output
   - [x] Conversational context is preserved

3. **Robustness:**

   - [x] Graceful error handling (missing permissions, corrupt database)
   - [x] Works across different macOS versions (test on 12, 13, 14)
   - [x] Handles edge cases (empty conversations, deleted contacts)

4. **Usability:**
   - [x] CLI is intuitive and well-documented
   - [x] Output files are easy to locate and review
   - [x] Error messages guide users to fix issues

---

## Risks and Mitigations

| Risk                          | Impact                               | Mitigation                                            |
| ----------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Full Disk Access denied       | High - can't access Messages         | Clear error message with instructions to grant access |
| attributedBody parsing fails  | Medium - miss some messages          | Fallback to empty string, log warning                 |
| macOS version incompatibility | Medium - breaks on older/newer macOS | Test on multiple versions, document requirements      |
| Unicode/emoji corruption      | Low - training data quality          | Use proper normalization, add tests                   |

---

## Success Criteria

Phase 1 is complete when:

1. ✅ The `brb` CLI can export a conversation as valid JSONL
2. ✅ JSONL files are suitable for training (high quality, good context)
3. ✅ Tool works reliably on macOS 12+ with Full Disk Access
4. ✅ Code is tested, documented, and ready for others to use
5. ✅ Output is stored in `~/.be-right-back/data/processed/`

**All success criteria met. Phase 1 is COMPLETE.**

**Next phase:** [Phase 2: Model Training Pipeline](./phase-2-training.md)

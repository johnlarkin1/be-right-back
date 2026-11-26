# common

Shared domain types, error handling, path utilities, and Python environment management for the entire workspace.

## Workspace Role

Every other crate depends on `common`: `messages-db`, `ingestion`, `training`, `inference`, `personas`, `cli`, and `desktop` (with `tauri-support` feature). It is the leaf dependency -- it must stay lean.

## Public API

Everything is re-exported from `lib.rs` via glob re-exports, so consumers use `common::Message`, `common::get_brb_dir()`, etc.

### Core Types (`models.rs`)

- `Message`, `Contact`, `Conversation` -- iMessage domain models, all `Serialize`/`Deserialize`
- `TrainingExample` / `TrainingMessage` -- chat-ML format training data (`role` is `"user"` or `"assistant"`)
- `PersonaStats` -- computed messaging style metrics (emoji rate, message length distribution, etc.)
- `ExportMetadata` -- metadata written alongside exported training data, includes optional `llm_analysis` and `persona_stats`
- `ConversationStats` + sub-structs (`MessageCounts`, `TemporalStats`, `MessageLengthStats`, `ResponseTimeStats`) -- per-contact analytics with a `Display` impl for CLI output

### Error Handling (`error.rs`)

`BrbError` enum with `#[from]` conversions for `rusqlite::Error`, `std::io::Error`, and `serde_json::Error`. `DatabaseSource` variant preserves error chains for non-SQLite DB errors via `BrbError::database(context, source)`. Other variants take `String`. Aliased as `common::Result<T>`.

### Path Utilities (`paths.rs`)

All `get_*` functions return `Result<PathBuf>` and **create directories as a side effect** via `create_dir_all`. The sole exception is `get_brb_dir()` which only computes the path.

Key filesystem layout under `~/.be-right-back/`:
```
data/raw/          -- raw exported data
data/processed/    -- processed training data
data/stats/        -- per-contact stats (subdirs by sanitized contact ID)
data/db/           -- brb.db (SQLite) + brb.duckdb
models/base/       -- base GGUF model files
models/personas/   -- adapter files; the app writes only `you/`
mlx/               -- Python scripts
mlx-venv/          -- Python virtual environment
```

`sanitize_contact_id_for_filename()` strips leading `+`, replaces `@` and `.` with `_`, replaces other non-alphanumeric with `_`. This is used to key both stats and persona directories.

### Constants (`constants.rs`)

- `COCOA_TO_UNIX_OFFSET` (978307200) -- for converting Apple/iMessage timestamps
- `MESSAGES_DB_PATH` / `ADDRESSBOOK_DB_PATH` -- macOS system DB paths relative to `$HOME`
- `CHAT_SNAPSHOT_FILENAME` / `ADDRESSBOOK_SNAPSHOT_FILENAME` -- snapshot file names
- `DEFAULT_MLX_AGENT_MODEL` = `"mlx-community/Qwen3.5-9B-4bit"` -- Casper agent tool-calling model (same 4-bit model)
- `DEFAULT_MLX_EMBEDDING_MODEL` = `"mlx-community/nomicai-modernbert-embed-base-8bit"`
- `get_dev_message_limit()` -- reads `BRB_DEV_MESSAGE_LIMIT` env var, returns `Option<usize>`

### Model Tiers (`model_tiers.rs`)

- `ModelTier` struct with tier name, display name, HF model IDs (4-bit used for all tasks, 8-bit field retained but unused), min memory, size estimates, layer count
- `MODEL_TIERS: &[ModelTier]` -- 4 tiers: 9B (24GB+ Mac), 4B (16GB+ Mac), 2B (12GB+ Mac), 0.8B (8GB+ Mac). `min_memory_gb` thresholds account for the 5GB overhead subtracted in `recommend_model_tier()`
- `detect_system_memory_gb()` -- macOS unified memory via `sysctl hw.memsize`
- `recommend_model_tier()` -- picks highest tier that fits with headroom for embedding model + OS (~5GB)
- `recommended_persona_model()` -- shorthand for `recommend_model_tier().model_4bit`
- `recommended_agent_model()` -- shorthand for `recommend_model_tier().model_4bit`
- `get_tier_by_name(name)` -- lookup by tier name ("9b", "4b", etc.)

### Python Environment (`python_env.rs`)

`PythonEnvironment` has three fields: `python_bin`, `scripts_dir`, `mlx_dir`.

Two construction paths:
- `PythonEnvironment::get()` -- assumes venv exists, errors if not. Used by CLI/inference/ingestion.
- `PythonEnvironment::ensure(&app)` -- **(requires `tauri-support` feature)** extracts bundled Python/uv from Tauri resources, creates venv, installs deps. Emits `"setup-progress"` events.

Script lookup via `env.script(scripts::EMBED)` joins `scripts_dir` with the script filename. In dev mode (`debug_assertions`), `find_scripts_dir` falls back to the workspace-relative `mlx/src/entry/` path.

## Gotchas

- `get()` checks for `bin/python` but `ensure()` creates `bin/python3` -- both work because venv symlinks both names.
- All path functions silently create directories. If you just want to check existence, use the path constants directly with `get_brb_dir()`.
- `BrbError::Json` variant provides `From<serde_json::Error>` -- use `?` for simple conversions. Use `BrbError::Serialization(format!(...))` only when adding context to the error message.
- `BrbError::database(context, source)` preserves error chains for non-SQLite database errors (e.g., DuckDB). Use it to wrap a concrete error type.
- `Contact.id` is a phone number or email string, not a numeric ID.

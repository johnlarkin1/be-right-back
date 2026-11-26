# src-tauri

Tauri v2 Rust backend that bridges the React frontend with workspace crates (messages-db, ingestion, inference, training, personas).

## Command Modules

All commands live in `src/commands/`. Each `#[tauri::command]` fn is registered in the `generate_handler![]` macro in `lib.rs`.

| Module | Purpose |
|---|---|
| `contacts.rs` | Contact listing from brb.db (SQLite), contacts cache prewarming |
| `system.rs` | Initialization status, ingestion pipeline (6-stage with progress events), FDA settings, model tier selection, ingestion settings CRUD, analytics-only pipeline |
| `training.rs` | "You" persona training via Python subprocess (`scripts::TRAIN`), `cancel_training`, persona listing. No command takes a contact (see `AGENTS.md`) |
| `inference.rs` | Streaming chat with the "You" persona via `UnifiedEngine`, plus the RAG retrieval and personality-profile injection that ground it |
| `insights.rs` | Analytics dashboard queries against DuckDB (timelines, calendars, word frequencies, embedding visualizations) via granular per-section endpoints |
| `analysis.rs` | Two-phase LLM personality analysis via Python subprocess (`scripts::ANALYZE_PERSONA`). Supports both single-contact and multi-contact "You" analysis. Results cached in SQLite |
| `casper.rs` | Casper AI agent (RAG Q&A over messages). Spawns MLXPythonEngine with Qwen3 for tool-calling. Streaming variant emits `casper-progress` events. `cancel_casper` stops the run |
| `types.rs` | Shared serializable types (ContactWithStatus, IngestionSettings, AnalyticsSettings, etc.) |

## State Management

Three state objects are managed by Tauri via `.manage()` in `lib.rs`:

**AppState** (`state.rs`) -- the primary state, registered with `.manage(AppState::with_backend(backend))`:
- `engine: Arc<Mutex<Option<UnifiedEngine>>>` -- lazily-created inference engine
- `backend: InferenceBackend` -- currently hardcoded to `MLXPython`
- `ingestion: Arc<IngestionState>` -- cancel/running flags (AtomicBool)
- `training: Arc<TrainingState>` -- cancel flag plus the trainer `Child`, which `cancel_training` kills
- Casper cancel token -- `begin_casper_run()` registers one per `ask_casper_streaming` call, `cancel_casper_run()` fires it
- `contacts_cache: Arc<RwLock<ContactsCache>>` -- cached contact list keyed by snapshot dir
- `ingestion_info_cache: Arc<RwLock<IngestionInfoCache>>` -- cached ingestion metadata

Access in commands: `state: tauri::State<'_, AppState>` or `state: tauri::State<'_, crate::AppState>`.

Cache invalidation: call `state.invalidate_caches().await` after ingestion or snapshot creation. The contacts cache alone can be invalidated via `invalidate_contacts_cache()`.

## Event Emission Pattern

Async commands accept `app: AppHandle` and emit events for real-time frontend updates:

| Event Name | Emitter | Payload |
|---|---|---|
| `ingestion-progress` | `system.rs` | `IngestionProgressEvent` (6 stages, stats, completion) |
| `chat-meta` | `inference.rs` | `ChatMetaPayload { ragResultCount }` -- emitted once before the first token |
| `chat-token` | `inference.rs` | `ChatTokenPayload { token, done }` |
| `analysis-progress` | `analysis.rs` | `AnalysisProgressEvent { phase, content, is_complete, error }` |
| `casper-progress` | `casper.rs` | `CasperEvent` (started/thinking/tool_start/tool_complete/token/token_reset/complete/cancelled/error) |

Pattern: `app.emit("event-name", payload).map_err(|e| format!("..."))?;`

Frontend listens via `listen('event-name', (event) => { ... })` from `@tauri-apps/api/event`.

## Adding a New Tauri Command

1. Add or modify a file in `src/commands/`. Define your function with `#[tauri::command]` and `pub` visibility. Return `Result<T, String>` where T: Serialize.
2. If you created a new module, add `pub mod your_module;` to `src/commands/mod.rs`.
3. Register the command in the `generate_handler![]` macro in `src/lib.rs` as `commands::your_module::your_command`.
4. Define any new types in `types.rs` (or in-module) with `#[derive(Serialize, Deserialize)]`.
5. Call from frontend: `await invoke('your_command', { argName: value })`. Rust snake_case function names map directly to the invoke string.

## Key Patterns

- **Blocking work in async commands**: Use `tokio::task::spawn_blocking(move || { ... }).await` for CPU-bound or synchronous work (see `run_ingestion`, `run_analytics_only`).
- **Python subprocesses**: Use `PythonEnvironment::ensure(&app).await` to get the venv, then spawn via `std::process::Command` or `tokio::process::Command`. Scripts are referenced via `env.script(scripts::SCRIPT_NAME)`.
- **DuckDB queries**: Opened read-only in `insights.rs` via `ingestion::VectorDb::open_readonly()`. SQL constants live in `queries.rs`.
- **SQLite metadata**: Accessed via `ingestion::MetadataDb::open(&db_dir)` for contacts, stats, analysis cache, app state.
- **Error handling**: All commands return `Result<T, String>`. Convert errors with `.map_err(|e| format!("...: {}", e))?`.
- **Logging**: Use `tracing::{info, debug, warn, error}` (never `println!`).
- **App data directory**: `~/.be-right-back/` -- accessed via `dirs::home_dir().join(".be-right-back")` or `common::get_db_dir()`.

## Workspace Crate Dependencies

`common` (with `tauri-support` feature), `messages-db`, `training`, `personas`, `ingestion`, `inference`. External: `tokio`, `chrono`, `tracing`.

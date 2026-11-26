# cli

Unified `brb` CLI binary for all iMessage operations: snapshot, ingest, export, train, chat, and RAG queries.

## Subcommands

| Command | Handler | Description |
|---------|---------|-------------|
| `snapshot` | inline in `main.rs` | Create timestamped copy of Messages DB |
| `ingest` | `ingest.rs` | Full pipeline: snapshot + chunk + embed + save to DuckDB |
| `list` | `list.rs` | List contacts with message counts (table/csv/json) |
| `export` | `export.rs` | Export your own replies across your 1:1 chats as "You" training data, with self-analysis |
| `stats` | `stats.rs` | Compute + display conversation statistics, saves `distribution.json` |
| `view` | `view.rs` | Paginated message viewer |
| `visualize` | `visualize.rs` | Runs `stats` first, then calls `scripts/visualize.py` via `uv run` |
| `train` | `train.rs` | Trains the "You" persona: shells out to the Python training script via `PythonEnvironment` |
| `ask` | `ask.rs` | Casper RAG agent: spawns MLX Python daemon, runs agentic tool-call loop |

## Architecture

- **Clap derive pattern**: `Cli` struct with `Commands` enum in `cli.rs`. `OutputFormat` is a `ValueEnum` for `--format` on `list`.
- **Command routing**: `main.rs` matches on `Commands` variants, delegates to `handle_*` functions in `commands/`.
- **Snapshot auto-creation**: Most commands call `db::get_latest_snapshot()` and create one if missing. `export` uses `db::snapshot::get_or_create_snapshot()` instead.
- **No async runtime globally**: Only `ask` creates a `tokio` runtime (`new_current_thread`) for the agent loop. Everything else is synchronous.

## Workspace Crate Usage

- `messages-db` - DB snapshots, queries, schema, `decode_attributed_body`
- `training` - `export::*` functions for JSONL generation, persona stats, LLM analysis
- `ingestion` - `run_ingestion()` with progress callback (6-stage pipeline)
- `inference` - `CasperAgent`, `MLXPythonEngine` for the `ask` command
- `personas` - Persona management (dependency, used indirectly)
- `common` - `Result`, `BrbError`, path helpers (`get_brb_dir`, `get_processed_data_dir`, `get_stats_contact_dir`), `PythonEnvironment`

## Non-Obvious Patterns

- `export` samples 100 conversation blocks (`SAMPLE_CONVERSATION_BLOCKS` in `constants.rs`) across your top 20 chats for LLM self-analysis, with graceful fallback if LLM fails.
- `visualize` internally calls `handle_stats` to ensure `distribution.json` exists before invoking the Python script. It locates `scripts/visualize.py` by walking up ancestors from CWD.
- `train` uses `common::PythonEnvironment::get()` to find the venv Python binary and training script path.
- `stats` computes everything in-process (response times, distributions, daily counts) and writes `distribution.json` to `~/.be-right-back/data/stats/{contact}/`.
- `view` replaces Unicode object replacement character (`\u{FFFC}`) with `[attachment]` for display.
- `ask` spawns an `MLXPythonEngine` daemon process and explicitly shuts it down after the agent loop via `agent.take_engine()`.
- `list` uses `ContactQueryOptions` builder pattern with `.min_messages()` and `.include_groups()`.
- `rustyline` is a dependency (for readline-style input) but `chat` is currently stubbed out.

## Build & Run

```bash
cargo build --package brb
cargo run --package brb -- list
cargo run --package brb -- ask "who do I text the most?"
```

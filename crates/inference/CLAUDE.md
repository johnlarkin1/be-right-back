# inference

LLM inference engine and tool-calling agent for running persona chatbots and iMessage search on Apple Silicon.

## Public API

All public types are re-exported from `lib.rs`:

```rust
// Engine types
use inference::{UnifiedEngine, InferenceBackend};
use inference::MLXPythonEngine;

// Daemon types
use inference::{DaemonConnection, DaemonManager, DaemonRole};

// Config types
use inference::{GenerationConfig, ChatMessage};

// Agent types
use inference::{CasperAgent, AgentConfig, AgentResponse, AgentProgressEvent};
use inference::{Tool, ToolCall, ToolRegistry, ToolResult};
use inference::{ExtractedPlan, merge_plans, parse_extracted, resolve_turn_plan};

// Error handling
use inference::{InferenceError, Result};
```

## Backend Architecture

`InferenceBackend` has one variant, `MLXPython` (`backend.rs:12`), and `UnifiedEngine` wraps `MLXPythonEngine`. MLX models are downloaded by the Python daemon on first load -- there is no Rust-side download path.

## MLXPythonEngine

Spawns a long-running Python daemon (`mlx/src/entry/inference_daemon.py`) that communicates via JSON lines over stdin/stdout. The daemon keeps the model loaded in memory.

Two spawn modes:
- `MLXPythonEngine::spawn()` -- Qwen3.5 model (persona chat, 4-bit)
- `MLXPythonEngine::spawn_for_agent()` -- Qwen3.5 model (tool calling, 4-bit)
- `MLXPythonEngine::spawn_with_model(model)` -- arbitrary model

Key operations beyond the trait interface:
- `embed_query(&str) -> Vec<f32>` -- generates 768-dim embeddings via ModernBERT (used by agent for semantic search)
- `load_base_model()` / `load_model_with_override(Some("model"))` -- hot-swap between models without restarting daemon
- `ping()` / `is_alive()` -- health checks

The daemon protocol is defined in `engines::mlx_python::protocol`:
- Commands: `Load`, `Generate`, `Cancel`, `EmbedQuery`, `Rerank`, `AnalyzePersona`, `Ping`, `Shutdown`
- Responses: `Ready`, `Loaded`, `Token{text,done}`, `Complete`, `Cancelled`, `Embedding`, `RerankResult`, `AnalysisProgress`, `AnalysisPhase1Complete`, `AnalysisComplete`, `Error`, `Pong`, `ShuttingDown`, `Log`

### Request ids

Every command carries a request `id`, and every reply to it carries the same `id` (`protocol::CommandFrame`, `protocol::ResponseFrame`). `RequestIds` in each transport discards frames with any other id. So a reply to an abandoned request (a timed-out read, a swallowed error) never answers the next command. The `ready` frame has no id and reports `protocol`. On connect, the engine restarts a socket daemon that reports another `PROTOCOL_VERSION`.

A socket read that times out sends `Cancel` for its request, so the daemon stops the generation.

### Streaming and cancellation

`Generate` with `stream: true` makes the daemon send `Token` frames as text arrives, then one `Complete`. Tokens are raw output: think blocks, tool calls and special tokens included. The `Complete` text is cleaned and authoritative. Without `stream`, the daemon sends `Complete` only.

`MLXPythonEngine::generate_with_tokens(messages, config, on_token, &CancelToken)` drives this. In socket mode it sends `Cancel` with the generation's id when the token fires, stops calling `on_token`, and reads until `Cancelled` (or `Complete`), so the connection stays in sync. It then returns `InferenceError::Cancelled`. The daemon also stops a generation when its client disconnects. A pipe daemon reads stdin only between commands, so cancel kills the process instead.

## Casper Agent

`CasperAgent` is a tool-calling agent loop that uses MLX for both inference and embeddings. The default model is Qwen3.5, which calls tools reliably.

### Agent loop (`ask_with_history_cancellable`):
1. Build system prompt with tool definitions (Qwen3 OpenAI format)
2. Generate LLM response
3. Parse tool calls from response (handles Qwen3/Qwen3.5 `<tool_call>` and bare JSON formats)
4. Execute tools in Rust, inject results as `<|tool_response|>` messages
5. Repeat until LLM gives a final answer or `max_iterations` (default: 3) exceeded
6. On max iterations, runs a synthesis pass to summarize findings

Every generation streams through `AnswerStream` (`agent/answer_stream.rs`). It hides `<think>` blocks and tool calls, and emits the rest as `AnswerToken` events. Its tool-call markers are `parser::TOOL_CALL_OPENERS`, so a new parser format needs an entry there. The daemon strips tokenizer special tokens before streaming. The agent knows an iteration was a tool call only after it ends, so it then emits `AnswerReset` to clear the preview. The final `AgentResponse::answer` replaces the preview.

The `CancelToken` is checked before each iteration and on every streamed token. `ask_with_history_progress` is the same call with a token that never fires.

### Anti-loop protections:
- Deduplicates identical Qwen3 tool calls within a response
- Detects repeated tool call JSON across iterations and forces an answer
- Detects repetitive text answers (50-char prefix match) and synthesizes from tool results
- Fixes incomplete/truncated JSON from model output

### Built-in tools (in `agent::builtin`):
- `list_contacts` -- queries `MetadataDb` for contacts with message counts
- `search_messages` -- hybrid search (semantic via `VectorDb` + keyword). Agent injects `_embedding` parameter by calling `embed_query()` before execution
- `get_conversation_context` -- fetches messages around a date from iMessage snapshot
- `get_contact_stats` -- message counts, date ranges, emoji usage from `MetadataDb`
- `get_message_volume_by_period` -- per-contact message counts in a date range, from DuckDB `daily_activity`
- `get_conversation_analysis` -- pre-computed LLM analysis of a contact from `MetadataDb` (truncated to 6k chars for context budget)
- `get_topic_clusters` -- Leiden topic clusters from DuckDB `chunk_projections`, via `ingestion::queries::build_cluster_summary_query`

All tools resolve their database paths through `common` (`MetadataDb::open()` / `VectorDb::open_readonly()` take no arguments).

**Tool result convention**: `ToolResult::error` is for failures the caller could retry. "No data exists for this contact" is a *successful* result carrying `available: false` or a `note`. This matters because the agent loop treats an unsuccessful record as a hard stop: the duplicate-call guard emits a canned error string and `synthesize_from_tool_results` skips the record entirely, so an absent-data error dead-ends the turn instead of falling back to search.

Any tool registered in `create_builtin_tools()` also needs an arm in `synthesize_from_tool_results` (`agent/mod.rs`), or its results fall through to "I was unable to complete the request."

### Custom tools:
Implement the `Tool` trait (`name`, `description`, `parameters` as JSON Schema, `execute`) and register with `ToolRegistry`.

## GenerationConfig Presets

| Preset | temp | max_tokens | Key use |
|--------|------|-----------|---------|
| `default()` | 0.7 | 256 | Balanced |
| `chat()` | 0.8 | 256 | Persona conversation |
| `agent()` | 0.6 | 4096 | Tool calling (higher rep penalty, custom stops, `use_default_stops: false`) |
| `deterministic()` | 0.0 | 256 | Testing |

`use_default_stops` controls whether the Python daemon appends pleasantry-detection stop sequences. Agent mode disables this.

## Workspace Dependencies

Depends on: `common` (Python env, paths, constants), `personas` (adapter paths), `ingestion` (VectorDb, MetadataDb for agent tools), `messages-db` (iMessage snapshot access for agent tools).

Depended on by: `apps/desktop/src-tauri`, `apps/cli`.

## Gotchas

- `MLXPythonEngine::generate_streaming()` blocks the calling thread despite being async (uses `blocking_send`). The engine takes `&mut self`, so concurrent calls are not possible. It sends `stream: false`, so persona chat still gets one `Complete`. Casper uses `generate_with_tokens()` instead.
- The agent temporarily `take()`s the engine out of `self` during `ask()` to avoid borrow conflicts, then puts it back.
- `ChatMessage::tool_response()` uses role `"tool"` which the Python daemon handles specially (outputs content without role wrapper).
- `GenerationConfigForPython` adds `repetition_context_size: 50` which is not configurable from the Rust side.

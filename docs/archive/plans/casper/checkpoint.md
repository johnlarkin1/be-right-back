# Casper Agent Implementation Checkpoint

**Date**: 2026-01-13
**Branch**: `feat-casper-buildout`
**Status**: Backend complete, frontend integration pending

## Overview

Casper is an AI agent that can search and interact with iMessage history using Qwen3's native tool calling capabilities. The agent uses semantic search over message embeddings and provides a natural language interface for exploring conversations.

## Completed Work

### Phase 1: Tool Infrastructure ✅

Created the foundational tool system in `crates/inference/src/agent/`:

| File | Purpose |
|------|---------|
| `tools.rs` | `Tool` trait, `ToolRegistry`, `ToolCall`, `ToolResult`, `ToolCallRecord` types |
| `parser.rs` | Regex-based parsing of tool call formats (Qwen3 `<tool_call>`, bare JSON, legacy Phi-4 `<\|tool_call\|>`) |
| `prompts.rs` | System prompt generation with tool definitions in Qwen3 OpenAI format |
| `mod.rs` | `CasperAgent` struct, `AgentConfig`, `AgentResponse` |

### Phase 2: Built-in Tools ✅

Implemented 4 tools in `crates/inference/src/agent/builtin/`:

| Tool | File | Description |
|------|------|-------------|
| `list_contacts` | `list_contacts.rs` | Lists contacts from MetadataDb with search/filter options |
| `get_contact_stats` | `get_stats.rs` | Gets conversation statistics (message counts, dates, emoji usage) |
| `get_conversation_context` | `get_context.rs` | Gets messages around a specific date |
| `search_messages` | `search_messages.rs` | Semantic search over message embeddings via VectorDb |

### Phase 3: Query Embedding Support ✅

Extended the MLX Python daemon protocol to support query embedding:

| File | Changes |
|------|---------|
| `crates/inference/src/engines/mlx_python/protocol.rs` | Added `EmbedQuery` command and `Embedding` response variants |
| `crates/inference/src/engines/mlx_python/engine.rs` | Added `embed_query(&str) -> Vec<f32>` method |
| `mlx/src/entry/inference_daemon.py` | Added `handle_embed_query()` handler using ModernBERT |
| `crates/inference/src/config.rs` | Added `ChatMessage::tool_response()` constructor |

### Phase 4: Agent Loop ✅

Implemented the full agent loop in `CasperAgent`:

- `ask(question)` - Main entry point
- `ask_with_history(question, history)` - With conversation context
- Automatic embedding injection for `search_messages` tool calls
- Iterative loop: generate → parse → execute tools → format response → continue/respond
- Configurable `max_iterations` (default: 5)

Key implementation details:
- Engine is temporarily taken from agent during execution to avoid borrow conflicts
- Tool results are formatted with `<|tool_response|>...<|/tool_response|>` tokens
- Agent stops when LLM produces response without tool calls

### Phase 5: CLI Integration ✅

Added `brb ask` command:

| File | Changes |
|------|---------|
| `apps/cli/src/cli.rs` | Added `Ask` command variant with `question`, `--verbose`, `--max-iterations` |
| `apps/cli/src/commands/ask.rs` | Created `handle_ask()` with tokio runtime |
| `apps/cli/src/commands/mod.rs` | Exported `handle_ask` |
| `apps/cli/src/main.rs` | Registered `Ask` command |

Usage:
```bash
brb ask "who do I text the most?"
brb ask "what did Alice say about the party?" --verbose
brb ask "find messages about vacation" --max-iterations 10
```

### Phase 6: Desktop Backend ✅

Added Tauri command for desktop app:

| File | Changes |
|------|---------|
| `apps/desktop/src-tauri/src/commands/casper.rs` | Created `ask_casper` command with `CasperResponse` type |
| `apps/desktop/src-tauri/src/commands/mod.rs` | Exported `casper` module |
| `apps/desktop/src-tauri/src/lib.rs` | Registered `commands::casper::ask_casper` |

Tauri command signature:
```rust
#[tauri::command]
pub async fn ask_casper(
    question: String,
    max_iterations: Option<usize>,
) -> Result<CasperResponse, String>
```

Response type:
```rust
pub struct CasperResponse {
    pub answer: String,
    pub iterations: usize,
    pub duration_ms: u64,
    pub tool_calls: Vec<ToolCallInfo>,
}
```

## Files Created/Modified

### New Files
```
crates/inference/src/agent/
├── mod.rs              # CasperAgent, AgentConfig, AgentResponse
├── tools.rs            # Tool trait, ToolRegistry
├── parser.rs           # Tool call parsing
├── prompts.rs          # System prompt generation
└── builtin/
    ├── mod.rs          # Module exports
    ├── list_contacts.rs
    ├── get_stats.rs
    ├── get_context.rs
    └── search_messages.rs

apps/cli/src/commands/ask.rs
apps/desktop/src-tauri/src/commands/casper.rs
```

### Modified Files
```
crates/inference/src/lib.rs                    # Export agent module
crates/inference/Cargo.toml                    # Added ingestion, messages-db, regex, chrono deps
crates/inference/src/engines/mlx_python/protocol.rs  # EmbedQuery/Embedding
crates/inference/src/engines/mlx_python/engine.rs    # embed_query() method
crates/inference/src/config.rs                 # ChatMessage::tool_response()
mlx/src/entry/inference_daemon.py              # handle_embed_query()
apps/cli/src/cli.rs                            # Ask command
apps/cli/src/commands/mod.rs                   # Export ask
apps/cli/src/main.rs                           # Register Ask
apps/desktop/src-tauri/src/commands/mod.rs     # Export casper
apps/desktop/src-tauri/src/lib.rs              # Register ask_casper
```

## Pending Work

### Frontend Integration (Next Up)

The `SearchLayout.tsx` component exists but is currently disabled with "Coming Soon" badge. Need to:

1. **Enable the search input** - Remove `disabled` from input and button
2. **Wire up `ask_casper` call** - Call Tauri command on form submit
3. **Add loading state** - Show Casper thinking animation while agent runs
4. **Display results** - Show answer and optionally tool call details
5. **Handle errors** - Show friendly error messages
6. **Enable example queries** - Make clickable chips that populate input

File to modify: `apps/desktop/src/components/search/SearchLayout.tsx`

### Optional Enhancements

1. **Streaming responses** - Add `ask_casper_streaming` command that emits tokens
2. **Conversation history** - Allow follow-up questions with context
3. **Result caching** - Cache recent queries to avoid redundant agent runs
4. **Tool call visualization** - Show which tools were called in the UI
5. **Error recovery** - Retry logic for transient failures

## Architecture Notes

### Data Flow
```
User Question
    ↓
CasperAgent.ask()
    ↓
MLXPythonEngine.generate() → LLM Response
    ↓
parse_tool_calls() → ToolCall[]
    ↓
[For search_messages: inject_embeddings() via engine.embed_query()]
    ↓
execute_tool_calls() → ToolResult[]
    ↓
format_tool_response() → <|tool_response|>...<|/tool_response|>
    ↓
Continue loop until no tool calls → Final Answer
```

### Embedding Strategy

Query embeddings use the same ModernBERT model as ingestion:
- Model: `mlx-community/nomicai-modernbert-embed-base-8bit`
- Dimensions: 768
- Query prefix: `"search_query: "` (vs `"search_document: "` for indexing)
- IPC overhead: ~50ms (negligible vs inference time)

### Tool Call Format (Qwen3)

System prompt with tools:
```
<|system|>You are Casper...
<|tool|>[{"name": "list_contacts", "description": "...", "parameters": {...}}]<|/tool|><|end|>
```

Tool call from LLM:
```
<|tool_call|>[{"name": "search_messages", "arguments": {"query": "birthday"}}]<|/tool_call|>
```

Tool response back to LLM:
```
<|tool_response|>{"results": [...], "count": 5}<|/tool_response|>
```

## Test Results

All tests passing:
- `cargo test --package inference` - 35 tests
- `cargo test --package brb` - 0 tests (no CLI tests)
- `cargo check --package be-right-back` - compiles successfully

## Dependencies Added

`crates/inference/Cargo.toml`:
```toml
regex = "1.10"
ingestion = { path = "../ingestion" }
messages-db = { path = "../messages-db" }
chrono = { version = "0.4", features = ["serde"] }
```

## Usage Examples

### CLI
```bash
# Basic query
brb ask "who do I text the most?"

# Verbose mode (shows tool calls)
brb ask "what did Alice say about vacation?" --verbose

# Custom iteration limit
brb ask "find recent messages about dinner plans" --max-iterations 3
```

### Tauri (from frontend)
```typescript
import { invoke } from "@tauri-apps/api/core";

const response = await invoke<CasperResponse>("ask_casper", {
  question: "who do I text the most?",
  maxIterations: 5,
});

console.log(response.answer);
console.log(`Took ${response.iterations} iterations in ${response.duration_ms}ms`);
```

## Known Limitations

1. **No streaming** - Agent returns complete response, no token streaming yet
2. **No conversation memory** - Each query is independent
3. **Tool errors** - Some tools may fail if data isn't ingested
4. **Cold start** - First query spawns Python daemon (~2-3s startup)

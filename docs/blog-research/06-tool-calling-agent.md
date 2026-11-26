# Research Report: Building a Tool-Calling LLM Agent on Consumer Hardware

> Reference material for writing about the Casper agent — tool-calling, anti-loop, and local inference
> Generated: 2026-04-03

---

## What You Built

A tool-calling LLM agent ("Casper") that runs entirely on-device using Qwen3.5 (4-bit quantized, ~5GB). It has 5 built-in tools, an iterative tool-calling loop with max 3 iterations, anti-loop protections for degenerate model behavior, and JSON repair for truncated output. 1,240 lines of Rust.

---

## Agent Loop

```
1. Build system prompt with tool definitions (Qwen3 OpenAI-style format)
2. Generate LLM response
3. Parse response for <tool_call> tags or JSON tool calls
4. If tool calls found:
   a. Deduplicate identical calls within same response
   b. Execute tools in Rust
   c. Inject results as <|tool_response|> messages
   d. Go to step 2 (up to max_iterations=3)
5. If no tool calls → return final answer
```

---

## Built-in Tools

| Tool | What It Does | Implementation |
|------|-------------|----------------|
| `list_contacts` | Query MetadataDb for stored contacts | `agent/builtin/list_contacts.rs` |
| `search_messages` | Hybrid search (auto-embeds query) | `agent/builtin/search_messages.rs` (13 tests) |
| `get_conversation_context` | Temporal message fetching | `agent/builtin/get_context.rs` |
| `get_contact_stats` | Stats from MetadataDb | `agent/builtin/get_stats.rs` |
| `get_message_volume` | Message count over time | `agent/builtin/get_volume.rs` (4 tests) |

Tool definitions use Qwen3's OpenAI-compatible format:
```json
{
  "type": "function",
  "function": {
    "name": "search_messages",
    "description": "Search through message history...",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {"type": "string", "description": "..."},
        "contact_name": {"type": "string", "description": "..."}
      },
      "required": ["query"]
    }
  }
}
```

---

## Anti-Loop Protections

Small local models (4B-9B) are prone to degenerate behavior that cloud models rarely exhibit. Three protections:

### 1. Intra-Response Deduplication
- Same tool call repeated within a single response → execute once
- Happens when model generates `search_messages("restaurants")` three times

### 2. Cross-Iteration Repetition Detection
- Track tool call JSON from previous iterations
- If this iteration's tool calls are identical to last iteration's → force a final answer
- Model gets stuck calling the same tool with the same args repeatedly

### 3. Text Repetition Detection
- Compare first 50 characters of current response to previous responses
- If prefix matches → model is regenerating the same text
- Force-synthesize a final answer from available context

---

## JSON Repair

Small models frequently generate truncated or malformed JSON in tool calls:
```json
{"name": "search_messages", "arguments": {"query": "dinner plans", "contact_na
```

The parser attempts to fix:
- Missing closing braces/brackets
- Truncated string values
- Unmatched quotes
- Trailing commas

Implementation: `crates/inference/src/agent/parser.rs` (32 tests)

---

## Tool Call Parsing

Two parse strategies tried in order:

1. **XML-style `<tool_call>` tags** — Qwen3/3.5 native format
   ```
   <tool_call>
   {"name": "search_messages", "arguments": {"query": "restaurants"}}
   </tool_call>
   ```

2. **JSON object detection** — Fallback for when model omits tags
   - Scan response for `{"name":` patterns
   - Extract and parse JSON objects

Parser tests: 32 tests in `agent/parser.rs` covering edge cases.

---

## The System Prompt

The agent system prompt includes:
- Tool definitions in Qwen3 OpenAI format
- Instructions for when to use which tool
- Formatting guidance for final answers
- Explicit instruction to call tools before answering (prevent hallucination)

Key file: `crates/inference/src/agent/prompts.rs`

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Agent code | 1,240 lines (`agent/mod.rs`) |
| Parser tests | 32 (`agent/parser.rs`) |
| Search tool tests | 13 (`agent/builtin/search_messages.rs`) |
| Max iterations | 3 (configurable) |
| Default model | Qwen3.5-9B-4bit |
| Model size | ~5GB VRAM |
| Built-in tools | 5 |
| Text repeat prefix match | 50 characters |

---

## Known Gaps

| Gap | Status | Impact |
|-----|--------|--------|
| Simulated token streaming | `casper.rs:206` fakes streaming | UX — delayed responses |
| No cancellation | Frontend buttons exist, backend is no-op | Can't abort long queries |
| Token starvation with thinking mode | Documented in casper improvement strategy | Model wastes tokens "thinking" |
| Stop sequences not applied | Dead code identified | Model may not stop cleanly |

Detailed strategy: `docs/feature-plans/casper-agent-improvement-strategy.md`

---

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Agent loop + orchestration | `crates/inference/src/agent/mod.rs` | 1,240 |
| Tool call parser + JSON repair | `crates/inference/src/agent/parser.rs` | — (32 tests) |
| Tool definitions + registry | `crates/inference/src/agent/tools.rs` | — (3 tests) |
| System/tool prompts | `crates/inference/src/agent/prompts.rs` | — (2 tests) |
| search_messages tool | `crates/inference/src/agent/builtin/search_messages.rs` | — (13 tests) |
| get_conversation_context | `crates/inference/src/agent/builtin/get_context.rs` | — |
| get_contact_stats | `crates/inference/src/agent/builtin/get_stats.rs` | — |
| get_message_volume | `crates/inference/src/agent/builtin/get_volume.rs` | — (4 tests) |
| list_contacts | `crates/inference/src/agent/builtin/list_contacts.rs` | — |
| Tauri command | `apps/desktop/src-tauri/src/commands/casper.rs` | — |
| Frontend hook | `apps/desktop/src/hooks/useCasperAgent.ts` | — |

---

## Narrative Angles

1. **"Tool-calling on a 9B model: what breaks"** — Cloud models (GPT-4, Claude) handle tool calls gracefully. Small local models generate malformed JSON, repeat themselves, and waste tokens thinking. Here's every failure mode and how to handle it.

2. **"The 32 tests that keep the parser honest"** — JSON repair, XML tag extraction, fallback strategies. When your model can't generate valid JSON 100% of the time, your parser needs to be very forgiving.

3. **"3 iterations and you're done"** — Why capping at 3 tool-calling rounds works. Most useful queries resolve in 1-2 rounds. By round 3, the model is either stuck or has enough context.

4. **"Anti-loop patterns"** — Three layers of protection against degenerate behavior: intra-response dedup, cross-iteration repetition, and text prefix matching. Each addresses a distinct failure mode.

5. **"The local model trade-off"** — 50ms latency (local) vs 500ms (cloud API), but you trade reliability. The engineering complexity shifts from "how do I call an API" to "how do I handle a model that sometimes forgets what it's doing."

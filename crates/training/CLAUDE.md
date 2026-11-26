# training

Converts the user's iMessage conversations into "You" fine-tuning data (JSONL) and generates system prompts that capture the user's own texting personality. Users may only train a persona of themselves, never of another person.

## Workspace Role

Depends on `common` (shared types: `Conversation`, `Message`, `PersonaStats`, `ExportMetadata`, `TrainingExample`, `TrainingMessage`). Used by `apps/cli` and `apps/desktop`. Does not depend on `messages-db` -- callers fetch conversations first, then pass them here.

## Public API

All re-exported from `lib.rs`:

- `export_self_to_jsonl(conversations, output_path, progress_callback)` -- main JSONL export, across all of the user's 1:1 conversations
- `calculate_persona_stats(messages)` -- programmatic stats (emoji rate, punctuation, message lengths, response time)
- `sample_conversation_blocks(messages, target_pairs)` -- recency-weighted sampling for LLM analysis
- `sample_self_blocks(conversations, target_total)` -- samples blocks across the top 20 conversations and names the contact on each block
- `analyze_persona_with_llm(blocks)` -- calls Python `analyze_persona.py` in self-analysis mode (`contact_id: "you"`) via stdin/stdout JSON; returns `Option<String>` (gracefully returns `None` on any failure)
- `build_system_prompt(stats, llm_analysis)` -- assembles rich "You" system prompt from stats + LLM insights
- `build_fallback_prompt()` -- minimal "You" prompt when analysis unavailable
- Types: `ConversationBlock`, `SampledMessage`

## JSONL Export Pipeline

1. **Filter**: Removes messages < 2 chars, attachment-only (`\u{FFFC}`), non-alphanumeric-only
2. **Segment**: Splits each conversation by 4-hour silence gaps (`CONVERSATION_GAP_HOURS`). An example never mixes two conversations
3. **Start**: Each example starts with any message from the other person (`user`). There is no question filter
4. **Multi-turn**: Up to `MAX_TURNS_PER_EXAMPLE` (8) turns per example, must end with the user's own reply (`assistant`), non-overlapping
5. **Consecutive message merging**: Same-sender runs joined with `<MSG_BREAK>` token
6. **Cap**: Examples from all conversations are sorted by time; the most recent 50k are kept

Output format per line: `{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}`

Role mapping: `is_from_me=true` -> `"assistant"`, `is_from_me=false` -> `"user"`. The user is the persona being trained. `calculate_persona_stats` uses the same mapping. `ConversationBlock` keeps the older `is_from_me` -> `"user"` mapping, because the Python self-analysis prompt reads `role="user"` as the user's own messages.

## Sampling Strategy

`sample_conversation_blocks` uses exponential decay weighting (lambda=0.2) to bias toward recent conversations. Segments with < 3 messages are excluded. Weighted random sampling without replacement, results sorted chronologically.

## LLM Analysis

`analyze_persona_with_llm` spawns a Python subprocess (`analyze_persona.py` via `PythonEnvironment`), passes JSON on stdin, reads JSON from stdout. 5-minute timeout. All errors return `Ok(None)` -- never fails the pipeline.

## System Prompt Structure

`build_system_prompt` emits markdown sections: Instructions, Writing Style (from stats), Personality & Communication Style (from LLM), Message Format (explains `<MSG_BREAK>`), Style Guidelines, Critical Rules. Includes AI transparency clause. Thresholds: emoji_rate > 0.5 = "frequently", > 0.1 = "occasionally"; short_message_rate > 0.3 triggers short-message note; response_time < 5min = "very quickly".

## Constants (`constants.rs`)

| Constant | Value | Purpose |
|---|---|---|
| `MSG_BREAK_TOKEN` | `<MSG_BREAK>` | Separates consecutive same-sender messages |
| `MIN_MESSAGE_LENGTH` | 2 | Minimum chars to include a message |
| `MAX_TRAINING_EXAMPLES` | 50,000 | Cap on exported examples |
| `CONVERSATION_GAP_HOURS` | 4 | Hours of silence = new conversation |
| `MAX_TURNS_PER_EXAMPLE` | 8 | Max turn switches per training example |

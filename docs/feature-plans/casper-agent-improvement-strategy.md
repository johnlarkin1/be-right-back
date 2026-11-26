# Casper Agent Improvement Strategy

## Executive Summary

The Casper agent has three compounding problems that produce empty or low-quality responses:

1. **Token starvation**: Qwen3's thinking mode consumes the entire 1028-token budget before producing an answer
2. **Poor search quality**: Low similarity scores (0.30-0.36) due to chunking strategy and lack of recency weighting
3. **Dead code paths**: Stop sequences, multiple generation parameters, and a stop-sequence-aware generation method are all ignored

This document outlines a prioritized set of fixes and improvements.

---

## Problem 1: Empty Responses (Token Starvation)

### Root Cause

The Qwen3-4B-4bit model generates `<think>...</think>` blocks **before** any tool call or answer. These thinking tokens count against `max_tokens: 1028` (in `crates/inference/src/config.rs:117`). The model exhausts its token budget during internal reasoning and gets truncated before producing output.

After the parser strips the `<think>` block, the remaining text is empty, producing `answer_len=0`.

### Evidence from Logs

```
=== RAW RESPONSE ===
<think>
Okay, the user is asking "What was the last restaurant I went to?" ...
[~800 tokens of reasoning]
... but since there's no more recent mention, that might be the answer. However, I should check if any of the other entries have a more recent date that mentions a restaurant. The 2015-08-30 is earlier than the 2017-04-14. Wait, no: 2015 is earlier than 2017. So the latest in the list is 2015-08-30, then
=== END RESPONSE ===
```

The response is truncated mid-sentence inside the `<think>` block. No actual answer follows.

### Contributing Factors

| Factor | Current | Qwen3 Recommended | File |
|--------|---------|-------------------|------|
| `max_tokens` | 1028 | 32768 (or at least 4096) | `config.rs:117` |
| `temperature` | 0.2 | 0.6 (thinking) / 0.7 (non-thinking) | `config.rs:118` |
| `top_p` | 0.9 | 0.95 | `config.rs:119` |
| `top_k` | 40 | 20 | `config.rs:120` |
| `repetition_penalty` | 1.3 | use `presence_penalty: 1.5` instead | `config.rs:121` |

The Qwen3 model card explicitly warns: **"DO NOT use greedy decoding [temperature near 0], as it can lead to performance degradation and endless repetitions."**

### Fix Options

#### Option A: Disable thinking mode (Recommended for agent use)

Add `/no_think` to the end of the system prompt or beginning of the user message. This tells Qwen3 to skip the thinking phase and respond directly.

**Pros**: Dramatically reduces token usage, faster responses, simpler parsing
**Cons**: May slightly reduce reasoning quality on complex multi-step queries
**Effort**: Small - one line change in `prompts.rs`

```rust
// In build_system_prompt_qwen3_with_base(), append to system prompt:
format!("{}\n\n/no_think", system_prompt_content)
```

Or per the Qwen3 docs, add to user message:
```
<|im_start|>user
{question} /no_think<|im_end|>
```

#### Option B: Increase max_tokens significantly

Raise `max_tokens` from 1028 to 4096 or higher to accommodate thinking + response.

**Pros**: Preserves reasoning quality
**Cons**: Much slower generation (4x+ latency), higher memory usage, still wastes tokens on internal reasoning that the user never sees
**Effort**: Trivial - one constant change

#### Option C: Hybrid - disable thinking for tool calls, enable for final answer

Use `/no_think` during tool-calling iterations but allow thinking on the final synthesis. This keeps tool calls fast and accurate while allowing deeper reasoning for the answer.

**Pros**: Best of both worlds
**Cons**: More complex prompt management
**Effort**: Moderate - conditional prompt formatting per iteration

### Recommended Approach

**Option A (disable thinking)** for the agent. A 4B parameter model's "thinking" is not high-quality reasoning -- it's mostly restating the problem. The token budget is better spent on actual output. If quality is insufficient without thinking, move to Option C.

---

## Problem 2: Stop Sequences Not Applied (Dead Code)

### Root Cause

`GenerationConfig::agent()` defines stop sequences including `"</tool_call>"`, but:

1. `handle_generate()` in `inference_daemon.py` (line 200) **never reads `stop_sequences` from the request data**
2. The method `_generate_with_stop_sequences()` (line 349) exists and correctly implements stop-sequence handling via `stream_generate` with manual detection, but **it is never called**
3. Several other parameters (`top_k`, `frequency_penalty`, `presence_penalty`) are sent but also ignored

### Impact

Without the `"</tool_call>"` stop sequence, the model continues generating past the tool call JSON, wasting tokens on content that gets discarded by the parser. This compounds the token starvation issue.

### Fix

Wire up stop sequences in `handle_generate()`:

```python
# In handle_generate(), after reading other params:
stop_sequences = data.get("stop_sequences", [])

# Option 1: Use existing _generate_with_stop_sequences method
if stop_sequences:
    response = self._generate_with_stop_sequences(prompt, max_tokens, sampler, stop_sequences)
else:
    response = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens, sampler=sampler)
```

Also extract and apply: `top_k`, `frequency_penalty`, `presence_penalty`.

---

## Problem 3: Poor Search Quality

### Current Architecture

```
User Query -> Embed with "search_query: " prefix
                                            |
                              cosine_similarity(query_embedding, chunk_embedding)
                                            |
Stored Chunks <- 5 messages concatenated, embedded with "search_document: " prefix
```

### Issues Identified

#### 3a. Chunk content lacks structure

**Current**: Chunks store raw concatenated message text without sender names, timestamps, or conversation context.

```
"That's open til 8 I'm pretty sure\nsharples isn't cooking?\nhaha damn..."
```

**Problem**: The embedding model can't distinguish who said what, when, or in what context. Searching for "restaurant I went to" has weak semantic overlap with raw chat fragments.

**Fix**: Include structured metadata in the embedded text:

```
[2024-01-15] Conversation with Alice:
Alice: Want to try that new Italian place?
You: Sounds good! Let's go to Olive Garden
Alice: Perfect, 7pm?
You: Works for me
```

This gives the embedding model much richer semantic content to match against.

**Files to change**:
- `mlx/src/pipelines/embedding.py` - `create_chunks()` function
- `mlx/src/data/storage.py` - `chunk_data` formatting

#### 3b. No recency weighting

**Current**: Results ordered by `similarity DESC, end_timestamp DESC`. Recency only breaks ties.

**Problem**: For "last restaurant" queries, a 2015 message with 0.36 similarity beats a 2024 message with 0.35 similarity, even though the user clearly cares about recency.

**Fix Options**:

1. **Time-decay boosting**: Apply a temporal decay factor to similarity scores

   ```sql
   SELECT *,
     array_cosine_similarity(embedding, ?::FLOAT[768]) *
     (1.0 + 0.1 * LN(1 + EPOCH(end_timestamp) / 86400.0)) as boosted_score
   ORDER BY boosted_score DESC
   ```

2. **Configurable recency weight**: Let the search tool specify a recency preference

   ```rust
   pub struct SearchOptions {
       recency_weight: f64,  // 0.0 = pure similarity, 1.0 = pure recency
   }
   ```

3. **Date-aware query rewriting**: When the query contains temporal language ("last", "recent", "yesterday"), automatically add `min_date` or `max_date` filters.

**Recommended**: Option 1 (logarithmic time boost) + Option 3 (automatic date filtering for temporal queries). The agent's system prompt should also instruct it to use date filters when temporal language is detected.

**Files to change**:
- `crates/ingestion/src/queries.rs` - `build_search_query()`
- `crates/ingestion/src/search.rs` - `SearchOptions`
- `crates/inference/src/agent/builtin/search_messages.rs` - tool description update

#### 3c. Small non-overlapping chunks

**Current**: 5 messages per chunk, stride 5 (no overlap), minimum 10 characters.

**Problem**: Short iMessage conversations produce tiny chunks with little semantic content. Non-overlapping windows can split relevant conversations across chunks.

**Fix**: Increase window size and add overlap:

```python
class EmbeddingConfig:
    chunk_window_size: int = 10      # Was 5 - more context per chunk
    chunk_stride: int = 5            # Was 5 - 50% overlap for better coverage
    min_chunk_chars: int = 50        # Was 10 - skip trivially short chunks
```

**Trade-off**: More chunks = more storage and slightly slower search, but significantly better recall.

**Files to change**:
- `mlx/src/config/embedding.py` - chunk parameters
- Requires re-ingestion of all data

#### 3d. No keyword/hybrid search fallback

**Current**: Pure vector similarity search only.

**Problem**: Semantic search works well for conceptual queries ("how's the weather been?") but poorly for entity queries ("Olive Garden", "Dr. Smith"). If the user asks about a specific restaurant name, vector similarity may miss it while exact text matching would find it instantly.

**Fix**: Add BM25 or keyword search as a fallback/complement:

```sql
-- DuckDB supports full-text search via the fts extension
INSTALL fts;
LOAD fts;

-- Create a full-text index on chunk text
PRAGMA create_fts_index('message_chunks', 'chunk_id', 'chunk_text');

-- Hybrid search: combine vector similarity with keyword relevance
SELECT *,
  0.7 * array_cosine_similarity(embedding, ?) +
  0.3 * fts_main_message_chunks.match_bm25(chunk_id, ?) as hybrid_score
ORDER BY hybrid_score DESC
```

**Effort**: Moderate - requires DuckDB FTS extension setup and hybrid ranking logic
**Files to change**:
- `crates/ingestion/sql/duckdb_schema.sql` - add FTS index
- `crates/ingestion/src/queries.rs` - hybrid search query
- `crates/ingestion/src/search.rs` - combine results

#### 3e. Contact name resolution in results

**Current**: Some results show raw phone numbers instead of contact names (e.g., `"2036446876"` instead of the actual name).

**Fix**: Ensure contact name resolution always works. The current fallback chain in `search_messages.rs` (lines 192-225) should be more robust.

---

## Problem 4: Agent Loop Not Iterating Effectively

### Current Behavior

The agent made 1 tool call, received results, then the model exhausted tokens trying to reason about results in its `<think>` block. The loop "completed" in 2 iterations but the second iteration produced no output.

### Ideal Behavior

1. Search "restaurant" -> get results
2. Notice results are old/low-relevance -> refine search with date filters or different query
3. Maybe search for specific restaurant names found in initial results
4. Synthesize a clear answer with dates and context

### Fixes

#### 4a. Better system prompt for iterative behavior

Add explicit instructions for search refinement:

```
When initial search results are not satisfactory:
- Try different query phrasings
- Use date filters to narrow results (min_date, max_date)
- Search for specific names, places, or topics found in initial results
- Use get_conversation_context to see surrounding messages for promising results

Always provide your answer OUTSIDE of any thinking blocks.
When you have enough information to answer, respond directly to the user.
```

#### 4b. Synthesis prompt improvement

When max iterations are reached, the current `SYNTHESIS_PROMPT` (in `mod.rs`) asks the model to synthesize from tool results. This should be improved to:

```
Based on the tool results above, provide a direct answer to the user's question.
Be specific - cite dates, names, and quotes from the results.
If the results don't fully answer the question, say so and suggest what the user could try.
/no_think
```

The `/no_think` directive on the synthesis prompt is critical to ensure the model doesn't waste its final chance on more reasoning.

#### 4c. Inject current date into system prompt

The agent doesn't know what "today" is. Add the current date to the system prompt so temporal queries ("last week", "recently") can be grounded:

```
Today's date is {current_date}.
```

This enables the model to set appropriate `min_date`/`max_date` filters.

---

## Problem 5: Generation Parameter Mismatches

### Parameters Sent but Ignored by Python Daemon

| Parameter | Sent from Rust | Read in Python | Status |
|-----------|---------------|----------------|--------|
| `max_tokens` | Yes | Yes | Working |
| `temperature` | Yes | Yes | Working |
| `top_p` | Yes | Yes | Working |
| `repetition_penalty` | Yes | Yes | Working (via `make_sampler`) |
| `stop_sequences` | Yes | **No** | DEAD |
| `top_k` | Yes | **No** | DEAD |
| `frequency_penalty` | Yes | **No** | DEAD |
| `presence_penalty` | Yes | **No** | DEAD |
| `repetition_context_size` | Yes | **No** | DEAD |

### Fix

Update `handle_generate()` in `inference_daemon.py` to read and apply all parameters:

```python
stop_sequences = data.get("stop_sequences", [])
top_k = data.get("top_k", 0)
frequency_penalty = data.get("frequency_penalty", 0.0)
presence_penalty = data.get("presence_penalty", 0.0)

# Pass to make_sampler:
sampler = make_sampler(temp=temperature, top_p=top_p, top_k=top_k)

# Pass to make_logits_processors:
logits_processors = make_logits_processors(
    repetition_penalty=repetition_penalty,
    repetition_context_size=20,
)
```

---

## Implementation Priority

### Phase 1: Critical Fixes (Unblock the agent)

These fixes address the empty response problem and should be done first:

| # | Fix | Impact | Effort | Files |
|---|-----|--------|--------|-------|
| 1 | Disable Qwen3 thinking mode (`/no_think`) | Eliminates token starvation | Small | `prompts.rs` |
| 2 | Increase `max_tokens` to 2048 as safety net | Prevents truncation even with thinking | Trivial | `config.rs` |
| 3 | Fix temperature to 0.6 | Prevents repetition loops | Trivial | `config.rs` |
| 4 | Wire up stop sequences in daemon | Stops generation at `</tool_call>` | Small | `inference_daemon.py` |
| 5 | Inject current date into system prompt | Enables temporal query reasoning | Trivial | `prompts.rs` |

### Phase 2: Search Quality (Better results)

| # | Fix | Impact | Effort | Files |
|---|-----|--------|--------|-------|
| 6 | Add structured metadata to chunks | Better embeddings for conversational content | Medium | `embedding.py`, `storage.py` |
| 7 | Add recency weighting to search | Recent results rank higher | Small | `queries.rs` |
| 8 | Increase chunk size + add overlap | Better context per chunk | Small | `embedding.py` (+ re-ingestion) |
| 9 | Automatic date filtering for temporal queries | "Last restaurant" searches recent messages | Medium | `search_messages.rs` |
| 10 | Fix contact name resolution | Display names not phone numbers | Small | `search_messages.rs` |

### Phase 3: Advanced Improvements (Best-in-class agent)

| # | Fix | Impact | Effort | Files |
|---|-----|--------|--------|-------|
| 11 | Hybrid search (vector + BM25 keyword) | Finds entity names that vector search misses | Large | `duckdb_schema.sql`, `queries.rs`, `search.rs` |
| 12 | Improved system prompt with refinement instructions | Better multi-step search behavior | Small | `prompts.rs` |
| 13 | Real streaming (not simulated) | Better UX during generation | Large | `casper.rs`, `mod.rs` |
| 14 | Query rewriting / expansion | LLM rewrites query before search | Medium | New tool or pre-processing step |
| 15 | Multi-query search | Run multiple queries in parallel | Medium | `search_messages.rs` |
| 16 | Wire up all ignored generation parameters | Full control over generation | Small | `inference_daemon.py` |

---

## Architecture Diagram: Current vs. Improved

### Current Flow

```
User Question
    |
    v
[Qwen3 + <think>...think...think...] -> truncated at 1028 tokens -> empty answer
    |
    v
search_messages("last restaurant", limit=10)
    |
    v
DuckDB: cosine_similarity(query, chunks) ORDER BY similarity DESC
    |
    v
[Old messages from 2015 with 0.30-0.36 similarity]
    |
    v
[Qwen3 + <think>...think...think...] -> truncated again -> answer_len=0
```

### Improved Flow

```
User Question + current date context
    |
    v
[Qwen3 /no_think] -> immediate tool call (fast, no wasted tokens)
    |
    v
search_messages("restaurant dinner plans", limit=10, min_date="2024-01-01")
    |                    ^-- automatic date filter for "last" query
    v
DuckDB: cosine_similarity * recency_boost ORDER BY boosted_score DESC
    |          ^-- structured chunks with sender names + dates
    v
[Recent, relevant results with 0.5+ similarity]
    |
    v
[Qwen3 /no_think] -> concise, grounded answer with dates and quotes
```

---

## Key Files Reference

| File | Path | Role |
|------|------|------|
| Agent loop | `crates/inference/src/agent/mod.rs` | Core iteration, tool execution |
| Parser | `crates/inference/src/agent/parser.rs` | Tool call extraction, thinking removal |
| Prompts | `crates/inference/src/agent/prompts.rs` | System prompts for Qwen3 |
| Config | `crates/inference/src/config.rs` | `max_tokens`, temperature, stop sequences |
| Search tool | `crates/inference/src/agent/builtin/search_messages.rs` | Semantic search tool |
| Context tool | `crates/inference/src/agent/builtin/get_context.rs` | Conversation context tool |
| Python daemon | `mlx/src/entry/inference_daemon.py` | Generation, prompt formatting, embedding |
| Embedding pipeline | `mlx/src/pipelines/embedding.py` | Chunking and embedding logic |
| Embedding config | `mlx/src/config/embedding.py` | Chunk size, stride, model settings |
| Vector DB | `crates/ingestion/src/vectordb.rs` | DuckDB management |
| Search queries | `crates/ingestion/src/queries.rs` | SQL query building |
| Search logic | `crates/ingestion/src/search.rs` | Dedup, ranking |
| Storage | `mlx/src/data/storage.py` | Chunk data formatting for DuckDB |
| Tauri command | `apps/desktop/src-tauri/src/commands/casper.rs` | Frontend integration |
| Frontend hook | `apps/desktop/src/hooks/useCasperAgent.ts` | React hook for Casper |
| Constants | `crates/common/src/constants.rs` | Model defaults |

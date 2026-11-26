---
title: "Casper - The Agent System"
shortTitle: "Casper Agent"
slug: casper-agent
order: 6
description: "How Casper orchestrates query planning, hybrid search, reranking, and context building to answer questions about your messages."
---

## Overview

Our [vector search section][vector-search-rag] handles retrieval for a given query. It is not yet "agentic" (buzzword flag).

To make Casper helpful, we need tools and guardrails that surface useful information. Otherwise it would just return the best-matching chunk, which is basically the output of [our vector search][vector-search-rag].

## Agent Loop

You can kinda think of this section as Casper's heart. It's the core [agent loop][agent-loop]: it holds a set of tools, chooses which to call, and eventually returns a response to the user.

Casper, our beloved yet slightly dark mascot for this time sink of a side project, runs up to 5 iterations by default. It basically is this...

```rust
pub async fn ask_with_history_progress(
    &mut self,
    question: &str,
    history: &[ChatMessage],
    progress: Option<&dyn Fn(AgentProgressEvent)>,
) -> Result<AgentResponse> {
    // Enrich question with temporal extraction, contact prefetching
    let enriched = self.enrich_question(question).await?;
    
    for iteration in 0..self.config.max_iterations {
        let response = self.engine.generate(&messages, &config).await?;
        
        let parsed = parse_tool_calls(&response);
        
        if parsed.tool_calls.is_empty() {
            // Model returned a direct answer
            return Ok(AgentResponse::from_text(parsed.text));
        }
        
        // Execute tool calls, append results, continue loop
        for tool_call in &parsed.tool_calls {
            let result = self.execute_tool_call(tool_call).await?;
            messages.push(ChatMessage::tool_response(result));
        }
    }
    
    // Max iterations reached — synthesize from what we have
    self.synthesize_answer(&messages).await
}
```

<details>
<summary>Hating on "basically" there? Fine, this is the actual function:</summary>

```rust
/// Ask with conversation history and a progress callback.
    ///
    /// Same as `ask_with_history` but emits `AgentProgressEvent`s in real-time
    /// via the provided callback, allowing callers to forward events to a UI.
    pub async fn ask_with_history_progress<F: FnMut(AgentProgressEvent)>(
        &mut self,
        question: &str,
        history: &[ChatMessage],
        mut progress: F,
    ) -> Result<AgentResponse> {
        let start = Instant::now();

        let system_prompt = self.build_system_prompt();
        let max_iterations = self.config.max_iterations;
        let generation_config = self.config.generation_config.clone();
        let mut messages = vec![ChatMessage::system(&system_prompt)];

        // TODO(@larkin): would lvoe not to clone here
        messages.extend(history.iter().cloned());

        // yeah, i know this is bad... 
        // 
        // for inferential questions (relationship, frequency, "who" questions),
        // automatically prefetch top contacts so the LLM has frequency data
        // without needing to call list_contacts itself. This compensates for
        // smaller models that may not follow multi-step tool strategies.
        let enriched_question = if Self::is_inferential_question(question) {
            info!("Detected inferential question, prefetching top contacts");
            match self.prefetch_top_contacts() {
                Some(context) => format!("{}\n\n{}", question, context),
                None => question.to_string(),
            }
        } else {
            question.to_string()
        };

        // Add the current question (with optional context enrichment)
        messages.push(ChatMessage::user(&enriched_question));

        info!(question = question, "Starting agent loop");
        let mut engine = self.engine.take().ok_or(InferenceError::NotInitialized)?;
        debug!("Using Qwen3 model for agent");
        let model_to_load = Some(DEFAULT_MLX_AGENT_MODEL);

        // Load the model (hot-swap if needed)
        if let Err(e) = engine.load_model_with_override(model_to_load) {
            self.engine = Some(engine);
            return Err(e);
        }

        let mut all_tool_calls = Vec::new();
        let mut iterations = 0;
        let mut previous_responses: Vec<String> = Vec::new();
        let mut last_tool_call_json: Option<String> = None;

        let result = loop {
            iterations += 1;

            if iterations > max_iterations {
                warn!(
                    iterations = iterations,
                    max = max_iterations,
                    "Exceeded max iterations, running synthesis pass"
                );

                // if we've hit our max, we'll just synthesis and report back
                messages.push(ChatMessage::user(prompts::SYNTHESIS_PROMPT));
                let synthesis = match engine.generate(&messages, &generation_config).await {
                    Ok(r) => {
                        info!(
                            raw_len = r.len(),
                            raw_preview = %r.chars().take(300).collect::<String>(),
                            "Synthesis pass raw response"
                        );
                        // Parse to extract just the text (ignore any accidental tool calls)
                        let text = match parse_tool_calls(&r) {
                            Ok(parsed) => {
                                info!(
                                    has_thinking = parsed.thinking.is_some(),
                                    has_tool_calls = parsed.has_tool_calls,
                                    text_len = parsed.final_text().len(),
                                    "Synthesis pass parsed"
                                );
                                parsed.final_text()
                            }
                            Err(_) => r,
                        };
                        // Guard against empty synthesis (model generated only <think> block
                        // with no answer text). Fall back to tool result summary.
                        if text.trim().is_empty() {
                            warn!("Synthesis pass returned empty text, falling back to tool result summary");
                            Self::synthesize_from_tool_results(&all_tool_calls)
                        } else {
                            text
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "Synthesis generation failed, using fallback");
                        "I gathered some information but couldn't complete the full analysis. Please try a more specific question.".to_string()
                    }
                };

                break Ok(AgentResponse {
                    answer: synthesis,
                    tool_calls: all_tool_calls,
                    iterations,
                    duration_ms: start.elapsed().as_millis() as u64,
                    thinking: None,
                });
            }

            progress(AgentProgressEvent::Thinking {
                iteration: iterations,
                max_iterations,
            });

            debug!(iteration = iterations, "Generating LLM response");
            let response = match engine.generate(&messages, &generation_config).await {
                Ok(r) => r,
                Err(e) => {
                    self.engine = Some(engine);
                    return Err(e);
                }
            };

            info!(
                iteration = iterations,
                response_len = response.len(),
                response_preview = %response.chars().take(300).collect::<String>(),
                "LLM response received"
            );

            // Parse the response for tool calls first (before repetition check)
            // This way we can distinguish between repeated tool calls and repeated answers
            let parsed = match parse_tool_calls(&response) {
                Ok(p) => p,
                Err(e) => {
                    self.engine = Some(engine);
                    return Err(e);
                }
            };

            if parsed.has_tool_calls {
                let current_tool_json = serde_json::to_string(&parsed.tool_calls).ok();
                if let (Some(current), Some(last)) = (&current_tool_json, &last_tool_call_json)
                    && current == last
                {
                    let last_result = all_tool_calls
                        .last()
                        .map(|r| {
                            if r.result.success {
                                format!(
                                    "Based on the tool results, I couldn't find the information you're looking for. {}",
                                    r.result.data.get("note").and_then(|n| n.as_str()).unwrap_or("")
                                )
                            } else {
                                "I encountered an error while searching. Please try again.".to_string()
                            }
                        })
                        .unwrap_or_else(|| "I was unable to find the requested information.".to_string());

                    break Ok(AgentResponse {
                        answer: last_result,
                        tool_calls: all_tool_calls,
                        iterations,
                        duration_ms: start.elapsed().as_millis() as u64,
                        thinking: parsed.thinking.clone(),
                    });
                }
                last_tool_call_json = current_tool_json;

                info!(
                    count = parsed.tool_calls.len(),
                    iteration = iterations,
                    "Executing tool calls"
                );

                // Inject embeddings for search_messages calls.
                // Run on a blocking thread because embed_query() does synchronous
                // socket I/O to the Python daemon, which would starve the tokio
                // executor under concurrent queries.
                let question_owned = question.to_string();
                let tool_calls = parsed.tool_calls;
                let (engine_back, calls_result) =
                    tokio::task::spawn_blocking(move || {
                        let result = CasperAgent::inject_embeddings(
                            &mut engine,
                            tool_calls,
                            &question_owned,
                        );
                        (engine, result)
                    })
                    .await
                    .map_err(|e| {
                        InferenceError::BackendError(format!(
                            "embedding task panicked: {e}"
                        ))
                    })?;
                engine = engine_back;
                let calls = match calls_result {
                    Ok(c) => c,
                    Err(e) => {
                        self.engine = Some(engine);
                        return Err(e);
                    }
                };

                let (mut records, _) = self.execute_tool_calls_with_progress(&calls, iterations, &mut progress);

                // here's our lovely cross encoder rerank
                Self::rerank_search_results(&mut engine, &mut records);
                let formatted_response = Self::format_tool_records(&records);
                all_tool_calls.extend(records);

                // Add assistant message with ONLY the tool calls in Qwen3.5 XML format
                // Don't include any hallucinated text that came after the tool call
                let tool_call_xml = parser::format_tool_calls_xml(&calls);
                messages.push(ChatMessage::assistant(&tool_call_xml));
                messages.push(ChatMessage::tool_response(&formatted_response));
                previous_responses.push(response.clone());
            } else {
                let answer = parsed.final_text();

                // yes yes... i know this is also jank
                // small model problems
                //
                // Detect empty responses (model generated only <think></think> + EOS).
                // Common with small quantized models on simple/meta questions.
                // Nudge the model to actually respond.
                if iterations < max_iterations && answer.trim().is_empty() {
                    warn!(
                        iteration = iterations,
                        "Detected empty response, nudging model to answer"
                    );

                    messages.push(ChatMessage::assistant(&response));
                    messages.push(ChatMessage::user(
                        "Please respond to the user's question directly with a helpful answer.",
                    ));
                    previous_responses.push(response.clone());
                    continue;
                }

                // Detect when the model narrates intent to search instead of
                // actually calling tools (common small-model failure mode).
                // If the answer reads like a plan ("Let me search...", "I'll try...")
                // and we haven't exhausted iterations, nudge it to act.
                if iterations < max_iterations && Self::is_narrated_intent(&answer) {
                    warn!(
                        answer_preview = %answer.chars().take(120).collect::<String>(),
                        iteration = iterations,
                        "Detected narrated intent instead of tool call, nudging model to act"
                    );

                    messages.push(ChatMessage::assistant(&response));
                    messages.push(ChatMessage::user(
                        "Don't describe what you plan to do — actually call the tool now. \
                         Use <tool_call> to search.",
                    ));
                    previous_responses.push(response.clone());
                    continue;
                }

                progress(AgentProgressEvent::Answering);
                let mut answer = answer;
                if Self::is_repetitive(&answer, &previous_responses) {
                    warn!(
                        answer_preview = %answer.chars().take(100).collect::<String>(),
                        "Detected repetitive text answer, synthesizing from tool results"
                    );
                    answer = Self::synthesize_from_tool_results(&all_tool_calls);
                }
                if answer.trim().is_empty() {
                    warn!("Final answer is empty, falling back to tool result summary");
                    answer = Self::synthesize_from_tool_results(&all_tool_calls);
                }

                info!(
                    iterations = iterations,
                    answer_len = answer.len(),
                    "Agent reached final answer"
                );

                let duration_ms = start.elapsed().as_millis() as u64;

                break Ok(AgentResponse {
                    answer,
                    tool_calls: all_tool_calls,
                    iterations,
                    duration_ms,
                    thinking: parsed.thinking,
                });
            }
        };
        self.engine = Some(engine);
        result
    }
```

</details>


### Loop Protections

I won't go through them here. If you expand the collapsible section, you'll see a few small-model problems that we guard against. I'm confident we won't need these guards by Qwen 4.5. Until then, feel free to rip apart my (and Claude's) code.

::playground[agent-loop]{label="Step through the agent loop" preview="Replay real-shaped traces — think → tool call → tool result → answer — and watch the anti-loop guards trip when the model repeats itself or narrates instead of acting."}

## Tools

What is an agent without tools? A pretty fucking bad agent.

Casper has 5 tools. All of them are Rust functions.

### `search_messages`

This is the primary tool. It calls the [search pipeline][vector-search-rag] with basically this payload:

```json
{
  "name": "search_messages",
  "parameters": {
    "query": "Thanksgiving dinner plans",
    "contact_id": "+15551234567",
    "limit": 7,
    "min_date": "2025-11-01",
    "max_date": "2025-11-30"
  }
}
```

Before the search runs, we inject an embedding vector for the query. The LLM never sees this step. It writes the query text, and the agent handles the embedding.

### `list_contacts`

Lists contacts so the model can inspect them.

### `get_contact_stats`
Returns aggregated stats for one contact: message counts, date ranges, emoji usage, average response time, yadda yadda. These stats are precomputed in `brb.db`.

### `get_conversation_context`
Retrieves messages around a specific point in time. Useful for "what happened around or after X?"

### `get_message_volume_by_period`

Aggregates message volume per contact in a date range. Used for "life period" questions like "who did I talk to most in college?"

> [!NOTE]
> If you're thinking, "John! It's 2026! Opus 4.8! Models are smart! Give it the DuckDB and SQLite schemas and let it write text-to-SQL queries on the fly," yeah. A couple of points.
> 1. That will be slower. Every choice here is a tradeoff.
> 2. These models are SMALL. This is not a $1T company with some of the best and brightest minds working on it. This is me, using an EXCELLENT small model from a small lab, building this at 11:48pm on a Saturday night. Give me a break.

## Query Planning

Again, the hard part was working around small-model quirks that frontier models handle for free. For example, the `search_messages` payload has `min_date` and `max_date`. You'd expect the model to see those and infer the right range. In practice, Qwen didn't always manage it.

So a planner step, a little hacky, takes a crack at extracting the date range first. A friend at OpenAI likes to say you'd be stunned how much regex still props up core workflows. So our approach is regex first, with an LLM fallback.

### Regex first

Again, I know. This is not the best. There are 18 regex patterns. But it's sweet, sweet deterministic code that I can unit test and clearly understand. A snippet:

```rust
static RE_YESTERDAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\byesterday\b").unwrap());
static RE_TODAY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\btoday\b").unwrap());
static RE_LAST_WEEK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+week\b").unwrap());
static RE_THIS_WEEK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+week\b").unwrap());
static RE_LAST_MONTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+month\b").unwrap());
static RE_THIS_MONTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+month\b").unwrap());
static RE_THIS_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bthis\s+year\b").unwrap());
static RE_LAST_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\blast\s+year\b").unwrap());
static RE_IN_YEAR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bin\s+(20\d{2})\b").unwrap());
```

### Fallback

Regex does not catch everything. Take a query like `when covid started`. No pattern of mine catches that.

I threw together a golden set of queries, and regex scored 21/31 (68%). So when regex finds nothing, a `temporal_hint` check asks "does this mention time?" If it does, we make one LLM call to extract the range as JSON.

> [!NOTE]
> Fun bug I hit here: `enable_thinking=false` in the daemon was a no-op. The model was burning its whole token budget *thinking* before it ever emitted the JSON. Turns out you have to inject an empty `<think></think>` block to actually shut it up — which is exactly what `apply_chat_template(enable_thinking=False)` does under the hood. Once that was fixed the planner call dropped to ~0.3s average, and it only fires on regex misses anyway.

### Merge: regex always wins

The LLM is only a fallback, but we hit it a good amount. If regex finds a match, we keep it and stop there. The hybrid approach does far better on the golden set.

Net result on the golden set:

| | regex only | hybrid |
|---|---|---|
| in-distribution | 100% | 100% |
| paraphrases | 17% | 75% |
| overall | 68% | **90%** |


### Recency Boost

One more product decision. When we detect recency phrases like "last" or "latest", we set `prefer_recent = true`. After retrieval, each result gets an exponential decay multiplier:

$$ \text{decay} = e^{-0.03 * \text{age}_{\text{days}}} $$

## Tool Calling Format

Again, we run the incredible [Qwen 3.5][qwen35] model. But when I started this project, we were on Qwen3. That's how fucking long it's taken me.

I bring this up because the tool-calling format changed between them.

Qwen3 wrapped tool calls as JSON inside `<tool_call>` tags. That format is fairly familiar, at least from what I've seen.

```
<tool_call>
{"name": "search_messages", "arguments": {"query": "thanksgiving plans", "limit": 7}}
</tool_call>
```

Qwen3.5 axed that. I'm not sure why, although I've read that language models handle XML better.

:unfurl[https://docs.morphllm.com/guides/xml-tool-calls]{title="XML Tool Calls" site="https://docs.morphllm.com/" icon="M"}

XML does cost more tokens than JSON. Regardless, here is the equivalent call:

```
<tool_call>
<function=search_messages>
<parameter=query>
thanksgiving plans
</parameter>
<parameter=limit>
7
</parameter>
</function>
</tool_call>
```

### Parser Dialects

This is a borderline insane amount of tech debt for a one-year-old side project. Maybe it's a symptom of the times, or of agentic tooling. Either way, Qwen3.5 did not always emit a reliable format.

There's a [confirmed upstream badcase][qwen-toolcall-bug] where 3.5 flip-flops between JSON and XML tool calls — worst on the 9B model with reasoning mode on. This is *exactly* the configuration Casper runs. The maintainers reproduced it, tagged it `badcase-confirmed`, and the issue is now closed against the Qwen3.6 repo, so 3.6 looks meant to put this to bed. I'm not sure yet, because I haven't run 3.6 locally.

So the TL;DR is that our parser still handles four formats:

1. **Qwen3.5 XML** — `<tool_call><function=name><parameter=p>val</parameter></function></tool_call>` (the native format)
2. **Legacy wrapped** — `<|tool_call|>[{...}]<|/tool_call|>`
3. **Qwen3 JSON wrapped** — `<tool_call>{"name": ..., "arguments": ...}</tool_call>`
4. **Bare JSON** — `[{"name": ..., "parameters": ...}]` with no tags at all


> [!NOTE]
> None of this is Qwen's fault, by the way. Part of it is the tax you pay for running a 4-bit quantized model on a laptop instead of calling an API backed by a $1T company's inference stack.

## Daemon Architecture

Casper runs on its own inference daemon, separate from the persona chat. It loads the base model with no LoRA adapter, because it doesn't need to sound like you. It only needs to call tools. Thanks to that separation, you can run a search while a persona reply is mid-generation. The daemon lifecycle itself is its own rabbit hole. I'll discuss that more in the [inference system][inference-system] section.

[comment]: <> (Bibliography)
[vector-search-rag]: /how-its-built/vector-search-rag
[agent-loop]: https://docs.temporal.io/ai-cookbook/agentic-loop-tool-call-claude-python
[qwen35]: https://huggingface.co/mlx-community/Qwen3.5-9B-4bit
[qwen-toolcall-bug]: https://github.com/QwenLM/Qwen3.6/issues/125
[inference-system]: /how-its-built/inference-system
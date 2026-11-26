# Persona Fidelity Eval

Measures whether a trained persona adapter fits the real person better than the base model.
Training loss cannot answer that. A no-op adapter still reports a loss.

Every metric runs twice on the same held-out examples:

- **base**: the base model with the adapter switched off (every LoRA scale set to 0).
- **adapter**: the same weights with the adapter on.

The eval reports the gap. It does not produce a 0-100 "sounds like them" score (issue #228 rules that out).

## Run

The eval loads the model with MLX, so it runs on an Apple Silicon Mac.
To score a persona, run:

```bash
make eval-persona PERSONA=<persona id or dir>
make eval-persona PERSONA=<id> ARGS="--generate 0"            # perplexity only, fastest
make eval-persona PERSONA=<id> ARGS="--max-examples 0"        # score every held-out example
```

The report lands in `<persona dir>/fidelity/<timestamp>/` as `report.json` and `report.md`.
Both hold real messages. Never commit them.

The script also prints JSON lines on stdout (`fidelity_progress`, then `fidelity_complete`), the same way other MLX scripts talk to Rust.

## Held-out set

Training now splits train/val with a seeded shuffle (`mlx/src/fidelity/heldout.py`).
After training succeeds, it writes the held-out indices and a SHA-256 of `train.jsonl` to `<persona dir>/heldout.json`.
The eval scores only those examples, so the adapter never trained on them.

`train.jsonl` lives in the shared `data/processed/` folder, and each export overwrites it.
The export keeps only the newest 50,000 examples, so a re-export can keep the count and still shift every index.
The eval therefore refuses data whose count or hash differs from `heldout.json`. Retrain to evaluate again.

Before this change, training held out the chronological tail: the newest 10%.
For a persona with no `heldout.json`, the eval scores that tail and reports `split: legacy_tail`.
It first checks the example count against `training_examples` in `training_metadata.json`.
That set is still unseen by the adapter, but it is biased toward recent messages.

Caveat: early stopping reads val loss, so the held-out set has some influence on which checkpoint survives.
It never contributes gradients.

## Metrics

### 1. Held-out perplexity (the pass/fail signal)

Scoring matches training. `ChatDataset(mask_prompt=True)` tokenizes each example.
Only the final assistant message counts. Sequences truncate at the training `max_seq_length`.
One exception: Qwen3 templates open the final reply with an empty `<think>\n\n</think>\n\n` block.
That block is template, not the person, so the eval leaves it out of the targets.

After loading, the eval checks that every weight in `adapters.safetensors` reached the model.
mlx-lm before 0.31 drops weights whose names do not match the model, without an error.
The adapter then does nothing, and base and adapter perplexity match exactly.

`delta = base_ppl - adapter_ppl`. Positive means the adapter predicts the person's real replies better.

The eval reports perplexity twice: over all target tokens, and without `<MSG_BREAK>` targets.
Training registers `<MSG_BREAK>` as a new special token, so the base model has never seen it.
The adapter trains its rows, so that token alone can make the adapter look good.

`verdict` is `improved` only when both deltas are positive. Otherwise it is `not_improved` or `mixed`.

### 2. Style distance (diagnostic)

The eval picks a random subset of the scored examples (50 by default).
It samples one reply per prompt from each condition, with the chat UI's settings
(ChatML with thinking off, temp 0.7, top_p 0.9, repetition penalty 1.1). It reseeds before each condition.
It then compares each condition's replies with the real replies, feature by feature:

| Feature | Measure |
|---|---|
| `lowercase_start`, `all_lowercase`, `ends_with_period`, `has_question`, `has_exclamation`, `has_emoji`, `has_laugh`, `has_slang` | rate per bubble, absolute gap |
| `bubbles_per_reply` | histogram of `<MSG_BREAK>`-separated bubbles per turn, Jensen-Shannon divergence |
| `words_per_bubble` | length histogram, Jensen-Shannon divergence |
| `word_distribution` | unigram distribution, Jensen-Shannon divergence |

Each feature names the closer condition. A gap under 0.01 is a tie.
With the default 50 samples, treat single-feature wins as noise. Look for a consistent pattern.

## Validation

`mlx/tests/test_fidelity_*.py` run on a tiny random model on CPU, so they pass on Linux with `mlx[cpu]` too.

- An untrained adapter (LoRA B is zero at init) gives `delta == 0` and `not_improved`. This is the "broken adapter" check from #228.
- A LoRA fit on the examples gives a positive delta, with and without `<MSG_BREAK>`.
- The split is deterministic, disjoint, and not the chronological tail.

## Guesses to confirm

These are choices made without data. Each one is a flag or a constant.

1. **System prompt during scoring.** Training examples have no system prompt. The chat UI adds the one from `chat_metadata.json`.
   The eval uses the chat prompt by default (`--system-prompt chat`), as #228 proposes. `--system-prompt none` matches training instead.
   The chat UI also appends a personality profile. The eval does not.
2. **Sample sizes.** 200 examples for perplexity and 50 for style. Not tuned.
3. **Style features and the 0.01 tie band.** A first pick from `docs/feature-plans/ai-evals-and-quality-strategy.md`.
4. **No stop sequences in generation.** The daemon also stops on phrases like "Feel free to". The eval stops on EOS or `--max-tokens` only.

## Findings from the first real run (2026-11-22)

The first run scored persona `15555550142`, a contact-voice persona from before #319.

1. **The adapter did not load.** Base and adapter perplexity matched to every digit.
   `adapters.safetensors` has Qwen3.5 layer names (`language_model.model.layers.N.linear_attn...`).
   `training_metadata.json` names `Qwen3-4B-8bit`, which has none of those layers.
   mlx-lm 0.30.8 dropped all 352 weights without an error. The eval now fails loudly instead.
   The adapter was retrained in April, but its metadata is from February, so the base model name is stale.
2. **`<MSG_BREAK>` has an untrained embedding.** Training adds it as a new special token (id 151669).
   LoRA does not train embeddings, so that row stays at its initial value.
   Each break target costs 20-26 nats, and the text after a break costs up to 37.
   This inflates perplexity for both conditions, even without the break targets themselves.
   Fixed: every consumer copies the `\n\n` rows into the token's rows, and training puts LoRA on its output row (`utils/msg_break.py`).
   LoRA on the input row crashed training: it backprops through every DeltaNet layer and exceeds Metal's buffer limit.
3. **Serving mismatch, confirmed.** `entry/inference_daemon.py` did not register `<MSG_BREAK>`.
   The You persona sent 1.12 bubbles per reply against 2.32 in real replies.
   Fixed: the daemon now registers the token after it loads a persona.

## Not in this version

- Writing the perplexity fields into `training_metadata.json` and `TrainingMetrics` at the end of training.
- Showing the delta in the training-complete UI.
- LLM-as-judge and the A/B Turing test from NEXT_UP Phase D.
- A committed synthetic persona fixture. The synthetic corpus in PR #305 is a candidate, but its filler is templated, so it would only work as a smoke test.

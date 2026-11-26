# mlx/ - Python ML pipeline (training, embeddings, analytics, persona analysis)

## Entry Points

Rust spawns the first 5 scripts via subprocess. `eval_persona.py` is a developer tool you run by hand. Human-readable logs go to stderr; structured JSON goes to stdout for Rust to parse.

### `src/entry/train.py` -- LoRA fine-tuning

```bash
python src/entry/train.py --data <dir> --output <dir> [--base-model MODEL] \
  [--max-steps 500] [--learning-rate 1e-5] [--batch-size 1] \
  [--lora-rank 16] [--lora-alpha 32] [--save-every 200] \
  [--max-seq-length 1024] [--num-layers N] [--grad-accum 4]
```

`--data` must contain `train.jsonl` (chat-format JSONL) and `metadata.json` (with `contact_id`, `contact_name`, `msg_break_token`). If `--output` is omitted, writes to `~/.be-right-back/models/personas/you`. Uses `mlx_lm.lora.train_model()` with a `TrainingCallback` that implements early stopping via `StopIteration`.

`msg_break_token` joins one sender's consecutive bubbles in a turn. The Rust export defines it (`MSG_BREAK_TOKEN`); Python never hardcodes it. Training reads it from `metadata.json` and copies that file to the persona's `chat_metadata.json`, where the daemon and the eval read it. Newlines inside one iMessage stay newlines. Every consumer calls `register_msg_break` (`src/utils/msg_break.py`), so the token gets the same id everywhere. With the model, `register_msg_break` also copies the `\n\n` token's rows into the break token's rows, so every consumer starts from the same base rows. It also rebuilds mlx-lm's cached streaming detokenizer (0.32+). Without that, generated breaks decode as "!". Training puts LoRA on the output rows only: `lm_head` when untied, or the embedding with its input side stopped (`OutputOnlyLoRAEmbedding`) when tied. Do not train the input row with gradients: that backprops through every layer, and Qwen3.5's DeltaNet training loop then exceeds Metal's 499,000-buffer limit. The LoRA weights save in `adapters.safetensors`, and `load(adapter_path=...)` restores them. Training weights the loss on break targets by `BREAK_LOSS_WEIGHT` (3x). With equal weight the adapter under-predicts the break. Validation loss stays unweighted, so early stopping compares like with like.

`--num-layers` adapts only the top-N transformer layers (default: all layers) — fewer trainable params, less optimizer state, faster wall-clock; top layers carry the most style signal. `--grad-accum` sets gradient accumulation steps (effective batch = `batch_size * grad_accum`). The desktop app does **not** pass fixed values here: `train_persona` (Rust) computes a hardware-aware `TrainingProfile` (`crates/common/src/training_profile.rs`) from the model tier, system memory, and the exported example count, then passes the derived `--lora-rank`, `--max-seq-length`, `--num-layers`, `--grad-accum`, and a data-scaled `--max-steps`. This keeps "You" fine-tuning within memory budget and fast on consumer Macs (8GB/16GB included).

Training writes two debug files to the output folder. `memory_log.jsonl` holds MLX, process and system memory every 2 s, plus each report, validation pass and the top processes by memory. `crash_trace.txt` gets every thread's Python stack if the process aborts, for example on a Metal out-of-memory error. Both are flushed per line, so they survive a crash. Code: `src/utils/train_debug.py`.

### `src/entry/embed.py` -- Embedding generation

```bash
python src/entry/embed.py --snapshot-db <path> --output-db <path> --ingestion-id <int> \
  [--window-size 8] [--stride 8] [--batch-size 0] [--addressbook-db <path>] \
  [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--min-messages-per-contact N]
```

Reads messages from a snapshot SQLite DB, chunks them (non-overlapping, window=stride=8), generates 768-dim embeddings with ModernBERT via MLX, and writes them to DuckDB with an FTS index. Batch size auto-detected from RAM via `psutil`.

`clean_message_text()` (`data/loaders.py`) drops tapback reactions, near-empty messages and automated verification-code texts (`utils/verification_codes.py`). A code text needs a 4-8 digit code plus an automated phrase ("verification", "passcode", "don't share", or a start of "Your ... code is"), so "the door code is 4821" from a friend stays.

The last three flags carry the user's Ingestion Settings from Rust. Both dates are inclusive and interpreted in UTC. `--min-messages-per-contact` counts messages inside the date range, so a contact with a long history but little activity in the window is dropped. All three apply in `queries/sqlite.py`, on the contact-discovery and batch-read queries; omitting a flag means no filter.

### `src/entry/analytics.py` -- Clustering and insights

```bash
python src/entry/analytics.py --db-path <path> [--target-topics 15] [--pca-dims 50] \
  [--umap-n-neighbors 20] [--umap-min-dist 0.25] [--umap-spread 1.5] [--random-state 42]
```

Pipeline steps:

1. Load embeddings from DuckDB.
2. Subtract each contact's mean embedding.
3. Reduce to 50 dimensions with PCA.
4. Run Leiden on a kNN graph. The resolution is tuned to about `--target-topics` topics. Every chunk gets a topic.
5. Project to 2D and 3D with UMAP for display.
6. Find c-TF-IDF keywords and LLM cluster labels.
7. Aggregate daily activity and word counts.

The script reads DuckDB read-only and writes all results at the end, inside `with write_lock():` (`data/write_lock.py`). The app keeps brb.duckdb open, so the lock asks it to close its connection first. Keep writes inside that block short: app reads fail while it is held. Without `BRB_WRITE_LOCK_HANDSHAKE=1` (a manual run), the lock is a no-op.

Every chunk embeds a `[Contact: Name | date]` header and sender names. Without the mean subtraction, clusters form per contact, not per topic. Keywords, labels and word counts read message text only (`utils/chunk_text.py`): no header, no sender names, and no tokens of the chunk's own contact name. The labeler disables thinking through the chat template (`enable_thinking=False`) and rejects answers that fail `validate_label` or repeat a taken label; the fallback is the top two keywords.

The labeler shows the model up to 10 excerpts per cluster, picked by `representative_samples()`:

- Chunks rank by the top keywords they use, each weighted by how many chunks in the cluster use it. Distance to the centroid breaks ties. The chunks nearest the centroid of a large cluster are small talk that never uses the keywords, and the model labeled that small talk ("Tech Support" for a sleep cluster).
- Near-copies are skipped (digits are ignored), and one contact gives at most 2 excerpts. Without this, a cluster of bank codes was one PNC template ten times, and the model called it "Phishing Scam".
- Each excerpt keeps only the lines that use a keyword, with one line of context. Links become `<link>`.

A rejected answer goes back to the model with the reason, up to 3 attempts. Link text never counts as a word (`extract_words` drops URLs).

### `src/entry/analyze_persona.py` -- LLM personality profiling

Reads JSON from **stdin** (not CLI args). Two-phase approach: Phase 1 extracts 5 quotes/topics/insights, Phase 2 synthesizes a personality profile. Input must include `phase1_conversation_blocks` and `phase2_conversation_blocks`. If `contact_id` is "you", routes to self-analysis prompts (second-person language). Supports streaming mode (`"streaming": true`) for incremental phase events.

### `src/entry/inference_daemon.py` -- Long-lived inference subprocess

```bash
python src/entry/inference_daemon.py [--base-model MODEL]
```

JSON-lines protocol over stdin/stdout (pipe mode) or a Unix socket (`--mode socket`). Commands: `load` (persona + optional model override), `generate` (chat completion), `cancel`, `embed_query` (single embedding), `ping`, `shutdown`. `generate` with `"stream": true` sends `token` frames before the `complete` frame. Streamed text has the tokenizer's special tokens removed (`all_special_tokens`, except `<think>`/`<tool_call>` tags) and never includes part of a stop sequence. Every command has an `id`, and every reply copies it (`with_id()`). The `ready` frame reports `protocol` (`PROTOCOL_VERSION`). Bump it when the format changes: the Rust client restarts a daemon with another version. In socket mode a `cancel` command stops the generation whose `id` it carries, which answers `cancelled`. A client disconnect stops it too. Socket handlers send through a `reply` bound to their request id, never a shared global. Pipe mode ignores `cancel`: the Rust client kills the process instead. Default model is Qwen3.5-9B. Handles Qwen3/Qwen3.5 chat templates internally (same ChatML format).

### `src/entry/eval_persona.py` -- Persona fidelity eval

```bash
python src/entry/eval_persona.py --persona-dir <dir> [--data train.jsonl] [--base-model MODEL] \
  [--max-examples 200] [--generate 50] [--system-prompt chat|none] [--output <dir>]
```

Scores the persona's held-out examples (`heldout.json`, written by `core/train.py`) with the adapter off and on. Reports held-out perplexity delta, per-feature style distance, and the break vs end-of-turn choice at the person's real bubble and turn ends. Code lives in `src/fidelity/`. See `eval/persona/README.md`.

## JSON Progress Protocol

Three distinct protocols, all JSON-lines on stdout:

**Ingestion (embed.py)**:
```json
{"type": "stage_progress", "stage": "parsing|chunking|embedding|saving", "percent": 0-100, "message": "...", "stats": {...}, "current_contact": {...}}
{"type": "result", "success": true, "data": {...}}
```

**Analytics (analytics.py)**:
```json
{"type": "analytics_progress", "stage": "loading|pca|clustering|umap_2d|umap_3d|labeling|saving_clusters|activity|words|complete", "percent": 0-100, "message": "..."}
{"type": "result", "success": true, "data": {...}}
```

**Write lock (analytics.py)**: the script prints `{"type": "write_lock", "action": "acquire|release"}` and reads one reply line from stdin: `ok` or `error: <reason>`.

**Persona analysis (analyze_persona.py)**:
```json
{"type": "phase", "phase": "loading_model|extracting_quotes|analyzing_personality"}
{"type": "phase1_complete", "quotes_count": N, "topics_count": N, "insights_count": N}
{"type": "complete", "content": "...", "duration_secs": N}
{"type": "error", "error": "..."}
```

**Shared base messages** (`progress/base.py`): `{"type": "log", "level": "info|warn|error", "message": "..."}` and `{"type": "result", "success": bool, "data": {...}}`.

## Critical Version Pins

- **`mlx-lm>=0.31.3`**: Required for Qwen3.5 DeltaNet architecture support (`qwen3_5.py` model type), released on PyPI in 0.31.0. Keep this a plain registry dependency — a `git+` URL makes uv invoke the `git` CLI, which fails first-run setup on a Mac without Xcode Command Line Tools.
- **`mlx>=0.31.2`**: Floor imposed by mlx-lm 0.31.3 on Darwin.
- **`duckdb==2.0.1`**: Must exactly match the Rust `duckdb` crate (`= 1.20001.0` is DuckDB 2.0.1). Mismatched versions cause extension load failures, and 1.x cannot open a file 2.0 created. In 2.0, use `lambda x: ...` in SQL (the `x -> ...` form errors), and `to_arrow_table()` (`fetch_arrow_table()` is gone).
- **`numba>=0.61.0` + `llvmlite>=0.44.0`**: Forced pins for Python 3.13 support (required by `umap-learn` and `pynndescent`).
- **`requires-python = ">=3.13,<3.14"`**: Matches bundled Python 3.13.9.

## mlx-lm 0.28+ make_sampler API

`generate()` and `stream_generate()` no longer accept `temp=` or `temperature=` directly. Passing them causes `generate_step() got an unexpected keyword argument 'temp'`.

```python
from mlx_lm import generate
from mlx_lm.sample_utils import make_sampler, make_logits_processors

sampler = make_sampler(temp=temperature, top_p=top_p)  # temp=, NOT temperature=
logits_processors = make_logits_processors(repetition_penalty=1.1, repetition_context_size=20)

response = generate(model, tokenizer, prompt=prompt, max_tokens=256,
                     sampler=sampler, logits_processors=logits_processors)
```

The daemon and the eval use `make_sampler` this way. For the repetition penalty they use `utils/sampling.py:make_repetition_penalty` instead of `make_logits_processors`. It skips `<MSG_BREAK>` and the end-of-turn tokens, so a multi-bubble reply does not penalize its own breaks.

## LoRA Target Modules

Auto-detected in `config/training.py` based on model name. Getting these wrong silently produces a model that doesn't learn.

**Qwen3.5 (DeltaNet hybrid -- default for Qwen3.5 models)**:
```
linear_attn.out_proj,
self_attn.q_proj, self_attn.k_proj, self_attn.v_proj, self_attn.o_proj,
mlp.gate_proj, mlp.up_proj, mlp.down_proj
```

Qwen3.5 uses a hybrid architecture: 3 DeltaNet (linear attention) layers then 1 full attention layer, repeating. Weight prefix: `language_model.model.layers.N.*`.

**Qwen3 / Llama-family (legacy)**:
```
self_attn.q_proj, self_attn.k_proj, self_attn.v_proj, self_attn.o_proj,
mlp.gate_proj, mlp.up_proj, mlp.down_proj
```

Detection logic: if model name contains "qwen3.5" -> Qwen3.5 targets; if "llama"/"tinyllama"/"qwen" -> legacy targets; default -> Qwen3.5 targets.

## Package Layout

`pyproject.toml` sets `package-dir = {"" = "src"}`, so all imports are top-level (e.g., `from config.training import Config`, not `from src.config...`). Entry point scripts use `sys.path.insert(0, ...)` when needed.

## Key Modules

- **`config/`**: Dataclasses for training (`Config`, `LoRAConfig`, `TrainingConfig`), embedding (`EmbeddingConfig`), analytics (`AnalyticsConfig`)
- **`core/train.py`**: Orchestrates the full training loop, saves loss history + plots
- **`core/analyze_persona.py`**: Two-phase LLM analysis; formats conversation blocks as XML for the LLM
- **`core/callbacks.py`**: `TrainingCallback` with early stopping (raises `StopIteration`)
- **`pipelines/embedding.py`**: Full embed pipeline: read messages -> chunk -> embed -> write DuckDB
- **`pipelines/analytics.py`**: Full analytics pipeline: contact offsets -> PCA -> Leiden -> UMAP -> labeling -> activity -> words
- **`ml/labeling.py`**: Uses LLM to generate cluster labels; prompts in `prompts.py`
- **`progress/`**: Three progress reporters (base, ingestion, analytics) with distinct stage enums
- **`prompts.py`**: All LLM prompts (cluster labeling, personality analysis, self-analysis, persona system prompts)

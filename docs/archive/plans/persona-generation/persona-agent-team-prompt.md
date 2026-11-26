# Persona Feature — Claude Code Agent Team Prompt

> **Project:** Be Right Back (BRB) — Local AI persona app for macOS
>
> **Goal:** Complete the persona training, loading, and chat pipeline end-to-end. After this sprint, a user should be able to select a contact, train a LoRA persona on their iMessage history, and chat with that persona — all locally on Apple Silicon.
>
> **Prerequisites:**
> 1. Enable agent teams: add `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` to your `settings.json` under `env`
> 2. Clone the BRB monorepo and ensure you're at the repo root
> 3. Recommended: use `--dangerously-skip-permissions` on the lead session since teammates inherit permissions and you don't want 6 agents bottlenecked on approval prompts
> 4. Recommended: run in tmux or iTerm2 for split-pane mode so you can monitor all teammates at once
>
> **Current state (read this before doing anything):**
> - Phase 1 (Data Ingestion CLI): ✅ Complete — JSONL export works
> - Phase 2 (Model Training Pipeline): 🟡 ~90% — MLX-LM LoRA training works, GGUF conversion exists but needs testing, progress streaming to UI not wired
> - Phase 3 (Inference Pipeline): ❌ 0% — Not started
> - Phase 5 (Tauri Integration): 🟡 ~40% — Scaffold exists, training command stubs exist, most React components are stubs
> - Phase 6 (Desktop UI): 🟡 ~60% — Sidebar with Contacts/Personas tabs exists, empty states exist, chat layout exists but not functional
>
> **How to run:** Start a Claude Code session at the root of the BRB repo and paste the prompt below.

---

## THE PROMPT

Paste everything below this line into Claude Code:

---

I need you to act as team lead for completing the Persona feature in Be Right Back (BRB). This is a Tauri desktop app (Rust backend, React frontend) that creates AI chat personas from iMessage conversation history using LoRA fine-tuning on Qwen3-4B via MLX-LM, with inference via MLX Python daemon.

**Important: Use delegate mode.** You are the orchestrator — do NOT implement anything yourself. Your job is to spawn teammates, assign tasks, synthesize findings, and verify integration. Press Shift+Tab to enter delegate mode after creating the team.

### Your first job: Codebase Inventory (do this yourself before spawning the team)

Before creating any teammates, do a quick audit of where things stand:

1. Check the actual state of these key files and directories:
   - `mlx/src/` — Python training scripts (core/train.py, core/convert_to_gguf.py, callbacks.py)
   - `crates/training/src/` — Rust training orchestration (python.rs, lib.rs)
   - `crates/personas/src/` — Persona metadata management (metadata.rs)
   - `apps/desktop/src-tauri/src/commands/training.rs` — Tauri training command
   - `apps/desktop/src/components/chat/` — React chat components
   - `apps/desktop/src/components/home/SetupWizard.tsx` — Setup wizard
   - `~/.be-right-back/` directory structure (if it exists on this machine)
2. Identify what's **actually implemented** vs. what's a stub/TODO
3. Check if Qwen3-4B base model is downloaded, and whether `mlx-lm` is installed
4. Write your findings to `./persona-sprint/inventory.md`
5. Show me the inventory and wait for my confirmation before proceeding

### After I confirm the inventory, create the agent team

Create an agent team with 5 teammates. Spawn them with the following names, roles, and prompts. Each teammate should write their findings/code to their designated areas.

**Use plan approval for the training-eng and inference-eng teammates** — these touch the ML pipeline and I want to verify their approach before they start making changes.

Give every teammate this shared context in their spawn prompt:
> You are part of a sprint team completing the Persona feature in Be Right Back (BRB). This is a Tauri desktop app (Rust + React) that fine-tunes Qwen3-4B (~4B params) on iMessage conversations using LoRA via MLX-LM on Apple Silicon, then runs inference via MLX Python daemon.
>
> Key paths:
> - `mlx/` — Python MLX-LM training package
> - `crates/training/` — Rust training orchestration
> - `crates/personas/` — Persona metadata management
> - `crates/messages-db/` — iMessage database access
> - `crates/common/` — Shared types and path helpers
> - `apps/desktop/src-tauri/` — Tauri backend (Rust)
> - `apps/desktop/src/` — React frontend
> - `~/.be-right-back/` — Runtime data directory (models, personas, venv)
>
> The codebase inventory is at `./persona-sprint/inventory.md`. Read it before starting.
>
> **Ground rules:**
> - Be specific — include file paths and line numbers
> - Test your changes — run `cargo check` for Rust, `npm run build` for React, verify Python scripts execute
> - Don't break existing functionality — Phase 1 (ingestion) is complete and working
> - Message each other when you find something relevant to another teammate's work
> - When blocked, note it clearly — don't skip silently

---

#### Teammate 1: "training-eng"

**Spawn prompt (plan approval required):**
> Your role is **Training Pipeline Completion**. You own the last 10% of Phase 2.
>
> Before starting, submit a plan to the lead describing exactly what's missing and your approach to completing it.
>
> **Context on Qwen3-4B fine-tuning best practices (from research):**
> - Model: `mlx-community/Qwen3-4B-8bit` (~4B params, 32k context)
> - MLX-LM LoRA command: `mlx_lm.lora --model mlx-community/Qwen3-4B-8bit --data <path> --train --iters 1000 --adapter-path <output>`
> - Recommended hyperparameters for persona/style fine-tuning on small datasets:
>   - `lora_rank`: 8-16 (8 for memory-constrained, 16 for quality)
>   - `lora_alpha`: 2× rank (community best practice for MLX — prevents adapter weights from being drowned by frozen base weights)
>   - `learning_rate`: 1e-5 to 2e-4 (start conservative at 1e-5)
>   - `dropout`: 0.05-0.1 (important for small/narrow datasets like personal chat history to prevent overfitting)
>   - `batch_size`: 1-2 (for 8-16GB unified memory)
>   - `iters`: 500-1000 (more data = fewer iters needed)
>   - `--load-in-4bit` flag for QLoRA on memory-constrained machines
> - Target modules for Qwen3: `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`
> - Training data format: JSONL with chat format `{"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}`
> - Peak memory with Q4 + LoRA rank 8: ~8GB (fits in 8GB MacBook)
> - Peak memory with full precision + LoRA rank 16: ~12-14GB (needs 16GB+)
>
> **Your tasks:**
>
> 1. **Audit `mlx/src/core/train.py`**: Verify the LoRA config uses sensible defaults for persona training. Specifically:
>    - Is `lora_alpha` set to `2 * rank`? If not, fix it — MLX's implementation benefits from higher alpha
>    - Is dropout enabled? Should be 0.05-0.1 for narrow chat datasets
>    - Are the correct target modules specified for Qwen3? (`q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`)
>    - Is early stopping implemented in `callbacks.py`? What's the patience?
>
> 2. **Audit `mlx/src/core/convert_to_gguf.py`**: This is the critical MLX → GGUF adapter conversion path. Known issues in the ecosystem:
>    - MLX adapters use lowercase `lora_a`/`lora_b` keys but llama.cpp's `convert_lora_to_gguf.py` expects HF PEFT format with `lora_A.weight`/`lora_B.weight` — verify our conversion handles this key renaming
>    - Tensors need transposing (MLX is row-major, HF PEFT expects column-major for these)
>    - `adapter_config.json` must be generated in HF PEFT format with `base_model_name_or_path`, `target_modules`, `r`, `lora_alpha`, `lora_dropout`
>    - **Alternative path**: If direct adapter GGUF conversion is too fragile, implement the fuse-then-convert approach: `mlx_lm.fuse --model <base> --adapter-path <adapters> --save-path <fused> --de-quantize` → `convert_hf_to_gguf.py`
>    - Test whichever path you implement end-to-end with a tiny dataset
>
> 3. **Audit training data format**: Check `crates/training/src/export/jsonl.rs` — ensure the JSONL output matches what MLX-LM expects. The format should be:
>    ```json
>    {"messages": [{"role": "system", "content": "You are {contact_name}. Respond in their texting style..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
>    ```
>    Verify the system prompt template captures persona context well.
>
> 4. **Progress streaming**: Check `crates/training/src/python.rs` — the Rust subprocess needs to parse MLX-LM stdout for training metrics (iter, loss, tokens/sec) and pipe them to the Tauri frontend. Verify this works or implement it. The Tauri event type is `TrainingProgressEvent` in `apps/desktop/src-tauri/src/commands/types.rs`.
>
> 5. **Validation**: After all fixes, test the full training pipeline:
>    - Export a small JSONL from test data
>    - Run `mlx_lm.lora` training for 50 iterations
>    - Convert adapter to GGUF
>    - Verify the GGUF adapter loads in llama.cpp
>
> When you complete the GGUF conversion audit, message the "inference-eng" teammate with:
> - Which conversion path you chose (direct adapter GGUF vs fused model)
> - The exact file paths and format of the output artifacts
> - Any caveats about Qwen3 specifically
>
> When you fix the training data format, message the "rust-backend" teammate — they need to know the exact schema for the export command.

---

#### Teammate 2: "inference-eng"

**Spawn prompt (plan approval required):**
> Your role is **Inference Pipeline (Phase 3)**. This is the completely missing piece — there is currently NO inference implementation.
>
> Before starting, submit a plan to the lead describing your approach.
>
> **Context on llama.cpp with LoRA adapters:**
> - llama.cpp supports loading LoRA adapters at runtime: `llama-server -m base.gguf --lora adapter.gguf`
> - Hot-swapping adapters via `POST /lora-adapters` endpoint (load with `--lora-init-without-apply`)
> - The base model should be available via MLX-LM auto-download from `mlx-community/Qwen3-4B-8bit`
> - Persona adapters at `~/.be-right-back/models/personas/{contact_id}/adapter.gguf`
> - llama.cpp provides an OpenAI-compatible API at `/v1/chat/completions`
>
> **Your tasks:**
>
> 1. **Create the inference Python module** at `mlx/src/core/infer.py` (or determine if we should skip Python and go directly through llama.cpp from Rust):
>    - **Option A (Recommended): llama.cpp server approach**
>      - Rust spawns `llama-server` as subprocess with base model
>      - Load persona adapter via `--lora` flag or hot-swap API
>      - Communicate via HTTP (`/v1/chat/completions` with streaming)
>      - Supports concurrent persona switching without reloading base model
>    - **Option B: MLX-LM inference (simpler but less production-ready)**
>      - Python subprocess using `mlx_lm.generate` with `--adapter-path`
>      - Simpler but no streaming, harder to manage from Rust
>    - Evaluate both and pick the one that works best. Document your decision.
>
> 2. **Create `crates/inference/`** (new Rust crate) or add to existing crate:
>    - `InferenceServer` struct that manages the llama.cpp subprocess lifecycle
>    - `start_server(base_model_path, port)` — spawn llama-server
>    - `load_persona(adapter_path)` — load a LoRA adapter
>    - `generate(messages, config) -> Stream<String>` — send chat completion request with streaming
>    - `stop_server()` — graceful shutdown
>    - Handle server health checks (is it ready? did it crash?)
>
> 3. **Create the Tauri command** for chat:
>    - `generate_response(persona_id, messages, config)` → streams tokens back to React via Tauri events
>    - Should use `TrainingProgressEvent`-style streaming (check `apps/desktop/src-tauri/src/commands/types.rs` for patterns)
>
> 4. **Handle model download**: Check if base model GGUF exists. If not, implement a download command:
>    - Ensure Qwen3-4B-8bit is available via MLX-LM auto-download from `mlx-community`
>    - Show download progress
>    - Store at `~/.be-right-back/models/base/`
>
> 5. **System prompt construction**: When sending a chat completion, construct the system prompt that gives the persona its identity:
>    ```
>    You are {contact_name}. You are chatting with the user in iMessage.
>    Respond in {contact_name}'s texting style — match their typical message
>    length, emoji usage, slang, capitalization patterns, and tone.
>    Keep responses natural and concise, like real text messages.
>    ```
>    Consider: should this system prompt be stored per-persona in metadata, or generated at runtime?
>
> **Wait for the "training-eng" teammate** to message you about the GGUF conversion path before finalizing your adapter loading approach.
>
> When your inference server API is defined, message the "react-ui" teammate with the Tauri command signatures so they can wire up the chat UI.
>
> When you define the model download flow, message the "rust-backend" teammate so they can integrate it into the setup wizard.

---

#### Teammate 3: "rust-backend"

**Spawn prompt:**
> Your role is **Rust Backend Integration**. You wire together all the Tauri commands that the React frontend needs.
>
> **Your tasks:**
>
> 1. **Audit existing Tauri commands** in `apps/desktop/src-tauri/src/commands/`:
>    - `training.rs` — What's implemented vs. stub? What needs to connect to the actual training pipeline?
>    - Check `lib.rs` — are all commands registered in `invoke_handler`?
>    - Check `state.rs` — what's in `AppState`? Does it need an inference server handle?
>
> 2. **Wire up training commands**:
>    - `train_persona(contact_id, config)` → should call into `crates/training` to:
>      1. Export JSONL from messages DB for the contact
>      2. Ensure Python venv + MLX-LM is set up (`python_setup.rs`)
>      3. Invoke MLX-LM training subprocess
>      4. Stream progress events to frontend
>      5. Convert adapter to GGUF on completion
>      6. Save `PersonaMetadata` via `crates/personas`
>    - `cancel_training()` → kill the Python subprocess gracefully
>
> 3. **Wire up persona management commands**:
>    - `list_personas()` → should return `Vec<TrainedPersona>` with full metadata (not just string IDs like the current implementation does — see `ChatLayout.tsx` where it casts to `string[]`)
>    - `get_persona(persona_id)` → return full persona details
>    - `delete_persona(persona_id)` → remove adapter files + metadata
>    - `get_persona_status(persona_id)` → check if adapter exists, model loaded, etc.
>
> 4. **Wire up chat/inference commands** (after "inference-eng" defines the API):
>    - `start_inference_server()` → launch llama.cpp server with base model
>    - `generate_response(persona_id, messages)` → stream chat responses
>    - `stop_inference_server()` → graceful shutdown
>
> 5. **Fix the `list_personas` return type** — this is currently broken:
>    - The Tauri command returns `string[]` but `ChatLayout.tsx` expects `TrainedPersona[]`
>    - Ensure the Rust side returns fully hydrated persona objects with: `id`, `contact_id`, `contact_name`, `display_name`, `base_model`, `adapter_size_bytes`, `adapter_size_display`, `trained_at`, `message_count`
>
> 6. **Setup wizard integration**: The `SetupWizard.tsx` has stages: `permissions → snapshot → ingestion → model → persona`. Make sure:
>    - The "model" step calls `download_base_model` (coordinate with inference-eng)
>    - The "persona" step transitions to the training flow
>
> Message the "react-ui" teammate whenever you change a Tauri command signature — they need to update the `invoke()` calls.
> Message the "training-eng" teammate if you find issues with the Python subprocess management in `python_setup.rs`.

---

#### Teammate 4: "react-ui"

**Spawn prompt:**
> Your role is **React Frontend — Persona Training & Chat UI**. You own the user-facing experience.
>
> **Important**: This app uses a custom CRT/retro terminal aesthetic with CSS variables like `--color-crt-text`, `--color-crt-bg`, `--color-crt-glow`, `--color-crt-cyan`. There's a `Ghost` component for the mascot. Stick to the existing design system — don't introduce new design patterns.
>
> **Your tasks:**
>
> 1. **Training flow UI** — When a user selects a contact and clicks "Generate Persona":
>    - Show a training configuration modal/screen (simple — just "Train" button with info about estimated time)
>    - Show real-time training progress: phase (exporting/downloading/training/converting), progress bar, current step/total, loss graph (optional), ETA
>    - Handle training completion → persona appears in Personas tab
>    - Handle training errors → show error with retry option
>    - Handle training cancellation → confirm dialog → clean up
>    - Listen for Tauri events: `training-progress` with `TrainingProgressEvent` payload
>
> 2. **Persona list (Personas tab)** — Currently shows empty state. Wire it up:
>    - Call `invoke("list_personas")` → display results in `PersonasList`
>    - Each persona shows: avatar initial, display name, adapter size, message count, trained date
>    - Click persona → switch to chat view
>    - Add context menu or button: delete persona (with confirmation)
>    - Add visual indicator for "currently loaded in inference server" vs. "needs to be loaded"
>
> 3. **Chat interface** — `InlineChatPanel` exists but needs wiring:
>    - Send message → call `invoke("generate_response", { personaId, messages })`
>    - Stream response tokens → update UI in real-time (typewriter effect fits the CRT theme)
>    - Show "typing..." indicator while generating
>    - Message history should persist in component state (not across sessions for now)
>    - The chat input should be disabled until inference server is ready
>
> 4. **Contact detail → persona CTA**: The `ContactDetailPanel` already has a "Generate Persona" button — make sure it:
>    - Shows "Training..." state if training is in progress for that contact
>    - Shows "Chat with Persona" if persona already exists
>    - Shows "Retrain" option if persona exists
>
> 5. **Fix the `list_personas` consumer**: In `ChatLayout.tsx`, the `fetchPersonas` effect currently casts `string[]` to `TrainedPersona[]` with placeholder data. Once "rust-backend" fixes the return type, update this to use the real data.
>
> Wait for messages from "rust-backend" and "inference-eng" about Tauri command signatures before wiring up `invoke()` calls. If they're not ready yet, build the UI components with mock data and a clear TODO marking where the real invoke calls go.
>
> When you implement the training progress UI, message the "training-eng" teammate to confirm the event payload format matches what they're emitting.

---

#### Teammate 5: "researcher"

**Spawn prompt:**
> Your role is **Research & Quality Assurance**. You explore best practices, find potential issues, and validate the work of other teammates.
>
> **Your tasks:**
>
> 1. **Qwen3-4B fine-tuning research**: Search the web and compile current best practices for fine-tuning Qwen3-4B with MLX-LM LoRA. Write findings to `./persona-sprint/research/phi4-finetuning.md` (historical filename). Cover:
>    - Optimal hyperparameters for conversational/style fine-tuning (not reasoning or code tasks)
>    - Common pitfalls (overfitting on small datasets, wrong alpha, etc.)
>    - Data format requirements for MLX-LM chat fine-tuning
>    - Memory usage expectations on 8GB vs 16GB Apple Silicon
>    - Whether Qwen3-4B's 32k context window helps or hurts for short chat messages
>    - Comparison: Is Qwen3-4B the best choice in the 3-4B range? (Check Llama 3.2-3B, Gemma-3-4B)
>    - When you find relevant findings, message "training-eng" immediately
>
> 2. **MLX → GGUF conversion research**: This is a known pain point. Research and document:
>    - Current state of MLX adapter → llama.cpp GGUF conversion (as of 2025)
>    - The `convert_lora_to_gguf.py` script from llama.cpp: does it work with MLX adapters directly?
>    - The key renaming issue (`lora_a` → `lora_A.weight`) and tensor transposing
>    - Whether fuse-then-convert is more reliable than direct adapter conversion
>    - `GGUF-my-LoRA` HuggingFace space — is this relevant for our pipeline?
>    - Write findings to `./persona-sprint/research/mlx-to-gguf.md`
>    - Message "training-eng" and "inference-eng" with your findings
>
> 3. **Persona quality research**: What makes a good chat persona? Write to `./persona-sprint/research/persona-quality.md`:
>    - How much training data is needed for a convincing persona? (Messages count threshold)
>    - What should the system prompt include for best persona adherence?
>    - Should we include message timestamps in training data for temporal context?
>    - Should we use multi-turn conversation format or single-turn Q&A pairs?
>    - How to handle emoji-heavy conversations in training data
>    - Should we include metadata like time-of-day, day-of-week patterns?
>    - Any papers or blog posts on "persona fine-tuning" specifically?
>
> 4. **Integration testing plan**: Once teammates start completing their pieces, write a test plan at `./persona-sprint/test-plan.md` covering:
>    - End-to-end flow: contact selection → export → training → conversion → inference → chat
>    - Edge cases: contact with very few messages, contact with only emoji, very long messages, Unicode/multilingual
>    - Error scenarios: training fails midway, OOM, corrupt adapter, server crash
>    - Performance benchmarks: training time for 1k/5k/10k messages, inference latency, memory usage
>
> 5. **Cross-team QA**: As teammates finish tasks, review their work:
>    - Does the training pipeline actually produce a usable adapter?
>    - Does the inference server respond correctly?
>    - Does the UI flow make sense?
>    - Are there race conditions? (e.g., user tries to chat before server is ready)
>    - Broadcast issues to the whole team

---

### Task list structure

Create the shared task list with these tasks. Set dependencies where noted:

| Task | Assigned to | Depends on |
|---|---|---|
| Audit MLX training config & hyperparameters | training-eng | — |
| Audit/fix GGUF conversion pipeline | training-eng | Audit MLX training config |
| Audit training data JSONL format | training-eng | — |
| Implement training progress streaming | training-eng | Audit training data format |
| End-to-end training pipeline test | training-eng | Audit/fix GGUF conversion |
| Design inference architecture | inference-eng | — |
| Implement inference server manager (Rust) | inference-eng | Design inference architecture |
| Implement chat Tauri command with streaming | inference-eng | Implement inference server manager |
| Implement base model download | inference-eng | Design inference architecture |
| Construct persona system prompt | inference-eng | — |
| Audit existing Tauri commands | rust-backend | — |
| Wire training commands | rust-backend | Implement training progress streaming |
| Wire persona management commands | rust-backend | Audit existing Tauri commands |
| Wire chat/inference commands | rust-backend | Implement chat Tauri command |
| Fix list_personas return type | rust-backend | Audit existing Tauri commands |
| Setup wizard model step integration | rust-backend | Implement base model download |
| Build training progress UI | react-ui | — |
| Build persona list UI (real data) | react-ui | Fix list_personas return type |
| Wire chat interface | react-ui | Wire chat/inference commands |
| Contact detail → persona CTA flow | react-ui | Wire training commands |
| Qwen3-4B fine-tuning research | researcher | — |
| MLX → GGUF conversion research | researcher | — |
| Persona quality research | researcher | — |
| Write integration test plan | researcher | Qwen3-4B research, MLX→GGUF research |
| Cross-team QA review | researcher | End-to-end training test, Wire chat interface |

---

### After all teammates finish: Integration Verification

Once all 5 teammates have completed their tasks and messaged you with summaries, do the following yourself:

1. **Read all research docs** from `./persona-sprint/research/`

2. **Run the full integration test** (if possible on this machine):
   - Export JSONL for a test contact
   - Train a LoRA adapter (50 iters minimum)
   - Convert to GGUF
   - Start inference server
   - Send a test message and verify response
   - Verify the Tauri app builds: `cd apps/desktop && npm run build`

3. **Write `./persona-sprint/completion-report.md`** containing:
   - Summary of what was completed vs. what remains
   - Any open issues or blockers
   - Recommended next steps (Phase 4 RAG, Phase 7 optimization)
   - Known limitations of the current implementation
   - Performance characteristics discovered during testing

4. **Write `./persona-sprint/remaining-work.md`** — a checklist of anything that was descoped, blocked, or needs follow-up:
   - Items the researcher flagged as risks
   - UI polish items deferred
   - Edge cases not yet handled
   - Performance optimizations for later

After writing all files, clean up the team.

---

### Ground rules for the whole team

- **Test everything.** Don't just write code — verify it compiles (`cargo check`, `npm run build`) and runs. If you can't run a full test, at least check types and imports.
- **Don't break ingestion.** Phase 1 is complete. Don't modify `crates/messages-db` or `crates/common` without good reason, and if you do, run the existing tests.
- **Match the design system.** The app has a CRT terminal aesthetic. Use existing CSS variables and components. Don't introduce Material UI, Tailwind, or other frameworks.
- **Handle errors gracefully.** Every Tauri command should return `Result<T, String>`. Every UI state should have an error fallback. No silent failures.
- **Message each other.** If you find something relevant to another teammate's work, tell them. The training pipeline feeds into inference which feeds into the UI — coordination is critical.
- **Be specific about what's a stub.** If you can't fully implement something because you're waiting on another teammate, leave a clear `// TODO(teammate-name): <description>` comment and note it in your summary.
- **When in doubt about the ML pipeline, ask the researcher.** They have the latest findings on Qwen3-4B and MLX-LM best practices.

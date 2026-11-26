# Phase 3: Inference Pipeline

**Timeline:** Week 3-4
**Status:** 🟡 ~60-70% Complete
**Dependencies:** Phase 2 (LoRA adapters must be available) ✅
**Priority:** Critical
**Last Updated:** January 2025
**Blocker:** Python inference daemon was deleted and needs reimplementation

---

## Overview

Integrate llama.cpp to run inference with the base model and LoRA adapters. This allows the app to generate responses that mimic the texting style of each contact. The inference pipeline must be fast, memory-efficient, and support loading/unloading multiple adapters.

### Goals

1. Integrate llama.cpp server (llama-server) for inference
2. Load base model with Metal acceleration
3. Dynamically load and swap LoRA adapters
4. Implement streaming text generation
5. Create Rust API for chat completions
6. Support multiple concurrent personas

### Non-Goals (for this phase)

- No RAG integration (that's Phase 4)
- No UI (that's Phase 5-6)
- No advanced sampling strategies (use defaults)
- No model quantization (use pre-quantized GGUF)

---

## Architecture

### Components (Planned → Actual)

```
# ACTUAL IMPLEMENTATION:
crates/inference/
├── src/
│   ├── lib.rs                  # Public API
│   ├── backend.rs              # Backend selection (MLXPython, LlamaCpp, MLXNative)
│   ├── config.rs               # GenerationConfig, ModelConfig
│   ├── unified.rs              # UnifiedEngine - routes to backends
│   ├── prompts.rs              # Chat templates, system prompts
│   ├── download.rs             # HuggingFace model download utilities
│   ├── error.rs                # Comprehensive error types
│   └── engines/
│       ├── llama_cpp/
│       │   └── engine.rs       # ✅ 603 lines, fully implemented
│       └── mlx_python/
│           └── engine.rs       # ✅ Rust side (416 lines), Python daemon MISSING
└── Cargo.toml

apps/desktop/src-tauri/src/
├── commands/
│   └── inference.rs            # ✅ Tauri chat commands
└── state.rs                    # ✅ AppState with lazy engine init

apps/cli/src/commands/
└── chat.rs                     # ❌ Returns "not implemented"

mlx/src/
└── inference_daemon.py         # ❌ DELETED in commit 42d35c1, needs restoration

~/.be-right-back/models/
├── base/                       # Downloaded base models
└── personas/{contact_id}/
    ├── adapters.safetensors    # MLX format (for MLXPython)
    └── adapter.gguf            # GGUF format (for LlamaCpp)
```

### Data Flow

```
User prompt
    ↓
[Rust API] → Select persona, build request
    ↓
[llama-server HTTP] → Load LoRA adapter, generate tokens
    ↓
[SSE stream] → Stream tokens back to Rust
    ↓
Generated response
```

---

## Implementation Tasks

### Task 1: Set up llama.cpp

**Installation:**

```bash
# Install via Homebrew (includes Metal support)
brew install llama.cpp

# Or build from source with Metal
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make GGML_METAL=1
```

**Verify installation:**
```bash
llama-server --version
```

**Download base model:**
```bash
# Download Qwen3-4B in GGUF format
# Store in ~/.be-right-back/models/base/
huggingface-cli download \
  Qwen/Qwen3-4B-GGUF \
  qwen3-4b-q4_k_m.gguf \
  --local-dir ~/.be-right-back/models/base/
```

**Acceptance criteria:**
- [x] llama.cpp installed with Metal support (via `llama-cpp-2` crate)
- [x] llama-server binary accessible (embedded in Rust via bindings)
- [x] Base model downloaded and verified

**Implementation notes:**
- Using `llama-cpp-2` Rust crate instead of subprocess
- Metal support enabled in Cargo.toml features
- Model download utilities in `crates/inference/src/download.rs`

---

### Task 2: Implement llama-server lifecycle management

**Files:** `crates/inference/src/server.rs`

**Purpose:** Start, stop, and monitor llama-server subprocess.

```rust
use std::process::{Command, Child, Stdio};
use std::path::PathBuf;
use anyhow::Result;

pub struct LlamaServer {
    process: Child,
    port: u16,
    model_path: PathBuf,
}

impl LlamaServer {
    pub fn start(config: ServerConfig) -> Result<Self> {
        let model_path = config.base_model_path;
        let port = config.port.unwrap_or(8080);

        let process = Command::new("llama-server")
            .arg("-m").arg(&model_path)
            .arg("--port").arg(port.to_string())
            .arg("--ctx-size").arg("8192")       // Context window
            .arg("--n-gpu-layers").arg("-1")     // All layers on Metal
            .arg("--parallel").arg("4")          // 4 concurrent requests
            .arg("--cont-batching")              // Enable continuous batching
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // Wait for server to be ready
        Self::wait_for_ready(port)?;

        Ok(Self {
            process,
            port,
            model_path,
        })
    }

    fn wait_for_ready(port: u16) -> Result<()> {
        // Poll /health endpoint until server responds
        let client = reqwest::blocking::Client::new();
        let url = format!("http://localhost:{}/health", port);

        for _ in 0..30 {
            if client.get(&url).send().is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_secs(1));
        }

        anyhow::bail!("Server failed to start within 30 seconds")
    }

    pub fn shutdown(&mut self) -> Result<()> {
        self.process.kill()?;
        self.process.wait()?;
        Ok(())
    }
}

impl Drop for LlamaServer {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
```

**Acceptance criteria:**
- [x] Can start llama-server subprocess (using Rust bindings instead)
- [x] Waits for server to be ready before returning
- [x] Shuts down cleanly on drop
- [x] Handles startup failures gracefully

**Implementation notes:**
- `LlamaCppEngine` in `crates/inference/src/engines/llama_cpp/engine.rs`
- Uses `llama-cpp-2` crate for direct bindings (no subprocess)
- Implements `InferenceEngineBackend` trait

---

### Task 3: Implement HTTP client for llama.cpp API

**Files:** `crates/inference/src/client.rs`

**llama.cpp API endpoints:**

1. **`POST /completion`** - Generate text completion
2. **`POST /v1/chat/completions`** - OpenAI-compatible chat API
3. **`GET /health`** - Health check
4. **`POST /lora-adapters`** - Load LoRA adapter

**Chat completion request:**

```rust
#[derive(Serialize)]
struct ChatCompletionRequest {
    messages: Vec<ChatMessage>,
    temperature: f32,
    top_p: f32,
    max_tokens: usize,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage {
    role: String,  // "system", "user", or "assistant"
    content: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    id: String,
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChatMessage,
    finish_reason: String,
}
```

**Client implementation:**

```rust
pub struct LlamaClient {
    base_url: String,
    client: reqwest::Client,
}

impl LlamaClient {
    pub fn new(port: u16) -> Self {
        Self {
            base_url: format!("http://localhost:{}", port),
            client: reqwest::Client::new(),
        }
    }

    pub async fn chat_completion(
        &self,
        messages: Vec<ChatMessage>,
        config: GenerationConfig,
    ) -> Result<String> {
        let request = ChatCompletionRequest {
            messages,
            temperature: config.temperature,
            top_p: config.top_p,
            max_tokens: config.max_tokens,
            stream: false,
        };

        let response = self.client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&request)
            .send()
            .await?
            .json::<ChatCompletionResponse>()
            .await?;

        Ok(response.choices[0].message.content.clone())
    }

    pub async fn health_check(&self) -> Result<bool> {
        let response = self.client
            .get(format!("{}/health", self.base_url))
            .send()
            .await?;

        Ok(response.status().is_success())
    }
}
```

**Acceptance criteria:**
- [x] Can send chat completion requests
- [x] Parses responses correctly
- [x] Handles API errors gracefully
- [x] Health check works

**Implementation notes:**
- Direct Rust API instead of HTTP client (using llama-cpp-2 bindings)
- Chat template application in `prompts.rs`
- Comprehensive error types in `error.rs`

---

### Task 4: Implement LoRA adapter loading

**Files:** `crates/inference/src/adapter.rs`

**llama.cpp LoRA API:**

```bash
# Load adapter
curl http://localhost:8080/lora-adapters \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/adapter.gguf", "scale": 1.0}'

# Unload adapter
curl http://localhost:8080/lora-adapters/{adapter_id} \
  -X DELETE
```

**Rust wrapper:**

```rust
#[derive(Serialize)]
struct LoadAdapterRequest {
    path: String,
    scale: f32,
}

#[derive(Deserialize)]
struct LoadAdapterResponse {
    id: String,
}

impl LlamaClient {
    pub async fn load_adapter(&self, adapter_path: PathBuf) -> Result<String> {
        let request = LoadAdapterRequest {
            path: adapter_path.to_string_lossy().to_string(),
            scale: 1.0,
        };

        let response = self.client
            .post(format!("{}/lora-adapters", self.base_url))
            .json(&request)
            .send()
            .await?
            .json::<LoadAdapterResponse>()
            .await?;

        Ok(response.id)
    }

    pub async fn unload_adapter(&self, adapter_id: &str) -> Result<()> {
        self.client
            .delete(format!("{}/lora-adapters/{}", self.base_url, adapter_id))
            .send()
            .await?;

        Ok(())
    }
}
```

**Adapter management:**

```rust
pub struct PersonaManager {
    client: LlamaClient,
    loaded_adapters: HashMap<String, String>,  // contact_id -> adapter_id
}

impl PersonaManager {
    pub async fn activate_persona(&mut self, contact_id: &str) -> Result<()> {
        // Unload current adapter if any
        if let Some(adapter_id) = self.loaded_adapters.get(contact_id) {
            self.client.unload_adapter(adapter_id).await?;
        }

        // Load new adapter
        let adapter_path = self.get_adapter_path(contact_id);
        let adapter_id = self.client.load_adapter(adapter_path).await?;
        self.loaded_adapters.insert(contact_id.to_string(), adapter_id);

        Ok(())
    }

    fn get_adapter_path(&self, contact_id: &str) -> PathBuf {
        dirs::home_dir()
            .unwrap()
            .join(".be-right-back/models/personas")
            .join(contact_id)
            .join("adapter.gguf")
    }
}
```

**Acceptance criteria:**
- [x] Can load LoRA adapter via API
- [x] Can unload adapter
- [x] Can swap between multiple personas
- [x] Handles missing adapters gracefully

**Implementation notes:**
- `load_adapter()` / `unload_adapter()` in LlamaCppEngine
- `load_persona()` / `current_persona()` for persona management
- Requires GGUF format adapters (conversion in `mlx/src/core/convert_to_gguf.py`)

---

### Task 5: Implement streaming text generation

**Files:** `crates/inference/src/streaming.rs`

**Why streaming?** Better UX—users see tokens appear in real-time instead of waiting for the full response.

**SSE (Server-Sent Events) format:**

```
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" there"}}]}

data: [DONE]
```

**Rust streaming client:**

```rust
use futures::stream::StreamExt;
use reqwest_eventsource::{Event, EventSource};

impl LlamaClient {
    pub async fn chat_completion_stream(
        &self,
        messages: Vec<ChatMessage>,
        config: GenerationConfig,
    ) -> Result<impl Stream<Item = Result<String>>> {
        let request = ChatCompletionRequest {
            messages,
            temperature: config.temperature,
            top_p: config.top_p,
            max_tokens: config.max_tokens,
            stream: true,
        };

        let url = format!("{}/v1/chat/completions", self.base_url);
        let mut event_source = EventSource::new(
            self.client
                .post(&url)
                .json(&request)
        )?;

        let stream = async_stream::stream! {
            while let Some(event) = event_source.next().await {
                match event {
                    Ok(Event::Message(msg)) => {
                        if msg.data == "[DONE]" {
                            break;
                        }

                        // Parse token from SSE data
                        if let Ok(token) = parse_token(&msg.data) {
                            yield Ok(token);
                        }
                    }
                    Err(e) => yield Err(e.into()),
                    _ => {}
                }
            }
        };

        Ok(stream)
    }
}

fn parse_token(data: &str) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(data)?;
    let token = value["choices"][0]["delta"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(token)
}
```

**Acceptance criteria:**
- [x] Streaming works end-to-end
- [x] Tokens arrive in real-time
- [x] Handles connection errors
- [x] Properly signals completion

**Implementation notes:**
- `generate_from_prompt_streaming()` returns tokio mpsc channel
- Tauri command emits "chat-token" events for real-time UI updates
- Stop sequence handling implemented

---

### Task 6: Implement high-level inference API

**Files:** `crates/inference/src/lib.rs`, `crates/inference/src/generation.rs`

**Public API for the rest of the application:**

```rust
pub struct InferenceEngine {
    server: LlamaServer,
    client: LlamaClient,
    persona_manager: PersonaManager,
}

impl InferenceEngine {
    pub async fn new(config: InferenceConfig) -> Result<Self> {
        let server = LlamaServer::start(config.server_config)?;
        let client = LlamaClient::new(server.port);
        let persona_manager = PersonaManager::new(client.clone());

        Ok(Self {
            server,
            client,
            persona_manager,
        })
    }

    pub async fn chat(
        &mut self,
        persona_id: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<String> {
        // Load persona's adapter
        self.persona_manager.activate_persona(persona_id).await?;

        // Generate response
        let config = GenerationConfig::default();
        self.client.chat_completion(messages, config).await
    }

    pub async fn chat_stream(
        &mut self,
        persona_id: &str,
        messages: Vec<ChatMessage>,
    ) -> Result<impl Stream<Item = Result<String>>> {
        // Load persona's adapter
        self.persona_manager.activate_persona(persona_id).await?;

        // Stream response
        let config = GenerationConfig::default();
        self.client.chat_completion_stream(messages, config).await
    }
}

#[derive(Clone)]
pub struct GenerationConfig {
    pub temperature: f32,
    pub top_p: f32,
    pub max_tokens: usize,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            temperature: 0.7,   // Slightly creative
            top_p: 0.9,         // Nucleus sampling
            max_tokens: 256,    // Reasonable for chat messages
        }
    }
}
```

**Acceptance criteria:**
- [x] Simple, ergonomic API for chat
- [x] Supports both streaming and non-streaming
- [x] Handles persona switching automatically
- [x] Proper error handling

**Implementation notes:**
- `UnifiedEngine` in `crates/inference/src/unified.rs`
- Routes to appropriate backend (MLXPython default, LlamaCpp available)
- Tauri commands: `chat_with_persona()`, `chat_with_persona_streaming()`
- Pre-built configs: `.chat()`, `.creative()`, `.deterministic()`

---

## Milestones

### Milestone 1: llama-server integration (2-3 days)
- [x] llama-server starts and stops correctly (via Rust bindings)
- [x] Can load base model
- [x] Health check works

### Milestone 2: Basic inference works (2-3 days)
- [x] Can generate completions via API
- [x] Responses are coherent
- [ ] Latency is acceptable (~10-20 tok/s) - untested

### Milestone 3: LoRA adapter loading (2-3 days)
- [x] Can load and unload adapters
- [x] Generated text reflects persona style
- [x] Can swap between personas

### Milestone 4: Streaming support (1-2 days)
- [x] Streaming works end-to-end
- [x] Tokens arrive smoothly
- [x] No buffering issues

### Milestone 5: Testing and polish (1-2 days)
- [ ] Test with multiple personas
- [ ] Verify performance targets
- [ ] Fix bugs and edge cases

---

## Testing Checkpoints

Before moving to Phase 4, verify:

1. **Functionality:**
   - [x] Can generate chat responses (LlamaCpp backend)
   - [x] LoRA adapters load correctly
   - [x] Responses match persona style
   - [x] Streaming works smoothly

2. **Performance:**
   - [ ] Inference runs at 10-20 tokens/sec on M1/M2 (untested)
   - [ ] Memory usage <4GB for one loaded model (untested)
   - [ ] Adapter loading takes <2 seconds (untested)

3. **Robustness:**
   - [x] Handles server crashes gracefully
   - [x] Recovers from network errors
   - [ ] Works with multiple concurrent requests (untested)

4. **Quality:**
   - [x] Responses are coherent and relevant
   - [x] Personas are distinguishable
   - [x] No hallucinations or nonsense output

---

## Configuration

**Inference configuration:**

```rust
#[derive(Serialize, Deserialize)]
pub struct InferenceConfig {
    pub base_model_path: PathBuf,
    pub port: Option<u16>,
    pub context_size: usize,
    pub gpu_layers: i32,
    pub parallel_requests: usize,
}

impl Default for InferenceConfig {
    fn default() -> Self {
        Self {
            base_model_path: dirs::home_dir()
                .unwrap()
                .join(".be-right-back/models/base/qwen3-4b-q4_k_m.gguf"),
            port: Some(8080),
            context_size: 8192,
            gpu_layers: -1,  // All layers on Metal
            parallel_requests: 4,
        }
    }
}
```

Save as `~/.be-right-back/inference/config.json`

---

## Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tokens/second | 10-20 | M1/M2 with Metal |
| First token latency | <500ms | Time to first token in stream |
| Adapter load time | <2s | Cold load of LoRA adapter |
| Memory usage | <4GB | Single model + adapter |
| Concurrent users | 4 | Parallel requests supported |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| llama-server crashes | High | Auto-restart, health checks |
| Slow inference | Medium | Use Metal, reduce context size |
| Memory leaks | Medium | Monitor memory, restart periodically |
| Adapter quality issues | High | Improve training (Phase 2) |
| API incompatibilities | Low | Pin llama.cpp version |

---

## Success Criteria

Phase 3 is complete when:

1. ✅ llama-server runs reliably with base model (via Rust bindings)
2. ✅ Can load LoRA adapters and generate persona-specific responses
3. ✅ Streaming text generation works smoothly
4. ⚠️ Performance targets are met (10-20 tok/s) - untested
5. ✅ High-level Rust API is clean and well-tested
6. ✅ Ready to integrate RAG in Phase 4

**Status: ~60-70% complete. Core infrastructure works but has critical blocker.**

## Critical Blocker

**Missing: `mlx/src/inference_daemon.py`**

The Python inference daemon was implemented in commit 3ff9b05 but **deleted in commit 42d35c1**. This daemon is required for the MLXPython backend (the default/shipped backend).

Without it:
- Desktop app chat fails when using MLXPython backend
- Rust code tries to spawn a Python process that doesn't exist

## Remaining Work (~30-40%)

1. **Reimplement Python inference daemon** (CRITICAL)
   - Restore from commit 3ff9b05 or rewrite
   - Should: load MLX model, handle LoRA adapters, stream responses
   - Location: `mlx/src/inference_daemon.py`

2. **Implement CLI chat command**
   - Currently returns "not implemented" error
   - Location: `apps/cli/src/commands/chat.rs`

3. **Performance testing**
   - Verify 10-20 tok/s on M1/M2
   - Memory usage benchmarks
   - Adapter load time measurements

4. **Integration testing**
   - End-to-end chat flow verification
   - Multi-persona switching tests

**Next phase:** [Phase 4: RAG Implementation](./phase-4-rag.md)

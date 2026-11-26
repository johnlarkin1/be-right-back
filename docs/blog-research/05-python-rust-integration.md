# Research Report: Bundling Python Inside a Rust Desktop App

> Reference material for writing about the Python ↔ Rust integration and distribution story
> Generated: 2026-04-03

---

## What You Built

A Tauri (Rust) desktop app that bundles a complete Python 3.13 environment, spawns Python subprocesses for ML tasks, communicates via JSON-lines over stdout/stdin/UDS, and signs + notarizes everything for macOS distribution. Five distinct Python entry points, each with its own IPC protocol.

---

## Architecture

```
Tauri App (.app bundle)
  ├── Rust binary (main process)
  │     ├── Spawns Python subprocesses for ML tasks
  │     ├── Communicates via JSON-lines on stdout (embed, train, analytics)
  │     ├── Communicates via UDS socket (inference daemon)
  │     └── Parses structured progress events for UI updates
  │
  ├── Bundled Python 3.13.9 (resources/)
  │     ├── python3.13 binary
  │     ├── uv (package manager)
  │     └── MLX scripts (copied from mlx/src/)
  │
  └── Virtual environment (~/.be-right-back/mlx-venv/)
        ├── Created on first launch via uv
        └── MLX, DuckDB, sentence-transformers, etc.
```

---

## Five Python Entry Points

| Script | Communication | Lifecycle | Purpose |
|--------|--------------|-----------|---------|
| `embed.py` | JSON-lines on stdout | Short-lived subprocess | Embedding generation + HNSW/FTS indexing |
| `train.py` | JSON-lines on stdout | Short-lived subprocess | LoRA fine-tuning with progress callbacks |
| `analytics.py` | JSON-lines on stdout | Short-lived subprocess | PCA + UMAP + HDBSCAN clustering |
| `analyze_persona.py` | JSON on stdin/stdout | Short-lived subprocess | Two-phase personality profiling |
| `inference_daemon.py` | UDS socket (JSON protocol) | Long-lived daemon | Model serving (generate, stream, embed_query) |

---

## JSON-Lines IPC Protocol

### Short-Lived Subprocesses (embed, train, analytics)

Rust spawns a Python subprocess and reads its stdout line-by-line. Each line is a JSON object with a `type` tag:

```json
{"type": "stage_progress", "stage": "chunking", "percent": 50, "message": "Processing contacts...", "stats": {...}, "current_contact": {...}}
{"type": "result", "success": true, "data": {"chunks_created": 1234, "embeddings_generated": 1234}}
{"type": "log", "level": "info", "message": "Loaded model in 2.3s"}
```

Rust side (`crates/ingestion/src/python.rs`):
```rust
let env = PythonEnvironment::get()?;
let mut child = Command::new(&env.python_bin)
    .arg(env.script(scripts::EMBED))
    .arg("--db-dir").arg(&db_dir)
    .stdout(Stdio::piped())
    .spawn()?;

for line in BufReader::new(child.stdout.take().unwrap()).lines() {
    let msg: PythonMessage = serde_json::from_str(&line?)?;
    match msg {
        PythonMessage::StageProgress { stage, percent, .. } => {
            // Update UI via Tauri events
        }
        PythonMessage::Result { success, data } => {
            // Handle completion
        }
        PythonMessage::Log { level, message } => {
            // Forward to tracing
        }
    }
}
```

### Long-Lived Daemon (inference_daemon.py)

The inference daemon uses Unix Domain Sockets (UDS) for bidirectional communication:

```
Rust ──── UDS socket ────► Python daemon
  │                           │
  ├── Request: {"type": "generate", "prompt": "...", "max_tokens": 500}
  │                           │
  └── Response: {"type": "generate_response", "text": "...", "tokens": 142}
     OR streaming: {"type": "token", "text": "Hello"} × N
                   {"type": "generate_complete", "tokens": 142}
```

Daemon is long-lived — loads model once, serves requests until shutdown. Socket path: `~/.be-right-back/inference.sock`.

---

## The Bundle Pipeline

### Development (`make prepare-bundle-dev`)
1. Creates `~/.be-right-back/mlx-venv/` virtual environment
2. Installs MLX dependencies via `uv pip install`
3. Copies Python scripts from `mlx/src/` to `~/.be-right-back/mlx/`

### Production (`make build-desktop`)
1. **Download Python 3.13.9** — standalone build from `python-build-standalone`
2. **Download uv** — package manager binary
3. **Copy MLX scripts** to `resources/` directory inside app bundle
4. **Build Tauri app** — `npm run tauri build` → .app bundle + DMG

### Release (`scripts/release/release.sh`)
1. Bump version in VERSION, tauri.conf.json, package.json, Cargo.toml, Cargo.lock
2. Prepare bundle (Python + uv + MLX scripts)
3. **Sign embedded binaries** — python3.13, uv, all .dylib files
   - Uses `codesign` with "Developer ID Application" identity
   - `Entitlements-embedded.plist`: JIT, unsigned memory, library validation disabled
4. Build Tauri app (`npm run tauri build`)
5. **Post-build re-sign** — find any unsigned Mach-O binaries Tauri missed
6. **Verify** — `codesign --verify --deep --strict` on the .app
7. Create DMG volume
8. **Notarize** — Apple App Store Connect API (`notarytool submit`)
9. **Staple** — attach notarization ticket to DMG
10. Commit, tag, push to GitHub
11. Create GitHub Releases on both private + public repos

---

## Version Pinning Hell

### Critical Pins

| Dependency | Pin | Why |
|-----------|-----|-----|
| Python | `>=3.13,<3.14` | Bundled 3.13.9, numba/llvmlite require 3.13+ |
| DuckDB (Python) | `==1.4.4` | VSS extension binary must match Rust exactly |
| DuckDB (Rust) | `= 1.4.4` | VSS extension binary must match Python exactly |
| mlx-lm | `>=0.31.3` | Qwen3.5 DeltaNet architecture support (must stay a PyPI dependency, never `git+`) |
| numba | `>=0.61.0` | Python 3.13 support |
| llvmlite | `>=0.44.0` | Python 3.13 support |

### The DuckDB Version Mismatch Story
- DuckDB's VSS (Vector Similarity Search) extension is a compiled binary
- Python and Rust DuckDB both load the same VSS extension
- If Python uses DuckDB 1.4.2 and Rust uses 1.4.4, the VSS extension ABI mismatches
- Result: silent crashes, corrupted HNSW indexes, or segfaults
- Fix: exact version pin on both sides
- Empirically validated in `experiments/duckdb-index-compat/` (18/18 tests pass at matched 1.4.4)

### The mlx-lm 0.28+ API Break
- `generate()` removed the `temp=` parameter
- Must use `make_sampler(temp=temperature, top_p=top_p)` and pass `sampler=`
- `repetition_penalty` also moved to `make_logits_processors()`
- Not documented in changelog — had to read source code to discover
- Inference daemon was passing `temp=` → got `generate_step() got an unexpected keyword argument 'temp'`

---

## PythonEnvironment Management

### The Abstraction
```rust
// crates/common/src/python_env.rs
pub struct PythonEnvironment {
    pub python_bin: PathBuf,    // Path to python3.13
    pub scripts_dir: PathBuf,   // Path to MLX scripts
}

impl PythonEnvironment {
    pub fn get() -> Result<Self> { ... }  // For CLI/non-Tauri
    pub fn ensure() -> Result<Self> { ... }  // For Tauri (creates venv if needed)
    pub fn script(&self, name: &str) -> PathBuf { ... }
}
```

### Script Name Constants
```rust
// crates/common/src/python_env.rs
pub mod scripts {
    pub const EMBED: &str = "embed.py";
    pub const TRAIN: &str = "train.py";
    pub const ANALYTICS: &str = "analytics.py";
    pub const ANALYZE_PERSONA: &str = "analyze_persona.py";
    pub const INFERENCE_DAEMON: &str = "inference_daemon.py";
    pub const RERANK: &str = "rerank.py";
    pub const EMBED_QUERY: &str = "embed_query.py";
}
```

### Two Modes
- **Dev**: Python from `~/.be-right-back/mlx-venv/bin/python3`, scripts from repo
- **Bundled**: Python from app bundle `Resources/`, scripts from app bundle
- Feature flag `tauri-support` enables `PythonEnvironment::ensure()` which auto-creates venv

---

## Subprocess Error Handling

### Current State (Known Gaps)
- `panic!()` on malformed daemon output (8 locations — ship-blocker)
- No socket read timeout on daemon connection
- Silent `except Exception: pass` in Python (broad exception handling)
- NaN embeddings silently converted to 0 via `nan_to_num`
- No subprocess orphan cleanup on cancellation

### Graceful Degradation Pattern
- Personality analysis returns `None` on failure (doesn't crash pipeline)
- Cross-encoder reranking falls back to unreranked results on failure
- AddressBook integration degrades gracefully (warns + continues)
- 5-second timeout on reranker subprocess with `try_wait()` + `child.kill()`

---

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Python environment management | `crates/common/src/python_env.rs` | — |
| Subprocess spawning (embed) | `crates/ingestion/src/python.rs` | — |
| Daemon connection (UDS) | `crates/inference/src/daemon_connection.rs` | — |
| Daemon protocol (JSON messages) | `crates/inference/src/engines/mlx_python/protocol.rs` | — |
| Daemon manager (lifecycle) | `crates/inference/src/daemon_manager.rs` | — |
| Inference daemon (Python) | `mlx/src/entry/inference_daemon.py` | 1,267 |
| Training entry point (Python) | `mlx/src/core/train.py` | 376 |
| Embedding pipeline (Python) | `mlx/src/pipelines/embedding.py` | 764 |
| Release script | `scripts/release/release.sh` | — |
| Bundle preparation | `Makefile` (prepare-bundle targets) | — |
| Entitlements (main) | `apps/desktop/src-tauri/Entitlements.plist` | — |
| Entitlements (embedded) | `apps/desktop/src-tauri/Entitlements-embedded.plist` | — |

---

## Narrative Angles

1. **"Python inside Rust inside Tauri inside a DMG"** — The matryoshka doll of desktop app bundling. Downloading, signing, notarizing, and shipping a Python interpreter alongside a Rust binary.

2. **"JSON-lines: the protocol that's uglier than gRPC but actually works"** — Why structured stdout parsing beats sockets for short-lived ML subprocesses, and where it breaks down (the daemon).

3. **"Version pinning as a survival strategy"** — DuckDB, mlx-lm, numba, llvmlite, Python itself. Any of these drifting by a patch version causes silent data corruption or crashes.

4. **"Code signing Python for Apple"** — You can't just ship a Python binary on macOS. It needs entitlements for JIT (because NumPy), library validation exceptions (because C extensions), and a Developer ID signature.

5. **"The 8 panics that could crash your app"** — daemon_connection.rs and protocol.rs assume well-formed JSON from Python. When the daemon OOMs or sends garbage, the Rust side panics instead of recovering.

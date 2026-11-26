# Be Right Back - Development Roadmap

**Timeline:** 6-8 weeks (November 2025 - January 2026)

This roadmap outlines the development phases for building Be Right Back, a local-first macOS application that creates a "Digital You" AI persona from your own iMessage history.

## Overview

The project follows an incremental development approach, building from foundational data processing through to a polished desktop application. Each phase has clear deliverables and testing checkpoints.

### Core Product Philosophy

**"Digital You"** - Train an AI persona on YOUR sent messages to create a chatbot that texts like you. This compliance-friendly approach only uses messages you've written, not messages from others.

### Three Main Features

1. **"Digital You" Chat** - Train on your messages → chat with your digital self
2. **Conversation Search** - @mention contacts → RAG-powered Q&A about specific conversations
3. **Insights Dashboard** - Global overview + per-contact analytics

### Architecture Principles

- **Local-first**: All processing happens on-device; no cloud dependencies
- **Privacy-preserving**: User data never leaves their machine
- **Compliance-friendly**: Only trains on user's own sent messages
- **Modular design**: Separate concerns (ingest, training, inference, UI)
- **Storage convention**: All app data stored in `~/.be-right-back/`

### File Storage Structure

```
~/.be-right-back/
├── data/
│   ├── raw/              # Raw iMessage conversation exports
│   ├── processed/        # Cleaned JSONL training data
│   ├── embeddings/       # Vector embeddings for RAG
│   └── stats/            # Analytics and conversation statistics
├── models/
│   ├── base/             # Base LLM models (Qwen3-4B, etc.)
│   └── personas/         # LoRA adapters for each contact
│       ├── {contact_id}/
│       │   ├── adapter.gguf
│       │   ├── metadata.json
│       │   └── training_stats.json
├── data/
│   └── db/
│       ├── brb.db           # SQLite metadata
│       └── brb.duckdb       # DuckDB vectors for RAG and analytics
└── logs/                 # Application logs and debugging info
```

---

## Phase 1: Data Ingestion CLI (Week 1-2) ✅

**Status:** 🟢 Complete (January 2025)

**Goal:** Build a working CLI tool that parses iMessage database and generates training data

**Deliverables:**

- ✅ Unified CLI binary (`brb`) in `apps/cli/` (improved from original `brb-ingest` plan)
- ✅ iMessage database parser in `crates/messages-db/` (handles `chat.db` SQLite schema)
- ✅ JSONL export functionality in `crates/training/` for supervised fine-tuning
- ✅ Contact/phone number search and filtering

**Testing Checkpoints:**

- ✅ Successfully parse Messages database on macOS
- ✅ Generate valid JSONL from real conversation data
- ✅ Handle edge cases (attachments, system messages, emoji)

**Enhancements beyond original plan:**

- LLM-based persona analysis during export
- System prompt generation from message patterns
- Full ingestion pipeline (snapshot → embeddings → vector DB)

[See detailed breakdown →](./phase-1-ingest.md)

---

## Phase 2: Model Training Pipeline (Week 2-3) 🟡

**Status:** 🟡 ~90% Complete (January 2025)

**Goal:** Implement LoRA fine-tuning using MLX-LM on Apple Silicon

**Deliverables:**

- ✅ Python training scripts in `mlx/src/` using MLX-LM
- ✅ Rust subprocess wrapper in `crates/training/src/python.rs`
- ✅ LoRA adapter conversion to GGUF in `mlx/src/core/convert_to_gguf.py`
- ✅ Training progress callbacks with early stopping
- 🟡 Real-time progress streaming to frontend (partial)

**Testing Checkpoints:**

- ✅ Successfully fine-tune base model on sample conversation data
- ✅ Verify adapter quality through manual testing
- ✅ Confirm training completes within resource constraints (8-16GB RAM)

**Remaining work:**

- Wire real-time progress streaming to frontend
- Expose checkpoint resume via CLI/Tauri
- Pre-training data quality validation

[See detailed breakdown →](./phase-2-training.md)

---

## Phase 3: Inference Pipeline (Week 3-4) 🟡

**Status:** 🟡 ~60-70% Complete (January 2025)
**Blocker:** Python inference daemon deleted, needs reimplementation

**Goal:** Integrate llama.cpp for on-device inference with LoRA adapters

**Deliverables:**

- ✅ llama.cpp integration via `llama-cpp-2` Rust crate
- ✅ LoRA adapter loading and swapping (LlamaCpp backend)
- ✅ Rust API for text generation (`UnifiedEngine`)
- ✅ Streaming response support (tokio channels + Tauri events)
- ✅ Tauri commands (`chat_with_persona`, `chat_with_persona_streaming`)
- ❌ Python inference daemon (`mlx/src/inference_daemon.py` deleted)
- ❌ CLI chat command (returns "not implemented")

**Testing Checkpoints:**

- ✅ Load base model + LoRA adapter successfully
- ✅ Generate responses that match contact's style
- ⚠️ Achieve 10-20 tokens/sec on Apple Silicon (untested)

**Critical remaining work:**

- Reimplement `mlx/src/inference_daemon.py` (was in commit 3ff9b05)
- Implement CLI chat command
- Performance benchmarking

[See detailed breakdown →](./phase-3-inference.md)

---

## Phase 4: RAG Implementation (Week 4-5) 🟡

**Status:** 🟡 ~85-90% Complete (January 2025)
**Gap:** Backend ready, but not integrated into inference pipeline

**Goal:** Add retrieval-augmented generation for contextual memory

**Deliverables:**

- ✅ Embedding generation pipeline (`mlx-community/nomicai-modernbert-embed-base-8bit`, 768-dim)
- ✅ DuckDB integration with VSS extension and HNSW indexes
- ✅ Similarity search with deduplication (`crates/ingestion/src/search.rs`)
- ✅ Batch embedding pipeline (~366 chunks/sec)
- ❌ Context retrieval integrated into inference
- ❌ Tauri search commands for UI
- ❌ Token budget management

**Testing Checkpoints:**

- ✅ Retrieve relevant past messages given a query
- ❌ Verify RAG improves response quality (not integrated)
- ✅ Benchmark query performance (sub-100ms retrieval)

**Remaining work:**

- Create public RAG API (`RAGEngine`)
- Add `chat_with_rag()` to inference
- Add Tauri `search_messages()` command
- Token counting and context truncation

[See detailed breakdown →](./phase-4-rag.md)

---

## Phase 5: Tauri Integration (Week 5-6) 🟢

**Status:** 🟢 ~85-90% Complete (January 2025)

**Goal:** Connect Rust backend to React frontend via Tauri commands

**Deliverables:**

- ✅ Tauri command API for all core functionality (19 commands across 9 files)
- ✅ React state management via custom hooks (8 hooks, 1,163 lines)
- ✅ IPC layer for streaming responses (`chat-token`, `ingestion-progress`, `training-status`)
- ✅ Error handling and user feedback (Result<T, String> pattern)
- 🟡 Global state store (Zustand planned but not implemented)

**Testing Checkpoints:**

- ✅ Frontend can invoke ingestion, training, and inference
- ✅ Real-time progress updates during training
- ✅ Smooth token streaming in chat interface

**Remaining work:**

- Add Zustand global store for persona/chat state
- Implement React error boundary
- Fix training progress TODO

[See detailed breakdown →](./phase-5-tauri-integration.md)

---

## Phase 6: UI Polish & Features (Week 6-7) 🟡

**Status:** 🟡 ~70-75% Complete (January 2025)

**Goal:** Build a polished CRT terminal-style user interface

**Deliverables:**

- ✅ CRT design system (95%): globals.css with terminal colors, VT323/IBM Plex fonts, glow/scanline effects
- ✅ Chat interface (75%): ChatLayout, MessageBubble, ChatInput with terminal styling
- 🔴 Conversation Search (20%): UI shell only, RAG disabled (blocked by Phase 4 integration)
- ✅ Insights Dashboard (85%): Timeline, heatmap, word cloud, semantic space visualizations
- ✅ App navigation (90%): TopBar with tabs, AppShell with CRT effects, wandering ghost

**Testing Checkpoints:**

- ✅ UI feels responsive and native
- ✅ Users can manage personas via sidebar
- ✅ Analytics provide useful insights (visualizations working)
- 🔴 Search with @mentions (blocked)

**Remaining work:**

- Implement RAG search backend (Casper Q&A)
- Add @mention autocomplete
- Connect streaming inference to chat display

[See detailed breakdown →](./phase-6-ui-polish.md)

---

## Phase 7: Optimization & Testing (Week 7-8) 🔴

**Status:** 🔴 ~20-25% Complete (January 2025)

**Goal:** Performance tuning, comprehensive testing, and bug fixes

**Deliverables:**

- 🟡 Rust unit tests (30%): 54 test functions in messages-db, training, ingestion
- 🔴 Frontend tests (0%): No Jest/Vitest setup
- 🟡 Logging (60%): Tracing initialized, no persistent logs
- 🔴 Performance profiling: No flamegraph or benchmarks
- 🟡 Basic optimizations: mmap enabled, batch processing, caching

**Testing Checkpoints:**

- ⚠️ App runs smoothly on 8GB M1 MacBook (untested)
- ⚠️ No memory leaks during extended use (untested)
- ⚠️ Graceful degradation when resources are constrained (untested)

**Remaining work:**

- Set up Jest/Vitest for frontend tests
- Add coverage metrics (cargo-tarpaulin)
- Implement performance profiling
- Add memory leak detection
- Create benchmarks for inference/training

[See detailed breakdown →](./phase-7-optimization.md)

---

## Phase 8: Distribution (Week 8+) 🔴

**Status:** 🔴 ~35-40% Complete (January 2025)

**Goal:** Package and distribute the application for end users

**Deliverables:**

- ✅ Bundle configuration (80%): tauri.conf.json with DMG target, Python bundling scripts
- 🔴 Code signing: No signing identity configured
- 🔴 Notarization: No entitlements.macos.plist or notarization scripts
- 🟡 Documentation (50%): Website framework, How It's Built content
- 🟡 Website (60%): Deployed on Vercel, download page structure planned
- 🔴 Beta program (0%): No infrastructure

**Testing Checkpoints:**

- ⚠️ Installer works on fresh macOS installs (untested - not signed)
- ⚠️ App passes Gatekeeper verification (blocked - no notarization)
- ⚠️ Users can grant Full Disk Access (entitlements needed)

**Remaining work:**

- Create entitlements.macos.plist with Full Disk Access
- Set up Apple Developer account
- Add code signing identity to tauri.conf.json
- Implement notarization scripts
- Create actual download link on website
- Set up beta testing program

[See detailed breakdown →](./phase-8-distribution.md)

---

## Success Metrics

By the end of this roadmap, we will have:

1. **"Digital You" Persona**: Users can train an AI that texts like them, using only their own sent messages
2. **Conversation Search**: Users can @mention contacts to query their conversation history via RAG
3. **Insights Dashboard**: Users can view messaging analytics (global + per-contact)
4. **Local-first architecture**: All processing happens on-device with no external dependencies
5. **Performance targets met**:
   - Training completes in 15-90 minutes on M1/M2 hardware
   - Inference runs at 10-20 tokens/sec
   - RAG queries complete in <200ms
   - App uses <4GB RAM during normal operation
6. **CRT Terminal Aesthetic**: Ominous, retro-tech UI with scanlines, ghosts, and green glow
7. **Ready for beta testing**: Distributable package for early adopters

---

## Next Steps

**Immediate focus (Week 1):**

- Start with Phase 1: Build the ingestion CLI
- Set up development environment and tooling
- Create initial data structures in `crates/common`

## Important

- Explore why upgrading to mlx-lm 0.29 breaks things compared to 0.28

**See Phase 1 details →** [phase-1-ingest.md](./phase-1-ingest.md)

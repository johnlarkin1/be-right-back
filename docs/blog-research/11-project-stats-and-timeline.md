# Research Report: Project Stats & Timeline

> Reference material for "building in public" posts — the meta-story of building BRB
> Generated: 2026-04-03

---

## Timeline

| Date | Milestone |
|------|-----------|
| 2025-11-06 | First commit (`[init] checking in claude phases for train reading`) |
| 2025-11 | Phase 1: Ingestion CLI (`brb` command, 9 subcommands) |
| 2025-11/12 | Phase 2-4: JSONL export, training pipeline, inference |
| 2025-12 | Phase 5-6: RAG search, desktop app scaffolding |
| 2026-01 | Phase 7: Insights analytics, dual UI theme |
| 2026-01/02 | Phase 8: Distribution (codesigning, notarization, DMG) |
| 2026-02 | Website launch on Vercel (berightback.xyz) |
| 2026-03-04 | Qwen3.5 architecture research + migration from Qwen3 |
| 2026-03-14 | NEXT_UP.md assessment: ~85% complete |
| 2026-03-15 | Shipping readiness plan created |
| 2026-03-28 | TurboQuant KV cache compression spike (didn't work for 9B) |
| 2026-04-03 | Current state |

**Project age**: ~5 months
**Status**: v0.1.0, pre-beta

---

## Codebase Numbers

| Metric | Value |
|--------|-------|
| **Total commits** | 169 |
| **Rust lines** (crates/) | 19,390 |
| **Python lines** (mlx/src/) | 8,437 |
| **TypeScript lines** (desktop) | 24,161 |
| **Total hand-written code** | ~52,000 lines |
| **Rust crates** | 6 (common, messages-db, training, personas, ingestion, inference) |
| **Rust tests** | 294 `#[test]` across 42 files |
| **Frontend tests** | 300+ Vitest component tests |
| **E2E tests** | 33 Playwright tests |
| **Documentation files** | ~60 (docs/) |
| **Model cards** | 6 (Phi-4, Qwen3 x2, Qwen3.5 x3) |
| **Research docs** | 3 (Qwen3.5 architecture, TurboQuant, MLX-RS) |

---

## Architecture Complexity

| Dimension | Count |
|-----------|-------|
| Programming languages | 3 (Rust, Python, TypeScript) |
| Databases | 2 (SQLite for metadata, DuckDB for vectors) |
| ML models | 3 types (base LLM, embedding model, cross-encoder) |
| IPC protocols | 2 (JSON-lines on stdout, UDS socket) |
| Python entry points | 5 (embed, train, analytics, analyze_persona, inference_daemon) |
| Tauri commands | 24+ |
| Event channels | 6 |
| Zustand stores | 4 |
| LoRA target module families | 2 (standard Transformer, DeltaNet hybrid) |

---

## Key File Sizes (Largest Implementation Files)

| File | Lines | What |
|------|-------|------|
| `crates/ingestion/src/query_planner.rs` | 1,278 | Query understanding + 66 tests |
| `mlx/src/entry/inference_daemon.py` | 1,267 | Long-lived model serving daemon |
| `crates/inference/src/agent/mod.rs` | 1,240 | Tool-calling agent loop |
| `crates/ingestion/src/search.rs` | 1,184 | Hybrid search + 22 tests |
| `mlx/src/pipelines/embedding.py` | 764 | Embedding generation pipeline |
| `crates/ingestion/src/vectordb.rs` | 381 | DuckDB vector operations |
| `mlx/src/core/train.py` | 376 | LoRA training orchestration |
| `crates/messages-db/src/utils/attributed_body.rs` | 339 | ObjC FFI for NSAttributedString |
| `crates/ingestion/src/rerank.rs` | 252 | Cross-encoder bridge |
| `crates/ingestion/src/context_builder.rs` | 194 | LLM context formatting |

---

## What's Working (End-to-End)

- [x] iMessage database snapshot + parsing
- [x] Contact listing with AddressBook display names
- [x] JSONL training data export
- [x] LoRA fine-tuning on Apple Silicon (MLX)
- [x] Persona inference (generate text in someone's style)
- [x] Token streaming for persona chat
- [x] 768-dim embedding generation (ModernBERT)
- [x] HNSW + FTS index creation
- [x] Hybrid search (semantic + BM25 + RRF)
- [x] Query planning (18 temporal patterns)
- [x] Cross-encoder reranking
- [x] Tool-calling agent (Casper) with 5 tools
- [x] Desktop app with 3 views (home, chat, insights)
- [x] Dual theme system (retro/modern)
- [x] Codesigning + notarization + DMG
- [x] Website with 8 technical articles

---

## What's Not Working / Stubbed

- [ ] Semantic Space visualization (15+ NotImplementedError)
- [ ] Model download from HuggingFace (creates empty dir)
- [ ] Casper token streaming (simulated)
- [ ] Cancellation (frontend buttons, no backend)
- [ ] Settings panel (disabled button)
- [ ] Eval framework (zero implementation)
- [ ] Contact exclusion
- [ ] Data deletion
- [ ] Incremental embedding

---

## Models Used

| Role | Model | Size | Quantization |
|------|-------|------|-------------|
| Base LLM (training + inference) | Qwen3.5-9B | 9B params | 4-bit (~5GB) |
| Agent model (Casper) | Qwen3.5-9B | 9B params | 4-bit (~5GB) |
| Embedding model | nomicai-modernbert-embed-base | — | 8-bit |
| Cross-encoder (reranking) | ms-marco-MiniLM-L-6-v2 | 22M params | Full precision |

---

## Narrative Angles

1. **"5 months, 52K lines, 3 languages"** — The scope of building a local-first AI app from scratch. Not a wrapper around an API — a full ML pipeline + desktop app + website.

2. **"The 85% trap"** — The project is 85% done. The remaining 15% (evals, privacy features, polish, distribution) is the hardest part. Every "last mile" cliche is true.

3. **"169 commits of learning in public"** — The commit history as a learning journal. From initial ingestion to Qwen3.5 DeltaNet to TurboQuant experiments.

4. **"3 languages, 2 databases, 5 Python entry points"** — The complexity that accumulates when you refuse to use cloud services. Every cloud API you avoid becomes code you maintain.

5. **"What I'd do differently"** — Hindsight on architecture choices, model selection evolution (Phi-4 → Qwen3 → Qwen3.5), the DuckDB version pinning discovery, the mlx-lm API break.

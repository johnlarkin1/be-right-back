# Shipping Readiness Plan

> **Created:** 2026-03-15
> **Status:** Not Started
> **Goal:** Close the gaps between current state (~85%) and a confident v0.2.0 beta release

This plan consolidates findings from a full codebase audit (Rust, Python, TypeScript) into a prioritized execution plan. Work is organized into 3 tiers by ship-blocking severity, then broken into sprints.

---

## Current State Summary

| Area | Completion | Key Gap |
|------|-----------|---------|
| Data Ingestion | 100% | Done |
| Training Pipeline | 95% | LoRA config not tuned, no data filtering |
| Inference Engine | 98% | Phase 9 merged to main, generation params ignored |
| RAG / Hybrid Search | 95% | No reranker timeout, no incremental embedding |
| Casper Agent | 90% | Simulated streaming, blocking embed_query |
| Desktop App UI | 92% | Viz clusters stubbed, settings disabled, accessibility gaps |
| Python ML Pipeline | 95% | Silent failures, broad exception handling |
| Evals & Quality | 0% | Zero implementation |
| Distribution | 80% | Needs beta testing, clean Mac E2E test |

**Test Coverage:** 272 Rust tests, 300+ frontend component tests, 931 lines Python tests. No integration tests across crate boundaries. No Tauri command tests.

---

## Tier 1: Fix Before Shipping (Ship-Blockers)

### 1.1 Replace panic!() with Result in daemon protocol

**Why:** 8 `panic!()` calls in `daemon_connection.rs` and `protocol.rs` crash the entire Tauri app if the Python daemon sends malformed output. A daemon crash should degrade gracefully, not kill the app.

**Files:**
- `crates/inference/src/daemon_connection.rs` (lines 109, 156, 169, 191)
- `crates/inference/src/engines/mlx_python/protocol.rs` (4 locations)

**Work:**
- [ ] Replace each `panic!("unexpected response type")` with `Err(InferenceError::BackendError(...))`
- [ ] Ensure callers handle the new error variants
- [ ] Add unit tests for malformed daemon responses

**Effort:** Small (1-2 hours)

---

### 1.2 Add socket read timeout to daemon connection

**Why:** If the Python daemon hangs (OOM, deadlock, GPU stall), the Rust thread blocks indefinitely with no recovery path. The app becomes unresponsive.

**Files:**
- `crates/inference/src/daemon_connection.rs`

**Work:**
- [ ] Add `socket.set_read_timeout(Some(Duration::from_secs(30)))` on connection
- [ ] Handle `WouldBlock` / timeout errors gracefully (retry once, then return error)
- [ ] Add timeout to reranker subprocess calls (currently can hang indefinitely per NEXT_UP.md)

**Effort:** Small (1-2 hours)

---

### 1.3 Audit ObjC FFI code in attributed_body.rs

**Why:** 310 lines of `unsafe` Objective-C FFI code marked `"TODO:@larkin - audit this.... ai gen'd"`. This parses iMessage attributed body data — incorrect parsing could silently corrupt training data or crash on edge cases.

**Files:**
- `crates/messages-db/src/utils/attributed_body.rs`

**Work:**
- [ ] Manual audit of all null pointer checks and type coercions
- [ ] Verify correct handling of NSAttributedString edge cases (empty, emoji-only, RTL text, reactions)
- [ ] Add test cases for known edge cases (tapback reactions, link previews, edited messages)
- [ ] Remove or resolve the TODO comment

**Effort:** Medium (half day)

---

### 1.4 Fix blocking embed_query() in async context

**Why:** `crates/inference/src/agent/mod.rs:926` calls synchronous subprocess I/O from an async context, blocking the tokio runtime thread. Under concurrent Casper queries, this starves the thread pool.

**Files:**
- `crates/inference/src/agent/mod.rs` (~line 926-1014)

**Work:**
- [ ] Wrap `embed_query()` call in `tokio::task::spawn_blocking()`
- [ ] Ensure error propagation works across the spawn boundary
- [ ] Test with concurrent agent queries

**Effort:** Small (1-2 hours)

---

### 1.5 Build eval framework (foundation)

**Why:** Zero quality measurement exists. Can't prove personas "sound like the user" or that search returns relevant results. This is existential for the product — the entire value prop is persona fidelity.

**Files (new):**
- `eval/` directory structure
- `eval/fixtures/` — synthetic test data
- `eval/golden/` — golden test set
- `eval/scripts/` — eval runners

**Work (foundation only — full eval strategy in `docs/feature-plans/ai-evals-and-quality-strategy.md`):**
- [ ] Create eval directory structure
- [ ] Build 20-query golden test set (4 per type: recency, temporal, preference, factual, aggregation)
- [ ] Implement basic persona fidelity metric: vocabulary overlap + sentence length distribution KL-divergence
- [ ] Implement basic RAG metric: manual relevance labels for golden set, compute Precision@5
- [ ] Create `make eval` command that runs both and outputs a score report
- [ ] Establish baseline scores before any tuning

**Effort:** Large (2-3 days)

---

## Tier 2: High Impact Improvements

### 2.1 Apply LoRA training config improvements

**Why:** Known config improvements documented but not applied. These directly improve persona quality — the core product differentiator.

**Files:**
- `mlx/src/core/train.py`
- `mlx/src/config/` (training config)
- `mlx/src/data/loaders.py`

**Work:**
- [ ] Set lr=1e-4, alpha=16 (alpha/r=1), target all linear layers, dropout=0.1
- [ ] Add cosine LR schedule with warmup (5% of steps)
- [ ] Implement training data filtering: remove <5 word messages, exact duplicates, media-only (`Loved`/`Liked`/`Emphasized` tapbacks)
- [ ] Add multi-turn context: include 3-5 prior messages as conversation context in training examples
- [ ] Run before/after comparison using eval framework from 1.5

**Effort:** Medium (1-2 days)

---

### 2.2 Wire up ignored generation parameters

**Why:** Phase 9 inference work is already merged to main (`bbd8bf9`). However, several generation parameters are sent from Rust but ignored by `inference_daemon.py`: `stop_sequences`, `top_k`, `frequency_penalty`, `presence_penalty`.

**Files:**
- `mlx/src/entry/inference_daemon.py` — read and apply the parameters
- `crates/inference/src/engines/mlx_python/protocol.rs` — verify they're being sent

**Work:**
- [ ] Read `stop_sequences`, `top_k`, `frequency_penalty`, `presence_penalty` from daemon request
- [ ] Apply to `make_sampler()` and generation loop
- [ ] Test that parameter changes affect output

**Effort:** Small (2-4 hours)

---

### 2.3 Accessibility fixes

**Why:** ~40% accessibility coverage. Missing ARIA roles on modals, missing labels on icon buttons, no focus traps. Required for macOS accessibility compliance.

**Files:**
- `apps/desktop/src/components/CommandPalette.tsx`
- `apps/desktop/src/components/AboutModal.tsx`
- `apps/desktop/src/components/TopBar.tsx`
- `apps/desktop/src/components/Navigation.tsx`
- `apps/desktop/src/components/ShortcutsModal.tsx`

**Work:**
- [ ] Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to all modals
- [ ] Implement focus traps in modals (trap focus on open, restore on close)
- [ ] Add `aria-label` to all icon-only buttons (ghost menu, settings, home icon)
- [ ] Add `role="listbox"` / `role="option"` to CommandPalette results
- [ ] Add `aria-selected` / `aria-current` to Navigation tab buttons
- [ ] Add `aria-expanded` / `aria-controls` to collapsible sections

**Effort:** Medium (1 day)

---

### 2.4 Harden Python error handling

**Why:** Silent failures in the ML pipeline (NaN→0 conversion, broad `except Exception: pass`, no chunk drop logging) make debugging production issues nearly impossible.

**Files:**
- `mlx/src/entry/inference_daemon.py` — socket event loop `except: pass`
- `mlx/src/pipelines/embedding.py` — NaN handling, chunk filtering stats
- `mlx/src/ml/reranker.py` — thread-unsafe global singleton
- `mlx/src/ml/labeling.py` — silent LLM load failure

**Work:**
- [ ] Replace broad `except Exception: pass` with specific exception types + logging
- [ ] Add chunk filtering stats logging (how many chunks dropped and why)
- [ ] Log NaN embedding frequency (currently silent `nan_to_num`)
- [ ] Add thread lock to `_default_reranker` singleton
- [ ] Log warning when cluster labeling falls back to generic labels

**Effort:** Medium (1 day)

---

## Tier 3: Complete the Product

### 3.1 Implement compute_viz_clusters.py

**Why:** 15+ `NotImplementedError` raises. The Semantic Space visualization in the Insights tab is completely non-functional.

**Files:**
- `scripts/dev/compute_viz_clusters.py`

**Work:**
- [ ] Load embeddings from DuckDB
- [ ] t-SNE/UMAP dimensionality reduction to 3D
- [ ] HDBSCAN clustering
- [ ] Cluster label generation (using LLM or TF-IDF top terms)
- [ ] Save results back to DuckDB
- [ ] Wire into insights dashboard

**Effort:** Large (2-3 days)

---

### 3.2 Implement real Casper token streaming

**Why:** Currently simulated at `casper.rs:206`. Users see delayed full responses instead of real-time token-by-token output.

**Files:**
- `apps/desktop/src-tauri/src/commands/casper.rs` (~line 206-301)
- `crates/inference/src/agent/mod.rs`

**Work:**
- [ ] Replace simulated streaming with actual daemon token events
- [ ] Emit Tauri events per token (same pattern as persona chat streaming)
- [ ] Frontend already handles streaming — verify compatibility

**Effort:** Medium (1 day)

---

### 3.3 Implement actual model download

**Why:** `system.rs:979` creates an empty directory instead of downloading from HuggingFace. Base model management UI is non-functional.

**Files:**
- `apps/desktop/src-tauri/src/commands/system.rs` (~line 979)

**Work:**
- [ ] Implement HuggingFace Hub download (using `huggingface-cli` or Python `huggingface_hub`)
- [ ] Add progress reporting via Tauri events
- [ ] Handle partial downloads / resume
- [ ] Verify downloaded model integrity

**Effort:** Medium (1 day)

---

### 3.4 Privacy features (PRD requirements)

**Why:** PSR-2.3 and PSR-2.4 from the PRD are unimplemented. Contact exclusion and data deletion are explicit product requirements.

**Work:**
- [ ] **Contact exclusion list** — UI to select contacts to exclude, filter during ingestion
- [ ] **Data deletion button** — One-click deletion of all app data (`~/.be-right-back/`)
- [ ] Both need Tauri commands + frontend UI

**Effort:** Medium (1-2 days)

---

### 3.5 Cancellation support

**Why:** Frontend has cancel buttons (TrainingModal, useCasperAgent) but backend doesn't implement cancellation. Users can't abort long-running operations.

**Work:**
- [ ] Implement `cancel_training` Tauri command (kill Python subprocess, clean partial artifacts)
- [ ] Implement `cancel_agent_query` Tauri command (send shutdown to agent engine)
- [ ] Handle Python subprocess cleanup on cancel (prevent orphaned processes)
- [ ] Wire frontend cancel buttons to new commands

**Effort:** Medium (1 day)

---

## Execution Plan

### Sprint 1: Stability & Safety (3-4 days)
> Goal: The app doesn't crash on edge cases.

| Task | Effort | Priority |
|------|--------|----------|
| 1.1 Replace panics with Results | 1-2h | Ship-blocker |
| 1.2 Add socket read timeout | 1-2h | Ship-blocker |
| 1.3 Audit ObjC FFI code | 4h | Ship-blocker |
| 1.4 Fix blocking embed_query | 1-2h | Ship-blocker |
| 2.4 Harden Python error handling | 1d | High |
| 2.2 Wire up ignored gen params | 2-4h | High |

### Sprint 2: Quality Infrastructure (3-4 days)
> Goal: Can measure and improve persona quality.

| Task | Effort | Priority |
|------|--------|----------|
| 1.5 Build eval framework | 2-3d | Ship-blocker |
| 2.1 Apply LoRA config improvements | 1-2d | High |

### Sprint 3: UX Completeness (3-4 days)
> Goal: No dead buttons or missing features visible to users.

| Task | Effort | Priority |
|------|--------|----------|
| 2.3 Accessibility fixes | 1d | High |
| 3.2 Real Casper streaming | 1d | Medium |
| 3.3 Actual model download | 1d | Medium |
| 3.5 Cancellation support | 1d | Medium |

### Sprint 4: Product Completion (3-4 days)
> Goal: All PRD requirements met.

| Task | Effort | Priority |
|------|--------|----------|
| 3.1 Viz clusters implementation | 2-3d | Medium |
| 3.4 Privacy features | 1-2d | Medium |

### Post-Sprint: Beta Readiness
- [ ] End-to-end test on clean Mac
- [ ] Performance profiling across M1/M2/M3/M4
- [ ] User documentation / FAQ
- [ ] Recruit 10+ beta testers
- [ ] CHANGELOG.md for v0.2.0

---

## References

- [NEXT_UP.md](../../NEXT_UP.md) — Development roadmap
- [PRD](../PRD.md) — Product requirements
- [Evals Strategy](ai-evals-and-quality-strategy.md) — Full quality measurement plan
- [Casper Improvements](casper-agent-improvement-strategy.md) — Agent fix roadmap
- [Phase 9 Plan](../../claude/phase-9-inference-optimization.md) — Inference optimization details

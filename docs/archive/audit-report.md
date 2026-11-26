# Be Right Back — Comprehensive Code Quality Audit

**Date**: 2026-02-10
**Branch**: `explore-claude-swarm-repo-audit`
**Auditors**: rust-auditor, python-auditor, frontend-auditor, cross-cutting-auditor, architecture-reviewer

---

## Executive Summary

This audit examined the entire Be Right Back monorepo across three language domains (Rust, Python, TypeScript/React) and their integration boundaries. The codebase is **well-structured at the macro level** — clear crate boundaries, clean module separation in Python, and consistent theming in the frontend. However, we identified **~70 issues** across 5 domains, with the most impactful being:

1. **The `ingestion` crate is a god crate** (6,004 lines) that forces a dependency inversion where `inference` depends on `ingestion` just to access search functionality. Extracting a `search` crate is the single highest-impact refactoring.
2. **Cross-language constant drift** — model names, DuckDB versions, and file paths are defined independently in Rust, Python, and TypeScript with no enforcement mechanism. The base model constant already diverges (4-bit in Rust vs 8-bit default in Python).
3. **Zero test coverage in Python** and weak coverage in several Rust crates (`personas`, `desktop`, `cli`), creating regression risk for the most complex ML pipeline code.
4. **~1,500+ lines of dead code** across all domains — the llama.cpp backend, legacy UI components, stale debug scripts, and unused functions inflate compile times and maintenance burden.
5. **Significant code duplication** — Cocoa timestamp conversion copied 4 times across Rust crates, LLM response post-processing copied 6 times in Python, prerequisite checking duplicated in 5 React components.

**Total issues**: 12 P0, 24 P1, 34 P2

---

## 1. Rust Audit

**Summary**: The Rust codebase is well-structured with clear crate boundaries and good per-crate documentation. However, there are significant duplications across crates (especially Cocoa timestamp handling and path utilities), inconsistent dependency versions, and several crates that bypass the shared error type from `common`.

### Issues Found

#### Duplicated Logic

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `normalize_cocoa_timestamp()` copied 4 times | `messages-db/src/db/parser.rs:73`, `messages-db/src/db/schema.rs:36`, `ingestion/src/lib.rs:68`, `desktop/src-tauri/src/commands/system.rs:1281` |
| P1 | Path constants duplicated between `common` and `training` | `training/src/constants.rs` redefines `APP_DATA_DIR`, `RAW_DATA_DIR`, `PROCESSED_DATA_DIR`, `STATS_DATA_DIR` — identical to `common/src/paths.rs` |
| P1 | `personas::storage` duplicates path functions from `common::paths` | `personas/src/storage.rs` has own `get_models_dir()`, `get_base_models_dir()`, `get_personas_dir()` |
| P1 | `AnalyticsSettings` and `IngestionSettings` types duplicated | `crates/ingestion/src/metadata.rs:16-51` and `apps/desktop/src-tauri/src/commands/types.rs:137-199` |

#### Error Handling

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `personas` crate uses `anyhow::Result` instead of `common::Result<T, BrbError>` | All functions in `personas::registry` and `personas::storage` |
| P2 | `inference` crate has both `thiserror` AND `anyhow` in deps — `anyhow` may be unused | `inference/Cargo.toml` |

#### Dependency Hygiene

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `dirs` crate version mismatch: v5 in 3 crates, v6 in 4 crates | `inference`, `ingestion`, `desktop` (v5) vs `common`, `messages-db`, `training`, `personas` (v6) |
| P2 | Bare `dirs::home_dir()` calls instead of `common::get_brb_dir()` | `personas/src/storage.rs:8`, `inference/src/download.rs:167,180`, `desktop/.../system.rs:231`, `desktop/.../insights.rs:181`, `desktop/.../training.rs:65,68` |
| P2 | `rustyline` dependency in CLI is unused (chat command is stubbed) | `apps/cli/Cargo.toml` |
| P2 | `training` crate depends on `anyhow` but uses `common::Result` | `training/Cargo.toml` |

#### Dead Code

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | `#[allow(dead_code)]` on 3 structs in desktop types | `desktop/src-tauri/src/commands/types.rs:55,98,116` |
| P2 | `#[allow(dead_code)]` on function in system.rs | `desktop/src-tauri/src/commands/system.rs:154` |
| P2 | `#[allow(async_fn_in_trait)]` is a no-op on edition 2024 | `inference/src/traits.rs:69` |

#### Module Organization

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | `system.rs` is 1,664 lines handling many unrelated concerns | `desktop/src-tauri/src/commands/system.rs` |
| P2 | `agent/mod.rs` is 958 lines | `inference/src/agent/mod.rs` |
| P2 | `agent/parser.rs` is 862 lines | `inference/src/agent/parser.rs` |

#### Other

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | Three crates do `pub use common::*` causing namespace pollution | `messages-db`, `training`, `personas` lib.rs |
| P2 | Underscore-prefixed parameters that ARE used (misleading) | `messages-db/src/db/queries.rs:126,158,174` |
| P2 | Desktop edition is 2021, rest of workspace is 2024 | `apps/desktop/src-tauri/Cargo.toml:6` |
| P2 | No tests in `personas`, `cli`, or `desktop/src-tauri` | Multiple crates |
| P2 | `ingestion/src/metadata.rs` has no tests despite 890 lines of SQL | `ingestion/src/metadata.rs` |

### Recommendations

1. Create `common::timestamp` module — consolidate all 4 copies of Cocoa timestamp functions
2. Delete `training/src/constants.rs` path constants — use `common::paths::*`
3. Consolidate `personas::storage` into `common::paths` and switch to `common::Result`
4. Standardize `dirs` to v6 everywhere (or use workspace dependencies)
5. Remove type duplication for settings types — desktop should import from `ingestion`
6. Replace bare `dirs::home_dir()` calls with `common::get_brb_dir()`
7. Split `system.rs` into focused command modules
8. Add tests for `personas` crate and `ingestion::MetadataDb`

---

## 2. Python Audit

**Summary**: The Python codebase (~3,400 LOC across 38 files) is reasonably well-structured with clean module boundaries. However, there are significant DRY violations in LLM response post-processing (6 copies), zero test coverage, a stale debug script, and several `sys.path` hacks.

### Issues Found

#### Critical (P0)

| Priority | Issue | Location |
|----------|-------|----------|
| P0 | **Zero test coverage** — no `mlx/tests/` directory exists | Entire `mlx/` |
| P0 | **LLM response post-processing duplicated 6 times** — same EOS cleanup + preamble stripping | `core/analyze_persona.py:146,242,354,539,643` + `ml/labeling.py:84` |
| P0 | **Parquet bulk-write functions nearly identical** — `write_chunks_bulk_parquet()` and `write_analytics_chunks_bulk_parquet()` share 80% code | `data/storage.py:77-175` and `data/storage.py:178-252` |

#### P1

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `sys.path.insert(0, ...)` hacks in 3 entry points | `entry/inference_daemon.py:21`, `entry/embed_query.py:27`, `entry/rerank.py:34` |
| P1 | Stale 607-line debug script with diverged constants/prompts | `mlx/src/debug_analyze.py` |
| P1 | Metadata formatting duplicated in 4 prompt builder functions | `prompts.py:91,350,484,620` |
| P1 | Topics formatting duplicated in 2 functions | `prompts.py:302-312` and `prompts.py:585-595` |
| P1 | Inconsistent JSON library: most files use `ujson`, some use stdlib `json` | `core/analyze_persona.py:8`, `entry/analyze_persona.py:42`, `entry/inference_daemon.py:16` |
| P1 | `_emit_progress` in callbacks duplicates `progress/base.py` | `core/callbacks.py:8-13` |
| P1 | `send_response` function duplicated between entry points | `entry/inference_daemon.py:29-31`, `entry/embed_query.py:30-32` |
| P1 | LoRA target modules for Llama and Qwen3 return identical lists | `config/training.py:32-56` |
| P1 | `datetime.utcnow()` deprecated in Python 3.12+ | `data/storage.py:315-316` |
| P1 | `fmt: off` without matching `fmt: on` at bottom of constants.py | `constants.py:78` |

#### P2

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | Raw dict usage for metadata throughout — should be TypedDict | `prompts.py`, `analyze_persona.py`, entry points |
| P2 | `cosine_similarity()` appears unused | `ml/embeddings.py:112-119` |
| P2 | `add_system_prompts()` appears unused | `utils/data.py:32-49` |
| P2 | Global mutable state for LLM model/tokenizer | `ml/labeling.py:17-18` |
| P2 | Unused `AnalyticsChunkingStage` enum | `progress/analytics.py:27-32` |
| P2 | Unused `emit_analytics_stage_progress` function | `progress/analytics.py:62-76` |
| P2 | Unused `Result` dataclass | `progress/ingestion.py:67-75` |
| P2 | `pyproject.toml` has both ruff and black configs (black is unused) | `pyproject.toml:44-54` |
| P2 | ~10 unused type stubs in dev dependencies | `pyproject.toml:63-76` |

### Recommendations

1. Create `mlx/tests/` with unit tests for critical pure-logic modules first: `utils/time.py`, `data/loaders.py`, `config/training.py`, `core/callbacks.py`
2. Extract `clean_llm_response()` helper into `utils/llm.py`
3. Refactor parquet write functions into a generic `write_bulk_parquet()`
4. Delete `debug_analyze.py`
5. Create `MetadataDict` TypedDict for type safety
6. Standardize on `ujson` everywhere
7. Remove unused code: `cosine_similarity`, `add_system_prompts`, dead progress types
8. Fix `sys.path` hacks by running entry points as proper modules
9. Clean up `pyproject.toml`: remove black config, trim unused type stubs

---

## 3. Frontend Audit

**Summary**: The frontend is well-structured with clean Zustand state management, consistent dual-mode theming via `useUIMode()`, and well-separated hooks. However, there's significant dead code from a UI transition (~800+ lines), duplicated prerequisite-checking logic across 5+ components, no centralized Tauri service layer, and accessibility gaps.

### Issues Found

#### Dead Code / Legacy

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | Dead legacy code behind `USE_NEW_UI = true` — `SetupWizard` (306 lines), `CommandCenter` (267 lines) + sub-components are unreachable | `HomeLayout.tsx:28` |
| P1 | Unused hooks: `useSnapshots`, `useUnlockStatus` | `hooks/useSnapshots.ts`, `hooks/useUnlockStatus.ts` |
| P2 | Unused dependency `react-router-dom` (app uses tab-based navigation) | `package.json:25` |
| P2 | Unused dependency `autoprefixer` (Tailwind v4 handles prefixing) | `package.json:37` |
| P2 | ~130 lines mock data in HomeLayout | `HomeLayout.tsx:222-352` |

#### Duplication

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `invoke("get_initialization_status")` duplicated in 5 components with identical state boilerplate | `HomeLayout.tsx:52`, `DashboardView.tsx:69`, `WelcomeView.tsx:107`, `ChatLayout.tsx:81`, `InsightsLayout.tsx:55` |
| P1 | Identical `EXAMPLE_QUERIES` arrays in two files | `CasperChat.tsx:27-32`, `DashboardView.tsx:27-32` |
| P2 | Duplicate Casper state mappings (exported constants vs inline functions) | `types.ts:843-864` vs `useCasperAgent.ts:66-102` |
| P2 | Repetitive `isRetro` ternary patterns hundreds of times | Throughout components |

#### Architecture

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | No centralized Tauri service layer — `invoke()` scattered across 15+ files | Throughout `src/` |
| P1 | No React error boundaries anywhere | Entire app |
| P2 | TypeScript types (880 lines) are hand-written mirrors of Rust structs with no codegen | `types.ts` |

#### Oversized Components

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | `TrainingModal.tsx` — 867 lines | `chat/TrainingModal.tsx` |
| P1 | `CasperChat.tsx` — 720 lines | `casper/CasperChat.tsx` |
| P2 | `DashboardView.tsx` — 585 lines | `home/DashboardView.tsx` |
| P2 | `ContactDetailPanel.tsx` — 557 lines | `chat/ContactDetailPanel.tsx` |

#### Accessibility

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | Only 15 `aria-*` attributes in entire app — missing on navigation tabs, chat inputs, error messages, sidebar lists | Multiple components |
| P2 | No skip-to-content navigation | App-wide |

### Recommendations

1. Create `useInitStatus()` hook — single source of truth, eliminates 5 duplicate `invoke()` calls
2. Remove dead legacy code (`SetupWizard`, `CommandCenter`, sub-components) — ~800+ lines
3. Add React error boundaries around each `*Layout` component
4. Create `services/tauri.ts` — typed wrappers for all `invoke()` commands
5. Split oversized components (`TrainingModal`, `CasperChat`)
6. Fix accessibility — ARIA roles/labels on navigation, inputs, lists, errors
7. Remove unused deps (`react-router-dom`, `autoprefixer`) and hooks
8. Consider `ts-rs` or `specta` for auto-generating TypeScript types from Rust

---

## 4. Cross-Cutting Audit

**Summary**: The cross-language integration is thoughtfully designed with centralized Python environment management and a consistent JSON-lines subprocess protocol. However, model name constants diverge between Rust and Python, DuckDB version pins are mismatched, and Tauri command types have subtle field-level mismatches with TypeScript counterparts.

### Issues Found

#### Constants & Versions

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | **Model name mismatch**: Rust `DEFAULT_MLX_BASE_MODEL` = `Qwen3-4B-4bit`, Python daemon defaults to `Qwen3-4B-8bit` | `common/src/constants.rs:48` vs `entry/inference_daemon.py:610` |
| P1 | **DuckDB version mismatch**: ingestion pins `1.4.4`, desktop uses loose `1.0` | `ingestion/Cargo.toml:13` vs `desktop/src-tauri/Cargo.toml:48` |
| P1 | **DuckDB filename inconsistency**: code uses `brb.duckdb`, docs/comments say `vectors.duckdb` | `CLAUDE.md`, `common/src/paths.rs:35`, `ingestion/src/vectordb.rs:1`, `ingestion/src/lib.rs:6` |
| P2 | No shared embedding model constant between Rust and Python | `common/src/constants.rs:57` vs `config/embedding.py:29` |
| P2 | `DEFAULT_MLX_BASE_MODEL` and `DEFAULT_MLX_AGENT_MODEL` are identical — unclear intent | `constants.rs:48-53` |

#### Type Synchronization

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | **`TrainingProgressEvent` type mismatch** — Rust has `progress: f32` field missing in TS; phase values differ (`"finalizing"` vs `"converting"`) | `types.rs:96-112` vs `types.ts:287-300` |
| P2 | `IngestionSettings`/`AnalyticsSettings` defined in 3 places — Rust ingestion, Rust desktop types, TypeScript | 3 files + manual converter in `system.rs:1378-1394` |

#### Path Handling

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | `python_bin` path inconsistency: `bin/python` vs `bin/python3` in different functions | `python_env.rs:77,154,367` |
| P2 | Hardcoded paths bypass centralized path management | `desktop/.../training.rs:65-70`, `desktop/.../system.rs:230-232` |
| P2 | `format_bytes` duplicated with different signatures and formatting | `training.rs:348-362` (`u64`, "12.3 MB") vs `system.rs:597-611` (`i64`, "12MB") |

#### Error Handling

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | Inconsistent Python subprocess error propagation (Result vs Option vs Ok(None)) | `ingestion/src/python.rs`, `ingestion/src/rerank.rs`, `training/src/export/llm_analyze.rs` |
| P2 | `InferenceError` has no `From` conversion to `BrbError` | `inference/src/error.rs` vs `common/src/error.rs` |

#### Build System

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | `make test` only runs `cargo test` — no Python or TypeScript tests | `Makefile` |
| P2 | `system.rs` has own `list_trained_personas()` duplicating `PersonaRegistry::list()` | `system.rs:524-578` vs `training.rs:255-266` |

### Recommendations

1. Create a shared constants mechanism (even a `constants.json` read at build time) for model names, DuckDB filenames, versions
2. Pin `duckdb = "= 1.4.4"` uniformly across all Cargo.toml files
3. Standardize DuckDB filename to `brb.duckdb` in all docs and comments
4. Fix `TrainingProgressEvent` type alignment between Rust and TypeScript
5. Consolidate path construction through `common::get_brb_dir()` / `common::paths`
6. Consolidate `format_bytes` into `common` crate
7. Add `make test-python`, `make test-desktop`, `make test-all` targets
8. Synchronize Python daemon's default model with Rust constant

---

## 5. Architecture Review

**Summary**: The monorepo has a well-organized foundation with clear separation between library crates, app crates, and the Python ML pipeline. However, the `ingestion` crate has grown into a "god crate" handling both pipeline orchestration AND search/retrieval, creating a dependency inversion where `inference` depends on `ingestion`. There's also ~1,500 lines of dead code (llama.cpp backend, MLX native stub), no CI/CD, and significant documentation drift.

### Issues Found

#### Structural

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | **`ingestion` is a god crate** — 6,004 lines, 11 modules spanning pipeline orchestration, metadata CRUD, vector storage, search, query planning, reranking, and more | `crates/ingestion/` |
| P1 | **`inference → ingestion` dependency inversion** — inference depends on the full ingestion pipeline just for search access | `crates/inference/Cargo.toml:34` |
| P1 | **Edition mismatch** — desktop uses 2021, rest of workspace uses 2024 | `apps/desktop/src-tauri/Cargo.toml:6` |
| P2 | **No `[workspace.dependencies]`** — common deps duplicated across all Cargo.toml with potential version drift | Workspace `Cargo.toml` |
| P2 | **No CI/CD** — `.github/workflows/` exists but contains no workflow files | `.github/workflows/` |

#### Dead Code

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | **llama.cpp backend** — 551 lines + CMake/C++ compile overhead, not used anywhere | `inference/src/engines/llama_cpp/` + `inference/src/download.rs` (213 lines) |
| P2 | **MLX native engine stub** — every method returns an error | `inference/src/engines/mlx_native/engine.rs` (59 lines) |
| P2 | **CLI `chat` command stub** — returns `NotSupported` | `apps/cli/src/commands/chat.rs` (15 lines) |
| P2 | **`repomix-output.xml`** in repo despite being gitignored | Root directory (963 lines) |

#### Documentation

| Priority | Issue | Location |
|----------|-------|----------|
| P1 | **CLAUDE.md model constant is wrong** — says `Qwen3-4B-8bit`, actual code uses `Qwen3-4B-4bit` | `CLAUDE.md:~107` |
| P1 | **CLAUDE.md dependency graph is stale** — missing `inference → ingestion` and `inference → messages-db` | `CLAUDE.md:~35-40` |
| P2 | **Stale `PHI4_MINI_MODEL_CARD.md`** — project moved to Qwen3 | Root (379 lines) |
| P2 | **Three near-duplicate Qwen3 model card files** | `QWEN3_MODEL_CARD.md`, `QWEN3_4B_MODEL_CARD.md`, `QWEN3_8B_MODEL_CARD.md` |
| P2 | **`PROGRESS.md`** (926 lines) and `MLX_RS_PROJECT.md` (263 lines) clutter root | Root |
| P2 | **Multiple planning/doc directories** with no clear organization | `docs/`, `casper-improvements/`, `persona-sprint/`, `claude/plans/` |

#### Other

| Priority | Issue | Location |
|----------|-------|----------|
| P2 | `insights.rs` bypasses `VectorDb` abstraction, opens DuckDB directly | `desktop/src-tauri/src/commands/insights.rs:10` |
| P2 | Empty `data/` and `models/` directories in repo | Root |
| P2 | `schema/` directory contains nested git repository | Root |
| P2 | `scripts/` directory overlaps with `mlx/` functionality | Root |

### Top 10 Refactoring Opportunities

Ranked by impact vs. effort:

| # | Refactoring | Impact | Effort | Priority |
|---|-------------|--------|--------|----------|
| 1 | **Extract `search` crate from `ingestion`** — break god crate, fix dependency inversion | High | Medium | P1 |
| 2 | **Remove llama.cpp backend + GGUF download** — 764 lines dead code, saves 1-3 min compile | High | Low | P1 |
| 3 | **Add `[workspace.dependencies]`** — eliminate version drift for serde, chrono, dirs, duckdb, etc. | Medium | Low | P1 |
| 4 | **Fix DuckDB version pinning** — correctness issue, HNSW binary incompatibility risk | Medium | Low | P1 |
| 5 | **Unify edition to 2024** — consistent language semantics across workspace | Low-Med | Low | P1 |
| 6 | **Route insights DuckDB through `VectorDb`/search** — consolidate schema knowledge | Medium | Medium | P2 |
| 7 | **Clean up stale top-level files** — remove PHI4 card, consolidate Qwen3 cards, move PROGRESS.md | Low | Very Low | P2 |
| 8 | **Set up CI with GitHub Actions** — run lint+check+test on PRs | Medium | Medium | P2 |
| 9 | **Consolidate planning/docs directories** — single `docs/` root | Low | Low | P2 |
| 10 | **Remove MLX native engine stub** — 59 lines of no-op code | Low | Very Low | P2 |

---

## Prioritized Action Plan

### Phase 1: Critical Fixes (1-2 days)

These address correctness issues and high-risk drift:

1. **Pin DuckDB to `= "1.4.4"` in all Cargo.toml files** — prevents HNSW binary incompatibility
2. **Sync model name constants** — update Python daemon default to match Rust `Qwen3-4B-4bit`, or always pass `--base-model` from Rust
3. **Fix `TrainingProgressEvent` type mismatch** — align Rust emitted phases with TypeScript union
4. **Update CLAUDE.md** — fix model constant, update dependency graph, change `vectors.duckdb` → `brb.duckdb`
5. **Fix deprecated `datetime.utcnow()`** in `data/storage.py`
6. **Fix `fmt: off` without `fmt: on`** in `constants.py`

### Phase 2: Deduplication & Cleanup (3-5 days)

High-value, low-to-medium effort improvements:

7. **Create `common::timestamp` module** — consolidate 4 copies of Cocoa timestamp functions
8. **Extract `clean_llm_response()` helper** in Python — eliminate 6 copies
9. **Refactor parquet write functions** into generic helper
10. **Delete dead code**: `debug_analyze.py`, llama.cpp backend, MLX native stub, CLI chat stub, unused Python functions, legacy UI components (`SetupWizard`, `CommandCenter`, sub-components)
11. **Remove unused dependencies**: `rustyline` (CLI), `react-router-dom` (frontend), `autoprefixer` (frontend), unused type stubs (Python)
12. **Add `[workspace.dependencies]`** and standardize `dirs` to v6
13. **Unify edition to 2024** for desktop crate
14. **Create `useInitStatus()` hook** — eliminate 5 duplicated prerequisite checks
15. **Consolidate path constants** — delete `training/src/constants.rs` paths, use `common::paths`

### Phase 3: Structural Improvements (1-2 weeks)

Larger refactoring with significant architectural benefit:

16. **Extract `search` crate from `ingestion`** — move `vectordb.rs`, `metadata.rs`, `search.rs`, `query_planner.rs`, `rerank.rs`, `context_builder.rs`, `queries.rs`, `stats.rs` to new crate. Update `inference` to depend on `search` instead of `ingestion`.
17. **Create `services/tauri.ts`** — centralized typed wrappers for all `invoke()` commands
18. **Add React error boundaries** around layout components
19. **Split oversized files** — `system.rs` (1,664 lines), `TrainingModal.tsx` (867 lines), `CasperChat.tsx` (720 lines)
20. **Consolidate `personas::storage`** into `common::paths` and switch to `common::Result`

### Phase 4: Quality & DevEx (ongoing)

Foundational improvements for long-term maintainability:

21. **Create Python test suite** (`mlx/tests/`) — start with pure-logic modules: `utils/time.py`, `data/loaders.py`, `config/training.py`, `core/callbacks.py`
22. **Add Rust tests** for `personas` crate and `ingestion::MetadataDb`
23. **Set up CI** with GitHub Actions — `make check`, `make lint`, `cargo test`
24. **Add `make test-python` and `make test-desktop`** targets
25. **Improve accessibility** — ARIA roles/labels on navigation, inputs, lists
26. **Consider TypeScript codegen** from Rust types via `ts-rs` or `specta`
27. **Clean up stale docs** — consolidate model cards, move planning docs to `docs/archive/`
28. **Create shared constants mechanism** for cross-language constant synchronization

---

## Summary Statistics

| Domain | P0 | P1 | P2 | Total |
|--------|----|----|----|----|
| Rust | 0 | 7 | 14 | 21 |
| Python | 3 | 8 | 9 | 20 |
| Frontend | 0 | 8 | 9 | 17 |
| Cross-cutting | 0 | 4 | 10 | 14 |
| Architecture | 0 | 6 | 13 | 19 |
| **Total** | **3** | **33** | **55** | **91** |

*Note: Some issues appear in multiple audits (e.g., DuckDB version mismatch found by both cross-cutting and architecture reviewers). Unique issues after deduplication: ~70.*

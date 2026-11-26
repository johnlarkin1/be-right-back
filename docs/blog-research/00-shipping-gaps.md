# Shipping Gaps Report

> What's actually left to publish Be Right Back as a beta?
> Generated: 2026-04-03

---

## Project Vitals

| Metric | Value |
|--------|-------|
| First commit | 2025-11-06 |
| Total commits | 169 |
| Current version | 0.1.0 |
| Rust (crates/) | 19,390 lines across 6 crates |
| Python (mlx/src/) | 8,437 lines |
| TypeScript (desktop) | 24,161 lines |
| Rust tests | 294 `#[test]` across 42 files |
| Overall completion | ~85% per NEXT_UP.md (dated 2026-03-14) |

---

## Ship-Blockers (Tier 1) — Must fix before any beta

### 1. Panic-on-malformed-daemon-output (1-2h)
- **What**: 8 `panic!()` calls in `crates/inference/src/daemon_connection.rs` and `protocol.rs`
- **Impact**: If Python daemon sends unexpected JSON, the entire Tauri app crashes
- **Fix**: Replace `panic!()` with `Err(InferenceError::BackendError(...))`

### 2. No socket read timeout (1-2h)
- **What**: `daemon_connection.rs` reads from UDS socket with no timeout
- **Impact**: If Python hangs (OOM, GPU stall), Rust thread blocks forever, app becomes unresponsive
- **Fix**: `socket.set_read_timeout(Some(Duration::from_secs(30)))`

### 3. ObjC FFI audit (half day) — ALREADY DONE per NEXT_UP.md
- Audited 2026-03-15, marked "Done" in tech debt table. The shipping plan still lists it because it was written 2026-03-15 before the audit was completed. **Can be crossed off.**

### 4. Blocking embed_query() — ALREADY DONE per NEXT_UP.md
- `Phase A` in NEXT_UP shows this as `[x]` completed. Wrapped in `spawn_blocking()`. **Can be crossed off.**

### 5. Zero eval framework (2-3 days)
- **What**: No way to measure persona fidelity or search quality
- **Impact**: Can't prove the product works; core value prop is unmeasured
- **Minimum**: 20-query golden test set, vocabulary overlap metric, Precision@5 for RAG
- **Strategy doc**: `docs/feature-plans/ai-evals-and-quality-strategy.md`

---

## High Impact (Tier 2) — Strong improvement, not strictly blocking

| Item | Effort | Status |
|------|--------|--------|
| LoRA training config tuning (lr, alpha, dropout, filtering) | 1-2 days | Not started |
| Wire ignored gen params (stop_sequences, top_k) | 2-4h | Partially done — most params already wired per NEXT_UP |
| Accessibility (ARIA roles, focus traps, labels) | 1 day | Not started |
| Python error handling (silent failures, broad excepts) | 1 day | Not started |

---

## Product Completion (Tier 3) — Missing features visible to users

| Item | Effort | Notes |
|------|--------|-------|
| `compute_viz_clusters.py` — 15+ NotImplementedError | 2-3 days | Semantic Space tab completely non-functional |
| Real Casper token streaming (currently simulated) | 1 day | `casper.rs:206` is fake streaming |
| Actual model download from HuggingFace | 1 day | `system.rs:979` creates empty dir |
| Contact exclusion list (PRD PSR-2.3) | 1-2 days | Privacy requirement |
| Data deletion button (PRD PSR-2.4) | 1-2 days | Privacy requirement |
| Cancellation support (training, agent) | 1 day | Frontend buttons exist, backend is no-op |
| Settings panel | Unknown | Button exists but is `disabled={true}` |

---

## Distribution & Launch Readiness

### Done
- [x] Release script with codesigning + notarization (`scripts/release/release.sh`)
- [x] DMG + .app bundle targets configured in tauri.conf.json
- [x] Entitlements files for main app and embedded binaries
- [x] GitHub Releases pipeline (private + public repos)
- [x] SHA-256 checksum generation
- [x] CI/CD on GitHub Actions (Rust lint/test + desktop build + website build)
- [x] Website deployed on Vercel at berightback.xyz

### Not Done
- [ ] **Beta testing** — No testers recruited, no structured feedback collection
- [ ] **Clean Mac E2E test** — Install -> FDA -> ingest -> train -> chat -> search -> insights
- [ ] **Performance profiling** — No benchmarks across M1/M2/M3/M4
- [ ] **Privacy policy page** — Only exists in "How It's Built" article, not standalone
- [ ] **Terms of service** — None
- [ ] **User documentation / FAQ** — None
- [ ] **CHANGELOG.md** — None
- [ ] **Homepage unlock gate** — Website still gated by `BRB_UNLOCK_WEBSITE` env var
- [ ] **Download funnel tracking** — No analytics on download flow

---

## Website Gaps

| Gap | Severity |
|-----|----------|
| No `/blog` route or blog infrastructure | Need to build |
| No RSS feed | Need for blog |
| No `/privacy` page | Ship-blocker for trust |
| No `/terms` page | Should have before public beta |
| No newsletter signup | Nice-to-have |
| No sitemap.xml | SEO |
| Homepage still behind unlock gate | Must remove before launch |
| "How It's Built" articles are thin (33-88 lines each) | Content opportunity |

---

## Realistic Sprint Plan (Consolidated)

**Sprint 1 (3-4 days): Stability**
- Replace panics → Results (1-2h)
- Add socket timeout (1-2h)
- Harden Python error handling (1d)
- Accessibility fixes (1d)

**Sprint 2 (3-4 days): Quality**
- Build eval framework foundation (2-3d)
- Apply LoRA config improvements (1-2d, overlaps with eval)

**Sprint 3 (3-4 days): UX**
- Real Casper streaming (1d)
- Model download implementation (1d)
- Cancellation support (1d)
- Privacy features (1-2d)

**Sprint 4 (2-3 days): Launch Prep**
- Clean Mac E2E test
- Privacy policy + terms pages
- Unlock homepage gate
- CHANGELOG.md
- Recruit beta testers

**Total estimate: ~2-3 weeks of focused work to v0.2.0 beta**

---

## Key Source Files

| File | Lines | What |
|------|-------|------|
| `docs/feature-plans/shipping-readiness-plan.md` | 340 | Full shipping plan |
| `NEXT_UP.md` | 176 | Development roadmap |
| `docs/PRD.md` | 810 | Product requirements |
| `docs/feature-plans/ai-evals-and-quality-strategy.md` | 200+ | Eval strategy |
| `docs/feature-plans/casper-agent-improvement-strategy.md` | 200+ | Agent fixes |
| `scripts/release/release.sh` | — | Release automation |

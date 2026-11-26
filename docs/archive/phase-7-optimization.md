# Phase 7: Optimization & Testing

**Timeline:** Week 7-8
**Status:** 🔴 ~20-25% Complete (January 2025)
**Dependencies:** Phases 1-6 (all features implemented)
**Priority:** High

---

## Overview

Focus on performance optimization, comprehensive testing, and fixing bugs. Ensure the app runs smoothly on target hardware (8-16GB M1/M2 Macs) and handles edge cases gracefully.

### Goals

1. Profile and optimize performance bottlenecks
2. Reduce memory usage and prevent leaks
3. Add comprehensive test coverage
4. Fix bugs and edge cases
5. Improve error handling and recovery
6. Optimize for 8GB RAM Macs

---

## Optimization Tasks

### Task 1: Performance Profiling

**Tools:**
- Rust: `cargo flamegraph`, `heaptrack`
- React: Chrome DevTools Profiler
- llama.cpp: Built-in stats

**Areas to profile:**
1. Message parsing (Phase 1)
2. Training loop (Phase 2)
3. Inference latency (Phase 3)
4. Vector search (Phase 4)
5. React rendering (Phase 6)

**Metrics to track:**
- CPU usage during training/inference
- Memory usage (RSS, heap)
- Disk I/O for database operations
- Frame rate in UI (target 60fps)

**Acceptance criteria:**
- [ ] Identified top 3 performance bottlenecks (NOT STARTED)
- [ ] Documented baseline metrics (NOT STARTED)
- [ ] Created optimization plan (NOT STARTED)

---

### Task 2: Memory Optimization

**Memory targets:**
- Idle: <500MB
- Training: <8GB
- Inference (1 model): <4GB
- Inference (3 models): <10GB

**Optimization strategies:**

1. **Lazy loading:**
   - Don't load inference engine until needed
   - Unload inactive personas
   - Stream large files instead of loading into memory

2. **Caching:**
   - Cache embeddings (don't regenerate)
   - Cache frequently used queries
   - Use mmap for large model files

3. **Memory pools:**
   - Reuse allocations for tokenization
   - Pre-allocate buffers for streaming

4. **Resource cleanup:**
   - Close database connections when idle
   - Free VRAM after inference
   - Drop unused Rust structs

**Acceptance criteria:**
- [ ] App runs comfortably on 8GB M1 Mac (UNTESTED)
- [ ] No memory leaks during extended use (UNTESTED)
- [ ] Memory usage documented (NOT STARTED)

---

### Task 3: Inference Optimization

**Target latency:**
- First token: <500ms
- Subsequent tokens: 10-20 tok/s
- Context loading: <100ms

**Optimizations:**

1. **Model quantization:**
   - Use Q4_K_M or Q5_K_M (already planned)
   - Experiment with Q4_0 for faster inference

2. **Metal acceleration:**
   - Ensure all layers on GPU (`--n-gpu-layers -1`)
   - Use Metal-optimized kernels

3. **Batching:**
   - Process multiple requests in parallel
   - Use continuous batching in llama-server

4. **Context caching:**
   - Cache KV cache for repeated prompts
   - Reuse system prompt across requests

**Acceptance criteria:**
- [ ] Inference meets latency targets (UNTESTED)
- [ ] No stuttering during streaming (UNTESTED)
- [ ] Can handle 3-4 concurrent chats (UNTESTED)

**Implementation notes:**
- mmap enabled in `crates/inference/src/config.rs`
- Metal acceleration planned (`--n-gpu-layers -1`)

---

### Task 4: Database Optimization

**DuckDB optimizations:**

1. **Indexing:**
   - Ensure HNSW index is built
   - Add indexes on frequently queried columns (timestamp, contact_id)

2. **Query optimization:**
   - Use prepared statements
   - Batch inserts (already doing)
   - VACUUM database periodically

3. **Connection pooling:**
   - Reuse connections
   - Set appropriate timeout

**Vector search optimization:**
- Tune HNSW parameters (M, ef_construction)
- Use smaller embedding dimensions if possible (256 vs 384)
- Cache query embeddings

**Acceptance criteria:**
- [x] Similarity search <100ms for 10K messages (documented in Phase 4)
- [ ] Database file size reasonable (<1MB per 100 messages) (UNTESTED)
- [x] No query timeouts

**Implementation notes:**
- HNSW index implemented in DuckDB VSS
- Batch inserts working (~366 chunks/sec)
- Contact caching implemented in AppState

---

### Task 5: UI Performance

**React optimizations:**

1. **Memoization:**
   - `React.memo` for expensive components
   - `useMemo` for computed values
   - `useCallback` for event handlers

2. **Virtualization:**
   - Use `react-window` for long message lists
   - Only render visible messages

3. **Code splitting:**
   - Lazy load routes
   - Dynamic imports for heavy components

4. **Debouncing:**
   - Debounce search inputs
   - Throttle scroll handlers

**Acceptance criteria:**
- [x] UI feels snappy (no lag)
- [ ] Smooth scrolling with 1000+ messages (no virtualization - react-window not installed)
- [x] Fast initial load (<2s)

**Implementation notes:**
- Framer Motion animations implemented
- Loading skeleton states present
- No list virtualization (react-window) yet

---

## Testing Strategy

### Unit Tests

**Rust crates:** 🟡 ~30% Coverage
```bash
# Test coverage goal: >70%
cargo test --all
cargo tarpaulin --out Html  # NOT CONFIGURED
```

**Existing tests (54 test functions found):**
- ✅ Message parsing (date.rs, attributed_body.rs, names.rs)
- ✅ JSONL export formatting (jsonl.rs, stats.rs, sampling.rs)
- ✅ Vector search (search.rs)
- ❌ Embedding generation (no tests)
- ❌ LoRA adapter loading (no tests)

**React components:** 🔴 0% Coverage
```bash
npm test        # NOT CONFIGURED
npm run test:coverage  # NOT CONFIGURED
```

**Missing test infrastructure:**
- ❌ No Jest or Vitest setup
- ❌ No React Testing Library
- ❌ No component tests
- ❌ No integration tests

---

### Integration Tests

**End-to-end workflows:**

1. **Ingestion → Training → Inference:**
   - Import contact data
   - Train LoRA adapter
   - Chat with persona
   - Verify response quality

2. **RAG integration:**
   - Embed conversation
   - Query similar messages
   - Verify context injection
   - Check response relevance

3. **Multi-persona:**
   - Create 3 personas
   - Chat with each
   - Verify distinct styles

**Tauri integration tests:**
- Test all Tauri commands
- Verify event streaming
- Check error propagation

---

### Manual Testing

**Checklist:**
- [ ] Test on M1 8GB Mac
- [ ] Test on M2 16GB Mac
- [ ] Test on M3 24GB Mac
- [ ] Import 10+ contacts
- [ ] Train 5+ personas
- [ ] Chat sessions >100 messages
- [ ] Leave app running for 4+ hours (memory leak check)
- [ ] Kill and restart (state persistence)
- [ ] Interrupt training mid-way
- [ ] Network errors (if applicable)
- [ ] Full Disk Access denied scenario

---

### Bug Fixes

**Common bug categories:**

1. **Edge cases:**
   - Empty conversations
   - Very long messages (>2000 chars)
   - Special characters (emoji, Unicode)
   - Contacts with no name

2. **Concurrency:**
   - Multiple training jobs
   - Simultaneous chat requests
   - Database locking

3. **Resource exhaustion:**
   - Out of memory
   - Out of disk space
   - Too many open files

4. **Platform-specific:**
   - macOS version differences
   - File path edge cases
   - Permission issues

**Acceptance criteria:**
- [ ] All critical bugs fixed (NOT STARTED)
- [ ] High-priority bugs fixed or documented (NOT STARTED)
- [ ] Regression tests added (NOT STARTED)

---

## Monitoring & Logging

**Logging strategy:**

1. **Rust:**
   ```rust
   use tracing::{info, warn, error, debug};

   info!("Starting training for {}", contact_id);
   warn!("Low memory: {} MB available", available_mb);
   error!("Training failed: {}", err);
   ```

2. **React:**
   ```typescript
   console.log('[Chat] Sending message:', message);
   console.error('[Chat] Error:', error);
   ```

3. **Logs location:**
   - `~/.be-right-back/logs/app.log`
   - Rotate logs daily
   - Keep last 7 days

**Telemetry (optional, privacy-preserving):**
- App version and OS version
- Training time and model size
- Inference latency
- Error counts (no personal data)

**Acceptance criteria:**
- [x] Comprehensive logging in place (tracing crate configured)
- [x] Logs help diagnose issues
- [x] No sensitive data logged

**Implementation notes:**
- ✅ Tracing initialized in desktop app (`tracing-subscriber` with INFO level)
- ✅ `tracing::info!` used in state.rs, insights.rs, inference.rs
- ❌ Log rotation not implemented
- ❌ Logs not persisted to `~/.be-right-back/logs/`
- ❌ Python logging not configured

---

## Performance Targets Summary

| Component | Metric | Target |
|-----------|--------|--------|
| Message parsing | 1000 messages | <1s |
| Training | 3.8B model | 15-90 min |
| Inference | Tokens/sec | 10-20 |
| Inference | First token | <500ms |
| Vector search | 10K messages | <100ms |
| UI rendering | Frame rate | 60fps |
| Memory usage | Idle | <500MB |
| Memory usage | Training | <8GB |
| Memory usage | Inference | <4GB |

---

## Success Criteria

Phase 7 is complete when:

1. ⚠️ Performance targets are met on 8GB M1 Macs (UNTESTED)
2. ⚠️ No critical bugs remain (NOT VERIFIED)
3. 🔴 Test coverage >70% for core functionality (CURRENTLY ~15% OVERALL)
4. ⚠️ App runs stably for extended periods (4+ hours) (UNTESTED)
5. ✅ Error handling is robust and user-friendly
6. 🔴 Ready for distribution in Phase 8 (BLOCKERS REMAIN)

**Phase 7 is ~20-25% complete.**

---

## Remaining Work (~75-80%)

### Critical (to reach 70%+ completion)

1. **Set up frontend testing**
   - Install Jest or Vitest
   - Add React Testing Library
   - Write tests for core components (ChatLayout, InsightsLayout)
   - Target: 50% component coverage

2. **Add coverage metrics**
   - Configure cargo-tarpaulin for Rust
   - Configure coverage for frontend
   - Add coverage badges to README

3. **Profile performance**
   - Run flamegraph on training/inference
   - Document baseline metrics
   - Identify top 3 bottlenecks

4. **Memory testing**
   - Test on 8GB M1 Mac
   - Run extended use test (4+ hours)
   - Check for memory leaks

### Nice-to-have

5. **Add list virtualization** for long message lists
6. **Implement log rotation** and persistence
7. **Add benchmarks** for inference/training

**Next phase:** [Phase 8: Distribution](./phase-8-distribution.md)

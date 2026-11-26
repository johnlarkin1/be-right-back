# AI Evals & Production Quality Strategy

> Investigation conducted March 2026. Covers eval frameworks, fine-tuning improvements, RAG quality, and production shipping recommendations.

## Table of Contents

- [Executive Summary](#executive-summary)
- [Part 1: Current State](#part-1-current-state)
- [Part 2: Eval Framework Recommendations](#part-2-eval-framework-recommendations)
- [Part 3: Fine-Tuning Improvements](#part-3-fine-tuning-improvements)
- [Part 4: Production Quality for Shipping](#part-4-production-quality-for-shipping)
- [Prioritized Roadmap](#prioritized-roadmap)

---

## Executive Summary

The ML pipeline is architecturally sound but has **zero quality measurement** beyond training/validation loss. There's no way to know if a persona actually sounds like the person, if search returns the right messages, or if quality regresses between releases.

Key gaps identified:

- No persona fidelity measurement
- No retrieval metrics (MRR, NDCG, Precision@K)
- No embedding quality checks
- No safety guardrails or hallucination detection
- No regression testing for model quality
- HNSW index created but unused (semantic search is O(n) brute-force)

---

## Part 1: Current State

### Training Pipeline

| Parameter | Value |
|-----------|-------|
| Base model | Qwen3-4B-8bit |
| LoRA rank | 16 |
| LoRA alpha | 32 |
| Learning rate | 1e-5 |
| Max steps | 500 |
| Batch size | 4 (with gradient accumulation) |
| Train/val split | 90/10 |
| Early stopping | Patience=3, threshold=0.05 |

- Only creates training examples from question-answer exchanges
- 4-hour conversation segmentation, 50k example cap
- Metrics tracked: train/val loss, tokens/sec, memory, best_val_loss
- **Missing**: No semantic eval, no BLEU/ROUGE/perplexity on test set, no style metrics

### Inference Pipeline

- Model: Qwen3-4B with LoRA adapter loading
- Generation: temp=0.7, top_p=0.9 (configurable), 6 hardcoded stop sequences
- Chat format: Qwen3 ChatML template (auto-detected)
- IPC: JSON-lines protocol (load, generate, embed_query, rerank, ping, shutdown)
- **Missing**: No beam search, no output validation, no guardrails

### Embedding Pipeline

- Model: ModernBERT-embed-base-8bit (768-dim)
- Chunking: window=8 messages, stride=4 (~50% overlap)
- Storage: DuckDB with HNSW + FTS5 indexes
- Batch inference: Auto-tuned batch size (128/64/32 based on RAM)
- **Missing**: No embedding quality checks, no semantic coherence validation

### Search/RAG Pipeline (Casper)

9-stage hybrid retrieval:

1. Query Planning (18 temporal patterns, 4 aggregation triggers)
2. Query Embedding (ModernBERT 768-dim via Python subprocess)
3. Semantic Search (cosine similarity, currently O(n) brute-force)
4. BM25 FTS (DuckDB with English stemmer, 43 stopwords)
5. Keyword Search (ILIKE exact match fallback)
6. Reciprocal Rank Fusion (3-way merge, k=60, with recency boost)
7. Deduplication (MMR with lambda=0.7 or 50% novelty threshold)
8. Contact Diversity Penalty (prevents one contact flooding results)
9. Cross-Encoder Reranking (optional, ms-marco-MiniLM-L-6-v2)

**Test coverage**: ~95 unit tests (66 in query_planner, 17 in search, 7 in context_builder, 5 in rerank).

**Critical gaps**:

- No labeled evaluation dataset
- No ranking metrics (MRR, NDCG, Precision, Recall)
- No integration tests (full pipeline E2E)
- No latency benchmarking
- HNSW index unused due to Python/Rust binary incompatibility
- No timeout on reranker subprocess

### Training Data Preparation

- Strategy: Question-filtering + 4-hour conversation segmentation
- Output: JSONL with `<MSG_BREAK>` for consecutive same-sender messages
- Validation: Checks for user start, assistant end, non-empty content
- Cap: 50k most recent examples
- **Missing**: No duplicate detection, no semantic coherence checks, no data balancing

### Key Tunable Parameters

| Parameter | Current Value | Component |
|-----------|---------------|-----------|
| Learning rate | 1e-5 | Training |
| LoRA rank | 16 | Training |
| LoRA alpha | 32 | Training |
| Batch size | 4 | Training |
| Early stopping patience | 3 | Training |
| Early stopping threshold | 0.05 | Training |
| Chunk window | 8 | Embedding |
| Chunk stride | 4 | Embedding |
| RRF constant k | 60 | Search |
| MMR lambda | 0.7 | Search |
| Recency decay lambda | 0.03 | Search |
| Contact diversity penalty | 0.5^(n-2) | Search |

---

## Part 2: Eval Framework Recommendations

### Recommended Stack (Privacy-First)

All tools below run fully offline with local LLMs as judges. No data leaves the machine.

| Layer | Tool | Purpose |
|-------|------|---------|
| Orchestration | Custom Rust/Python harness | Fits existing subprocess architecture |
| Prompt/Response Testing | **Promptfoo** (local) | YAML configs, custom Python provider wrapping MLX inference, CI/CD ready |
| Regression Tests | **DeepEval** (pytest) | 14+ built-in metrics, conversation evaluation, runs in pytest |
| RAG Evaluation | **Ragas** | Research-backed RAG Triad (faithfulness, relevancy, context precision) |

**Not recommended**: Braintrust (closed-source, data leaves machine), LangSmith (cloud-based tracing).

### Framework Details

**Promptfoo**:

- Runs entirely locally; data stays on-machine unless you explicitly `share`
- Custom Python `call_api()` function wraps MLX inference directly
- YAML-based declarative configs for test cases
- Web UI for results comparison
- Built-in red teaming for adversarial testing
- Integration effort: Low (npm install + YAML config + Python provider)

**DeepEval**:

- Open-source, pytest-native (`deepeval test run`)
- 14+ built-in metrics: hallucination, answer relevancy, faithfulness
- Chatbot-specific: conversation relevancy, role adherence, knowledge retention
- Cloud platform (Confident AI) is optional — skip it
- Integration effort: Medium (pip install + Python test files)

**Ragas**:

- Research-backed RAG evaluation, reference-free metrics
- Core metrics: context precision, context recall, faithfulness, answer relevancy (the "RAG Triad")
- Can generate synthetic test datasets
- Integration effort: Low-Medium (pip install + wrap search pipeline)

### Privacy-Preserving Eval Data Strategy

```
eval/
  fixtures/              # Synthetic test data (committed to repo)
    synthetic_conversations.jsonl
    query_test_cases.yaml
    temporal_patterns.yaml
  golden/                # Real data golden sets (git-ignored)
    .gitignore
    search_golden.jsonl
    persona_golden.jsonl
  scripts/               # Eval runners (committed)
    generate_synthetic.py
    run_persona_eval.py
    run_rag_eval.py
  results/               # Git-ignored for real data runs
    .gitignore
```

**Strategies**:

1. **Synthetic data generation** (primary): Use base LLM to generate conversations mimicking iMessage statistical properties. Safe to commit and use in CI.
2. **Template-based test data**: Fill-in-the-blank message templates for deterministic testing of query planner temporal patterns.
3. **Anonymization pipeline**: Replace names/locations/dates with pseudonyms. Caution: can alter linguistic patterns.
4. **Local-only infrastructure**: All eval runs on-device, git-ignore files containing real data.
5. **Differential privacy**: Report only aggregate statistics (mean perplexity, average NDCG) without individual examples.

### Key Metrics to Implement

#### Persona Quality

| Metric | What It Measures | Priority |
|--------|-----------------|----------|
| Validation perplexity | Model confidence on held-out real messages | High |
| Stylometric KL-divergence | Distribution match of vocabulary, sentence length, emoji, contractions | High |
| LLM-as-judge rubric | Tone, vocabulary, length, emoji, topic handling, naturalness (1-5 each) | Medium |
| A/B Turing test | Judge identifies real vs generated (closer to 50% = better) | Medium |
| BERTScore | Semantic similarity of style | Low |

**Stylometric features to extract**:

- Vocabulary richness (type-token ratio, hapax legomena)
- Sentence structure (average length, punctuation patterns)
- Lexical features (word frequency, contraction rate)
- Character-level (emoji frequency/distribution, capitalization, abbreviations)
- Temporal patterns (message length distribution)

#### RAG/Search Quality

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| Precision@10 | % of top-10 results that are relevant | >0.7 |
| Recall@10 | % of relevant docs found in top-10 | >0.8 |
| MRR | Average reciprocal rank of first correct result | >0.8 |
| NDCG@10 | Rank-weighted relevance quality | >0.8 |
| Temporal accuracy | Correct date range for "last month" etc. | >0.9 |
| Cross-encoder lift | NDCG improvement with reranking | Positive |
| Contact precision | Right person's messages returned | >0.9 |

**Implementation**: Build a golden test set of 100-200 queries (20 per type: recency, temporal, preference, factual, aggregation). Manually annotate relevant chunk IDs and relevance scores 1-5.

#### Embedding Quality

| Metric | What It Measures |
|--------|-----------------|
| Recall@K | Does correct chunk appear in top-K nearest neighbors? |
| Same-contact clustering (silhouette) | Messages from same contact cluster together |
| Topic coherence | Same-topic messages across contacts are similar |
| Chunk boundary sensitivity | Overlapping chunks have high but not identical similarity |

---

## Part 3: Fine-Tuning Improvements

### Immediate Config Changes

| Change | Current | Recommended | Rationale |
|--------|---------|-------------|-----------|
| Learning rate | 1e-5 | **1e-4** | Standard for LoRA (10x higher than full fine-tuning is well-validated) |
| Alpha ratio | alpha=32 (alpha/r=2) | **alpha=16 (alpha/r=1)** | More stable; alpha=2r can overpower base weights |
| LoRA targets | Attention only | **All linear layers** (q/k/v/o/gate/up/down_proj) | Approaches full fine-tuning parity |
| KL-divergence penalty | None | **0.05** | Prevents catastrophic forgetting of base knowledge |
| LoRA dropout | None | **0.05-0.1** | Essential regularization for narrow persona datasets |
| Training duration | 500 steps | **1-3 epochs** | Chat fine-tuning overfits beyond 3 epochs |
| LR schedule | N/A | **Cosine decay with 5-10% linear warmup** | Standard, rarely underperforms |
| Gradient accumulation | 4 | **4-8 steps** (effective batch 16-32) | Stabilizes training on limited Apple Silicon memory |

### Training Data Quality Improvements

**Filtering** (implement immediately):

- Remove messages <5 words ("ok", "lol") unless genuinely characteristic of user's style
- Drop media-only messages (URLs, images, attachments without text)
- Deduplicate exact and near-duplicate messages
- Strip or replace URLs with placeholder tokens
- Filter messages not in user's primary language

**Formatting** (improve existing pipeline):

- Use Qwen's native `<|im_start|>` / `<|im_end|>` chat template
- Structure as multi-turn conversations (not isolated messages)
- Include 3-5 prior messages as context for each training turn

**Optimal dataset size**:

- Minimum viable: 500-1,000 quality conversation turns
- Good quality: 2,000-5,000 turns
- Diminishing returns beyond 10,000 turns
- Most active texters have 10K-100K+ sent messages — filter to best 2K-5K

**Future augmentation**:

- Self-play: Use base model to generate responses, filter for style consistency
- Contrarian examples: Generate "wrong style" responses for DPO training
- Persona-aware synthetic data: Generate new conversation scenarios

### QLoRA Consideration

Training adapters on 4-bit quantized base weights reduces memory ~3.5x. Quality for persona/chat tasks is nearly equivalent to standard LoRA. Would enable training on 8GB M1 Macs.

### Continuous Training Eval

Add to the training loop:

1. **Checkpoint evaluation**: Every N steps, generate responses to fixed test prompts
2. **Perplexity on validation set**: Compute at each checkpoint
3. **Style metric drift**: Track stylometric features across checkpoints
4. **Degeneration detection**: Check for repetitive output, mode collapse, gibberish
5. **Early stopping enhancement**: Stop on validation perplexity + style metric divergence (not just loss)

### Model Upgrade Path

**Top recommendation: Qwen3.5-35B-A3B** (February 2026)

- MoE architecture with only 3B active parameters
- Same compute cost as current 4B setup but dramatically better quality
- MLX-community already has 4-bit and 8-bit versions on HuggingFace
- Outperforms previous generation's 235B model
- Biggest single quality improvement available

**Alternatives**:

| Model | Size | Notes |
|-------|------|-------|
| SmolLM3-3B | 3B | Outperforms Llama-3.2-3B, good fallback |
| Phi-4-mini | 3.8B | Strong reasoning, less proven for persona/chat |
| Gemma-3n-E2B-IT | ~2B active | Multimodal, interesting for future features |
| Llama 3.2 3B | 3B | Fast, fits on 8GB Macs |

**Quantization impact**: 8-bit is measurably better for subtle style nuances (word choice, sentence rhythm). 4-bit works well for content/meaning. Current setup (8-bit for persona, 4-bit for agent) is correct.

---

## Part 4: Production Quality for Shipping

### Safety & Guardrails

**Recommended layered approach**:

1. **Fast layer**: Regex/keyword blocklist for obvious harmful content (near-zero latency)
2. **Model layer**: **ShieldGemma 2B** classification on outputs (~50-100ms on Apple Silicon). Outperforms Llama Guard by +10.8% on benchmarks. Covers hate/harassment/dangerous/sexually-explicit content.
3. **Persona boundary**: System prompt instruction to stay in-character and decline harmful requests
4. **Out-of-character handling**: Detect style anomalies (length, vocabulary, tone). Fallback: "I'm not sure how [persona name] would respond to that"
5. **User expectations**: Clear onboarding that this is an AI approximation. Confidence indicators on responses.

### Inference Optimization

| Optimization | Impact | Effort |
|-------------|--------|--------|
| **MLX prompt caching** for persona system prompts | Free latency win (system prompt identical across messages) | Low |
| **Rotating KV cache** | Already default in MLX (4K token window) | None |
| **Speculative decoding** | 1.5-3x speedup for larger models; less impactful for 4B | Medium |
| **QuantSpec** (Jan 2026) | Self-speculative with 4-bit draft of same model, >90% acceptance | Medium |

**Latency benchmarks** (MLX, 4B 4-bit):

- M1/M2: ~40 tok/s
- M3/M4: ~60-80 tok/s
- M4 Max: up to 525 tok/s (on optimized models)

### Search Pipeline Fixes

1. **Add 5-second timeout** on reranker subprocess (currently can hang indefinitely)
2. **Fix HNSW index** — currently O(n) brute-force despite index being created (Python/Rust binary incompatibility)
3. **Test reducing chunk overlap** — recent research (Jan 2026) shows overlap provides no measurable retrieval benefit. Test stride=6 or stride=8 to cut index size ~50%
4. **Consider increasing chunk window** from 8 to 12-16 messages for better retrieval context
5. **Daemon mode for embedding** — keep Python running between queries to eliminate subprocess overhead (~150ms per query)

### Embedding Upgrade

**Nomic Embed Text V2** — natural upgrade path:

- Same team as current model (nomic-ai)
- Same 768-dim space, minimal migration effort
- MoE architecture, trained on 1.6B pairs
- Supports Matryoshka dimensions (768 -> 256) for 3x memory reduction
- Apache 2.0 licensed, MLX compatible

### Reranker

Current ms-marco-MiniLM-L-6-v2 (22M params, ~100ms) is still solid. Upgrade to **BGE-reranker-v2-m3** only if eval shows retrieval quality is the bottleneck.

### Model Bundling

- Current download-on-first-run approach is correct (2-4GB in .dmg would be unreasonable)
- Consider bundling a tiny fallback model (SmolLM-135M) for basic functionality during download
- Detect available unified memory at startup and recommend model size:
  - 8GB: 4-bit 3B model
  - 16GB: 8-bit 4B model (current default)
  - 32GB+: Larger models or more context

### User Feedback Loop

- **Thumbs up/down** on responses — low friction, stored locally for future DPO training
- **"Doesn't sound like me" flag** — persona-specific signal for reweighting training data
- **Conversation quality scores** — track response length, user engagement, explicit ratings
- **All telemetry local-only** — aggregate metrics only (throughput, error rates, latency), never content

---

## Prioritized Roadmap

### Phase 1: Quick Wins (1 week)

1. Fix LoRA config (lr=1e-4, alpha=16, all linear layers, dropout=0.1, KL=0.05)
2. Add training data filtering (short messages, duplicates, media-only)
3. Implement MLX prompt caching for system prompts
4. Add reranker subprocess timeout (5 seconds)

### Phase 2: Eval Foundation (2 weeks)

5. Set up eval directory structure with synthetic data generation
6. Implement validation perplexity + stylometric feature extraction
7. Build 100-query RAG golden test set, implement Precision@10/NDCG@10/MRR
8. Integrate promptfoo with custom MLX provider

### Phase 3: Quality Infrastructure (2 weeks)

9. Add LLM-as-judge persona fidelity rubric (6-dimension scoring)
10. Integrate Ragas for RAG faithfulness/relevancy
11. Add ShieldGemma 2B safety classifier
12. Build thumbs up/down feedback collection in UI

### Phase 4: Model Upgrades (2 weeks)

13. Evaluate Qwen3.5-35B-A3B (MoE, 3B active params)
14. Upgrade to Nomic Embed Text V2
15. Test reduced chunking overlap (stride=6 or stride=8)
16. Implement checkpoint evaluation during training

### Phase 5: Advanced (Ongoing)

17. DPO training from collected user feedback
18. A/B testing between model versions
19. CI regression testing for model quality
20. Human preference evaluation for milestones

### RAG Eval Hyperparameter Sweep Plan

**Phase A (1 week)**: Build labeled dataset + baseline

- 100 queries (20 per type: recency, temporal, preference, factual, aggregation)
- Label each with relevance 1-5 + expected chunk IDs
- Run baseline with default hyperparameters
- Compute MRR, NDCG@10, Precision@10, Recall@10

**Phase B (2 weeks)**: Hyperparameter tuning

- Sweep RRF k in {30, 45, 60, 75, 90}
- Sweep MMR lambda in {0.3, 0.5, 0.7, 0.9}
- Sweep recency decay lambda in {0.01, 0.02, 0.03, 0.05}
- Measure impact on ranking quality

**Phase C (1 week)**: Validate + deploy

- Test top 3 parameter combinations on hold-out set
- Deploy best configuration
- Add regression tests to prevent quality drops

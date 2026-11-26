# Blog Research Reports

Raw research material for writing blog posts about Be Right Back. Every report contains facts, code locations, numbers, and narrative angles — no prose. You write the posts.

## Reports

| # | Report | What's In It |
|---|--------|-------------|
| 00 | [Shipping Gaps](00-shipping-gaps.md) | What's left to publish: ship-blockers, missing features, distribution gaps, sprint plan |
| 01 | [Blog Infrastructure](01-blog-infrastructure.md) | How to add a `/blog` route: existing markdown pipeline, options, post candidates |
| 02 | [Hybrid RAG Search](02-hybrid-rag-search.md) | 9-stage pipeline: RRF, MMR, contact diversity, cross-encoder, recency boost |
| 03 | [Qwen3.5 DeltaNet](03-qwen35-deltanaet-architecture.md) | Gated DeltaNet hybrid attention, 3:1 pattern, KV cache implications, TurboQuant failure |
| 04 | [iMessage Database](04-imessage-database-reverse-engineering.md) | ObjC FFI, NSAttributedString decode, Cocoa timestamps, snapshot strategy |
| 05 | [Python ↔ Rust Integration](05-python-rust-integration.md) | Bundling Python, JSON-lines IPC, UDS daemon, code signing, version pinning hell |
| 06 | [Tool-Calling Agent](06-tool-calling-agent.md) | Casper agent: tool-calling loop, anti-loop protections, JSON repair, small model trade-offs |
| 07 | [Tauri Desktop App](07-tauri-desktop-architecture.md) | IPC architecture, Zustand stores, dual themes, event channels, useShallow |
| 08 | [LoRA Training](08-lora-training-pipeline.md) | MLX fine-tuning, model tiers, data pipeline, DeltaNet LoRA targets, eval gap |
| 09 | [DuckDB as Vector DB](09-duckdb-as-vector-database.md) | HNSW + FTS in one file, version pinning story, cross-language compatibility |
| 10 | [Local-First AI Privacy](10-local-first-ai-privacy.md) | Privacy-as-architecture, competitive angle, Apple ecosystem lock, data layout |
| 11 | [Project Stats & Timeline](11-project-stats-and-timeline.md) | 52K lines, 169 commits, 5 months, what works, what doesn't, models used |

## Suggested Post Order (for a blog series)

1. **Start with why** → 10 (Privacy) or the "Problem & Vision" angle
2. **The data layer** → 04 (iMessage) + 09 (DuckDB)
3. **The ML pipeline** → 08 (Training) + 03 (Qwen3.5)
4. **The search system** → 02 (Hybrid RAG)
5. **The agent** → 06 (Casper)
6. **The app** → 07 (Tauri) + 05 (Python-Rust)
7. **Meta / building in public** → 11 (Stats) + 00 (Shipping Gaps)

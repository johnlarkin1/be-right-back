## Casper Benchmark Decision Briefing — Is anything newer than LongMemEval/LoCoMo worth switching to? (2026-07-04, revised 2026-07-26)

> **2026-07-26 revision.** Two open items from §5 are now resolved and they change the framing, not the target:
> 1. **LongMemEval-V2 shipped — and it is not a successor.** It is a differently-scoped benchmark under a reused name. Details in §2a. Do not adopt it. V1 remains the board.
> 2. **V1 is partly saturated and the leaderboard is crowded near the ceiling.** This kills "competitive with cloud memory vendors" as a headline and changes *which slices* are worth gating on. See §4a.

### 1. Bottom line

Yes, there are genuinely newer (2025–2026) benchmarks — roughly nine real, downloadable ones — but **none of them supersedes LongMemEval/LoCoMo as your primary publish target, and none fully fits Casper's multi-contact private-messaging use case.** The 2024 baselines still reign for one reason that dominates everything else: **comparability.** Mem0, Zep, and Letta/MemGPT all report on LongMemEval and LoCoMo; the 2025–26 entrants have thin-to-zero cross-product adoption, so publishing only on them would leave you with impressive-looking numbers nobody can benchmark you against. The right move is **keep LongMemEval as the primary board and bolt on exactly one current-2026 benchmark for credibility** — not a wholesale switch.

**Revised nuance (2026-07-26):** that remains true for *target selection*, but not for *claim selection*. LongMemEval V1's ceiling has moved to ~93–95% and its single-session categories sit at 96–99, so the board is now useful to Casper as a **comparability axis, not a ranking to win**. Publish the ratio-to-SOTA under a privacy/compute constraint no cloud entrant can match, and gate engineering on the two slices that still have headroom (multi-session, knowledge-update/temporal).

### 2. The modern options (CONFIRMED 2025–2026, ranked by usefulness to Casper)

| # | Benchmark | Year | Measures | Temporal / Abstention | Size | License | Who publishes | SOTA | Casper fit |
|---|-----------|------|----------|----------------------|------|---------|---------------|------|-----------|
| 1 | **BEAM** ([arxiv 2510.27246](https://arxiv.org/abs/2510.27246)) | 2025 (ICLR'26) | 10 LTM abilities over ultra-long dialogue; **isolates Abstention + Temporal as first-class** | ✅ / ✅ | 100 convos @128K–10M tok; 2,000 QA | Data CC BY-**SA** 4.0 / code MIT | Hindsight, Honcho (no Mem0/Zep/Letta yet) | 10M: Hindsight 64.1, Honcho 40.6; 1M: Hindsight 73.9 | Moderate — synthetic single-user, long-context-oriented; 10M track irrelevant on-device, but 128K/1M usable |
| 2 | **ConvoMem** ([HF/Salesforce](https://huggingface.co/datasets/Salesforce/ConvoMem)) | 2025 | 6 evidence categories incl. explicit **abstention (no-answer)** + temporal state-change | ✅ / ✅ | 75,336 QA; 100 personas; ~27.5 GB | **CC-BY-NC-4.0 (non-commercial)** ⚠️ | Self (Mem0 baseline only) | Full-context 70–82% vs Mem0-RAG 30–45% | Moderate — best abstention stressor, but NC license blocks commercial use & thesis is anti-RAG below ~150 convos |
| 3 | **PERMA** ([arxiv 2603.23231](https://arxiv.org/abs/2603.23231)) | 2026 | Preference identify/integrate/maintain over noisy long dialogue | ✅ / ~ (indirect "confidence") | 808–1,388 events; ~324K–1.17M tok | Apache-2.0 | **Mem0, MemOS, Memobase, EverMemOS, Supermemory** | MemOS 0.811 MCQ; Kimi-K2.5 0.955 | Moderate — good product comparability, but preference-tracking not retrieval-QA; abstention only indirect |
| 4 | **KnowMe-Bench** ([arxiv 2601.04745](https://arxiv.org/abs/2601.04745)) | 2026 | Evidence-grounded person-understanding over autobiographical prose; adversarial abstention + temporal | ✅ / ✅ | 2,580 queries; ~4.7M tok | MIT / HF Apache-2.0 ⚠️ (2 of 3 source texts **in-copyright**) | **Mem0, MemOS, A-Mem** | Best model L1 75.4 / L3 22.6 vs human 96.5 / 83.5 | Moderate — literary memoir prose, not messages; license legally fragile |
| 5 | **REALTALK** ([arxiv 2502.13270](https://arxiv.org/abs/2502.13270)) | 2025 | Persona simulation + memory-probing QA over **21 days of REAL human texts** | ✅ / ❌ | Tiny: 10 people, 728 QA | CC BY 4.0 | None (~46 stars) | gpt-4o judge: 0.519 multi-hop / 0.737 temporal | Best *conceptual* match (real texts, dyadic) but tiny, no abstention, gpt-4o-judge cloud dep, zero comparability |
| 6 | **MemoryAgentBench** ([arxiv 2507.05257](https://arxiv.org/abs/2507.05257)) | 2025 (ICLR'26) | 4 competencies incl. Accurate Retrieval, Selective Forgetting | ✅ / ❌ | 2,071 QA; 103K–1.44M tok | MIT / CC BY 4.0 | MIRIX, MemGPT/Letta | GPT-4o retrieval ~58%; forgetting ~32% | Weak — mostly repurposed long-context doc/novel QA; no abstention; only Accurate-Retrieval slice relevant |
| 7 | **Memora + FAMA** ([arxiv 2604.20006](https://arxiv.org/abs/2604.20006)) | 2026 | Remember/Reason/Recommend + forgetting-aware metric | ✅ / ❌ | 10 personas; 600–900 QA | Apache-2.0 / CC BY 4.0 | Mem0 only | Reasoning ~0–32; Remember ~119 FAMA | Weak — targets memory-*writing* agents & staleness, not RAG-over-history; non-standard scale |
| 8 | **PersonaMem** ([arxiv 2504.14225](https://arxiv.org/abs/2504.14225)) | 2025 | Dynamic user profiling / personalized response (MCQ) | ✅ / ❌ | 5,990 MCQ; ~180 personas | MIT / CC-BY-SA 4.0 | None (memory products) | Frontier models ~50–52% | Weak — wrong axis (profiling not retrieval); no abstention; no comparability |
| 9 | **EngramaBench** ([arxiv 2604.21229](https://arxiv.org/abs/2604.21229)) | 2026 | Cross-session retention; adversarial abstention | ✅ / ✅ | Tiny: 150 queries | MIT / CC BY 4.0 | Author only | GPT-4o 0.619 > Engrama 0.537 > Mem0 0.481 | Weak — single-author product showcase, tiny synthetic, zero adoption |

**Checked and REJECTED (do not use):**
- **Microsoft "Memora"** ([arxiv 2602.03315](https://arxiv.org/abs/2602.03315)) — it's a memory *method*, not a benchmark; evaluated on the same LoCoMo/LongMemEval you already have. Keep only as a SOTA reference point (LoCoMo 86.3% / LongMemEval 87.4%). Name-collides with #7 above (unrelated).
- **Mem0 "AI Memory Benchmarks in 2026" report** — vendor marketing blog, not a scoreable artifact; self-reported LoCoMo numbers have known contamination criticism. The only real thing it surfaces is BEAM (already #1).
- **Letta Leaderboard / Context-Bench** ([letta.com](https://www.letta.com/blog/letta-leaderboard/)) — real and 2025, but measures agentic memory *tool management*, no temporal, no abstention, no static licensed dataset. Not a retrieval benchmark.
- **LongMemEval / LoCoMo themselves** — flagged in candidate list as "new" but they ARE your 2024 baselines. Only the Sept-2025 cleaned re-release is a newer artifact you should care about. (LongMemEval-V2 is now confirmed shipped but is a *different benchmark* — see §2a.)

### 2a. LongMemEval-V2 (May 2026) — CONFIRMED SHIPPED, and NOT a successor. Do not adopt.

**"LongMemEval-V2: Evaluating Long-Term Agent Memory Toward Experienced Colleagues"** — Di Wu, Zixiang Ji, Asmi Kawatkar, Bryan Kwan, Jia-Chen Gu, Nanyun Peng, Kai-Wei Chang. [arxiv 2605.12493](https://arxiv.org/abs/2605.12493), submitted 2026-05-12, CC-BY-4.0. [Project page](https://xiaowu0162.github.io/longmemeval-v2/) · [data on HF](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2).

Shared lead author with V1, **entirely different task.** It is a name reuse, not a version bump.

| Axis | LongMemEval V1 (2024) | LongMemEval-V2 (2026) |
|---|---|---|
| Corpus | user↔assistant **conversation** history | **web/software-agent task trajectories** over multi-file GitHub repos |
| Abilities | 5 conversational memory abilities (incl. knowledge update, temporal) | static state recall, dynamic state tracking, **workflow knowledge**, **environment gotchas**, **premise awareness** |
| Scale | `_S` ~115K tok / `_M` ~1.5M tok | **25M (small) / 115M (medium)** tok; trajectories up to 500 deep |
| Questions | 500 | 451 manually curated |
| Winning method | retrieval-based memory layers | **AgentRunbook-C** (trajectories as files + coding agent) **72.5%** vs **48.5% RAG baseline** |
| Adoption | Mem0, Zep, Letta, Mastra, Hindsight, Supermemory | **leaderboard empty — "entries coming soon"** |

The project page's own comparison table lists V1 as a **separate conversational benchmark**; V2 *complements*, it does not replace.

**Why it's wrong for Casper — four independent reasons, any one sufficient:**
1. **Wrong axis.** V2 asks "did the agent learn from its *own* past task runs" (runbook induction). Casper asks "can I find what *another human* said to me." Different memory, different failure modes.
2. **Infeasible on-device.** No small track. 25M tokens is the *floor*; there is no ~115K analogue of `_S`. A 4-bit 9B on an M-series machine is not indexing 25M-token agent trajectories.
3. **Structurally hostile to retrieval.** The paper's own result is that a file-grepping coding agent beats RAG by 24 points. Entering a RAG pipeline here means competing in the configuration the benchmark was built to show losing.
4. **Zero comparability** — the entire reason to publish on a public board. No entries exist.

**One thing worth stealing from it, though:** the 72.5 vs 48.5 result is a real signal about *architecture*, even though the benchmark isn't ours. Casper has full local filesystem access to the message store — an agentic grep-the-corpus search path is a legitimate ablation to run against our own eval set. That is a design question, not a benchmark-target question; do not conflate them.

### 3. How they compare to LongMemEval/LoCoMo

**Genuinely better on a specific axis:**
- **BEAM** is the only newer benchmark that elevates *both* Abstention and Temporal Reasoning to first-class, explicitly-scored categories — a cleaner probe of Casper's two hardest strata than LongMemEval's blended abilities.
- **ConvoMem** has the largest, most explicit abstention test (a dedicated no-answer category at 75K-QA scale) — better than LongMemEval's ~5-ability slice for stress-testing "I don't know."
- **REALTALK** is the only one built on *real human messages* rather than LLM-synthesized dialogue — the single strongest conceptual match to Casper's private-iMessage reality.

**Newer but NOT better for you:**
- MemoryAgentBench, Memora/FAMA, PersonaMem, PERMA all measure adjacent-but-wrong axes (long-context doc QA, memory-write/forgetting, preference-tracking) and mostly lack abstention.
- KnowMe-Bench is literary prose, not messages, with a shaky copyright license.
- EngramaBench is a tiny single-author product demo.

**What NONE of them fix — the structural gap:** Every 2024 *and* 2025–26 benchmark is **single-user user↔assistant dialogue.** Not one covers Casper's differentiating strata: **person-scoped, cross-contact/multi-hop-across-people, contact-diversity, aggregation/count, and superlative (latest/first)** over multi-party message logs. Your contact-diversity penalty and cross-contact multi-hop have no public benchmark, period. That is a genuine market gap, not a search failure.

### 4. Recommendation for Casper

**Publish on two boards, do not switch away from the 2024 baselines:**

1. **Primary / comparability board → LongMemEval** ([arxiv 2410.10813](https://arxiv.org/abs/2410.10813), MIT, use the Sept-2025 cleaned `xiaowu0162/longmemeval-cleaned` release). It is the de-facto memory-layer leaderboard, natively tests temporal + abstention (your two priority strata), and is the *only* way to put a head-to-head number next to Mem0/Zep/Letta. For a local-first product, being able to say "our 4-bit on-device pipeline scores X on the same board as the cloud memory vendors" is the single most valuable comparability claim you can make. Report LongMemEval_S (~115K tok) — the _M/1.5M track is irrelevant on-device.

2. **Current-2026 credibility board → BEAM** (specifically **BEAM-128K / BEAM-1M**, [arxiv 2510.27246](https://arxiv.org/abs/2510.27246), ICLR 2026, data CC BY-SA 4.0 / code MIT). It's the freshest peer-reviewed benchmark that isolates abstention + temporal, has emerging product adoption (Hindsight, Honcho), and lets you show a 2026 number so reviewers can't dismiss you as benchmarking on "old" data. **Skip the 10M track** — pointless for a small on-device model.

### 4a. The saturation correction (2026-07-26) — what to claim, and which slices to gate on

The recommendation above stands on *target*, but the state of the board has moved and the original "put a head-to-head number next to Mem0/Zep/Letta" framing is now a losing play.

**Current LongMemEval V1 leaderboard (overall):**

| System | LongMemEval | Note |
|---|---|---|
| Mastra OM | **94.87%** | highest recorded |
| Mem0 (2026 token-efficient algo) | **93.4%** | at <7K tokens/retrieval |
| Hindsight | 91.4% | |
| Supermemory | 85.4% | |
| Zep / Graphiti | 71.2% | 63.8% temporal sub-task |
| Mem0 (GPT-4o, older) | — | 49.0% temporal sub-task |

Sources: [Mem0 2026 benchmark report](https://mem0.ai/blog/ai-memory-benchmarks-in-2026), [Mem0 state-of-memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), [OMEGA leaderboard](https://omegamax.co/benchmarks), [Atlan comparison](https://atlan.com/know/mem0-alternatives/).

**Per-category (Mem0), which is the part that matters for gating:**

| Category | Score | Usable as a regression signal? |
|---|---|---|
| single-session-user | 98.6 | ❌ saturated — a pipeline change moves nothing |
| single-session-assistant | 98.2 | ❌ saturated |
| knowledge-update (temporal) | 93.6 | ✅ live headroom |
| multi-session | **88.0** | ✅ **the most live slice** |

**Two consequences.**

**(a) Change the headline claim from rank to ratio.** A 4-bit 9B running entirely on-device is not going to top a board whose leader is at 94.87% with cloud-scale models. Attempting it produces a mediocre number you then have to explain. The defensible and more interesting claim:

> *Casper reaches N% of cloud SOTA on LongMemEval_S with **zero bytes leaving the device**, on a 4-bit 9B, at X ms/query and Y MB resident.*

That adds an axis to the leaderboard rather than entering its race — and **no current entrant can report it**, because they are all cloud services. It is also the exact thesis of the product, so the eval and the positioning reinforce each other instead of fighting.

**(b) Gate on the live slices only.** Two-thirds of LongMemEval is dead signal at 96–99. Report the full `_S` number for the ratio claim, but **wire CI/regression tracking to multi-session + knowledge-update only**; anything else burns runtime to measure noise near a ceiling. This also happens to align with Casper's two hardest known strata (temporal, cross-session), so the slices that are cheap to interpret are also the ones that matter.

*If you want a third for the abstention story specifically,* add **ConvoMem** as a qualitative stressor — **but note it is CC-BY-NC-4.0, so you can report numbers in a paper/blog but not ship it inside a commercial product**, and frame carefully since its thesis is anti-RAG at small N.

**Strategic note:** Because no public benchmark covers your multi-contact/person-scoped/aggregation/superlative strata, **build a small internal Casper eval set** (even 100–200 hand-labeled queries over synthetic or consented iMessage data) for those axes. That becomes both your internal regression gate *and* a potential differentiating artifact — you could be the first to publish a multi-contact conversational-memory benchmark, which none of the memory-layer vendors have.

### 5. Caveats & gaps

- ~~**Could not confirm LongMemEval-V2**~~ — **RESOLVED 2026-07-26.** It shipped ([arxiv 2605.12493](https://arxiv.org/abs/2605.12493), HF data live), but it is a web/software-agent-trajectory benchmark at 25M–115M tokens, not a conversational-memory expansion. It does **not** become the primary; V1 stays. Full reasoning in §2a.
- **LongMemEval V1 is partly saturated** (single-session 96–99, ceiling ~94.87%) — do not report the aggregate as a competitive ranking, and do not gate on the saturated slices. See §4a.
- **BEAM license is CC BY-**SA** 4.0 (ShareAlike), not plain CC BY** — the ShareAlike clause has downstream implications if you redistribute derived data; fine for reporting scores.
- **ConvoMem is non-commercial (CC-BY-NC-4.0)** — the arXiv paper is CC-BY-4.0 but the *dataset* is NC. Real constraint for a shipping product.
- **KnowMe-Bench's permissive label is legally fragile** — 2 of 3 source corpora (Knausgård, Ferrante) are in-copyright; only Proust is public domain. Avoid redistributing.
- **Rejected as vaporware/blog-only:** the Mem0 "2026 report" (marketing blog, not scoreable) and Microsoft "Memora" (a method, not a benchmark — its "weekly/monthly/quarterly sessions" framing appears to be fabricated in the candidate description and is absent from the actual paper).
- **Comparability is the recurring weakness of everything newer** — even the best 2026 entrants (PERMA, KnowMe) are reported on by at most Mem0/MemOS, and BEAM by only Hindsight/Honcho. No 2025–26 benchmark yet has the Mem0+Zep+Letta triple-coverage that makes LongMemEval/LoCoMo strategically valuable.
- ~~**Open question before committing:** "competitive with cloud memory vendors" vs "SOTA on the freshest temporal+abstention benchmark"~~ — **RESOLVED 2026-07-26: neither, as originally posed.** Both framings are rank-based, and the board's ceiling (94.87%) makes rank a losing frame for an on-device 4-bit model. The claim is **ratio-under-constraint**: *N% of cloud SOTA on LongMemEval_S with zero data egress, on-device, at X ms.* LongMemEval is still the required board — because the ratio needs a denominator everyone recognizes — with BEAM as the un-saturated 2026 credibility board. See §4a.
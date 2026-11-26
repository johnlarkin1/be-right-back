---
title: "System Design"
shortTitle: "System Design"
slug: system-design
order: 2
description: "How the desktop app, Rust crates, MLX daemons, and local databases fit together."
---

We can start with a high level system overview. Of course, given it's 2026, we'll use some fancy 3d rendering. Some of this was actually inspired from a loose friend (somewhat? At least on LinkedIn) [Kjartan van Driel][kjartan] that I traded some messages with after seeing his work get highlighted in the Jane Street ASIC challenge. 

## System Diagram (3D)

::system3d[]{title="Be Right Back in 3D"}

## System Diagram

For the more tame, here is an Excalidraw.

::excalidraw[/diagrams/02-system-design.excalidraw]{title="System Architecture Overview" fit height="560"}

We'll get into this a lot more.

## Key Design Principles

These were / are the basic tenets that I wanted to ensure survives for this project:

### 1. local first. data does not leave your machine.

Your data never goes over the network. The only `socket`s in this project are [unix domain sockets][unix-domain-socket] - there's no TLS nor TCP.

I have bricked my computer building this more times than I can count running / experimenting with this. I try to take some preemptive measures about protecting against OOMs given your unified memory constraints. For initial ingestion and for fine-tuning, I'll eat your RAM up rather quickly. You can configure various settings to go against this.

### 2. grounded responses from your data

Yeah yeah, I know RAG is dead and has been dying for about three years. We have long context!! 1M context for Opus 4.6 and Opus 5, yes. I get it and I know.

It's a hot button topic in the engineering community, and there are [many][rag-dying-pt1] [many][rag-dying-pt2] [many][rag-dying-pt3] [great][rag-dying-pt4] [posts][rag-dying-pt5] [about it][rag-dying-pt6]. Those links are borderline chronological.

Regardless, I use vector embeddings and RAG. And I use it in a very fun way through DuckDB's VSS extension which I'll be talking a lot about later on. Plus, this project has some other nifty bells and whistles. There's [hybrid BM25 search][bm25] plus a custom reranker! The functional approach for people is that it's actually referencing chunks of your iMessage data and the hallucinations should be minimal.

### 3. self-reflection over simulation

I am trying to show people grounded in their data insights that they might not have seen before. It's legitimately not that far off from what I am trying to do with [Odyssey][odozi.app]. With regards to fine-tuning on someone else's messages, that's **not allowed**. You can create a digital clone of yourself and chat with it, but you cannot do that for others. Consent needs to be guaranteed and that is an engineering + design element that I do not have.

And concretely: if Casper doesn't have data on something, it will say so - not play along. If you ever catch it doing otherwise, file a [GitHub issue][github-issue] and I'll take a look.

[comment]: <> (Bibliography)
[unix-domain-socket]: https://en.wikipedia.org/wiki/Unix_domain_socket
[rag-dying-pt1]: https://www.reddit.com/r/MachineLearning/comments/1bxeqdc/d_llms_ability_to_find_needles_in_a_haystack/?utm_source=chatgpt.com
[rag-dying-pt2]: https://aiexpjourney.substack.com/p/will-long-context-llms-cause-the?utm_source=chatgpt.com
[rag-dying-pt3]: https://www.llamaindex.ai/blog/rag-is-dead-long-live-agentic-retrieval?utm_source=chatgpt.com
[rag-dying-pt4]: https://decisioncomputing.ai/news/rag-is-dead?utm_source=chatgpt.com
[rag-dying-pt5]: https://hamel.dev/notes/llm/rag/not_dead.html?utm_source=chatgpt.com
[rag-dying-pt6]: https://lighton.ai/lighton-blogs/rag-is-dead-long-live-rag-retrieval-in-the-age-of-agents
[bm25]: https://www.anthropic.com/engineering/contextual-retrieval
[odozi.app]: https://odozi.app/
[github-issue]: https://github.com/johnlarkin1/be-right-back/issues
[kjartan]: https://kjartanvandriel.github.io/
[kjartan-asic]: https://kjartanvandriel.github.io/asic/

"use client";

import { useState } from "react";

interface Pipeline {
  name: string;
  summary: string;
  stages: { title: string; detail: string }[];
}

const PIPELINES: Pipeline[] = [
  {
    name: "Topic map",
    summary: "Turns every chunk into a point on a 2D/3D map, grouped by what you were talking about.",
    stages: [
      { title: "Reduce", detail: "Subtracts each contact's average, then PCA compresses the 768-dim embeddings down to 50." },
      { title: "Cluster", detail: "Leiden groups a nearest-neighbor graph into about 15 topics and folds tiny ones into neighbors." },
      { title: "Project", detail: "UMAP lays the points out in 2D and 3D." },
      { title: "Label", detail: "The local model reads each cluster and gives it a name." },
    ],
  },
  {
    name: "Search & Casper",
    summary: "Answers plain-language questions about your history.",
    stages: [
      { title: "Plan", detail: "Pulls dates like “last spring” out of the question and cleans it up." },
      { title: "Retrieve", detail: "Vector search and BM25 keyword search, merged with reciprocal rank fusion." },
      { title: "Rerank", detail: "Drops near-duplicates (MMR); an optional cross-encoder rescores the top hits." },
      { title: "Answer", detail: "Casper, a tool-calling agent, searches, pulls stats and topics, then replies." },
    ],
  },
  {
    name: "Digital clone",
    summary: "Fine-tunes a small add-on to the base model from your message history.",
    stages: [
      { title: "Export", detail: "Conversations become chat-format training examples (JSONL)." },
      { title: "Size", detail: "Picks the 0.8B, 2B, 4B, or 9B Qwen3.5 model to fit your unified memory." },
      { title: "Fine-tune", detail: "MLX trains a rank-16 LoRA adapter. The base model stays untouched." },
      { title: "Chat", detail: "Base model + adapter reply, with relevant past messages pulled in as context." },
    ],
  },
];

/**
 * The three pipelines on the landing page. Desktop shows every stage. On
 * phones each pipeline is an accordion row, and the first one starts open.
 */
export function PipelineList() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="overflow-hidden rounded-[14px] border border-border-subtle">
      {PIPELINES.map((p, i) => {
        const isOpen = open === i;
        const stagesId = `pipeline-stages-${i}`;
        return (
          <section
            key={p.name}
            className="border-b border-border-subtle bg-surface last:border-b-0 md:p-7 md:even:bg-crt-bg"
          >
            {/* Phone: accordion trigger */}
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={stagesId}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex min-h-14 w-full items-center justify-between gap-3 px-[18px] py-3.5 text-left md:hidden"
            >
              <span className="flex flex-col gap-1">
                <span className="font-jetbrains text-[15px] font-semibold text-crt-accent">{p.name}</span>
                <span className="font-inter text-[13px] text-text-secondary">{p.summary}</span>
              </span>
              <span aria-hidden="true" className="font-jetbrains text-sm text-crt-accent">
                {isOpen ? "[-]" : "[+]"}
              </span>
            </button>

            {/* Desktop: static heading */}
            <div className="mb-5 hidden flex-wrap items-baseline gap-x-4 gap-y-1.5 md:flex">
              <h3 className="m-0 font-jetbrains text-[17px] font-semibold text-crt-accent">{p.name}</h3>
              <p className="m-0 font-inter text-base text-text-secondary">{p.summary}</p>
            </div>

            <ol
              id={stagesId}
              className={`m-0 list-none flex-col gap-3 px-[18px] pb-[18px] md:grid md:grid-cols-2 md:gap-x-7 md:gap-y-5 md:p-0 lg:grid-cols-4 ${
                isOpen ? "flex" : "hidden"
              }`}
            >
              {p.stages.map((s, n) => (
                <li
                  key={s.title}
                  className="flex gap-3 font-inter text-sm leading-normal md:flex-col md:gap-1.5 md:border-t md:border-crt-accent/25 md:pt-3.5"
                >
                  <span className="font-jetbrains text-crt-accent md:hidden">{n + 1}</span>
                  <span className="md:hidden">
                    <span className="font-semibold text-text-primary">{s.title}.</span>{" "}
                    <span className="text-text-secondary">{s.detail}</span>
                  </span>
                  <span className="hidden font-jetbrains font-semibold text-text-primary md:inline">
                    <span className="text-crt-accent">{n + 1}</span>  {s.title}
                  </span>
                  <span className="hidden leading-[1.55] text-text-secondary md:inline">{s.detail}</span>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

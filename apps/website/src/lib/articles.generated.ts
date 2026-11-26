// GENERATED FILE - DO NOT EDIT.
// Built by scripts/generate-articles.mts from the frontmatter in
// content/how-its-built/{technical,shared}/*.md. Edit the frontmatter, then run
// `npm run generate:articles` and commit the result.

import type { ArticleMeta } from "./articles";

export const GENERATED_ARTICLES: ArticleMeta[] = [
  {
    slug: "preface",
    title: "Why?",
    shortTitle: "Why?",
    description: "Why build this?",
    order: 0,
  },
  {
    slug: "problem-vision",
    title: "The Problem & Vision",
    shortTitle: "Problem & Vision",
    description: "Why build a local-first AI persona app? The inspiration, motivation, and ethical considerations.",
    order: 1,
  },
  {
    slug: "system-design",
    title: "System Design",
    shortTitle: "System Design",
    description: "How the desktop app, Rust crates, MLX daemons, and local databases fit together.",
    order: 2,
  },
  {
    slug: "data-foundation",
    title: "Data Foundation - Understanding iMessage",
    shortTitle: "Data Foundation",
    description: "Deep dive into the iMessage database schema, message decoding, and snapshot strategy.",
    order: 3,
  },
  {
    slug: "ingestion-pipeline",
    title: "Ingestion Pipeline",
    shortTitle: "Ingestion Pipeline",
    description: "The 6-stage pipeline that transforms raw messages into searchable vector embeddings.",
    order: 4,
  },
  {
    slug: "vector-search-rag",
    title: "Vector Search & RAG",
    shortTitle: "Vector Search & RAG",
    description: "How semantic search and retrieval-augmented generation power intelligent conversations.",
    order: 5,
  },
  {
    slug: "casper-agent",
    title: "Casper - The Agent System",
    shortTitle: "Casper Agent",
    description: "How Casper orchestrates query planning, hybrid search, reranking, and context building to answer questions about your messages.",
    order: 6,
  },
  {
    slug: "training-pipeline",
    title: "Training Pipeline - LoRA & MLX",
    shortTitle: "Training Pipeline",
    description: "Local LoRA fine-tuning on Apple Silicon using MLX for personalized language models.",
    order: 7,
  },
  {
    slug: "inference-system",
    title: "Inference System - Running Models Locally",
    shortTitle: "Inference System",
    description: "Multi-backend architecture for running fine-tuned models entirely on your Mac.",
    order: 8,
  },
  {
    slug: "desktop-architecture",
    title: "Desktop App Architecture - Tauri & React",
    shortTitle: "Desktop Architecture",
    description: "Building a native macOS app with Rust, Tauri, and React for performance and security.",
    order: 9,
  },
  {
    slug: "privacy-ethics",
    title: "Privacy & Ethics by Design",
    shortTitle: "Privacy & Ethics",
    description: "How architectural decisions ensure your data never leaves your device.",
    order: 10,
  },
];

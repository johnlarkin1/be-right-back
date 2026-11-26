# How It's Built - Article Outline

This document contains the heading structure for all 8 articles. Use this as a reference when writing your content.

Each article needs **two versions**:
- `technical/XX-slug.md` - Full technical details, code samples, implementation specifics
- `simple/XX-slug.md` - High-level explanations, analogies, accessible to non-developers

---

## Article 1: The Problem & Vision

**File:** `01-problem-vision.md`

```markdown
# The Problem & Vision

## Why Build This?
### The Black Mirror Inspiration
### Personal Motivation
### Privacy Concerns in AI

## What We're Building
### Core Features
### Non-Goals & Guardrails

## Target Architecture Overview
### System Diagram (Excalidraw)
### Key Design Principles
```

---

## Article 2: Data Foundation - Understanding iMessage

**File:** `02-data-foundation.md`

```markdown
# Data Foundation

## The iMessage Database
### Where Messages Live
### Database Schema Deep Dive
### Apple's Timestamp Format (Cocoa time)

## Message Decoding Challenges
### Plain Text vs NSAttributedString
### Decoding Binary Blobs
### Objective-C FFI from Rust

## Snapshot Strategy
### Why Not Query Live?
### Safe Database Access
### Managing Multiple Snapshots
```

---

## Article 3: Ingestion Pipeline - From Raw to Embedded

**File:** `03-ingestion-pipeline.md`

```markdown
# Ingestion Pipeline

## Pipeline Overview
### 5-Stage Process
### Progress Tracking
### Cancellation Support

## Stage 1: Snapshot Creation
### Database Copying
### WAL/SHM Handling

## Stage 2: Message Extraction
### Contact Resolution
### Timestamp Normalization

## Stage 3: Statistics Computation
### Pre-computing for O(1) Lookup
### Contact Stats Schema

## Stage 4: Embedding Generation
### Chunking Strategy (Sliding Windows)
### MLX Embedding Model
### Vector Storage in DuckDB

## Stage 5: Index Building
### HNSW Index Creation
### Query Optimization
```

---

## Article 4: Vector Search & RAG

**File:** `04-vector-search-rag.md`

```markdown
# Vector Search & RAG

## Why Vectors?
### Semantic vs Keyword Search
### Embedding Intuition

## DuckDB as Vector Store
### Schema Design
### HNSW Indexes
### Query Patterns

## Retrieval-Augmented Generation
### Context Window Management
### Relevance Ranking
### Conversation Threading

## Analytics Chunks
### Non-overlapping for Clustering
### Topic-aware Boundaries
```

---

## Article 5: Training Pipeline - LoRA & MLX

**File:** `05-training-pipeline.md`

```markdown
# Training Pipeline

## LoRA Explained
### Why Not Full Fine-tuning?
### Low-Rank Adapters
### Memory & Time Savings

## MLX on Apple Silicon
### Why MLX?
### Metal Acceleration
### Memory-Efficient Training

## Training Data Preparation
### JSONL Format
### Conversation Sampling
### System Prompt Generation

## Model Selection
### Qwen3-4B (Production)
### TinyLlama (Debugging)
### Trade-offs & Recommendations

## Hyperparameter Tuning
### Learning Rate
### LoRA Rank & Alpha
### Batch Size Considerations
```

---

## Article 6: Inference System - Running Models Locally

**File:** `06-inference-system.md`

```markdown
# Inference System

## Multi-Backend Architecture
### MLX Python Backend
### llama.cpp Alternative
### Future: Native MLX Rust

## Model Loading
### Base Model + Adapter
### Memory Management
### Lazy Loading Strategy

## Generation Configuration
### Temperature & Sampling
### Stop Sequences
### Repetition Penalty

## Streaming Responses
### Server-Sent Events
### Token-by-token Output
```

---

## Article 7: Desktop App Architecture - Tauri & React

**File:** `07-desktop-architecture.md`

```markdown
# Desktop App Architecture

## Why Tauri?
### vs Electron
### Native Performance
### Security Model

## Rust Backend
### Tauri Commands
### State Management
### Async Operations

## React Frontend
### Component Architecture
### Zustand for State
### Tailwind Styling

## IPC Communication
### Command Patterns
### Event Streaming
### Error Handling

## Permissions & Onboarding
### Full Disk Access
### Guided Setup Flow
### State Machine
```

---

## Article 8: Privacy & Ethics by Design

**File:** `08-privacy-ethics.md`

```markdown
# Privacy & Ethics

## Local-First Architecture
### No Network Calls
### No Telemetry
### Data Sovereignty

## Security Considerations
### Database Sandboxing
### Permission Model
### What's NOT Stored

## Ethical Guardrails
### Self-Only Personas
### Consent Philosophy
### The Black Mirror Warning

## Open Source Transparency
### Why Open Source
### Educational Purpose
### What You Can Verify
```

---

## Markdown Frontmatter Template

Each markdown file should start with frontmatter like this:

```markdown
---
title: "The Problem & Vision"
slug: problem-vision
order: 1
description: "Why build a local-first AI persona app? The inspiration, motivation, and ethical considerations."
---

# The Problem & Vision

Your content here...
```

## Directory Structure

```
apps/website/content/how-its-built/
├── HOW-ITS-BUILT-OUTLINE.md  (this file)
├── technical/
│   ├── 01-problem-vision.md
│   ├── 02-data-foundation.md
│   ├── 03-ingestion-pipeline.md
│   ├── 04-vector-search-rag.md
│   ├── 05-training-pipeline.md
│   ├── 06-inference-system.md
│   ├── 07-desktop-architecture.md
│   └── 08-privacy-ethics.md
└── simple/
    ├── 01-problem-vision.md
    ├── 02-data-foundation.md
    ├── 03-ingestion-pipeline.md
    ├── 04-vector-search-rag.md
    ├── 05-training-pipeline.md
    ├── 06-inference-system.md
    ├── 07-desktop-architecture.md
    └── 08-privacy-ethics.md
```

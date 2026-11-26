# Be Right Back

A local-first macOS application that creates personalized AI chatbot personas from your iMessage conversation history. All processing happens on-device using Apple Silicon acceleration — your data never leaves your Mac.

## Features

- **Train "Digital You"** — Create an AI persona that texts like you, trained only on messages you've sent
- **Casper Search Agent** — Query your message history using natural language with a tool-calling RAG agent
- **View Insights** — Analyze your messaging patterns with heatmaps, timelines, word clouds, and semantic space visualization
- **Privacy First** — No cloud services, no data upload, everything runs locally on Apple Silicon

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Be Right Back                                │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Read iMessages    2. Export Training Data    3. Fine-tune Model    │
│  ┌──────────────┐     ┌──────────────────┐      ┌──────────────────┐  │
│  │  Messages.db │ ──▶ │   JSONL Export    │ ──▶  │  LoRA Adapter    │  │
│  │  (read-only) │     │   (your texts)   │      │  (50-200MB)      │  │
│  └──────────────┘     └──────────────────┘      └──────────────────┘  │
│                                                          │            │
│  4. Chat Interface                                       ▼            │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Base Model (Qwen3.5, VRAM-tiered) + Your LoRA = Digital You    │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Parse** your iMessage database (read-only, requires Full Disk Access)
2. **Export** conversations as training data (JSONL format)
3. **Fine-tune** a small language model using LoRA on Apple Silicon
4. **Chat** with your personalized AI persona

## Requirements

- **macOS** Sonoma 14.0 or later (the MLX wheels need it)
- **Apple Silicon** (M1, M2, M3, or M4)
- **8GB RAM** minimum (16GB recommended)
- **10GB+ free disk space** for models
- **Full Disk Access** permission for Messages database

## Installation

### Download

Download the latest `.dmg` from the [Releases page](https://github.com/johnlarkin1/be-right-back/releases) or visit [berightback.xyz/download](https://berightback.xyz/download).

### From Source

```bash
# Clone the repository
git clone https://github.com/johnlarkin1/be-right-back.git
cd be-right-back-pub

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js dependencies
cd apps/desktop && npm install && cd ../..

# Set up Python environment for ML pipeline
make prepare-bundle-dev

# Build and run the desktop app
make dev
```

## Quick Start

### Using the Desktop App

1. Launch **Be Right Back**
2. Grant Full Disk Access when prompted (System Settings > Privacy & Security)
3. Select "You" in the contact list. You can only train a persona of yourself.
4. Click "Generate Persona" and wait 30-60 minutes
5. Start chatting with your personalized AI!

### Using the CLI

```bash
# List all contacts with message counts
brb list

# Export your own replies across your 1:1 chats as "You" training data
brb export --output-dir ~/.be-right-back/data/processed

# Search message history with Casper agent
brb ask "What restaurants did Alice recommend last summer?"

# View conversation statistics
brb stats --contact "+1234567890"

# View messages from a conversation
brb view --contact "+1234567890" --limit 50
```

## Project Structure

```
be-right-back/
├── apps/
│   ├── cli/              # Command-line interface (brb binary)
│   ├── desktop/          # Tauri v2 desktop app (React 19 + Rust)
│   └── website/          # Marketing site (berightback.xyz, Next.js 16)
├── crates/
│   ├── common/           # Shared types, errors, path utils, Python env management
│   ├── messages-db/      # iMessage database access (macOS ObjC FFI bindings)
│   ├── training/         # JSONL export, persona stats, training data preparation
│   ├── personas/         # Persona metadata storage and registry
│   ├── inference/        # LLM inference engine, MLX Python daemon, Casper agent
│   └── ingestion/        # RAG search pipeline, vector DB, query planner, hybrid search
├── mlx/                  # Python ML pipeline (training, embeddings, analytics, inference)
└── docs/                 # Technical documentation
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Desktop App** | Tauri 2, React 19, TypeScript, Vite |
| **Backend** | Rust 2024 edition |
| **ML Training** | Python, MLX (Apple Silicon), LoRA fine-tuning |
| **Base Models** | Qwen3.5 4-bit, tier selected by available VRAM (9B / 4B / 2B / 0.8B) |
| **Embeddings** | ModernBERT 768-dim (semantic search) |
| **Database** | SQLite (iMessage + metadata), DuckDB (vector embeddings + FTS) |
| **Search** | Hybrid RAG (semantic cosine + BM25 via Reciprocal Rank Fusion) |
| **Website** | Next.js 16, Tailwind CSS |

## Development

### Commands

```bash
make build      # Build entire workspace in release mode
make test       # Run all Rust tests
make test-all   # Run all tests (Rust + Python + Desktop)
make dev        # Run desktop app in development mode
make lint       # Run all linters (Rust + TypeScript + Python + Website)
make fmt        # Format all code (Rust + TypeScript + Python)
make check      # cargo check --all-targets
```

### Storage

All user data is stored locally in `~/.be-right-back/`:

```
~/.be-right-back/
├── data/
│   ├── db/brb.db          # SQLite metadata
│   ├── db/brb.duckdb      # DuckDB vector embeddings (768-dim, exact in-memory scan)
│   ├── raw/               # iMessage snapshots
│   └── processed/         # JSONL training data
├── models/
│   ├── base/              # Downloaded base models
│   └── personas/          # Trained LoRA adapters
├── mlx/                   # Copied MLX scripts (for bundled app)
└── mlx-venv/              # Python virtual environment
```

## How It's Built

Read the full technical deep-dive at [berightback.xyz/how-its-built](https://berightback.xyz/how-its-built) — an 8-part article series covering the complete architecture from data foundation to privacy considerations.

## Privacy & Security

- **Local-only processing** — No cloud services, no data upload
- **Read-only database access** — Creates snapshots, never modifies Messages.db
- **Compliance-friendly** — Only trains on messages you sent
- **Transparent storage** — All data in `~/.be-right-back/`, easily auditable
- **Source available** — Core crates published for transparency and auditing

## Troubleshooting

### "Permission denied" accessing Messages database

Grant Full Disk Access:
1. Open **System Settings** > **Privacy & Security** > **Full Disk Access**
2. Add Terminal (for CLI) or the Be Right Back app

### Out of memory during training

- Reduce batch size: `--batch-size 2` or `--batch-size 1`
- Lower LoRA rank: `--lora-rank 8` or `--lora-rank 4`

## Contributing

This project is **not accepting pull requests.** The source is published so you can read,
audit, and learn from it — not as an invitation to co-develop.

Bug reports and questions are welcome via [issues](https://github.com/johnlarkin1/be-right-back/issues).
If you want to build on the code, the license permits forking for any noncommercial purpose;
please keep the attribution notice intact rather than sending the changes back here.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free to use, modify, and share for any
noncommercial purpose. Commercial use is not permitted.

If you redistribute this software or build on it, you must pass along the license terms and
preserve the attribution notice:

```
Required Notice: Copyright John Larkin — Be Right Back (https://berightback.xyz)
```

This is a source-available license, not an OSI-approved open source license.

## Acknowledgments

- [MLX](https://ml-explore.github.io/mlx/) — Apple's ML framework for Apple Silicon
- [Tauri](https://tauri.app/) — Desktop app framework
- [LoRA](https://arxiv.org/abs/2106.09685) — Low-Rank Adaptation for efficient fine-tuning

---

**Be Right Back** — Your messages, your AI, your Mac.

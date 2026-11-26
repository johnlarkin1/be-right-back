# Research Report: Local-First AI — Privacy as Architecture

> Reference material for writing about why everything runs on-device and what that means
> Generated: 2026-04-03

---

## The Core Claim

Every byte of user data stays on the user's machine. No cloud APIs, no telemetry on message content, no model training data leaving the device. Privacy isn't a feature toggle — it's an architectural constraint that shaped every technical decision.

---

## What "Local-First" Actually Means Here

### Data That Never Leaves the Device
- iMessage database snapshots (`~/.be-right-back/data/raw/`)
- JSONL training exports (`~/.be-right-back/data/processed/`)
- Trained LoRA adapter weights (`~/.be-right-back/models/personas/`)
- Vector embeddings in DuckDB (`~/.be-right-back/data/db/brb.duckdb`)
- App metadata in SQLite (`~/.be-right-back/data/db/brb.db`)
- Base model weights (`~/.be-right-back/models/base/`)

### Network Calls That Do Happen
- **Model downloads**: HuggingFace Hub (one-time, base model ~5GB)
- **Website analytics**: PostHog on the marketing site (not the app)
- **Update checks**: (not yet implemented)

That's it. The app itself makes zero network calls after initial model download.

---

## Architectural Decisions Forced by Local-First

### 1. MLX Instead of Cloud APIs
- **Trade-off**: Worse model quality (9B vs GPT-4 175B+) but complete privacy
- **Why not hybrid**: Even "just the query" to a cloud API leaks conversation context
- **MLX chosen because**: Apple Silicon native, unified memory, 4-bit quantization makes 9B feasible on 16GB machines

### 2. DuckDB Instead of Cloud Vector DB
- **Trade-off**: No incremental updates, file-level locking vs. managed scalability
- **Why not ChromaDB**: DuckDB gives HNSW + FTS in one embedded file, no server process
- **Why not pgvector**: Would require bundling PostgreSQL

### 3. Bundled Python Instead of Cloud Inference
- **Trade-off**: Complex bundling, signing, version pinning vs. simple API call
- **Forced because**: Can't send messages to a server for processing
- **Result**: 5 Python entry points bundled in the .app, signed for notarization

### 4. Full Disk Access Instead of iCloud Sync
- **Trade-off**: Requires explicit macOS permission grant vs. seamless sync
- **Why**: Reading `chat.db` requires FDA; there's no API for iMessage data
- **Privacy upside**: The permission gate is actually a feature — makes the data access explicit and revocable

### 5. Snapshot-Based Isolation
- **What**: Copy `chat.db` + WAL to a separate directory, never modify originals
- **Why**: Prevents any possibility of corrupting the user's iMessage database
- **Downside**: Disk space (each snapshot is a full copy, 1-10GB)

---

## What's Still Missing (PRD Requirements)

| Privacy Feature | PRD Ref | Status |
|----------------|---------|--------|
| Contact exclusion list | PSR-2.3 | Not implemented |
| One-click data deletion | PSR-2.4 | Not implemented |
| Privacy policy (website) | PSR-3.3 | Only in "How It's Built" article |
| Privacy policy (in-app) | PSR-3.3 | Not implemented |
| Data retention controls | — | Not implemented |
| Export your data | — | Not implemented |

---

## The Competitive Angle

### Cloud-based alternatives
- **Replika**: Cloud-hosted, company has access to all conversations
- **Character.ai**: Cloud-hosted, training data used for company model improvements
- **ChatGPT memories**: Cloud-stored, OpenAI retains conversation logs

### BRB's differentiator
- Your model weights never leave your Mac
- Your message data never leaves your Mac
- No company has access to your conversations
- You can delete everything with `rm -rf ~/.be-right-back/`

---

## The Apple Ecosystem Lock

### Why macOS Only
- iMessage database only exists on macOS (iOS doesn't expose it)
- MLX only runs on Apple Silicon
- Full Disk Access is a macOS-specific permission model
- ObjC FFI for NSAttributedString decoding

### What This Means for Users
- Must have a Mac with Apple Silicon (M1+)
- Must have iMessage enabled on that Mac
- Must grant Full Disk Access to the app
- No iPhone-only, no Windows, no Linux (architecturally, not just "not yet")

---

## Data Storage Layout

```
~/.be-right-back/
├── data/
│   ├── db/
│   │   ├── brb.db          # SQLite — ingestion runs, contacts, settings
│   │   └── brb.duckdb      # DuckDB — embeddings, HNSW index, FTS index
│   ├── raw/
│   │   └── YYYYMMDD_HHMMSS/  # iMessage snapshot (chat.db + WAL + AddressBook)
│   └── processed/
│       └── *.jsonl          # Training data exports
├── models/
│   ├── base/
│   │   └── Qwen3.5-9B-4bit/  # Downloaded base model (~5GB)
│   └── personas/
│       └── contact_name/      # LoRA adapter weights (~50MB each)
├── mlx/                       # Python scripts (copied from repo)
└── mlx-venv/                  # Python virtual environment
```

Everything under `~/.be-right-back/` — single directory, easy to back up, easy to delete.

---

## Security Measures

| Measure | Implementation |
|---------|---------------|
| Read-only DB access | Snapshot strategy — never opens original chat.db for write |
| Code signing | Developer ID Application + notarization |
| Entitlements | Network client/server (for HF downloads), JIT (for NumPy), no camera/mic/location |
| Sandbox | NOT sandboxed (requires FDA which conflicts with App Store sandbox) |
| No telemetry | Zero analytics in the desktop app |
| PolyForm Noncommercial 1.0.0 | Source available — auditable, noncommercial use only |

---

## Narrative Angles

1. **"Privacy isn't a policy, it's an architecture"** — Every technical decision (MLX, DuckDB, bundled Python, snapshots) was forced by the constraint that data never leaves the device. Privacy shaped the entire system design, not just a privacy policy page.

2. **"The cost of local"** — You trade cloud model quality for privacy. 9B parameters vs 175B+. The engineering complexity shifts from "call an API" to "bundle Python, sign it, notarize it, and pray the version pins hold."

3. **"Your AI, your hardware, your data"** — No subscription, no API keys, no data mining. The model lives on your Mac, trained on your messages, and you can delete it all with one command.

4. **"Why there's no iPhone app"** — The iMessage database, MLX, Full Disk Access — all macOS-only. This isn't a business decision, it's a technical reality of Apple's platform.

5. **"One directory to rule them all"** — `~/.be-right-back/` contains everything. Backup = copy the folder. Delete = remove the folder. No hidden state in ~/Library, no cloud sync, no database servers.

---

## Existing Documentation

- `docs/PRD.md` — Privacy & Security Requirements (PSR-1 through PSR-3)
- `apps/website/content/how-its-built/technical/08-privacy-ethics.md` — Published article (thin, 35 lines)
- `docs/system/system-design-overview.md` — Data governance section

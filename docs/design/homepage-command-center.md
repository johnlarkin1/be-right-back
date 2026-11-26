# Homepage Command Center Design Proposals

> Shifting from analytics/insights to an operational command center for managing your digital twin pipeline.

## Current State Analysis

The current `HomeLayout` displays:
- Message statistics (total, contacts, date range)
- Response time analytics
- Conversation trends (top contacts)
- Keyword word cloud
- Two action cards (Train Digital Twin, Ask Casper)

**Problem**: This focuses on "insights about your messages" rather than "managing your persona system."

---

## Core Command Center Components

### Required Operations (from user request)

1. **Snapshot Generation**
   - Snapshot iMessage database
   - Snapshot AddressBook contacts
   - Point-in-time backup for privacy/safety

2. **Data Ingestion**
   - Create/populate SQLite database
   - Build DuckDB VSS vector database for semantic search (Casper)
   - Process and index conversations

3. **Model Management**
   - View downloaded base models
   - View trained personas (LoRA adapters)
   - Model storage usage

4. **System Status**
   - Pipeline health indicators
   - Last snapshot timestamp
   - Database status

---

## Chosen Direction

A pipeline metaphor with terminal styling: a compact status strip across the top, then the primary work surface.

Shipped as `apps/desktop/src/components/home/DashboardView.tsx`, which composes `CompactStatsBar`, `IngestionProgress`, `CasperChat`, `NeedsSetup` and `IngestionSettingsModal`. `HomeLayout.tsx` routes between `WelcomeView` (first run) and `DashboardView` (initialized).

---

## Component Breakdown

### 1. Pipeline Status Bar
A compact visual showing the data flow state:
- **Stage indicators**: Messages → Databases → Models
- **Health dots**: Green for ready, yellow for stale, red for error
- **Expandable**: Click to see detailed status

### 2. Operations Panel
Primary action buttons:
- **Snapshot**: Creates point-in-time backup of iMessage + AddressBook
- **Ingest**: Processes snapshot into SQLite + DuckDB VSS
- **Settings**: Configure paths, preferences

Each shows "Last run: X ago" for context.

### 3. Base Models Card
Shows available/downloaded base models:
- Download status and size
- Training readiness indicator
- Quick download action for missing models

### 4. Personas Card
Lists trained personas:
- Name, size, training date
- Quick "Chat" button to jump to conversation
- Delete option
- "Train New" CTA

### 5. Quick Access Bar
Navigation shortcuts:
- Jump to Chat tab
- Jump to Casper Search tab

---

## State Management Requirements

New types needed in `types.ts`:

```typescript
interface SystemStatus {
  messages_db: {
    status: 'ready' | 'stale' | 'error' | 'empty';
    message_count: number;
    contact_count: number;
    last_snapshot: string | null;
  };
  vector_store: {
    status: 'ready' | 'stale' | 'error' | 'empty';
    indexed_conversations: number;
    embedding_count: number;
    last_ingestion: string | null;
  };
  inference: {
    status: 'idle' | 'loading' | 'ready' | 'generating';
    loaded_persona: string | null;
  };
}

interface BaseModel {
  id: string;
  name: string;
  size_bytes: number | null;
  downloaded: boolean;
  path: string | null;
}

interface TrainedPersona {
  id: string;
  contact_name: string;
  base_model: string;
  adapter_size_bytes: number;
  trained_at: string;
  message_count: number;
}

interface CommandCenterData {
  system_status: SystemStatus;
  base_models: BaseModel[];
  personas: TrainedPersona[];
  storage: {
    models_bytes: number;
    data_bytes: number;
    total_bytes: number;
  };
}
```

---

## Tauri Commands Needed

```rust
// System status
#[tauri::command]
fn get_system_status() -> Result<SystemStatus, String>

// Snapshot operations
#[tauri::command]
async fn create_snapshot() -> Result<SnapshotResult, String>

// Ingestion
#[tauri::command]
async fn run_ingestion(
    progress_callback: Channel<IngestionProgress>
) -> Result<IngestionResult, String>

// Model management
#[tauri::command]
fn list_base_models() -> Result<Vec<BaseModel>, String>

#[tauri::command]
async fn download_base_model(
    model_id: String,
    progress_callback: Channel<DownloadProgress>
) -> Result<(), String>

// Persona management
#[tauri::command]
fn list_personas() -> Result<Vec<TrainedPersona>, String>

#[tauri::command]
fn delete_persona(persona_id: String) -> Result<(), String>
```

---

## Animation & Polish Ideas

1. **Pipeline flow animation**: Subtle particle flow between stages when system is healthy
2. **Status dot pulse**: Gentle pulse on healthy indicators
3. **Button feedback**: Terminal-style "command executing..." state with spinner
4. **Ghost reactions**: Different ghost expressions based on system state
   - Happy when all systems ready
   - Sleepy when inference idle
   - Worried if something is stale/errored
5. **Progress indicators**: For snapshot/ingest/download operations

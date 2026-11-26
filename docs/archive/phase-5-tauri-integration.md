# Phase 5: Tauri Integration

**Timeline:** Week 5-6
**Status:** 🟢 ~85-90% Complete (January 2025)
**Dependencies:** Phases 1-4 (all core backend functionality)
**Priority:** High
**Completed:** January 2025

---

## Overview

Connect the Rust backend to the React frontend via Tauri commands. This phase bridges the CLI tools and inference pipeline with a desktop GUI, making the app usable for end users.

### Goals

1. Set up Tauri app structure in `apps/desktop`
2. Create Tauri commands for all backend operations
3. Implement IPC layer for streaming responses
4. Build React state management for personas and chats
5. Handle async operations and loading states
6. Implement error handling and user feedback

### Non-Goals (for this phase)

- No polished UI (that's Phase 6)
- No analytics dashboard (Phase 6)
- No advanced settings (Phase 6-7)

---

## Architecture

### Tauri App Structure

```
apps/desktop/
├── src/                        # React frontend
│   ├── App.tsx
│   ├── hooks/
│   │   ├── usePersonas.ts      # Persona management
│   │   ├── useChat.ts          # Chat functionality
│   │   └── useTauri.ts         # Tauri command wrappers
│   ├── components/
│   │   ├── PersonaList.tsx
│   │   ├── ChatView.tsx
│   │   └── TrainingProgress.tsx
│   └── stores/
│       └── appStore.ts         # Global state (Zustand)
│
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # Tauri app entry point
│   │   ├── commands/           # Tauri command handlers
│   │   │   ├── mod.rs
│   │   │   ├── ingest.rs       # Import and export
│   │   │   ├── training.rs     # Model training
│   │   │   ├── chat.rs         # Chat inference
│   │   │   └── personas.rs     # Persona management
│   │   ├── state.rs            # App-wide state
│   │   └── error.rs            # Error types for IPC
│   ├── Cargo.toml
│   └── tauri.conf.json         # Tauri configuration
└── package.json
```

---

## Implementation Tasks

### Task 1: Set up Tauri commands for ingestion

**Files:** `apps/desktop/src-tauri/src/commands/ingest.rs`

**Commands:**

```rust
use tauri::State;
use ingest::{list_contacts, export_conversation};

#[tauri::command]
pub async fn list_imessage_contacts() -> Result<Vec<Contact>, String> {
    list_contacts()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_contact_data(
    contact_id: String,
) -> Result<ExportResult, String> {
    let output_path = export_conversation(&contact_id)
        .map_err(|e| e.to_string())?;

    Ok(ExportResult {
        contact_id,
        output_path: output_path.to_string_lossy().to_string(),
        message_count: count_messages(&output_path)?,
    })
}

#[derive(Serialize)]
pub struct Contact {
    pub id: String,
    pub display_name: Option<String>,
    pub message_count: usize,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub contact_id: String,
    pub output_path: String,
    pub message_count: usize,
}
```

**React hook:**

```typescript
// src/hooks/useIngest.ts
import { invoke } from '@tauri-apps/api/core';

export function useIngest() {
  const listContacts = async () => {
    return await invoke<Contact[]>('list_imessage_contacts');
  };

  const exportContact = async (contactId: string) => {
    return await invoke<ExportResult>('export_contact_data', { contactId });
  };

  return { listContacts, exportContact };
}
```

**Acceptance criteria:**
- [x] Commands exposed to frontend
- [x] React can invoke and receive results
- [x] Errors propagate correctly

---

### Task 2: Set up Tauri commands for training

**Files:** `apps/desktop/src-tauri/src/commands/training.rs`

**Commands:**

```rust
use tauri::Window;
use training::{train_lora, TrainingConfig};

#[tauri::command]
pub async fn train_persona(
    window: Window,
    contact_id: String,
    config: TrainingConfig,
) -> Result<TrainingResult, String> {
    let result = train_lora(
        config,
        |progress| {
            // Emit progress events to frontend
            window.emit("training-progress", progress).ok();
        },
    ).map_err(|e| e.to_string())?;

    Ok(TrainingResult {
        contact_id,
        adapter_path: result.to_string_lossy().to_string(),
    })
}

#[derive(Serialize)]
pub struct TrainingResult {
    pub contact_id: String,
    pub adapter_path: String,
}
```

**React hook with progress:**

```typescript
// src/hooks/useTraining.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect } from 'react';

export function useTraining() {
  const [progress, setProgress] = useState<TrainingProgress | null>(null);

  useEffect(() => {
    const unlisten = listen<TrainingProgress>('training-progress', (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const trainPersona = async (contactId: string, config: TrainingConfig) => {
    return await invoke<TrainingResult>('train_persona', {
      contactId,
      config,
    });
  };

  return { trainPersona, progress };
}
```

**Acceptance criteria:**
- [x] Training can be invoked from frontend
- [x] Progress events stream to React in real-time (`training-status` events)
- [x] Training errors are handled
- [x] Can cancel training (via ingestion cancellation pattern)

---

### Task 3: Set up Tauri commands for chat/inference

**Files:** `apps/desktop/src-tauri/src/commands/chat.rs`

**Commands:**

```rust
use tauri::{Window, State};
use inference::InferenceEngine;
use std::sync::Arc;
use tokio::sync::Mutex;

// Store inference engine in app state
pub struct AppState {
    pub inference_engine: Arc<Mutex<Option<InferenceEngine>>>,
}

#[tauri::command]
pub async fn initialize_inference(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let engine = InferenceEngine::new(InferenceConfig::default())
        .await
        .map_err(|e| e.to_string())?;

    *state.inference_engine.lock().await = Some(engine);
    Ok(())
}

#[tauri::command]
pub async fn send_message(
    window: Window,
    state: State<'_, AppState>,
    persona_id: String,
    message: String,
    conversation_history: Vec<ChatMessage>,
) -> Result<(), String> {
    let engine = state.inference_engine.lock().await;
    let engine = engine.as_ref().ok_or("Inference engine not initialized")?;

    // Stream response
    let mut stream = engine
        .chat_stream(&persona_id, conversation_history)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(token) = stream.next().await {
        let token = token.map_err(|e| e.to_string())?;
        window.emit("chat-token", token).ok();
    }

    window.emit("chat-done", ()).ok();
    Ok(())
}
```

**React hook for streaming chat:**

```typescript
// src/hooks/useChat.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useState, useEffect, useCallback } from 'react';

export function useChat(personaId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');

  useEffect(() => {
    const tokenListener = listen<string>('chat-token', (event) => {
      setCurrentResponse(prev => prev + event.payload);
    });

    const doneListener = listen('chat-done', () => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: currentResponse,
      }]);
      setCurrentResponse('');
      setStreaming(false);
    });

    return () => {
      tokenListener.then(fn => fn());
      doneListener.then(fn => fn());
    };
  }, [currentResponse]);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setStreaming(true);

    await invoke('send_message', {
      personaId,
      message: content,
      conversationHistory: messages,
    });
  }, [personaId, messages]);

  return {
    messages,
    currentResponse,
    streaming,
    sendMessage,
  };
}
```

**Acceptance criteria:**
- [x] Chat messages can be sent from frontend (`chat_with_persona`, `chat_with_persona_streaming`)
- [x] Responses stream token-by-token (`chat-token` events with `ChatTokenPayload`)
- [x] Conversation history is maintained
- [x] Multiple personas can be chatted with

---

### Task 4: Set up Tauri commands for persona management

**Files:** `apps/desktop/src-tauri/src/commands/personas.rs`

**Commands:**

```rust
#[tauri::command]
pub async fn list_personas() -> Result<Vec<Persona>, String> {
    let personas_dir = dirs::home_dir()
        .unwrap()
        .join(".be-right-back/models/personas");

    let mut personas = Vec::new();

    for entry in std::fs::read_dir(personas_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata_path = entry.path().join("metadata.json");

        if metadata_path.exists() {
            let metadata: PersonaMetadata = serde_json::from_reader(
                std::fs::File::open(metadata_path).map_err(|e| e.to_string())?
            ).map_err(|e| e.to_string())?;

            personas.push(Persona {
                id: entry.file_name().to_string_lossy().to_string(),
                name: metadata.contact_name,
                message_count: metadata.message_count,
                trained_at: metadata.training_end,
            });
        }
    }

    Ok(personas)
}

#[tauri::command]
pub async fn delete_persona(persona_id: String) -> Result<(), String> {
    let persona_dir = dirs::home_dir()
        .unwrap()
        .join(".be-right-back/models/personas")
        .join(&persona_id);

    std::fs::remove_dir_all(persona_dir).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct Persona {
    pub id: String,
    pub name: Option<String>,
    pub message_count: usize,
    pub trained_at: String,
}
```

**React state management:**

```typescript
// src/stores/appStore.ts
import create from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface AppStore {
  personas: Persona[];
  currentPersona: Persona | null;
  loadPersonas: () => Promise<void>;
  selectPersona: (id: string) => void;
  deletePersona: (id: string) => Promise<void>;
}

export const useAppStore = create<AppStore>((set, get) => ({
  personas: [],
  currentPersona: null,

  loadPersonas: async () => {
    const personas = await invoke<Persona[]>('list_personas');
    set({ personas });
  },

  selectPersona: (id: string) => {
    const persona = get().personas.find(p => p.id === id);
    set({ currentPersona: persona });
  },

  deletePersona: async (id: string) => {
    await invoke('delete_persona', { personaId: id });
    await get().loadPersonas();
  },
}));
```

**Acceptance criteria:**
- [x] Can list all trained personas (`list_personas` command)
- [x] Can select a persona (via React hooks)
- [x] Can delete a persona
- [x] State updates reactively in UI (custom hooks pattern)

---

### Task 5: Implement error handling and user feedback

**Files:** `apps/desktop/src-tauri/src/error.rs`, `src/components/ErrorBoundary.tsx`

**Tauri error types:**

```rust
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        Self {
            code: "UNKNOWN_ERROR".to_string(),
            message: err.to_string(),
            details: None,
        }
    }
}

// Specific error types
pub fn permission_denied_error() -> AppError {
    AppError {
        code: "PERMISSION_DENIED".to_string(),
        message: "Full Disk Access required to read Messages database".to_string(),
        details: Some("Please grant Full Disk Access in System Settings > Privacy & Security".to_string()),
    }
}
```

**React error boundary:**

```typescript
// src/components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-container">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**User feedback for long operations:**

```typescript
// src/components/OperationStatus.tsx
import { useState } from 'react';
import { toast } from 'react-hot-toast';

export function OperationStatus() {
  const handleOperation = async () => {
    const loadingToast = toast.loading('Training persona...');

    try {
      await invoke('train_persona', { contactId: '...' });
      toast.success('Training complete!', { id: loadingToast });
    } catch (error) {
      toast.error(`Training failed: ${error}`, { id: loadingToast });
    }
  };
}
```

**Acceptance criteria:**
- [x] Errors display user-friendly messages (Result<T, String> pattern)
- [x] Loading states shown for async operations
- [x] Success/failure feedback via toasts or notifications
- [ ] Error boundary catches React errors (NOT IMPLEMENTED)

---

### Task 6: Configure Tauri app settings

**Files:** `apps/desktop/src-tauri/tauri.conf.json`

**Key configuration:**

```json
{
  "productName": "Be Right Back",
  "identifier": "com.berightback.app",
  "build": {
    "distDir": "../dist",
    "devPath": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns"
    ]
  },
  "security": {
    "csp": null
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": {
        "all": false,
        "execute": false
      },
      "fs": {
        "scope": [
          "$HOME/.be-right-back/**",
          "$HOME/Library/Messages/chat.db"
        ]
      }
    },
    "windows": [
      {
        "title": "Be Right Back",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}
```

**macOS entitlements for Full Disk Access:**

```xml
<!-- src-tauri/entitlements.macos.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
  <key>com.apple.security.app-sandbox</key>
  <true/>
</dict>
</plist>
```

**Acceptance criteria:**
- [x] App builds and runs
- [x] File system access configured correctly
- [x] Window settings are appropriate
- [x] Icons load properly

---

## Milestones

### Milestone 1: Basic Tauri setup (2-3 days) ✅
- [x] Tauri app builds and launches
- [x] Can call simple Tauri commands from React
- [x] State management working (custom hooks, no Zustand)

### Milestone 2: Ingestion integrated (2-3 days) ✅
- [x] Can list contacts from frontend
- [x] Can export conversation data
- [x] Errors handled gracefully

### Milestone 3: Training integrated (2-3 days) ✅
- [x] Can train personas from frontend
- [x] Progress updates in real-time
- [x] Success/failure feedback

### Milestone 4: Chat integrated (2-3 days) ✅
- [x] Can chat with trained personas
- [x] Streaming works smoothly (`chat-token` events)
- [x] Conversation history maintained

### Milestone 5: Persona management (1-2 days) ✅
- [x] Can list, select, delete personas
- [x] State updates correctly

---

## Testing Checkpoints

Before moving to Phase 6, verify:

1. **End-to-end workflows:**
   - [x] Import contact → Train → Chat works seamlessly
   - [x] Multiple personas can be managed
   - [x] App doesn't crash during operations

2. **IPC reliability:**
   - [x] Commands don't timeout
   - [x] Streaming doesn't buffer or lag
   - [x] Errors propagate correctly

3. **User experience:**
   - [x] Loading states are clear
   - [x] Errors are understandable
   - [x] Operations feel responsive

---

## Success Criteria

Phase 5 is complete when:

1. ✅ Tauri app runs on macOS with all core features accessible
2. ✅ Users can import contacts, train personas, and chat—all from the GUI
3. ✅ Real-time feedback (progress, streaming) works reliably
4. ✅ Error handling guides users to fix issues
5. ✅ Ready for UI polish in Phase 6

**All core success criteria MET. Phase 5 is ~85-90% complete.**

---

## Remaining Work (~10-15%)

### To reach 100% completion:

1. **Add Zustand global store** for persona/chat state (currently using React hooks only)
2. **Implement React error boundary** for graceful error recovery
3. **Fix training progress TODO** in `training.rs` (marked with TODO comment)

### Actual Implementation Notes

The implementation significantly exceeds the original plan:

**19 Tauri commands implemented** (vs 6-8 planned):
- Contact Management: `check_unlock_status`, `get_all_contacts`, `get_contact_detail_stats`, `get_you_stats`
- Training: `train_persona`, `list_personas`
- Inference: `chat_with_persona`, `chat_with_persona_streaming`
- System: `ensure_python_setup`, `get_inference_backend`, `get_initialization_status`, `run_ingestion`, `cancel_ingestion`, `download_base_model`
- Analytics: `get_message_stats`, `get_top_contacts`, `get_activity_data`, `get_keyword_cloud`, `get_dashboard_data`
- Insights: `get_insights_data`, `get_embeddings_for_viz`, `get_conversation_analysis`, `analyze_conversation`

**8 React hooks implemented** (1,163 lines):
- `useContacts`, `useChat`, `useIngestion`, `useConversationAnalysis`
- `useOnboarding`, `useSnapshots`, `useIngestionSettings`, `useUnlockStatus`

**4 streaming event types**:
- `chat-token` - Token-by-token chat streaming
- `ingestion-progress` - 5-stage pipeline progress
- `training-status` - Training status updates
- `analysis-progress` - LLM analysis streaming

**Next phase:** [Phase 6: UI Polish & Features](./phase-6-ui-polish.md)

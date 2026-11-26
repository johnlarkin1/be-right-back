/**
 * Test data factories — typed against src/types.ts
 * Pattern: createX(overrides?: Partial<T>): T
 */
import type {
  InitializationStatus,
  ContactWithStatus,
  ContactDetailStats,
  InsightsStats,
  CasperEvent,
} from "@/types";

// These fixtures are the only place that needs a single Casper event variant
// narrowed out of the `CasperEvent` union, so the aliases live here rather
// than in the shared types.ts.
type CasperStartedEvent = Extract<CasperEvent, { type: "started" }>;
type CasperThinkingEvent = Extract<CasperEvent, { type: "thinking" }>;
type CasperToolStartEvent = Extract<CasperEvent, { type: "tool_start" }>;
type CasperToolCompleteEvent = Extract<CasperEvent, { type: "tool_complete" }>;
type CasperTokenEvent = Extract<CasperEvent, { type: "token" }>;
type CasperCompleteEvent = Extract<CasperEvent, { type: "complete" }>;
type CasperErrorEvent = Extract<CasperEvent, { type: "error" }>;

// ── Initialization ──────────────────────────────────────────

export function createInitializationStatus(
  overrides?: Partial<InitializationStatus>,
): InitializationStatus {
  return {
    has_fda_permission: true,
    has_snapshot: true,
    snapshot_date: "2025-01-15T10:30:00Z",
    snapshot_message_count: 12500,
    snapshot_contact_count: 45,
    has_sqlite_db: true,
    has_vector_db: true,
    has_base_model: true,
    has_trained_persona: false,
    current_stage: "persona",
    is_fully_initialized: false,
    snapshot_size_bytes: 25000000,
    snapshot_size_display: "25.0 MB",
    embeddings_size_bytes: 50000000,
    embeddings_size_display: "50.0 MB",
    total_data_size_bytes: 75000000,
    total_data_size_display: "75.0 MB",
    last_ingestion_date: "2025-01-15T11:00:00Z",
    last_ingestion_duration_secs: 120,
    chunk_count: 3200,
    ...overrides,
  };
}

// ── Contacts ────────────────────────────────────────────────

export function createContact(
  overrides?: Partial<ContactWithStatus>,
): ContactWithStatus {
  return {
    contact_id: "contact-1",
    display_name: "Alice Smith",
    message_count: 500,
    last_message_date: "2025-01-14T18:30:00Z",
    has_persona: false,
    is_you: false,
    ...overrides,
  };
}

export function createYouContact(
  overrides?: Partial<ContactWithStatus>,
): ContactWithStatus {
  return createContact({
    contact_id: "you",
    display_name: "You",
    message_count: 12500,
    is_you: true,
    has_persona: true,
    ...overrides,
  });
}

export function createContactDetailStats(
  overrides?: Partial<ContactDetailStats>,
): ContactDetailStats {
  return {
    contact_id: "contact-1",
    display_name: "Alice Smith",
    message_count: 500,
    messages_from_me: 250,
    messages_from_them: 250,
    date_range_start: "2023-01-01",
    date_range_end: "2025-01-14",
    avg_message_length: 42,
    emoji_rate: 0.15,
    avg_response_time_secs: 300,
    top_emojis: ["😂", "❤️", "👍"],
    ...overrides,
  };
}

// ── Ingestion Progress ──────────────────────────────────────

interface RawIngestionProgressEvent {
  stages: {
    stage: string;
    percent: number;
    status: string;
    message: string;
  }[];
  current_stage: string;
  is_complete: boolean;
  error: string | null;
  stats?: {
    messages_processed?: number;
    total_messages?: number;
    contacts_processed?: number;
    total_contacts?: number;
    chunks_created?: number;
    chunks_embedded?: number;
    elapsed_secs?: number;
    estimated_remaining_secs?: number;
  };
}

export function createIngestionProgressEvent(
  overrides?: Partial<RawIngestionProgressEvent>,
): RawIngestionProgressEvent {
  return {
    stages: [
      { stage: "snapshot", percent: 100, status: "completed", message: "Done" },
      { stage: "parsing", percent: 100, status: "completed", message: "Done" },
      {
        stage: "chunking",
        percent: 100,
        status: "completed",
        message: "Done",
      },
      {
        stage: "embedding",
        percent: 50,
        status: "in_progress",
        message: "Embedding...",
      },
      { stage: "saving", percent: 0, status: "pending", message: "" },
      { stage: "analyzing", percent: 0, status: "pending", message: "" },
    ],
    current_stage: "embedding",
    is_complete: false,
    error: null,
    ...overrides,
  };
}

// ── Casper Agent Events ─────────────────────────────────────

export function createCasperStartedEvent(
  overrides?: Partial<CasperStartedEvent>,
): CasperStartedEvent {
  return {
    type: "started",
    question: "Who do I text the most?",
    ...overrides,
  };
}

export function createCasperThinkingEvent(
  overrides?: Partial<CasperThinkingEvent>,
): CasperThinkingEvent {
  return {
    type: "thinking",
    iteration: 1,
    max_iterations: 5,
    ...overrides,
  };
}

export function createCasperToolStartEvent(
  overrides?: Partial<CasperToolStartEvent>,
): CasperToolStartEvent {
  return {
    type: "tool_start",
    tool_name: "search_messages",
    arguments: { query: "most texted" },
    iteration: 1,
    ...overrides,
  };
}

export function createCasperToolCompleteEvent(
  overrides?: Partial<CasperToolCompleteEvent>,
): CasperToolCompleteEvent {
  return {
    type: "tool_complete",
    tool_name: "search_messages",
    success: true,
    duration_ms: 150,
    result_preview: "Found 25 results",
    ...overrides,
  };
}

export function createCasperTokenEvent(text = "Hello"): CasperTokenEvent {
  return { type: "token", text };
}

export function createCasperCompleteEvent(
  overrides?: Partial<CasperCompleteEvent>,
): CasperCompleteEvent {
  return {
    type: "complete",
    answer: "Based on your messages, you text Alice the most.",
    iterations: 2,
    duration_ms: 3000,
    tool_calls: [
      {
        tool_name: "search_messages",
        success: true,
        duration_ms: 150,
        error: null,
      },
    ],
    ...overrides,
  };
}

export function createCasperErrorEvent(
  overrides?: Partial<CasperErrorEvent>,
): CasperErrorEvent {
  return {
    type: "error",
    message: "Something went wrong",
    ...overrides,
  };
}

// ── Insights Stats ──────────────────────────────────────────

export function createInsightsStats(
  overrides?: Partial<InsightsStats>,
): InsightsStats {
  return {
    total_messages: 12500,
    avg_response_time_mins: 15,
    active_days: 365,
    topics_count: 25,
    date_span_days: 730,
    ...overrides,
  };
}

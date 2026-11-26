/**
 * Shared TypeScript types for the Be Right Back desktop app
 *
 * Types that cross the Tauri IPC boundary are generated from Rust by ts-rs and
 * re-exported here. Run `make bindings` after changing a `#[derive(TS)]` type.
 * Everything defined in this file is frontend-only: view models, display
 * labels, and defaults the backend never sees.
 */

import type {
  AggregatedCount,
  AggregationType,
  CalendarCell,
  CalendarResponse,
  CasperEvent,
  CasperMessageDto,
  ChatMessage,
  ClusterInfo,
  ContactDetailStats,
  ContactWithStatus,
  DayContact,
  DayDetails,
  DaySnippet,
  DayTopic,
  EmbeddingPoint,
  EmbeddingVizData,
  IncompatiblePersona,
  IngestionProgressEvent,
  IngestionResult,
  IngestionStats,
  InitializationStatus,
  InitStage,
  InsightsStats,
  MemoryPressure,
  MessageDateRange,
  ModelChangeResult,
  ModelTierInfo,
  ProcSample,
  ResourceSample,
  TimelineResponse,
  ToolCallInfo,
  TrainedPersonaResponse,
  TrainingPhase,
  TrainingPlanResponse,
  TrainingProgressEvent,
  TrainingSettings,
  TrainingSettingsBounds,
  WordFrequency,
} from "./bindings/desktop";
import type { MentionedContact } from "./bindings/inference";
import type {
  AnalyticsSettings,
  CasperThread,
  ContactProgress,
  IngestionSettings,
  IngestionStage,
  StageProgress,
  StageStatus,
} from "./bindings/ingestion";

export type {
  AggregatedCount,
  AggregationType,
  AnalyticsSettings,
  CalendarCell,
  CalendarResponse,
  CasperEvent,
  ChatMessage,
  ClusterInfo,
  ContactDetailStats,
  ContactProgress,
  ContactWithStatus,
  DayContact,
  DayDetails,
  DaySnippet,
  DayTopic,
  EmbeddingPoint,
  EmbeddingVizData,
  IncompatiblePersona,
  IngestionProgressEvent,
  IngestionResult,
  IngestionSettings,
  IngestionStage,
  InitializationStatus,
  InitStage,
  InsightsStats,
  MemoryPressure,
  MentionedContact,
  MessageDateRange,
  ModelChangeResult,
  ModelTierInfo,
  ProcSample,
  ResourceSample,
  StageProgress,
  StageStatus,
  TimelineResponse,
  ToolCallInfo,
  TrainingPhase,
  TrainingProgressEvent,
  TrainingSettings,
  TrainingSettingsBounds,
  WordFrequency,
};

// Rust names these after their role on the wire; the UI has always used the
// shorter name.
export type { CasperThread as CasperConversation };
export type { IngestionStats as IngestionStatsEvent };
export type { TrainedPersonaResponse as TrainedPersona };
export type { TrainingPlanResponse as TrainingPlan };

/** Top-level tabs, in display order: Insights, Ask Casper, Personas. */
export type TabId = "insights" | "casper" | "personas";

/** Ghost color variants */
export type GhostColor = "green" | "pink" | "purple" | "cyan" | "amber";

/** Ghost variant types */
export type GhostVariant =
  | "standard"
  | "happy"
  | "sleepy"
  | "surprised"
  | "angry"
  | "sad"
  | "mischievous"
  | "worried"
  | "excited"
  | "bored"
  | "thinking";

// ============================================
// Chat Interface Types (iMessage-style redesign)
// ============================================

/** Screens of the Personas tab: the persona cards, one contact, a chat */
export type PersonasView = "grid" | "detail" | "chat";

/** Wire phases plus the two terminal states the training modal tracks itself. */
export type TrainingModalPhase =
  | TrainingProgressEvent["phase"]
  | "complete"
  | "error";

/** Training phase labels for display */
export const TRAINING_PHASE_LABELS: Record<TrainingModalPhase, string> = {
  exporting: "Exporting messages",
  downloading: "Downloading base model",
  training: "Training LoRA adapter",
  finalizing: "Finalizing adapter",
  complete: "Training complete",
  error: "Training failed",
};

// ============================================
// Home Page & Onboarding Types
// ============================================

/** Onboarding steps for Casper guide */
export type OnboardingStep =
  | "welcome"
  | "privacy_intro"
  | "permissions"
  | "first_snapshot"
  | "ingestion_ready"
  | "ingestion_running"
  | "complete"
  | "hidden";

/** Onboarding state for Casper */
export interface OnboardingState {
  currentStep: OnboardingStep;
  hasSeenWelcome: boolean;
  hasGrantedFDA: boolean;
  hasFirstSnapshot: boolean;
  hasCompletedIngestion: boolean;
  casperMinimized: boolean;
}

// ============================================
// Ingestion Progress Types (6-stage system)
// ============================================

/** Stage labels for display */
export const STAGE_LABELS: Record<IngestionStage, string> = {
  snapshot: "Creating snapshot",
  parsing: "Parsing messages",
  chunking: "Chunking messages",
  embedding: "Embedding messages",
  saving: "Saving results",
  analyzing: "Analyzing patterns",
};

/** Stage-specific colors from the ghost palette */
export const STAGE_COLORS: Record<IngestionStage, string> = {
  snapshot: "#00ff41", // green - terminal classic
  parsing: "#00ffff", // cyan - data flow
  chunking: "#8b5cf6", // purple - magic
  embedding: "#ff69b4", // pink - Casper
  saving: "#ffb000", // amber - gold completion
  analyzing: "#00ffff", // cyan - insight/discovery
};

/** Ghost color variants per stage */
export const STAGE_GHOST_COLORS: Record<IngestionStage, GhostColor> = {
  snapshot: "green",
  parsing: "cyan",
  chunking: "purple",
  embedding: "pink",
  saving: "amber",
  analyzing: "cyan",
};

// ============================================
// Insights Page Types
// ============================================

/** Date range for brush selection */
export interface InsightsDateRange {
  startDate: string;
  endDate: string;
  startIndex: number;
  endIndex: number;
}

// ============================================
// Ingestion Settings Types
// ============================================

/** Modal mode for IngestionSettingsModal */
export type IngestionModalMode = "ingest" | "re-embed";

/**
 * `AnalyticsSettings` with every optional field resolved to a concrete value.
 *
 * Every field is `Option<_>` on the Rust side, but the advanced sliders in
 * IngestionSettingsModal bind `value: number` and cannot take nulls. This keeps
 * the wire type honest while giving the UI something it can render, and it
 * tracks the generated shape automatically if a field is added.
 */
export type ResolvedAnalyticsSettings = {
  [K in keyof AnalyticsSettings]-?: NonNullable<AnalyticsSettings[K]>;
};

/** Default analytics settings */
export const DEFAULT_ANALYTICS_SETTINGS: ResolvedAnalyticsSettings = {
  target_topics: 15,
  pca_dims: 50,
  umap_n_neighbors: 20,
  umap_min_dist: 0.25,
  umap_spread: 1.5,
  random_state: 42,
};

/** Default ingestion settings */
export const DEFAULT_INGESTION_SETTINGS: IngestionSettings = {
  start_date: null,
  end_date: null,
  min_messages_per_contact: 50,
  analytics: DEFAULT_ANALYTICS_SETTINGS,
};

// ============================================
// Casper Agent Types
// ============================================

/** Casper agent execution state */
export type CasperAgentState =
  | "idle"
  | "started"
  | "thinking"
  | "tool_calling"
  | "processing"
  | "answering"
  | "complete"
  | "error";

/** Tool call status */
export type CasperToolStatus = "pending" | "running" | "success" | "error";

/** Information about a tool call during agent execution */
export interface CasperToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  status: CasperToolStatus;
  durationMs?: number;
  resultPreview?: string;
  error?: string;
}

/**
 * A Casper message as stored and returned by `load_casper_thread`.
 *
 * The backend stores `tool_calls` as opaque JSON, so the generated type says
 * so. Only the UI writes and reads those objects, and it writes
 * `CasperToolCall`, so narrow them here.
 */
export type CasperMessage = Omit<CasperMessageDto, "role" | "tool_calls"> & {
  role: "user" | "assistant";
  tool_calls: CasperToolCall[] | null;
};

/**
 * A message in the live conversation. Identical to `CasperMessage` except it
 * has no `id` — the turn has not been persisted yet, so the backend has not
 * assigned one. Loaded history is assignable to this.
 */
export type CasperChatMessage = Omit<CasperMessage, "id">;

/** Progress state during Casper agent execution */
export interface CasperProgress {
  state: CasperAgentState;
  iteration: number;
  maxIterations: number;
  currentTool: CasperToolCall | null;
  completedTools: CasperToolCall[];
  streamingAnswer: string;
  error: string | null;
}

/** Ghost variants mapped to Casper agent states */
export const CASPER_STATE_VARIANTS: Record<CasperAgentState, GhostVariant> = {
  idle: "happy",
  started: "excited",
  thinking: "thinking",
  tool_calling: "mischievous",
  processing: "sleepy",
  answering: "excited",
  complete: "happy",
  error: "sad",
};

/** Human-readable status messages for each state */
export const CASPER_STATE_MESSAGES: Record<CasperAgentState, string> = {
  idle: "Ready to help!",
  started: "Let me think about that...",
  thinking: "Thinking...",
  tool_calling: "Searching your messages...",
  processing: "Processing results...",
  answering: "Writing my response...",
  complete: "Here's what I found!",
  error: "Oops, something went wrong.",
};

/** Example search queries for Casper UI */
export const EXAMPLE_QUERIES = [
  "Who do I text the most?",
  "Find messages about weekend plans",
  "What restaurants did we discuss?",
  "Search for travel conversations",
];

// =============================================================================
// Model Picker Types
// =============================================================================

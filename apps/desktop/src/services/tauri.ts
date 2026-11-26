/**
 * Typed wrappers for all Tauri invoke() commands.
 * Import from here instead of calling invoke() directly.
 *
 * Event listeners (listen()) are NOT included here — those stay as
 * direct @tauri-apps/api/event imports in hooks that need streaming.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  MentionedContact,
  InitializationStatus,
  IngestionResult,
  IngestionSettings,
  AnalyticsSettings,
  MessageDateRange,
  ContactWithStatus,
  ContactDetailStats,
  TrainedPersona,
  TrainingPlan,
  TrainingSettings,
  InsightsStats,
  CalendarResponse,
  DayDetails,
  TimelineResponse,
  WordFrequency,
  EmbeddingVizData,
  AggregationType,
  ModelTierInfo,
  ModelChangeResult,
  IncompatiblePersona,
  CasperConversation,
  CasperMessage,
  CasperToolCall,
} from "@/types";
import type { ConversationAnalysisResult } from "@/hooks/useConversationAnalysis";
import type {
  ReactedMessage,
  TapbackContact,
  TapbackEmoji,
  TapbackMonth,
  TapbackSummary,
  TapbackWindow,
} from "@/bindings/ingestion";

// ── System ────────────────────────────────────────────────────────

export function getInitializationStatus(): Promise<InitializationStatus> {
  return invoke<InitializationStatus>("get_initialization_status");
}

export function openFdaSettings(): Promise<void> {
  return invoke("open_fda_settings");
}

// ── Snapshots & Ingestion ─────────────────────────────────────────

export function runIngestion(): Promise<IngestionResult> {
  return invoke<IngestionResult>("run_ingestion");
}

export function cancelIngestion(): Promise<void> {
  return invoke("cancel_ingestion");
}

export function getIngestionSettings(): Promise<IngestionSettings | null> {
  return invoke<IngestionSettings | null>("get_ingestion_settings");
}

export function saveIngestionSettings(
  settings: IngestionSettings,
): Promise<void> {
  return invoke("save_ingestion_settings", { settings });
}

export function getMessageDateRange(): Promise<MessageDateRange> {
  return invoke<MessageDateRange>("get_message_date_range");
}

export interface IngestionFreshness {
  indexed_latest_date: string | null;
  live_latest_date: string | null;
  is_stale: boolean;
  days_behind: number;
}

/**
 * Compare the latest indexed message date against the live Messages database.
 * Used to prompt a re-ingest when the index has fallen behind (stale data is
 * what makes Casper answer from months-old messages).
 */
export function checkIngestionFreshness(): Promise<IngestionFreshness> {
  return invoke<IngestionFreshness>("check_ingestion_freshness");
}

export function runAnalyticsOnly(
  settings: AnalyticsSettings | null,
): Promise<void> {
  return invoke("run_analytics_only", { settings });
}

// ── Contacts ──────────────────────────────────────────────────────

export function getAllContacts(): Promise<ContactWithStatus[]> {
  return invoke<ContactWithStatus[]>("get_all_contacts");
}

export function getContactDetailStats(
  contactId: string,
): Promise<ContactDetailStats> {
  return invoke<ContactDetailStats>("get_contact_detail_stats", { contactId });
}

// ── Training & Personas ───────────────────────────────────────────

/** Train the "You" persona. No other persona can be trained. */
export function trainPersona(args: {
  baseModel: string;
  maxSteps: number;
  /** Advanced panel values. Omit to use the hardware-aware profile. */
  settings?: TrainingSettings;
}): Promise<void> {
  return invoke("train_persona", args);
}

/** Stop the training run in progress. Resolves true if a trainer was running. */
export function cancelTraining(): Promise<boolean> {
  return invoke<boolean>("cancel_training");
}

export function getTrainingPlan(args: {
  messageCount: number;
  /** Plan for these settings instead of the recommended ones. */
  settings?: TrainingSettings;
}): Promise<TrainingPlan> {
  return invoke<TrainingPlan>("get_training_plan", args);
}

/**
 * Save a PNG of the loss chart to Downloads and reveal it in Finder.
 * Resolves to the saved file's path.
 */
export function saveLossChart(png: Uint8Array): Promise<string> {
  return invoke<string>("save_loss_chart", { png: Array.from(png) });
}

export function listPersonas(): Promise<TrainedPersona[]> {
  return invoke<TrainedPersona[]>("list_personas");
}

// ── Chat (Persona) ───────────────────────────────────────────────

/** Chat with the "You" persona. */
export function chatWithPersonaStreaming(args: {
  message: string;
  history: Array<{ role: string; content: string }>;
  enableThinking?: boolean;
}): Promise<void> {
  return invoke("chat_with_persona_streaming", args);
}

// ── Search (Casper) ──────────────────────────────────────────────

export function askCasperStreaming(args: {
  question: string;
  history: Array<{ role: string; content: string }>;
  maxIterations: number;
  enableThinking?: boolean;
  /** Contacts the user tagged with "@". */
  mentions?: MentionedContact[];
}): Promise<void> {
  return invoke("ask_casper_streaming", args);
}

/** Stop the Casper run in progress. Resolves true if one was running. */
export function cancelCasper(): Promise<boolean> {
  return invoke<boolean>("cancel_casper");
}

export interface CasperModelInfo {
  display_name: string;
  model_id: string;
  tier_name: string;
  quantization: string;
}

export function getCasperModelInfo(): Promise<CasperModelInfo> {
  return invoke<CasperModelInfo>("get_casper_model_info");
}

// ── Casper Threads (saved conversation persistence) ──────────────

export function createCasperThread(title: string): Promise<number> {
  return invoke<number>("create_casper_thread", { title });
}

export function listCasperThreads(): Promise<CasperConversation[]> {
  return invoke<CasperConversation[]>("list_casper_threads");
}

export function appendCasperMessage(args: {
  threadId: number;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  thinkingEnabled?: boolean;
  toolCalls?: CasperToolCall[];
}): Promise<number> {
  return invoke<number>("append_casper_message", args);
}

export function loadCasperThread(threadId: number): Promise<CasperMessage[]> {
  return invoke<CasperMessage[]>("load_casper_thread", { threadId });
}

export function renameCasperThread(
  threadId: number,
  title: string,
): Promise<void> {
  return invoke("rename_casper_thread", { threadId, title });
}

export function deleteCasperThread(threadId: number): Promise<void> {
  return invoke("delete_casper_thread", { threadId });
}

// ── Model Picker ──────────────────────────────────────────────────

export function getAvailableModels(): Promise<ModelTierInfo[]> {
  return invoke<ModelTierInfo[]>("get_available_models");
}

export function checkModelCompatibility(
  tierName: string,
  quantization?: string,
): Promise<IncompatiblePersona[]> {
  return invoke<IncompatiblePersona[]>("check_model_compatibility", {
    tierName,
    quantization,
  });
}

export function setModelPreference(
  tierName: string,
  quantization?: string,
): Promise<ModelChangeResult> {
  return invoke<ModelChangeResult>("set_model_preference", {
    tierName,
    quantization,
  });
}

export function resetModelPreference(): Promise<ModelChangeResult> {
  return invoke<ModelChangeResult>("reset_model_preference");
}

// ── Conversation Analysis ────────────────────────────────────────

export function getConversationAnalysis(
  contactId: string,
): Promise<ConversationAnalysisResult | null> {
  return invoke<ConversationAnalysisResult | null>(
    "get_conversation_analysis",
    { contactId },
  );
}

export function analyzeConversation(args: {
  contactId: string;
  contactName: string;
  forceRefresh?: boolean;
}): Promise<ConversationAnalysisResult> {
  return invoke<ConversationAnalysisResult>("analyze_conversation", args);
}

// ── Insights ─────────────────────────────────────────────────────

export function getInsightsStats(): Promise<InsightsStats> {
  return invoke<InsightsStats>("get_insights_stats");
}

export function getInsightsCalendar(): Promise<CalendarResponse> {
  return invoke<CalendarResponse>("get_insights_calendar");
}

/** Details of one day, or of the inclusive period from `date` to `endDate`. */
export function getDayDetails(
  date: string,
  endDate: string = date,
): Promise<DayDetails> {
  return invoke<DayDetails>("get_day_details", { date, endDate });
}

export function getInsightsTimeline(
  aggregationType: AggregationType,
): Promise<TimelineResponse> {
  return invoke<TimelineResponse>("get_insights_timeline", {
    aggregationType,
  });
}

// ── Tapbacks ──────────────────────────────────────────────────────

/** Tapback totals and kind mix. With `contactId`, only that person and you. */
export function getTapbackSummary(
  window: TapbackWindow,
  contactId: string | null = null,
): Promise<TapbackSummary> {
  return invoke<TapbackSummary>("get_tapback_summary", { window, contactId });
}

/** People ranked by Tapbacks exchanged with you. */
export function getTapbackContacts(
  window: TapbackWindow,
  limit: number,
): Promise<TapbackContact[]> {
  return invoke<TapbackContact[]>("get_tapback_contacts", { window, limit });
}

/** Given and received Tapbacks per month and kind. */
export function getTapbackMonthly(
  window: TapbackWindow,
): Promise<TapbackMonth[]> {
  return invoke<TapbackMonth[]>("get_tapback_monthly", { window });
}

/** Your messages with the most Tapbacks from others, with their text. */
export function getMostReactedMessages(
  window: TapbackWindow,
  limit: number,
): Promise<ReactedMessage[]> {
  return invoke<ReactedMessage[]>("get_most_reacted_messages", {
    window,
    limit,
  });
}

/** Emoji Tapbacks, most used first. */
export function getTapbackEmojis(
  window: TapbackWindow,
  limit: number,
): Promise<TapbackEmoji[]> {
  return invoke<TapbackEmoji[]>("get_tapback_emojis", { window, limit });
}

export function getWordFrequencies(): Promise<WordFrequency[]> {
  return invoke<WordFrequency[]>("get_word_frequencies");
}

export function getWordFrequenciesForRange(
  startDate: string,
  endDate: string,
): Promise<WordFrequency[]> {
  return invoke<WordFrequency[]>("get_word_frequencies_for_range", {
    startDate,
    endDate,
  });
}

export function getEmbeddingsForViz(
  use3d: boolean,
  maxPoints?: number,
): Promise<EmbeddingVizData> {
  return invoke<EmbeddingVizData>("get_embeddings_for_viz", {
    use3d,
    maxPoints,
  });
}

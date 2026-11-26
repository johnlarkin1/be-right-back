//! Shared types for the chat interface commands.
//!
//! These types are used by the contacts, export, and training commands
//! to communicate with the frontend.

use serde::{Deserialize, Serialize};

/// Contact with training status for the sidebar
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ContactWithStatus {
    pub contact_id: String,
    pub display_name: Option<String>,
    pub message_count: usize,
    pub last_message_date: Option<String>,
    /// Whether this contact has a trained persona
    pub has_persona: bool,
    /// Whether this is the special "You" entry, the only persona the user can train
    pub is_you: bool,
}

/// Detailed statistics for a single contact
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ContactDetailStats {
    pub contact_id: String,
    pub display_name: Option<String>,
    pub message_count: usize,
    pub messages_from_me: usize,
    pub messages_from_them: usize,
    pub date_range_start: Option<String>,
    pub date_range_end: Option<String>,
    pub avg_message_length: f64,
    pub emoji_rate: f64,
    pub avg_response_time_secs: Option<f64>,
    /// Top emojis used by this contact
    pub top_emojis: Vec<String>,
}

/// Statistics for the "You" persona (aggregated from multiple contacts)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouStats {
    pub total_messages: usize,
    pub contacts_included: usize,
    pub date_range_start: Option<String>,
    pub date_range_end: Option<String>,
    pub avg_message_length: f64,
    pub emoji_rate: f64,
    /// Names of top contacts included
    pub top_contacts: Vec<String>,
}

/// A trained persona, as `list_personas` returns it.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TrainedPersonaResponse {
    pub id: String,
    pub contact_id: String,
    pub contact_name: String,
    pub display_name: String,
    pub base_model: String,
    pub adapter_size_bytes: u64,
    pub adapter_size_display: String,
    pub trained_at: String,
    pub message_count: usize,
}

/// The phases the backend reports while training. There is deliberately no
/// terminal variant: completion and failure reach the frontend through the
/// resolved or rejected `train_persona` promise, not through this event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
#[serde(rename_all = "snake_case")]
pub enum TrainingPhase {
    Exporting,
    Downloading,
    Training,
    Finalizing,
}

/// Training progress event emitted during persona training
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TrainingProgressEvent {
    pub phase: TrainingPhase,
    /// Progress within current phase (0.0 - 1.0)
    pub progress: f32,
    /// Current training step (if in training phase)
    pub step: Option<usize>,
    /// Total training steps (if in training phase)
    pub total_steps: Option<usize>,
    /// Training loss at this step (if in training phase)
    pub loss: Option<f32>,
    /// Validation loss at this step (only on validation passes)
    pub val_loss: Option<f32>,
    /// Human-readable status message
    pub message: String,
}

/// Hardware-aware training plan shown before training starts.
///
/// Lets the UI tell the user what to expect on *their* Mac (tier, memory, an
/// honest time range, and how many optimizer steps will run) instead of a fixed
/// guess.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TrainingPlanResponse {
    /// Model tier selected for this machine (e.g. "9b", "0.8b").
    pub tier_name: String,
    /// Detected total system memory, in GB.
    pub system_memory_gb: u64,
    /// Whether this machine meets the minimum memory to train on-device.
    pub can_train: bool,
    /// Planned optimizer steps (scaled to data volume, capped per tier).
    pub max_steps: usize,
    /// Maximum tokens per training sequence.
    pub max_seq_length: usize,
    /// LoRA rank.
    pub lora_rank: usize,
    /// Number of top layers adapted (None = all layers).
    pub num_layers: Option<usize>,
    /// Low end of the estimated wall-clock, in whole minutes.
    pub est_minutes_low: u32,
    /// High end of the estimated wall-clock, in whole minutes.
    pub est_minutes_high: u32,
    /// True when the contact has little history (below the recommended minimum),
    /// so the persona is more likely to over-fit. Advisory — not a hard gate.
    pub low_data: bool,
    /// The hardware-aware settings for this Mac. The Advanced panel starts here.
    pub recommended: TrainingSettings,
    /// Allowed ranges for each setting.
    pub bounds: TrainingSettingsBounds,
}

/// Training settings the user can change in the Advanced panel.
/// Mirrors `common::TrainingSettings`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TrainingSettings {
    /// Optimizer steps to run.
    pub max_steps: usize,
    /// AdamW learning rate.
    pub learning_rate: f64,
    /// LoRA rank. Alpha follows at 2x.
    pub lora_rank: usize,
    /// Top layers to adapt. The model's depth means all layers.
    pub num_layers: usize,
    /// Examples per micro-batch.
    pub batch_size: usize,
    /// Micro-batches per optimizer step.
    pub gradient_accumulation_steps: usize,
    /// Maximum tokens per training sequence.
    pub max_seq_length: usize,
    /// Run a validation pass every this many steps.
    pub eval_steps: usize,
    /// Stop when validation loss stops improving.
    pub early_stopping: bool,
}

impl From<common::TrainingSettings> for TrainingSettings {
    fn from(s: common::TrainingSettings) -> Self {
        Self {
            max_steps: s.max_steps,
            learning_rate: s.learning_rate,
            lora_rank: s.lora_rank,
            num_layers: s.num_layers,
            batch_size: s.batch_size,
            gradient_accumulation_steps: s.gradient_accumulation_steps,
            max_seq_length: s.max_seq_length,
            eval_steps: s.eval_steps,
            early_stopping: s.early_stopping,
        }
    }
}

impl From<TrainingSettings> for common::TrainingSettings {
    fn from(s: TrainingSettings) -> Self {
        Self {
            max_steps: s.max_steps,
            learning_rate: s.learning_rate,
            lora_rank: s.lora_rank,
            num_layers: s.num_layers,
            batch_size: s.batch_size,
            gradient_accumulation_steps: s.gradient_accumulation_steps,
            max_seq_length: s.max_seq_length,
            eval_steps: s.eval_steps,
            early_stopping: s.early_stopping,
        }
    }
}

/// Allowed ranges for [`TrainingSettings`]. Mirrors `common::TrainingSettingsBounds`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct TrainingSettingsBounds {
    pub min_steps: usize,
    pub max_steps: usize,
    pub min_learning_rate: f64,
    pub max_learning_rate: f64,
    pub lora_ranks: Vec<usize>,
    pub max_layers: usize,
    pub max_batch_size: usize,
    pub max_grad_accum: usize,
    pub min_seq_length: usize,
    pub max_seq_length: usize,
    pub min_eval_steps: usize,
    pub max_eval_steps: usize,
}

impl From<common::TrainingSettingsBounds> for TrainingSettingsBounds {
    fn from(b: common::TrainingSettingsBounds) -> Self {
        Self {
            min_steps: b.min_steps,
            max_steps: b.max_steps,
            min_learning_rate: b.min_learning_rate,
            max_learning_rate: b.max_learning_rate,
            lora_ranks: b.lora_ranks,
            max_layers: b.max_layers,
            max_batch_size: b.max_batch_size,
            max_grad_accum: b.max_grad_accum,
            min_seq_length: b.min_seq_length,
            max_seq_length: b.max_seq_length,
            min_eval_steps: b.min_eval_steps,
            max_eval_steps: b.max_eval_steps,
        }
    }
}

/// Date range from user's message history for prepopulating pickers
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct MessageDateRange {
    pub earliest_date: String,
    pub latest_date: String,
}

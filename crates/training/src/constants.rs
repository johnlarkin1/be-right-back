//! Training-specific constants.
//!
//! For directory path constants (APP_DATA_DIR, RAW_DATA_DIR, etc.), use `common::paths`.

// === JSONL export constants ===

/// Token used to separate consecutive same-sender messages in training data.
/// Added as a normal (non-special) token with embedding resize before LoRA training.
pub const MSG_BREAK_TOKEN: &str = "<MSG_BREAK>";
pub const MIN_MESSAGE_LENGTH: usize = 2;
pub const MAX_TRAINING_EXAMPLES: usize = 50_000;

// === Conversation chunking constants ===

/// Hours of silence that indicate a natural conversation break
pub const CONVERSATION_GAP_HOURS: i64 = 4;

/// Maximum number of turns (back-and-forth exchanges) per training example
/// This translates to roughly 16 messages if each turn is 2 messages (user + assistant)
pub const MAX_TURNS_PER_EXAMPLE: usize = 8;

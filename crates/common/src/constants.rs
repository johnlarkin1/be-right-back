//! Shared constants used across the Be Right Back codebase.

// === Apple/macOS Constants ===

/// The difference between the Cocoa epoch (2001-01-01) and Unix epoch (1970-01-01).
/// Apple uses this epoch for timestamps in iMessage and other system databases.
/// Value: 978307200 seconds
pub const COCOA_TO_UNIX_OFFSET: i64 = 978307200;

/// Path to Messages database (relative to home directory)
pub const MESSAGES_DB_PATH: &str = "Library/Messages/chat.db";

/// Path to AddressBook directory (relative to home directory)
pub const ADDRESSBOOK_DB_PATH: &str = "Library/Application Support/AddressBook";

// === Snapshot Constants ===

/// Filename for the chat database snapshot
pub const CHAT_SNAPSHOT_FILENAME: &str = "chat_snapshot.db";

/// Filename for the address book database snapshot
pub const ADDRESSBOOK_SNAPSHOT_FILENAME: &str = "addressbook_snapshot.db";

/// Maximum number of snapshots to keep (older ones are cleaned up)
pub const MAX_SNAPSHOTS: usize = 1;

// === Development Constants ===

/// Environment variable name for development message limit.
/// Set BRB_DEV_MESSAGE_LIMIT=10000 to limit ingestion to 10k messages during development.
/// Unset or empty for production (no limit).
pub const DEV_MESSAGE_LIMIT_ENV_VAR: &str = "BRB_DEV_MESSAGE_LIMIT";

/// Get the development message limit from environment variable.
/// Returns None if not set, Some(limit) if set to a valid number.
pub fn get_dev_message_limit() -> Option<usize> {
    std::env::var(DEV_MESSAGE_LIMIT_ENV_VAR)
        .ok()
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse().ok())
}

// === MLX Model Constants ===

/// Default LLM model for Casper agent tool calling (4-bit quantized for Apple Silicon).
/// Qwen3.5 provides reliable JSON output for tool calls.
/// This model is hot-swapped in when the agent is active.
pub const DEFAULT_MLX_AGENT_MODEL: &str = "mlx-community/Qwen3.5-9B-4bit";

/// Default embedding model for semantic search (8-bit quantized for Apple Silicon).
/// ModernBERT provides high-quality embeddings for retrieval tasks.
pub const DEFAULT_MLX_EMBEDDING_MODEL: &str = "mlx-community/nomicai-modernbert-embed-base-8bit";

// === Persona Constants ===

/// Persona ID of the "You" persona. It is the only persona a user can train.
pub const SELF_PERSONA_ID: &str = "you";

/// A 1:1 conversation needs this many messages to feed "You" training.
/// Matches the contact list threshold in the desktop app.
pub const SELF_TRAINING_MIN_MESSAGES: usize = 50;

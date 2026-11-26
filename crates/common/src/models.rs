//! Core data models for Be Right Back
//! These types represent iMessage conversations and are used throughout
//! the data ingestion, training, and inference pipelines.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use strum_macros::{Display, EnumString};

/// Message service type (iMessage or SMS)
#[derive(EnumString, Display, Debug, Clone, Serialize, Deserialize)]
pub enum ServiceType {
    #[strum(serialize = "iMessage")]
    IMessage,
    #[strum(serialize = "SMS")]
    SMS,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: i64,
    pub text: String,
    pub is_from_me: bool,
    pub timestamp: DateTime<Utc>,
    pub service: ServiceType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: String, // Phone number or email
    pub display_name: Option<String>,
    pub message_count: usize,
    pub earliest_message: Option<DateTime<Utc>>,
    pub latest_message: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub contact: Contact,
    pub messages: Vec<Message>,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
}

// Statistics structures

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageCounts {
    pub total_messages: usize,
    pub messages_from_me: usize,
    pub messages_from_them: usize,
    pub total_reactions: usize,
    pub reactions_from_me: usize,
    pub reactions_from_them: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalStats {
    pub days_messaged: usize,
    pub days_missed: usize,
    pub days_with_no_reply: usize,
    pub total_days: i64,
    pub avg_gap_between_messages_secs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageLengthStats {
    pub avg_length_overall: f64,
    pub avg_length_from_me: f64,
    pub avg_length_from_them: f64,
    pub min_length: usize,
    pub max_length: usize,
    pub median_length: usize,
    pub percentile_25: usize,
    pub percentile_75: usize,
    pub percentile_90: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseTimeStats {
    /// Average time (in seconds) for them to respond to my messages
    pub avg_their_response_time_secs: Option<f64>,
    /// Average time (in seconds) for me to respond to their messages
    pub avg_my_response_time_secs: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageLengthDistribution {
    pub histogram: Vec<HistogramBin>,
    pub percentiles: Vec<Percentile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyMessageCount {
    pub date: String, // YYYY-MM-DD format
    pub from_me: usize,
    pub from_them: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistogramBin {
    pub range: String,
    pub count: usize,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Percentile {
    pub percentile: u8,
    pub value: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationStats {
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub message_counts: MessageCounts,
    pub temporal_stats: TemporalStats,
    pub message_length_stats: MessageLengthStats,
    pub response_time_stats: ResponseTimeStats,
    pub distribution_file: Option<String>,
}

// Training data structures

/// A single message in a training conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingMessage {
    pub role: String,    // "user" or "assistant"
    pub content: String, // the message content
}

/// A complete training example (context window + response)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainingExample {
    pub messages: Vec<TrainingMessage>,
}

/// Programmatic statistics about a persona's messaging patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonaStats {
    /// Average message length in characters for the assistant (persona being modeled)
    pub avg_message_length: f64,
    /// Average message length in characters for the user
    pub avg_user_message_length: f64,
    /// Emoji usage rate (emojis per message) for the assistant
    pub emoji_rate: f64,
    /// Most frequently used emojis by the assistant with their counts
    pub common_emojis: Vec<(String, usize)>,
    /// Punctuation usage patterns (e.g., "!" count, "?" count, "..." count)
    pub punctuation_patterns: Vec<(String, usize)>,
    /// Average response time in seconds (if calculable)
    pub avg_response_time_secs: Option<f64>,
    /// Percentage of messages that are short (< 10 chars)
    pub short_message_rate: f64,
    /// Percentage of messages that are long (> 100 chars)
    pub long_message_rate: f64,
}

/// Metadata about an export operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportMetadata {
    pub contact_id: String,
    pub contact_name: Option<String>,
    pub export_date: DateTime<Utc>,
    pub total_messages: usize,
    pub training_examples: usize,
    pub date_range_start: DateTime<Utc>,
    pub date_range_end: DateTime<Utc>,
    pub avg_user_msg_length: f64,
    pub avg_assistant_msg_length: f64,
    pub msg_break_token: String,
    pub system_prompt: Option<String>,
    pub persona_stats: Option<PersonaStats>,
    pub llm_analysis: Option<String>,
}

impl fmt::Display for ConversationStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "\n=== Conversation Statistics ===")?;
        writeln!(f, "Contact: {}", self.contact_name.as_ref().unwrap_or(&self.contact_id))?;
        writeln!(f)?;

        writeln!(f, "Messages")?;
        writeln!(f, "  Total:             {:>6}", self.message_counts.total_messages)?;
        writeln!(f, "  From Me:           {:>6}", self.message_counts.messages_from_me)?;
        writeln!(f, "  From Them:         {:>6}", self.message_counts.messages_from_them)?;
        writeln!(f)?;

        writeln!(f, "Reactions")?;
        writeln!(f, "  Total:             {:>6}", self.message_counts.total_reactions)?;
        writeln!(f, "  From Me:           {:>6}", self.message_counts.reactions_from_me)?;
        writeln!(f, "  From Them:         {:>6}", self.message_counts.reactions_from_them)?;
        writeln!(f)?;

        writeln!(f, "Temporal")?;
        writeln!(f, "  Days Messaged:     {:>6}", self.temporal_stats.days_messaged)?;
        writeln!(f, "  Days Missed:       {:>6}", self.temporal_stats.days_missed)?;
        writeln!(f, "  Days With No Reply:{:>6}", self.temporal_stats.days_with_no_reply)?;
        writeln!(f, "  Total Days:        {:>6}", self.temporal_stats.total_days)?;
        if let Some(avg_gap) = self.temporal_stats.avg_gap_between_messages_secs {
            writeln!(f, "  Avg Gap Between Msgs: {:.1}min", avg_gap / 60.0)?;
        }
        writeln!(f)?;

        writeln!(f, "Message Length")?;
        writeln!(
            f,
            "  Avg Overall:       {:>6.1}",
            self.message_length_stats.avg_length_overall
        )?;
        writeln!(
            f,
            "  Avg From Me:       {:>6.1}",
            self.message_length_stats.avg_length_from_me
        )?;
        writeln!(
            f,
            "  Avg From Them:     {:>6.1}",
            self.message_length_stats.avg_length_from_them
        )?;
        writeln!(f, "  Min:               {:>6}", self.message_length_stats.min_length)?;
        writeln!(f, "  Max:               {:>6}", self.message_length_stats.max_length)?;
        writeln!(f, "  Median:            {:>6}", self.message_length_stats.median_length)?;
        writeln!(f, "  25th Percentile:   {:>6}", self.message_length_stats.percentile_25)?;
        writeln!(f, "  75th Percentile:   {:>6}", self.message_length_stats.percentile_75)?;
        writeln!(f, "  90th Percentile:   {:>6}", self.message_length_stats.percentile_90)?;
        writeln!(f)?;

        writeln!(f, "Response Time")?;
        if let Some(their_time) = self.response_time_stats.avg_their_response_time_secs {
            writeln!(f, "  Their Avg Response: {:>6.1}min", their_time / 60.0)?;
        } else {
            writeln!(f, "  Their Avg Response: N/A")?;
        }
        if let Some(my_time) = self.response_time_stats.avg_my_response_time_secs {
            writeln!(f, "  My Avg Response:    {:>6.1}min", my_time / 60.0)?;
        } else {
            writeln!(f, "  My Avg Response:    N/A")?;
        }
        writeln!(f)?;

        if let Some(ref dist_file) = self.distribution_file {
            writeln!(f, "Detailed distribution saved to: {}", dist_file)?;
        }

        Ok(())
    }
}

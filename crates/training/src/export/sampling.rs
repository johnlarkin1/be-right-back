/// Conversation sampling for LLM-based personality analysis
use chrono::{Duration, Utc};
use common::{Conversation, Message, Result};
use rand::prelude::*;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::constants::CONVERSATION_GAP_HOURS;

/// Exponential decay constant (λ) for weighted sampling
/// λ = 0.2 gives: 1 month = 82%, 6 months = 30%, 1 year = 9%, 2 years = 1%
const DECAY_LAMBDA: f64 = 0.2;

/// Minimum number of messages for a conversation to be included
const MIN_MESSAGES_PER_SEGMENT: usize = 3;

/// A conversation block representing a natural exchange between user and contact
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationBlock {
    /// Messages in this exchange (alternating or consecutive)
    pub messages: Vec<SampledMessage>,
    /// Timestamp of the first message in this block
    pub start_time: String,
    /// Number of messages in this block
    pub message_count: usize,
    /// Who the user talked to in this block. The self-analysis prompt shows it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
}

/// A simplified message for analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampledMessage {
    /// "user" or "assistant"
    pub role: String,
    /// Message content
    pub content: String,
    /// Approximate timestamp (YYYY-MM-DD HH:MM)
    pub timestamp: String,
}

/// Sample conversation blocks from a full conversation for LLM analysis
///
/// Uses exponential decay weighted sampling to bias towards recent conversations
/// while still including historical context. Also applies quality filtering to
/// exclude short, low-value exchanges.
///
/// # Arguments
/// * `messages` - Raw, unfiltered messages (not train.jsonl)
/// * `target_pairs` - Target number of conversation exchanges to sample
///
/// # Returns
/// A vector of conversation blocks suitable for LLM analysis, sorted chronologically
pub fn sample_conversation_blocks(messages: &[Message], target_pairs: usize) -> Result<Vec<ConversationBlock>> {
    if messages.is_empty() {
        info!("No messages to sample");
        return Ok(vec![]);
    }

    info!(
        total_messages = messages.len(),
        target_pairs, "Sampling conversation blocks for LLM analysis"
    );

    // Split messages into conversation segments by time gaps
    let conversation_segments = split_by_time_gap(messages, CONVERSATION_GAP_HOURS);

    debug!(
        segments = conversation_segments.len(),
        "Split messages into conversation segments"
    );

    // Quality filter: only include segments with at least MIN_MESSAGES_PER_SEGMENT messages
    let filtered_segments: Vec<&Vec<Message>> = conversation_segments
        .iter()
        .filter(|seg| seg.len() >= MIN_MESSAGES_PER_SEGMENT)
        .collect();

    let filtered_out = conversation_segments.len() - filtered_segments.len();
    debug!(
        filtered_segments = filtered_segments.len(),
        filtered_out,
        min_messages = MIN_MESSAGES_PER_SEGMENT,
        "Applied quality filter"
    );

    if filtered_segments.is_empty() {
        info!("No segments passed quality filter");
        return Ok(vec![]);
    }

    // Calculate exponential decay weights based on recency
    let now = Utc::now();
    let weights: Vec<f64> = filtered_segments
        .iter()
        .map(|seg| {
            let last_msg_time = seg.last().map(|m| m.timestamp).unwrap_or(now);
            let days_ago = now.signed_duration_since(last_msg_time).num_days().max(0) as f64;
            let months_ago = days_ago / 30.0;
            (-DECAY_LAMBDA * months_ago).exp()
        })
        .collect();

    debug!(
        min_weight = weights.iter().cloned().fold(f64::INFINITY, f64::min),
        max_weight = weights.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
        "Calculated exponential decay weights"
    );

    // Perform weighted random sampling without replacement
    let sample_count = target_pairs.min(filtered_segments.len());
    let sampled_indices = weighted_sample_without_replacement(&weights, sample_count);

    // Convert sampled segments to blocks and sort by time
    let mut sampled_blocks: Vec<ConversationBlock> = sampled_indices
        .iter()
        .map(|&i| segment_to_block(filtered_segments[i]))
        .collect();

    // Sort chronologically (oldest first) for LLM context
    sampled_blocks.sort_by(|a, b| a.start_time.cmp(&b.start_time));

    info!(
        total_blocks = sampled_blocks.len(),
        total_messages = sampled_blocks.iter().map(|b| b.message_count).sum::<usize>(),
        "Completed conversation sampling with exponential decay"
    );

    Ok(sampled_blocks)
}

/// Number of conversations that `sample_self_blocks` samples from, largest first
const SELF_SAMPLE_CONVERSATIONS: usize = 20;

/// Sample blocks across the user's conversations for "You" self-analysis.
///
/// Takes up to `SELF_SAMPLE_CONVERSATIONS` conversations, in the order given, and
/// samples an equal share of `target_total` blocks from each. Each block names the
/// contact, so the analysis can see how the user's style changes between people.
pub fn sample_self_blocks(conversations: &[Conversation], target_total: usize) -> Result<Vec<ConversationBlock>> {
    let top = &conversations[..conversations.len().min(SELF_SAMPLE_CONVERSATIONS)];
    if top.is_empty() {
        return Ok(vec![]);
    }
    let blocks_per = (target_total / top.len()).max(1);

    let mut blocks = Vec::new();
    for conversation in top {
        let contact_name = conversation
            .contact
            .display_name
            .clone()
            .unwrap_or_else(|| conversation.contact.id.clone());
        for mut block in sample_conversation_blocks(&conversation.messages, blocks_per)? {
            block.contact_name = Some(contact_name.clone());
            blocks.push(block);
        }
    }
    blocks.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    Ok(blocks)
}

/// Perform weighted random sampling without replacement
///
/// Uses a simple but effective algorithm: repeatedly select items with probability
/// proportional to weight, removing selected items from the pool.
fn weighted_sample_without_replacement(weights: &[f64], count: usize) -> Vec<usize> {
    if weights.is_empty() || count == 0 {
        return vec![];
    }

    let mut rng = rand::thread_rng();
    let mut available: Vec<(usize, f64)> = weights.iter().copied().enumerate().collect();
    let mut selected = Vec::with_capacity(count.min(weights.len()));

    while selected.len() < count && !available.is_empty() {
        // Calculate total weight of remaining items
        let total_weight: f64 = available.iter().map(|(_, w)| w).sum();

        if total_weight <= 0.0 {
            break;
        }

        // Pick a random point in the weight space
        let target = rng.r#gen::<f64>() * total_weight;

        // Find which item this corresponds to
        let mut cumulative = 0.0;
        let mut chosen_idx = 0;

        for (i, (_, weight)) in available.iter().enumerate() {
            cumulative += weight;
            if cumulative >= target {
                chosen_idx = i;
                break;
            }
        }

        // Record the original index and remove from available pool
        let (original_idx, _) = available.remove(chosen_idx);
        selected.push(original_idx);
    }

    selected
}

/// Convert a message segment into a conversation block
fn segment_to_block(segment: &[Message]) -> ConversationBlock {
    let messages: Vec<SampledMessage> = segment
        .iter()
        .map(|msg| SampledMessage {
            role: if msg.is_from_me {
                "user".to_string()
            } else {
                "assistant".to_string()
            },
            content: msg.text.clone(),
            timestamp: msg.timestamp.format("%Y-%m-%d %H:%M").to_string(),
        })
        .collect();

    let start_time = segment
        .first()
        .map(|m| m.timestamp.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default();

    ConversationBlock {
        message_count: messages.len(),
        messages,
        start_time,
        contact_name: None,
    }
}

/// Split messages into conversation segments based on time gaps
///
/// Reuses the same logic as JSONL export to identify natural conversation boundaries.
/// A new segment starts when there's a gap of `gap_hours` or more between messages.
fn split_by_time_gap(messages: &[Message], gap_hours: i64) -> Vec<Vec<Message>> {
    if messages.is_empty() {
        return vec![];
    }

    let mut segments = Vec::new();
    let mut current_segment = Vec::new();

    for (i, msg) in messages.iter().enumerate() {
        if i == 0 {
            current_segment.push(msg.clone());
            continue;
        }

        let prev_msg = &messages[i - 1];
        let time_diff = msg.timestamp.signed_duration_since(prev_msg.timestamp);

        // If gap is too large, start a new segment
        if time_diff > Duration::hours(gap_hours) {
            if !current_segment.is_empty() {
                segments.push(current_segment);
            }
            current_segment = vec![msg.clone()];
        } else {
            current_segment.push(msg.clone());
        }
    }

    // Add the last segment
    if !current_segment.is_empty() {
        segments.push(current_segment);
    }

    segments
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use common::ServiceType;

    fn create_test_message(text: &str, is_from_me: bool, hours_ago: i64) -> Message {
        Message {
            id: 1,
            text: text.to_string(),
            is_from_me,
            timestamp: Utc::now() - Duration::hours(hours_ago),
            service: ServiceType::IMessage,
        }
    }

    #[test]
    fn test_split_by_time_gap() {
        let messages = vec![
            create_test_message("Message 1", true, 10),
            create_test_message("Message 2", false, 9), // 1 hour gap - same segment
            create_test_message("Message 3", true, 4),  // 5 hour gap - new segment
            create_test_message("Message 4", false, 3), // 1 hour gap - same segment
        ];

        let segments = split_by_time_gap(&messages, 4);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].len(), 2);
        assert_eq!(segments[1].len(), 2);
    }

    #[test]
    fn test_sample_conversation_blocks_empty() {
        let messages: Vec<Message> = vec![];
        let result = sample_conversation_blocks(&messages, 10).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_sample_conversation_blocks_basic() {
        // Create a conversation with 4 messages (passes quality filter of 3)
        let messages = vec![
            create_test_message("Hey!", true, 10),
            create_test_message("Hi there!", false, 9),
            create_test_message("How are you?", true, 8),
            create_test_message("Good!", false, 7),
        ];

        let result = sample_conversation_blocks(&messages, 2).unwrap();
        // Should return 1 block (all messages in one segment)
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].message_count, 4);
    }

    #[test]
    fn test_quality_filter_excludes_short_segments() {
        // Create two segments: one with 2 messages (filtered out), one with 3 (kept)
        let messages = vec![
            // Segment 1: only 2 messages - should be filtered out
            create_test_message("Hey", true, 100),
            create_test_message("Hi", false, 99),
            // Gap of > 4 hours
            // Segment 2: 3 messages - should pass filter
            create_test_message("What's up?", true, 10),
            create_test_message("Not much", false, 9),
            create_test_message("Cool", true, 8),
        ];

        let result = sample_conversation_blocks(&messages, 10).unwrap();
        // Only 1 segment should pass the quality filter
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].message_count, 3);
    }

    #[test]
    fn test_sample_self_blocks_names_each_contact() {
        let conversation = |id: &str, name: Option<&str>| {
            let messages = vec![
                create_test_message("Hey!", false, 10),
                create_test_message("Hi there!", true, 9),
                create_test_message("How are you?", false, 8),
            ];
            Conversation {
                contact: common::Contact {
                    id: id.to_string(),
                    display_name: name.map(str::to_string),
                    message_count: messages.len(),
                    earliest_message: None,
                    latest_message: None,
                },
                start_date: messages[0].timestamp,
                end_date: messages[2].timestamp,
                messages,
            }
        };
        let conversations = [
            conversation("a@example.com", Some("Alice")),
            conversation("+15550001111", None),
        ];

        let blocks = sample_self_blocks(&conversations, 10).unwrap();

        let mut names: Vec<_> = blocks.iter().filter_map(|b| b.contact_name.clone()).collect();
        names.sort();
        assert_eq!(names, ["+15550001111", "Alice"]);
    }

    #[test]
    fn test_weighted_sample_without_replacement() {
        // Test with uniform weights
        let weights = vec![1.0, 1.0, 1.0, 1.0];
        let result = weighted_sample_without_replacement(&weights, 2);
        assert_eq!(result.len(), 2);
        // All indices should be unique
        assert_ne!(result[0], result[1]);
    }

    #[test]
    fn test_weighted_sample_respects_count_limit() {
        let weights = vec![1.0, 1.0, 1.0];
        let result = weighted_sample_without_replacement(&weights, 10);
        // Should return at most the number of available items
        assert_eq!(result.len(), 3);
    }
}

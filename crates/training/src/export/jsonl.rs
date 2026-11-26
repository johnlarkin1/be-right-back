/// JSONL export for "You" training data
use common::{Conversation, ExportMetadata, Message, Result, SELF_PERSONA_ID, TrainingExample, TrainingMessage};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use tracing::{debug, info, warn};

use crate::constants::{CONVERSATION_GAP_HOURS, MAX_TRAINING_EXAMPLES, MIN_MESSAGE_LENGTH, MSG_BREAK_TOKEN};

/// Display name of the "You" persona.
const SELF_PERSONA_NAME: &str = "You";

/// Export the user's own replies across many conversations to JSONL for fine-tuning.
///
/// The persona is always the user. Their messages (`is_from_me`) become `assistant`
/// turns. The other person's messages become `user` turns:
/// ```json
/// {"messages": [
///   {"role": "user", "content": "Hey, how are you?"},
///   {"role": "assistant", "content": "Good! Just finished work. You?"}
/// ]}
/// ```
///
/// Each conversation is cut into examples on its own, so an example never mixes two
/// people. Examples are sorted by time, and only the newest `MAX_TRAINING_EXAMPLES` stay.
///
/// # Arguments
/// * `conversations` - The user's 1:1 conversations
/// * `output_path` - Path to write the JSONL file
/// * `progress_callback` - Optional callback for progress updates (current, total)
pub fn export_self_to_jsonl<F>(
    conversations: &[Conversation],
    output_path: &Path,
    mut progress_callback: Option<F>,
) -> Result<ExportMetadata>
where
    F: FnMut(usize, usize),
{
    let total_messages: usize = conversations.iter().map(|c| c.messages.len()).sum();
    info!(
        conversations = conversations.len(),
        total_messages,
        output_path = ?output_path,
        "starting jsonl export"
    );

    let mut filtered_messages = Vec::new();
    let mut timed_examples = Vec::new();
    for conversation in conversations {
        let filtered = filter_messages(&conversation.messages);
        timed_examples.extend(generate_training_examples(&filtered));
        filtered_messages.extend(filtered);
    }
    info!(
        original_count = total_messages,
        filtered_count = filtered_messages.len(),
        examples_generated = timed_examples.len(),
        "Generated training examples"
    );

    // Keep the newest MAX_TRAINING_EXAMPLES, in time order
    timed_examples.sort_by_key(|(timestamp, _)| *timestamp);
    if timed_examples.len() > MAX_TRAINING_EXAMPLES {
        warn!(
            total = timed_examples.len(),
            cap = MAX_TRAINING_EXAMPLES,
            "Capping to most recent training examples"
        );
        timed_examples.drain(..timed_examples.len() - MAX_TRAINING_EXAMPLES);
    }

    let file = File::create(output_path)?;
    let mut writer = BufWriter::new(file);
    let total = timed_examples.len();
    let mut written = 0;
    for (idx, (_, example)) in timed_examples.iter().enumerate() {
        if !validate_training_example(example) {
            warn!(example_idx = idx, "Invalid training example, skipping");
            continue;
        }
        writeln!(writer, "{}", serde_json::to_string(example)?)?;
        written += 1;

        if let Some(ref mut callback) = progress_callback {
            callback(idx + 1, total);
        }
    }
    writer.flush()?;

    let metadata = calculate_export_metadata(conversations, &filtered_messages, written);
    info!(
        examples_written = written,
        output_path = ?output_path,
        "Successfully exported training data"
    );

    Ok(metadata)
}

/// Filter messages to remove invalid training examples
fn filter_messages(messages: &[Message]) -> Vec<Message> {
    messages
        .iter()
        .filter(|msg| {
            // Skip very short messages
            if msg.text.trim().len() < MIN_MESSAGE_LENGTH {
                debug!(message_id = msg.id, text = %msg.text, "Skipping short message");
                return false;
            }

            // Skip empty messages
            if msg.text.trim().is_empty() {
                debug!(message_id = msg.id, "Skipping empty message");
                return false;
            }

            // Filter out messages with only object replacement characters (attachments/images)
            let clean_text = msg.text.replace('\u{FFFC}', "").trim().to_string();
            if clean_text.is_empty() {
                debug!(
                    message_id = msg.id,
                    "Skipping message with only attachment placeholders"
                );
                return false;
            }

            // Filter out messages that are only special characters (no alphanumeric content)
            if clean_text.chars().all(|c| !c.is_alphanumeric() && c != ' ') {
                debug!(message_id = msg.id, text = %msg.text, "Skipping message with no alphanumeric content");
                return false;
            }

            true
        })
        .cloned()
        .collect()
}

/// Generate training examples from one conversation.
///
/// # Strategy
/// 1. Split the conversation by 4+ hour gaps (natural conversation breaks)
/// 2. In each segment, extract exchanges:
///    - Start with any message from the other person
///    - End with the user's reply
///    - Up to MAX_TURNS_PER_EXAMPLE turns
///    - Non-overlapping, to avoid duplicate data
///
/// Returns each example with the timestamp of its last message.
fn generate_training_examples(messages: &[Message]) -> Vec<(chrono::DateTime<chrono::Utc>, TrainingExample)> {
    use crate::constants::MAX_TURNS_PER_EXAMPLE;

    let segments = split_by_time_gap(messages, CONVERSATION_GAP_HOURS);
    debug!(
        total_messages = messages.len(),
        conversation_segments = segments.len(),
        "Split messages into conversation segments"
    );

    segments
        .iter()
        .flat_map(|segment| process_conversation_segment(segment, MAX_TURNS_PER_EXAMPLE))
        .collect()
}

/// Split messages into conversation segments based on time gaps
fn split_by_time_gap(messages: &[Message], gap_hours: i64) -> Vec<Vec<Message>> {
    use chrono::Duration;

    if messages.is_empty() {
        return vec![];
    }

    let mut segments = Vec::new();
    let mut current_segment = Vec::new();

    for (i, msg) in messages.iter().enumerate() {
        if i > 0 {
            let time_diff = msg.timestamp - messages[i - 1].timestamp;
            if time_diff > Duration::hours(gap_hours) {
                // Save current segment and start a new one
                if !current_segment.is_empty() {
                    segments.push(current_segment.clone());
                    current_segment.clear();
                }
            }
        }
        current_segment.push(msg.clone());
    }

    // Don't forget the last segment
    if !current_segment.is_empty() {
        segments.push(current_segment);
    }

    segments
}

/// Process a conversation segment into one or more training examples
///
/// Rules:
/// - Each example starts with a message from the other person (`user`)
/// - Each example ends with a reply from the user (`assistant`)
/// - Each example has up to max_turns role switches
/// - Examples do not overlap
fn process_conversation_segment(
    segment: &[Message],
    max_turns: usize,
) -> Vec<(chrono::DateTime<chrono::Utc>, TrainingExample)> {
    let mut examples = Vec::new();
    let mut i = 0;

    while i < segment.len() {
        // Look for a message from the other person
        if segment[i].is_from_me {
            i += 1;
            continue;
        }
        let start_idx = i;

        // Collect up to max_turns of conversation after the opening message
        let mut example_end_idx = start_idx;
        let mut turn_count = 0;
        let mut last_is_from_me = false;
        for (j, msg) in segment.iter().enumerate().skip(start_idx + 1) {
            if msg.is_from_me != last_is_from_me {
                turn_count += 1;
                last_is_from_me = msg.is_from_me;
            }
            example_end_idx = j;
            if turn_count >= max_turns {
                break;
            }
        }

        // End on the user's own reply
        while example_end_idx > start_idx && !segment[example_end_idx].is_from_me {
            example_end_idx -= 1;
        }

        if example_end_idx == start_idx {
            // The user never replied
            i += 1;
            continue;
        }

        let example_messages = &segment[start_idx..=example_end_idx];
        debug!(
            opening = %segment[start_idx].text,
            turns = turn_count,
            "Found conversation exchange"
        );
        examples.push((
            segment[example_end_idx].timestamp,
            TrainingExample {
                messages: convert_to_training_messages(example_messages),
            },
        ));

        // Move past this entire exchange (non-overlapping)
        i = example_end_idx + 1;
    }

    examples
}

/// Convert a slice of messages to training messages.
///
/// The user's own messages become `assistant` turns, and the other person's become
/// `user` turns. Consecutive messages from one sender are joined with MSG_BREAK tokens.
fn convert_to_training_messages(messages: &[Message]) -> Vec<TrainingMessage> {
    let mut training_messages = Vec::new();
    let mut current_content = String::new();
    let mut current_role: Option<String> = None;

    for msg in messages {
        let role = if msg.is_from_me { "assistant" } else { "user" };

        match &current_role {
            None => {
                current_role = Some(role.to_string());
                current_content = msg.text.clone();
            }
            Some(prev_role) if prev_role == role => {
                current_content.push_str(MSG_BREAK_TOKEN);
                current_content.push_str(&msg.text);
            }
            Some(_) => {
                // so for different roles, we save the previous message and start a new one
                if let Some(role_str) = current_role.take() {
                    training_messages.push(TrainingMessage {
                        role: role_str,
                        content: current_content.clone(),
                    });
                }
                current_role = Some(role.to_string());
                current_content = msg.text.clone();
            }
        }
    }
    if let Some(role_str) = current_role {
        training_messages.push(TrainingMessage {
            role: role_str,
            content: current_content,
        });
    }
    training_messages
}

/// Validate a training example
fn validate_training_example(example: &TrainingExample) -> bool {
    if example.messages.is_empty() {
        return false;
    }

    // Must have at least one user message
    let has_user_message = example.messages.iter().any(|m| m.role == "user");
    if !has_user_message {
        debug!("Skipping example with no user messages");
        return false;
    }

    // Must end with assistant message
    if let Some(last) = example.messages.last() {
        if last.role != "assistant" {
            return false;
        }
    } else {
        return false;
    }

    // Validate individual messages
    for msg in &example.messages {
        if msg.role != "user" && msg.role != "assistant" {
            return false;
        }
        if msg.content.trim().is_empty() {
            return false;
        }

        let clean_content = msg
            .content
            .replace('\u{FFFC}', "") // object replacement character
            .replace(MSG_BREAK_TOKEN, "")
            .trim()
            .to_string();

        // Check if message has actual text content (not just emojis/special chars)
        if clean_content.is_empty() || clean_content.chars().all(|c| !c.is_alphanumeric()) {
            debug!(content = %msg.content, "Skipping message with only special characters");
            return false;
        }
    }

    true
}

/// Calculate metadata about the export
fn calculate_export_metadata(
    conversations: &[Conversation],
    filtered_messages: &[Message],
    training_examples_count: usize,
) -> ExportMetadata {
    let avg_length = |from_me: bool| {
        let lengths: Vec<usize> = filtered_messages
            .iter()
            .filter(|m| m.is_from_me == from_me)
            .map(|m| m.text.len())
            .collect();
        if lengths.is_empty() {
            0.0
        } else {
            lengths.iter().sum::<usize>() as f64 / lengths.len() as f64
        }
    };
    let now = chrono::Utc::now();

    ExportMetadata {
        contact_id: SELF_PERSONA_ID.to_string(),
        contact_name: Some(SELF_PERSONA_NAME.to_string()),
        export_date: now,
        total_messages: conversations.iter().map(|c| c.messages.len()).sum(),
        training_examples: training_examples_count,
        date_range_start: conversations.iter().map(|c| c.start_date).min().unwrap_or(now),
        date_range_end: conversations.iter().map(|c| c.end_date).max().unwrap_or(now),
        // The other person's messages are `user` turns; the user's own are `assistant` turns
        avg_user_msg_length: avg_length(false),
        avg_assistant_msg_length: avg_length(true),
        msg_break_token: MSG_BREAK_TOKEN.to_string(),
        // populated in post
        system_prompt: None,
        persona_stats: None,
        llm_analysis: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};
    use common::{Contact, ServiceType};

    fn create_test_message(id: i64, text: &str, is_from_me: bool) -> Message {
        Message {
            id,
            text: text.to_string(),
            is_from_me,
            timestamp: Utc::now() + Duration::seconds(id),
            service: ServiceType::IMessage,
        }
    }

    fn create_conversation(contact_id: &str, messages: Vec<Message>) -> Conversation {
        Conversation {
            contact: Contact {
                id: contact_id.to_string(),
                display_name: None,
                message_count: messages.len(),
                earliest_message: messages.first().map(|m| m.timestamp),
                latest_message: messages.last().map(|m| m.timestamp),
            },
            start_date: messages.first().unwrap().timestamp,
            end_date: messages.last().unwrap().timestamp,
            messages,
        }
    }

    fn examples_of(messages: &[Message]) -> Vec<TrainingExample> {
        generate_training_examples(messages)
            .into_iter()
            .map(|(_, e)| e)
            .collect()
    }

    #[test]
    fn test_filter_messages_removes_short() {
        let messages = vec![
            create_test_message(1, "H", true),            // Too short (MIN_MESSAGE_LENGTH is 2)
            create_test_message(2, "Hello there", false), // OK
            create_test_message(3, "X", true),            // Too short
            create_test_message(4, "How are you?", true), // OK
        ];

        let filtered = filter_messages(&messages);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].text, "Hello there");
        assert_eq!(filtered[1].text, "How are you?");
    }

    #[test]
    fn test_convert_to_training_messages_own_messages_are_assistant() {
        let messages = vec![
            create_test_message(1, "Hey", false),
            create_test_message(2, "What's up?", false), // Consecutive message from the other person
            create_test_message(3, "Not much", true),
        ];

        let training = convert_to_training_messages(&messages);

        assert_eq!(training.len(), 2);
        assert_eq!(training[0].role, "user");
        assert_eq!(training[0].content, "Hey<MSG_BREAK>What's up?");
        assert_eq!(training[1].role, "assistant");
        assert_eq!(training[1].content, "Not much");
    }

    #[test]
    fn test_convert_to_training_messages_alternating() {
        let messages = vec![
            create_test_message(1, "Hey", false),
            create_test_message(2, "Hi!", true),
            create_test_message(3, "How are you?", false),
        ];

        let training = convert_to_training_messages(&messages);

        let roles: Vec<&str> = training.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, ["user", "assistant", "user"]);
        assert_eq!(training[1].content, "Hi!");
    }

    #[test]
    fn test_validate_training_example() {
        let message = |role: &str, content: &str| TrainingMessage {
            role: role.to_string(),
            content: content.to_string(),
        };

        // Valid example
        let valid = TrainingExample {
            messages: vec![message("user", "Hello"), message("assistant", "Hi there!")],
        };
        assert!(validate_training_example(&valid));

        // Invalid - last message not from assistant
        let invalid = TrainingExample {
            messages: vec![message("assistant", "Hi there!"), message("user", "Hello")],
        };
        assert!(!validate_training_example(&invalid));

        // Invalid - empty messages
        let empty = TrainingExample { messages: vec![] };
        assert!(!validate_training_example(&empty));
    }

    #[test]
    fn test_examples_start_with_their_message_and_end_with_my_reply() {
        let messages = vec![
            create_test_message(1, "Hey", false), // Not a question, still starts an example
            create_test_message(2, "Hi!", true),
            create_test_message(3, "Long day at work", false),
            create_test_message(4, "Same here", true),
            create_test_message(5, "Thanks", false),
        ];

        let examples = examples_of(&messages);

        assert_eq!(examples.len(), 1);
        let example = &examples[0].messages;
        assert_eq!(example[0].role, "user");
        assert_eq!(example[0].content, "Hey");
        // The trailing message from the other person is trimmed: the example ends on my reply
        assert_eq!(example.len(), 4);
        assert_eq!(example.last().unwrap().role, "assistant");
        assert_eq!(example.last().unwrap().content, "Same here");
    }

    #[test]
    fn test_my_opening_message_is_skipped() {
        let messages = vec![
            create_test_message(1, "What's your favorite food?", true), // I text first
            create_test_message(2, "Pizza!", false),
            create_test_message(3, "Nice", true),
        ];

        let examples = examples_of(&messages);

        // An example needs a `user` turn before my reply, so it starts at "Pizza!"
        assert_eq!(examples.len(), 1);
        assert_eq!(examples[0].messages[0].content, "Pizza!");
        assert_eq!(examples[0].messages[1].content, "Nice");
    }

    #[test]
    fn test_unreplied_message_gives_no_example() {
        let messages = vec![
            create_test_message(1, "Are you free tonight?", false),
            create_test_message(2, "Hello??", false),
        ];

        assert!(examples_of(&messages).is_empty());
    }

    #[test]
    fn test_generate_training_examples_splits_on_time_gap() {
        let base_time = Utc::now();
        let mut messages = vec![
            create_test_message(1, "What's your favorite food?", false),
            create_test_message(2, "Pizza!", true),
            create_test_message(3, "Nice choice", false),
            create_test_message(4, "Yeah I love it", true),
            create_test_message(5, "Why pizza?", false),
            create_test_message(6, "It's just so good", true),
        ];
        for (i, msg) in messages.iter_mut().enumerate() {
            msg.timestamp = base_time + Duration::minutes(i as i64);
        }
        // Second conversation after a 5 hour gap
        messages[4].timestamp = base_time + Duration::hours(5);
        messages[5].timestamp = base_time + Duration::hours(5) + Duration::minutes(1);

        let examples = examples_of(&messages);

        assert_eq!(examples.len(), 2);
        assert_eq!(examples[0].messages.len(), 4);
        assert_eq!(examples[1].messages[0].content, "Why pizza?");
    }

    #[test]
    fn test_export_self_to_jsonl_across_conversations() {
        let alice = create_conversation(
            "alice@example.com",
            vec![
                create_test_message(1, "Where are you?", false),
                create_test_message(2, "On my way", true),
            ],
        );
        let bob = create_conversation(
            "+15551234567",
            vec![
                create_test_message(10, "Did you eat?", false),
                create_test_message(11, "Not yet, you?", true),
            ],
        );

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("train.jsonl");
        let metadata = export_self_to_jsonl(&[alice, bob], &path, None::<fn(usize, usize)>).unwrap();

        assert_eq!(metadata.contact_id, "you");
        assert_eq!(metadata.contact_name.as_deref(), Some("You"));
        assert_eq!(metadata.total_messages, 4);
        assert_eq!(metadata.training_examples, 2);

        let lines: Vec<TrainingExample> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        for example in &lines {
            assert_eq!(example.messages.len(), 2);
            assert_eq!(example.messages[1].role, "assistant");
        }
        assert_eq!(lines[0].messages[1].content, "On my way");
        assert_eq!(lines[1].messages[1].content, "Not yet, you?");
    }
}

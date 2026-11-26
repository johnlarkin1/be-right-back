/// Programmatic analysis of persona messaging patterns
use common::{Message, PersonaStats, Result};
use regex::Regex;
use std::collections::HashMap;
use tracing::debug;

/// Calculate programmatic statistics about the user's own messaging patterns
///
/// Analyzes objective, quantifiable characteristics that can be extracted
/// without LLM analysis (message lengths, emoji usage, punctuation patterns, etc.)
/// The persona is the user, so style stats use `is_from_me` messages.
///
/// # Arguments
/// * `messages` - All messages in the user's conversations (unfiltered)
///
/// # Returns
/// PersonaStats with calculated metrics
pub fn calculate_persona_stats(messages: &[Message]) -> Result<PersonaStats> {
    debug!(
        total_messages = messages.len(),
        "Calculating programmatic persona statistics"
    );

    if messages.is_empty() {
        return Ok(PersonaStats {
            avg_message_length: 0.0,
            avg_user_message_length: 0.0,
            emoji_rate: 0.0,
            common_emojis: vec![],
            punctuation_patterns: vec![],
            avg_response_time_secs: None,
            short_message_rate: 0.0,
            long_message_rate: 0.0,
        });
    }

    // The user's own messages are the persona (`assistant`); the other side is `user`
    let user_messages: Vec<&Message> = messages.iter().filter(|m| !m.is_from_me).collect();
    let assistant_messages: Vec<&Message> = messages.iter().filter(|m| m.is_from_me).collect();

    // Calculate message lengths
    let avg_message_length = calculate_avg_length(&assistant_messages);
    let avg_user_message_length = calculate_avg_length(&user_messages);

    // Calculate emoji statistics (for assistant only)
    let emoji_rate = calculate_emoji_rate(&assistant_messages);
    let common_emojis = extract_common_emojis(&assistant_messages, 10);

    // Calculate punctuation patterns (for assistant only)
    let punctuation_patterns = analyze_punctuation(&assistant_messages);

    // Calculate response time (assistant's responses to user's messages)
    let avg_response_time_secs = calculate_avg_response_time(messages);

    // Calculate message length distribution (for assistant only)
    let (short_message_rate, long_message_rate) = calculate_length_distribution(&assistant_messages);

    debug!(
        avg_message_length,
        emoji_rate,
        common_emojis_count = common_emojis.len(),
        "Calculated persona statistics"
    );

    Ok(PersonaStats {
        avg_message_length,
        avg_user_message_length,
        emoji_rate,
        common_emojis,
        punctuation_patterns,
        avg_response_time_secs,
        short_message_rate,
        long_message_rate,
    })
}

/// Calculate average message length in characters
fn calculate_avg_length(messages: &[&Message]) -> f64 {
    if messages.is_empty() {
        return 0.0;
    }

    let total_length: usize = messages.iter().map(|m| m.text.len()).sum();
    total_length as f64 / messages.len() as f64
}

/// Calculate emoji usage rate (emojis per message)
fn calculate_emoji_rate(messages: &[&Message]) -> f64 {
    if messages.is_empty() {
        return 0.0;
    }

    // Use Emoji_Presentation only to avoid matching ASCII digits (0-9) which are technically
    // emoji characters but not displayed as emojis without variation selectors
    let emoji_regex = Regex::new(r"\p{Emoji_Presentation}").unwrap();
    let total_emojis: usize = messages.iter().map(|m| emoji_regex.find_iter(&m.text).count()).sum();

    total_emojis as f64 / messages.len() as f64
}

/// Extract most common emojis with their counts
fn extract_common_emojis(messages: &[&Message], top_n: usize) -> Vec<(String, usize)> {
    // Use Emoji_Presentation only to avoid matching ASCII digits (0-9) which are technically
    // emoji characters but not displayed as emojis without variation selectors
    let emoji_regex = Regex::new(r"\p{Emoji_Presentation}").unwrap();
    let mut emoji_counts: HashMap<String, usize> = HashMap::new();

    for msg in messages {
        for emoji_match in emoji_regex.find_iter(&msg.text) {
            let emoji = emoji_match.as_str().to_string();
            *emoji_counts.entry(emoji).or_insert(0) += 1;
        }
    }

    let mut emoji_vec: Vec<(String, usize)> = emoji_counts.into_iter().collect();
    emoji_vec.sort_by_key(|(_, count)| std::cmp::Reverse(*count)); // Sort by count descending
    emoji_vec.truncate(top_n);

    emoji_vec
}

/// Analyze punctuation usage patterns
fn analyze_punctuation(messages: &[&Message]) -> Vec<(String, usize)> {
    let punctuation_marks = vec!["!", "?", "...", "!!", "???", "lol", "haha", "lmao"];
    let mut counts: HashMap<String, usize> = HashMap::new();

    for msg in messages {
        let text_lower = msg.text.to_lowercase();
        for mark in &punctuation_marks {
            let count = text_lower.matches(mark).count();
            if count > 0 {
                *counts.entry(mark.to_string()).or_insert(0) += count;
            }
        }
    }

    let mut result: Vec<(String, usize)> = counts.into_iter().collect();
    result.sort_by_key(|(_, count)| std::cmp::Reverse(*count)); // Sort by count descending
    result.truncate(10); // Top 10 patterns

    result
}

/// Calculate the user's average response time
///
/// Looks at the time between the other person's message and the user's next message
fn calculate_avg_response_time(messages: &[Message]) -> Option<f64> {
    let mut response_times: Vec<f64> = Vec::new();

    for i in 0..messages.len().saturating_sub(1) {
        let current = &messages[i];
        let next = &messages[i + 1];

        // The other person's message followed by the user's reply
        if !current.is_from_me && next.is_from_me {
            let duration = next.timestamp.signed_duration_since(current.timestamp);
            let seconds = duration.num_seconds() as f64;

            // Filter out unreasonably long response times (> 24 hours)
            // These are likely new conversations, not actual response times
            if seconds > 0.0 && seconds < 86400.0 {
                response_times.push(seconds);
            }
        }
    }

    if response_times.is_empty() {
        return None;
    }

    let avg = response_times.iter().sum::<f64>() / response_times.len() as f64;
    Some(avg)
}

/// Calculate percentage of short and long messages
fn calculate_length_distribution(messages: &[&Message]) -> (f64, f64) {
    if messages.is_empty() {
        return (0.0, 0.0);
    }

    let short_threshold = 10; // characters
    let long_threshold = 100; // characters

    let short_count = messages.iter().filter(|m| m.text.len() < short_threshold).count();
    let long_count = messages.iter().filter(|m| m.text.len() > long_threshold).count();

    let short_rate = short_count as f64 / messages.len() as f64;
    let long_rate = long_count as f64 / messages.len() as f64;

    (short_rate, long_rate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use common::ServiceType;

    fn create_test_message(text: &str, is_from_me: bool) -> Message {
        Message {
            id: 1,
            text: text.to_string(),
            is_from_me,
            timestamp: Utc::now(),
            service: ServiceType::IMessage,
        }
    }

    #[test]
    fn test_calculate_avg_length() {
        let messages = [
            create_test_message("Hello", false),
            create_test_message("Hi there!", false),
            create_test_message("How are you doing?", false),
        ];
        let msg_refs: Vec<&Message> = messages.iter().collect();

        let avg = calculate_avg_length(&msg_refs);
        assert!(avg > 0.0);
        assert!(avg < 50.0); // Reasonable for these test messages
    }

    #[test]
    fn test_emoji_rate() {
        let messages = [
            create_test_message("Hello 👋", false),
            create_test_message("Hi there! 😊", false),
            create_test_message("No emojis here", false),
        ];
        let msg_refs: Vec<&Message> = messages.iter().collect();

        let rate = calculate_emoji_rate(&msg_refs);
        assert!(rate > 0.0); // Should have some emojis
        assert!(rate < 2.0); // Should be less than 2 emojis per message
    }

    #[test]
    fn test_extract_common_emojis() {
        let messages = [
            create_test_message("Hello 👋", false),
            create_test_message("Hi 👋 😊", false),
            create_test_message("👋 again!", false),
        ];
        let msg_refs: Vec<&Message> = messages.iter().collect();

        let common = extract_common_emojis(&msg_refs, 5);
        assert!(!common.is_empty());
        // 👋 should be most common with 3 occurrences
        assert_eq!(common[0].0, "👋");
        assert_eq!(common[0].1, 3);
    }

    #[test]
    fn test_analyze_punctuation() {
        let messages = [
            create_test_message("What?!", false),
            create_test_message("Really??", false),
            create_test_message("Haha yeah!", false),
        ];
        let msg_refs: Vec<&Message> = messages.iter().collect();

        let patterns = analyze_punctuation(&msg_refs);
        assert!(!patterns.is_empty());
    }

    #[test]
    fn test_calculate_length_distribution() {
        let messages = [
            create_test_message("Hi", false),                              // short
            create_test_message("Hello!", false),                          // short
            create_test_message("This is a medium length message", false), // medium
            create_test_message(
                "This is a very long message that exceeds the threshold for long messages and contains lots of text to test",
                false,
            ), // long (>100 chars)
        ];
        let msg_refs: Vec<&Message> = messages.iter().collect();

        let (short_rate, long_rate) = calculate_length_distribution(&msg_refs);
        assert!(short_rate > 0.0);
        assert!(short_rate <= 1.0);
        assert!(long_rate > 0.0);
        assert!(long_rate <= 1.0);
    }

    #[test]
    fn test_calculate_persona_stats_empty() {
        let messages: Vec<Message> = vec![];
        let stats = calculate_persona_stats(&messages).unwrap();
        assert_eq!(stats.avg_message_length, 0.0);
        assert_eq!(stats.emoji_rate, 0.0);
    }

    #[test]
    fn test_calculate_persona_stats_basic() {
        let messages = vec![
            create_test_message("Hey! 👋", true),
            create_test_message("What's up?", false),
            create_test_message("Not much, just working lol", true),
        ];

        let stats = calculate_persona_stats(&messages).unwrap();
        assert!(stats.avg_message_length > 0.0);
        assert!(stats.emoji_rate >= 0.0);
        assert!(!stats.common_emojis.is_empty());
    }
}

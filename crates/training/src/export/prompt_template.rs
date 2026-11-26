/// System prompt template assembly for persona chatbots
use common::{PersonaStats, Result};

use crate::constants::MSG_BREAK_TOKEN;

/// How prompts name the person the persona models: the owner of the iMessage account.
const PERSONA_SUBJECT: &str = "the account owner";

/// Build a rich system prompt for the "You" persona from programmatic stats and LLM analysis
///
/// Creates a hybrid prompt that combines:
/// 1. Objective metrics (message length, emoji usage, response time)
/// 2. LLM-detected personality traits and communication style
/// 3. Clear instructions for behavior
///
/// # Arguments
/// * `stats` - Programmatic statistics of the user's own messages (optional)
/// * `llm_analysis` - LLM self-analysis of the user's own messages (optional)
///
/// # Returns
/// A complete system prompt ready for training
pub fn build_system_prompt(stats: Option<&PersonaStats>, llm_analysis: Option<&str>) -> Result<String> {
    let mut prompt = String::new();

    // Base instruction
    prompt.push_str(&format!(
        "You are a digital version of {PERSONA_SUBJECT}. You are texting with one of their friends.\n\n"
    ));

    // Behavioral instructions
    prompt.push_str("## Instructions\n\n");

    // Core identity and role with transparency
    prompt.push_str(&format!(
        "You are an AI persona trained on the messages {PERSONA_SUBJECT} sent in their own iMessage conversations. "
    ));
    prompt.push_str(&format!(
        "Your purpose is to replicate how {PERSONA_SUBJECT} texts, capturing their unique voice, personality, and communication patterns based on the training data.\n\n"
    ));
    prompt
        .push_str("IMPORTANT: You are NOT the real person. You are an AI model that has learned their texting style. ");
    prompt.push_str(&format!(
        "If asked directly, acknowledge that you are an AI persona trained on {PERSONA_SUBJECT}'s own messages.\n\n"
    ));

    // Programmatic analysis section
    if let Some(persona_stats) = stats {
        prompt.push_str("## Writing Style (Observed Patterns)\n\n");

        // Message length
        prompt.push_str(&format!(
            "Your messages are typically {:.0} characters long. ",
            persona_stats.avg_message_length
        ));

        // Short vs long message tendency
        if persona_stats.short_message_rate > 0.3 {
            prompt.push_str("You often send short, quick messages. ");
        } else if persona_stats.long_message_rate > 0.2 {
            prompt.push_str("You sometimes send longer, more detailed messages. ");
        }
        prompt.push('\n');

        // Emoji usage
        if persona_stats.emoji_rate > 0.5 {
            prompt.push_str(&format!(
                "You use emojis frequently (about {:.1} per message). ",
                persona_stats.emoji_rate
            ));

            if !persona_stats.common_emojis.is_empty() {
                let top_emojis: Vec<String> = persona_stats
                    .common_emojis
                    .iter()
                    .take(5)
                    .map(|(emoji, _)| emoji.clone())
                    .collect();
                prompt.push_str(&format!("Your favorite emojis include: {}. ", top_emojis.join(", ")));
            }
            prompt.push('\n');
        } else if persona_stats.emoji_rate > 0.1 {
            prompt.push_str(&format!(
                "You use emojis occasionally ({:.1} per message). ",
                persona_stats.emoji_rate
            ));

            if !persona_stats.common_emojis.is_empty() {
                let top_emojis: Vec<String> = persona_stats
                    .common_emojis
                    .iter()
                    .take(3)
                    .map(|(emoji, _)| emoji.clone())
                    .collect();
                prompt.push_str(&format!("Commonly: {}. ", top_emojis.join(", ")));
            }
            prompt.push('\n');
        }

        // Punctuation and expression patterns
        if !persona_stats.punctuation_patterns.is_empty() {
            let patterns: Vec<String> = persona_stats
                .punctuation_patterns
                .iter()
                .take(3)
                .map(|(pattern, _count)| {
                    if pattern.chars().all(|c| !c.is_alphanumeric()) {
                        format!("'{}'", pattern)
                    } else {
                        pattern.clone()
                    }
                })
                .collect();

            if !patterns.is_empty() {
                prompt.push_str(&format!(
                    "You frequently use expressions like {}. ",
                    patterns.join(", ")
                ));
                prompt.push('\n');
            }
        }

        // Response timing
        if let Some(response_time) = persona_stats.avg_response_time_secs {
            let minutes = response_time / 60.0;
            if minutes < 5.0 {
                prompt.push_str("You typically respond very quickly to messages. ");
            } else if minutes < 30.0 {
                prompt.push_str("You typically respond within a reasonable time. ");
            } else {
                prompt.push_str("You sometimes take a while to respond to messages. ");
            }
            prompt.push('\n');
        }

        prompt.push('\n');
    }

    // LLM-detected personality section
    if let Some(analysis) = llm_analysis
        && !analysis.trim().is_empty()
    {
        prompt.push_str("## Personality & Communication Style\n\n");
        prompt.push_str(analysis.trim());
        prompt.push_str("\n\n");
    }

    // Message format and multi-message behavior
    prompt.push_str("## Message Format\n\n");
    prompt.push_str("IMPORTANT: You are simulating iMessage behavior. People often send multiple consecutive messages instead of one long message. ");
    prompt.push_str(&format!(
        "To send multiple messages in sequence, use the special token `{}` to separate them.\n\n",
        MSG_BREAK_TOKEN
    ));
    prompt.push_str("Examples:\n");
    prompt.push_str("- Single message: `hey what's up?`\n");
    prompt.push_str(&format!(
        "- Multiple messages: `hey{}what's up?{}you free later?`\n\n",
        MSG_BREAK_TOKEN, MSG_BREAK_TOKEN
    ));
    prompt
        .push_str("Use multiple messages when it feels natural - for emphasis, pacing, or when breaking up thoughts. ");
    prompt.push_str("This is especially common for:\n");
    prompt.push_str("- Excited or rapid-fire responses\n");
    prompt.push_str("- Breaking up longer thoughts into digestible chunks\n");
    prompt.push_str("- Adding afterthoughts or follow-ups\n");
    prompt.push_str("- Creating conversational rhythm and pacing\n\n");

    // Style and tone guidelines
    prompt.push_str("## Style Guidelines\n\n");
    prompt.push_str("- **Match the writing style**: Use the observed patterns above (message length, emoji usage, punctuation, expressions)\n");
    prompt
        .push_str("- **Stay in character**: Maintain the personality and tone described in the AI-detected analysis\n");
    prompt.push_str("- **Be authentic**: Text like a real person, not a formal AI assistant. Use casual language, contractions, and natural imperfections\n");
    prompt.push_str("- **Context awareness**: Respond appropriately to the conversation context and emotional tone\n");
    prompt.push_str("- **Natural variation**: Don't be too formulaic - real people vary their responses\n\n");

    // Critical constraints
    prompt.push_str("## Critical Rules\n\n");
    prompt.push_str(&format!(
        "- Respond in {PERSONA_SUBJECT}'s voice and style, but be transparent if asked about being an AI\n"
    ));
    prompt.push_str("- Keep responses natural and conversational without meta-commentary\n");
    prompt.push_str(&format!(
        "- Stay true to {PERSONA_SUBJECT}'s communication patterns (personality, tone, vocabulary, etc.)\n"
    ));
    prompt.push_str(
        "- Keep messages concise and natural like real text messages (unless the observed pattern shows otherwise)\n",
    );
    prompt.push_str("- Use the person's authentic style, including casual language, slang, or unique expressions\n");

    Ok(prompt)
}

/// Build a simple fallback prompt for the "You" persona when analysis is not available
///
/// Used when LLM analysis fails or stats cannot be calculated
pub fn build_fallback_prompt() -> String {
    format!(
        "You are an AI persona trained on the messages {contact} sent in their own iMessage conversations. You are texting with one of their friends.\n\n\
        ## Instructions\n\n\
        You are an AI model designed to replicate how {contact} texts. You are NOT the real person - you are a digital persona that has learned their communication style.\n\
        If asked directly, acknowledge that you are an AI persona trained to preserve and remember {contact}'s texting patterns.\n\n\
        ## Message Format\n\n\
        IMPORTANT: You are simulating iMessage behavior. To send multiple consecutive messages, use the special token `{token}` to separate them.\n\
        Example: `hey{token}what's up?{token}you free later?`\n\n\
        ### Style Guidelines\n\n\
        - Respond in {contact}'s voice and style\n\
        - Use casual language, contractions, and natural imperfections\n\
        - Keep messages concise and natural like real text messages\n\
        - Use multiple messages for pacing when it feels natural\n\n\
        ### Critical Rules\n\n\
        - Replicate {contact}'s communication patterns authentically\n\
        - Be transparent if asked about being an AI\n\
        - Keep responses natural and conversational without meta-commentary",
        contact = PERSONA_SUBJECT,
        token = MSG_BREAK_TOKEN
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use common::PersonaStats;

    fn create_test_stats() -> PersonaStats {
        PersonaStats {
            avg_message_length: 45.5,
            avg_user_message_length: 38.2,
            emoji_rate: 1.2,
            common_emojis: vec![("😊".to_string(), 50), ("👍".to_string(), 30), ("😂".to_string(), 25)],
            punctuation_patterns: vec![
                ("!".to_string(), 120),
                ("lol".to_string(), 45),
                ("haha".to_string(), 30),
            ],
            avg_response_time_secs: Some(180.0), // 3 minutes
            short_message_rate: 0.25,
            long_message_rate: 0.15,
        }
    }

    #[test]
    fn test_build_system_prompt_full() {
        let stats = create_test_stats();
        let llm_analysis = "You are friendly and casual. You use humor often and prefer informal language.";

        let prompt = build_system_prompt(Some(&stats), Some(llm_analysis)).unwrap();

        // Check that prompt contains key sections
        assert!(prompt.contains("AI persona"));
        assert!(prompt.contains(PERSONA_SUBJECT));
        assert!(prompt.contains("Writing Style"));
        assert!(prompt.contains("Personality & Communication Style"));
        assert!(prompt.contains("Instructions"));

        // Check transparency
        assert!(prompt.contains("NOT the real person"));

        // Check that stats are included
        assert!(prompt.contains("😊"));
        assert!(prompt.contains("lol"));

        // Check that LLM analysis is included
        assert!(prompt.contains("You are friendly"));
    }

    #[test]
    fn test_build_system_prompt_no_stats() {
        let prompt = build_system_prompt(None, Some("You are professional and concise.")).unwrap();

        assert!(prompt.contains("You are professional"));
        assert!(!prompt.contains("Writing Style")); // No stats section
    }

    #[test]
    fn test_build_system_prompt_no_llm() {
        let stats = create_test_stats();

        let prompt = build_system_prompt(Some(&stats), None).unwrap();

        assert!(prompt.contains("Writing Style"));
        assert!(!prompt.contains("Personality & Communication Style")); // No LLM section
    }

    #[test]
    fn test_build_fallback_prompt() {
        let prompt = build_fallback_prompt();

        assert!(prompt.contains("AI persona"));
        assert!(prompt.contains(PERSONA_SUBJECT));
        assert!(prompt.contains("<MSG_BREAK>"));
        assert!(prompt.contains("transparent if asked"));
    }
}

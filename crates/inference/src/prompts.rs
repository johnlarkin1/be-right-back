//! LLM prompt templates for inference.
//!
//! This module centralizes chat templates and system prompts used during inference.

// =============================================================================
// System Prompts
// =============================================================================

/// Default system prompt when no persona-specific prompt is available.
pub const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful assistant.";

/// Build a fallback system prompt for a persona when no custom prompt exists.
///
/// This creates a persona-appropriate prompt that instructs the model to
/// respond as the specified contact in a natural texting style.
///
/// # Arguments
/// * `contact_name` - The name of the contact/persona
pub fn build_persona_fallback_prompt(contact_name: &str) -> String {
    format!(
        "You are {contact_name}. You are texting back to your friend.\n\n\
        Respond naturally as {contact_name} would in a text conversation. \
        Keep responses concise and casual, like a real text message. \
        Match the texting style, tone, and personality that {contact_name} typically uses.\n\n\
        Important: Respond ONLY as {contact_name}. Do not break character or mention that you are an AI."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_persona_fallback_prompt() {
        let prompt = build_persona_fallback_prompt("Alice");
        assert!(prompt.contains("You are Alice"));
        assert!(prompt.contains("texting back to your friend"));
        assert!(prompt.contains("Do not break character"));
    }
}

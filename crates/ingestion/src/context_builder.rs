//! RAG context builder for formatting search results for LLM consumption.
//!
//! Takes search results from the hybrid search pipeline and formats them as a
//! context block to append to a persona's system prompt.

use crate::search::SearchResult;

/// Maximum characters across all excerpts in a persona context block.
const PERSONA_MAX_TOTAL_CHARS: usize = 6000;
/// Maximum characters retained from any single chunk.
const PERSONA_MAX_CHUNK_CHARS: usize = 300;
/// Maximum excerpts kept per calendar date, so one long conversation
/// can't crowd out every other day.
const PERSONA_MAX_PER_DATE: usize = 3;

/// A formatted persona-chat context block plus the number of excerpts it holds.
///
/// `chunk_count` is the count of excerpts that actually survived filtering and
/// the character budget — not the number of raw search hits. It's what the UI
/// grounding indicator should report.
#[derive(Debug, Clone)]
pub struct PersonaContext {
    pub text: String,
    pub chunk_count: usize,
}

/// Format search results as a context section to append to a persona's system prompt.
///
/// Results are sorted by relevance (descending similarity), deduplicated by date
/// (at most [`PERSONA_MAX_PER_DATE`] chunks per date so one conversation can't
/// dominate), filtered to drop chunks where only the friend speaks, and truncated
/// to [`PERSONA_MAX_TOTAL_CHARS`].
///
/// Returns `None` when no excerpt survives — callers should skip RAG injection
/// entirely rather than emit a preamble promising excerpts that aren't there.
pub fn format_persona_context(results: &[SearchResult]) -> Option<PersonaContext> {
    let mut sorted: Vec<&SearchResult> = results.iter().collect();
    sorted.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut sections = Vec::new();
    let mut total_len = 0;
    let mut date_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for r in &sorted {
        let date = r.start_timestamp.format("%Y-%m-%d").to_string();

        // Limit chunks per date to prevent one conversation from dominating
        let count = date_counts.entry(date.clone()).or_insert(0);
        if *count >= PERSONA_MAX_PER_DATE {
            continue;
        }

        // Strip the redundant "[Contact: ... | date]" header since we already
        // know the persona and add our own date line.
        let mut text = r.chunk_data.formatted.clone();
        if let Some(after_header) = text.find("]\n")
            && text.starts_with("[Contact:")
        {
            text = text[after_header + 2..].to_string();
        }

        // Relabel "Me:" (the app user/friend) to "Friend:" so the model
        // doesn't confuse the friend's messages with its own (the persona's).
        if text.starts_with("Me: ") {
            text = format!("Friend: {}", &text[4..]);
        }
        text = text.replace("\nMe: ", "\nFriend: ");

        // Skip chunks where only the friend speaks — they add noise without
        // any of the persona's own words for the model to ground on.
        let has_persona_speech = text.lines().any(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && !trimmed.starts_with("Friend:")
        });
        if !has_persona_speech {
            continue;
        }

        if text.len() > PERSONA_MAX_CHUNK_CHARS {
            let safe_boundary = text.floor_char_boundary(PERSONA_MAX_CHUNK_CHARS);
            if let Some(pos) = text[..safe_boundary].rfind('\n') {
                text.truncate(pos);
            } else {
                text.truncate(safe_boundary);
            }
        }

        let section = format!("[{date}]\n{text}");
        let section_len = section.len() + 2; // +2 for the blank line separator
        if total_len + section_len > PERSONA_MAX_TOTAL_CHARS {
            break;
        }
        total_len += section_len;
        sections.push(section);
        *count += 1;
    }

    if sections.is_empty() {
        return None;
    }

    let chunk_count = sections.len();
    let text = format!(
        "\n\n## Your Real Conversation History\n\n\
         IMPORTANT: Read these excerpts carefully before answering.\n\
         Lines with your name are things YOU actually said. Lines with 'Friend:' are what your friend said.\n\
         You MUST base factual answers on what YOU said in these excerpts.\n\
         Do NOT make up names, places, schools, or events that are not in the excerpts below.\n\
         If the answer is not clearly in these excerpts, say you don't remember rather than guessing.\n\n\
         {}",
        sections.join("\n\n")
    );

    Some(PersonaContext { text, chunk_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vectordb::ChunkData;
    use chrono::Utc;

    /// Build a result on a fixed date so date-dedup is deterministic.
    fn persona_result(chunk_id: i64, text: &str, date: &str, similarity: f32) -> SearchResult {
        let ts = format!("{date}T12:00:00Z").parse::<chrono::DateTime<Utc>>().unwrap();
        SearchResult {
            chunk_id,
            contact_id: "contact_1".to_string(),
            contact_name: Some("Persona".to_string()),
            chunk_data: ChunkData {
                messages: vec![],
                formatted: text.to_string(),
            },
            message_ids: vec![chunk_id],
            start_timestamp: ts,
            end_timestamp: ts,
            similarity,
            embedding: None,
        }
    }

    #[test]
    fn test_persona_context_none_when_empty() {
        assert!(format_persona_context(&[]).is_none());
    }

    #[test]
    fn test_persona_context_none_when_only_friend_speaks() {
        // Every line is the friend, so nothing grounds the persona.
        let results = vec![persona_result(1, "Me: hey\nMe: you there?", "2024-03-15", 0.9)];
        assert!(format_persona_context(&results).is_none());
    }

    #[test]
    fn test_persona_context_counts_surviving_chunks_not_raw_hits() {
        // 4 hits on one date, but MAX_PER_DATE caps retention at 3.
        let results: Vec<_> = (0..4)
            .map(|i| persona_result(i, &format!("Persona: line {i}\nMe: ok"), "2024-03-15", 0.9))
            .collect();

        let ctx = format_persona_context(&results).expect("some chunks survive");
        assert_eq!(
            ctx.chunk_count, PERSONA_MAX_PER_DATE,
            "chunk_count must reflect excerpts kept, not the 4 raw results"
        );
    }

    #[test]
    fn test_persona_context_respects_max_per_date_across_dates() {
        let mut results = Vec::new();
        for (i, date) in ["2024-03-15", "2024-03-16"].iter().enumerate() {
            for j in 0..4 {
                let id = (i * 10 + j) as i64;
                results.push(persona_result(id, &format!("Persona: msg {id}\nMe: ok"), date, 0.9));
            }
        }

        let ctx = format_persona_context(&results).expect("some chunks survive");
        // 4 per date capped to 3, across 2 dates.
        assert_eq!(ctx.chunk_count, PERSONA_MAX_PER_DATE * 2);
    }

    #[test]
    fn test_persona_context_relabels_me_as_friend() {
        let results = vec![persona_result(
            1,
            "Me: where'd you go?\nPersona: Harvard",
            "2024-03-15",
            0.9,
        )];
        let ctx = format_persona_context(&results).expect("chunk survives");

        assert!(ctx.text.contains("Friend: where'd you go?"));
        assert!(!ctx.text.contains("Me: "), "no raw 'Me:' should reach the model");
        assert!(ctx.text.contains("Persona: Harvard"));
    }

    #[test]
    fn test_persona_context_strips_contact_header() {
        let results = vec![persona_result(
            1,
            "[Contact: Persona | 2024-03-15]\nPersona: hello\nMe: hi",
            "2024-03-15",
            0.9,
        )];
        let ctx = format_persona_context(&results).expect("chunk survives");
        assert!(!ctx.text.contains("[Contact:"), "redundant header should be stripped");
    }

    #[test]
    fn test_persona_context_truncates_on_char_boundary() {
        // Multi-byte characters straddling the cut point must not panic.
        let long = format!("Persona: {}", "é".repeat(PERSONA_MAX_CHUNK_CHARS));
        let results = vec![persona_result(1, &long, "2024-03-15", 0.9)];

        let ctx = format_persona_context(&results).expect("chunk survives");
        assert!(ctx.text.len() < long.len() + 500);
    }

    #[test]
    fn test_persona_context_orders_by_similarity() {
        let results = vec![
            persona_result(1, "Persona: low relevance\nMe: ok", "2024-03-15", 0.2),
            persona_result(2, "Persona: high relevance\nMe: ok", "2024-03-16", 0.95),
        ];
        let ctx = format_persona_context(&results).expect("chunks survive");

        let high = ctx.text.find("high relevance").expect("high present");
        let low = ctx.text.find("low relevance").expect("low present");
        assert!(high < low, "higher similarity must come first");
    }

    #[test]
    fn test_persona_context_respects_total_char_budget() {
        // Many distinct dates so date-dedup never fires; only the budget bounds it.
        let results: Vec<_> = (1..=40)
            .map(|i| {
                let date = format!("2024-03-{:02}", (i % 28) + 1);
                persona_result(i, &format!("Persona: {}\nMe: ok", "x".repeat(250)), &date, 0.9)
            })
            .collect();

        let ctx = format_persona_context(&results).expect("chunks survive");
        let excerpt_len: usize = ctx.text.len();
        assert!(
            excerpt_len < PERSONA_MAX_TOTAL_CHARS + 1000,
            "total context {excerpt_len} should stay near the {PERSONA_MAX_TOTAL_CHARS} budget"
        );
    }
}

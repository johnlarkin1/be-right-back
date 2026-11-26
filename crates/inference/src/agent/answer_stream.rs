//! Turns raw generation tokens into a live preview of Casper's answer.
//!
//! One agent iteration produces either a tool call or a final answer, and the
//! agent knows which only after the generation ends. The preview must show
//! answer text as it arrives and never show a `<think>` block or a tool call.
//! `AnswerStream` takes raw tokens and returns only the text that is safe to show:
//!
//! - Text inside a leading `<think>...</think>` block stays hidden.
//! - Text that starts with a tool-call marker is hidden entirely.
//! - Text before a tool-call marker that appears mid-answer is shown. The
//!   agent sends a reset when the iteration turns out to be a tool call.
//! - A trailing fragment that could still grow into a marker waits for the
//!   next token.
//!
//! The tool-call markers come from [`TOOL_CALL_OPENERS`], so the
//! preview and the parser agree on what a tool call is. The daemon strips the
//! tokenizer's special tokens (`<|im_end|>` and so on) before it streams.
//!
//! The preview is not the answer. The agent's final answer comes from the
//! parser and replaces the preview when the turn completes.

use super::parser::TOOL_CALL_OPENERS;

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Accumulates raw tokens and hands out the new, safe-to-show answer text.
#[derive(Debug, Default)]
pub struct AnswerStream {
    raw: String,
    emitted: usize,
}

impl AnswerStream {
    /// Create an empty stream.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a raw token. Returns the new preview text, if there is any.
    pub fn push(&mut self, token: &str) -> Option<String> {
        self.raw.push_str(token);

        let visible = visible_answer(&self.raw);
        if visible.len() <= self.emitted || !visible.is_char_boundary(self.emitted) {
            return None;
        }

        let new_text = visible[self.emitted..].to_string();
        self.emitted = visible.len();
        Some(new_text)
    }

    /// Whether any preview text was handed out.
    pub fn has_emitted(&self) -> bool {
        self.emitted > 0
    }
}

/// The part of `raw` that is safe to show as answer text.
fn visible_answer(raw: &str) -> String {
    let text = raw.trim_start();

    // Hide a leading think block until it closes.
    let after_think = if let Some(rest) = text.strip_prefix(THINK_OPEN) {
        match rest.find(THINK_CLOSE) {
            Some(end) => &rest[end + THINK_CLOSE.len()..],
            None => return String::new(),
        }
    } else if THINK_OPEN.starts_with(text) {
        // Empty, or a fragment such as "<thi": it may still become a think tag.
        return String::new();
    } else {
        text
    };

    let answer = after_think.replace(THINK_CLOSE, "");
    let answer = answer.trim_start();

    // Visible text ends at the first tool-call marker.
    if let Some(pos) = TOOL_CALL_OPENERS.iter().filter_map(|m| answer.find(m)).min() {
        return answer[..pos].to_string();
    }

    // Hold back a trailing fragment that could still become a marker.
    let held = partial_marker_suffix_len(answer);
    answer[..answer.len() - held].to_string()
}

/// Length of the longest suffix of `text` that is a proper prefix of a
/// tool-call marker or the closing think tag.
fn partial_marker_suffix_len(text: &str) -> usize {
    TOOL_CALL_OPENERS
        .iter()
        .chain(std::iter::once(&THINK_CLOSE))
        .map(|marker| {
            (1..marker.len())
                .rev()
                .find(|&n| marker.is_char_boundary(n) && text.ends_with(&marker[..n]))
                .unwrap_or(0)
        })
        .max()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::parser;

    /// Feed `tokens` one by one and return everything the stream emitted.
    fn stream(tokens: &[&str]) -> (String, AnswerStream) {
        let mut s = AnswerStream::new();
        let mut out = String::new();
        for t in tokens {
            if let Some(text) = s.push(t) {
                out.push_str(&text);
            }
        }
        (out, s)
    }

    #[test]
    fn plain_answer_streams_through() {
        let (out, s) = stream(&["You ", "texted ", "Sam ", "most."]);
        assert_eq!(out, "You texted Sam most.");
        assert!(s.has_emitted());
    }

    #[test]
    fn think_block_stays_hidden() {
        let (out, _) = stream(&["<think>\n", "Let me ", "look.", "</thi", "nk>\n\n", "Sam ", "wins."]);
        assert_eq!(out, "Sam wins.");
    }

    #[test]
    fn unclosed_think_block_shows_nothing() {
        let (out, s) = stream(&["<think>\n", "still thinking"]);
        assert_eq!(out, "");
        assert!(!s.has_emitted());
    }

    #[test]
    fn split_think_tag_is_not_shown() {
        let (out, _) = stream(&["<th", "ink>", "hidden", "</think>", "shown"]);
        assert_eq!(out, "shown");
    }

    #[test]
    fn tool_call_after_thinking_shows_nothing() {
        let (out, s) = stream(&[
            "<think>\nI should search.\n</think>\n\n",
            "<tool",
            "_call>\n<function=search_messages>",
            "<parameter=query>pizza</parameter></function></tool_call>",
        ]);
        assert_eq!(out, "");
        assert!(!s.has_emitted());
    }

    #[test]
    fn bare_json_tool_call_shows_nothing() {
        let (out, _) = stream(&["[", "{\"name\": \"list_contacts\"}]"]);
        assert_eq!(out, "");
    }

    #[test]
    fn text_stops_at_a_mid_answer_tool_call() {
        let (out, s) = stream(&["Let me check. ", "<tool_", "call>{\"name\": \"x\"}"]);
        assert_eq!(out, "Let me check. ");
        assert!(s.has_emitted());
    }

    #[test]
    fn bracket_that_is_not_a_tool_call_is_released() {
        let (out, _) = stream(&["See [", "1] for details."]);
        assert_eq!(out, "See [1] for details.");
    }

    /// One sample per tool-call format the parser accepts. Add a sample when
    /// the parser learns a new format.
    const TOOL_CALL_SAMPLES: &[&str] = &[
        "<tool_call>\n<function=search_messages>\n<parameter=query>\npizza\n</parameter>\n</function>\n</tool_call>",
        "<tool_call>\n{\"name\": \"search_messages\", \"arguments\": {\"query\": \"pizza\"}}\n</tool_call>",
        "<|tool_call|>[{\"name\": \"search_messages\", \"arguments\": {\"query\": \"pizza\"}}]<|/tool_call|>",
        "[{\"name\": \"search_messages\", \"arguments\": {\"query\": \"pizza\"}}]",
    ];

    #[test]
    fn every_parser_format_stays_out_of_the_preview() {
        for sample in TOOL_CALL_SAMPLES {
            let parsed = parser::parse_tool_calls(sample).unwrap();
            assert!(parsed.has_tool_calls, "parser no longer accepts: {sample}");

            // Feed it in small chunks, as the daemon would.
            let chars: Vec<char> = sample.chars().collect();
            let chunks: Vec<String> = chars.chunks(3).map(|c| c.iter().collect()).collect();
            let refs: Vec<&str> = chunks.iter().map(String::as_str).collect();
            let (out, _) = stream(&refs);
            assert_eq!(out, "", "tool call leaked into the preview: {sample}");
        }
    }

    #[test]
    fn multibyte_text_is_safe() {
        let (out, _) = stream(&["Café ", "☕ ", "time"]);
        assert_eq!(out, "Café ☕ time");
    }
}

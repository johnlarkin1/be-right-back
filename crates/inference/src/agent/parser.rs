//! Parser for extracting tool calls from LLM responses.
//!
//! This module parses tool calls in multiple formats:
//! - Qwen3.5 XML: `<tool_call><function=name><parameter=p>val</parameter></function></tool_call>`
//! - Qwen3 JSON wrapped: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`
//! - Legacy wrapped: `<|tool_call|>[{"name": "...", "arguments": {...}}]<|/tool_call|>`
//! - Bare JSON: `[{"name": "...", "parameters": {...}}]`

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

use super::tools::ToolCall;
use crate::error::{InferenceError, Result};

/// Text that opens a tool call, one entry per format `parse_tool_calls` accepts:
/// Qwen3/Qwen3.5 `<tool_call>`, legacy `<|tool_call|>`, and bare JSON `[{`.
///
/// `AnswerStream` ends the live answer preview at the first one. A new tool
/// call format needs an entry here, or its text leaks into the preview.
pub const TOOL_CALL_OPENERS: &[&str] = &["<tool_call>", "<|tool_call|>", "[{"];

/// Regex for matching legacy wrapped tool call blocks (`<|tool_call|>...<|/tool_call|>`).
static TOOL_CALL_REGEX: OnceLock<Regex> = OnceLock::new();

/// Regex for matching Qwen3 tool call blocks (JSON content inside <tool_call> tags).
static QWEN3_TOOL_CALL_REGEX: OnceLock<Regex> = OnceLock::new();

/// Regex for matching Qwen3.5 XML-style function tags inside <tool_call> blocks.
static QWEN35_FUNCTION_REGEX: OnceLock<Regex> = OnceLock::new();

/// Regex for matching Qwen3.5 XML-style parameter tags.
static QWEN35_PARAMETER_REGEX: OnceLock<Regex> = OnceLock::new();

/// Regex for collapsing multiple spaces (preserving newlines).
static WHITESPACE_REGEX: OnceLock<Regex> = OnceLock::new();

/// Regex for collapsing 3+ consecutive newlines.
static NEWLINE_REGEX: OnceLock<Regex> = OnceLock::new();

fn tool_call_regex() -> &'static Regex {
    TOOL_CALL_REGEX
        .get_or_init(|| Regex::new(r"<\|tool_call\|>(.*?)<\|/tool_call\|>").expect("invalid tool_call regex"))
}

fn qwen3_tool_call_regex() -> &'static Regex {
    // Match <tool_call>...</tool_call> OR <tool_call>...<tool_call> (malformed closing)
    // OR <tool_call>...</tool_response> (Qwen3 mismatched closing tag quirk)
    // OR <tool_call>... to end of string (truncated by stop sequence before closing tag)
    // Use (?s) flag to make . match newlines (Qwen3 outputs pretty-printed JSON)
    QWEN3_TOOL_CALL_REGEX.get_or_init(|| {
        Regex::new(r"(?s)<tool_call>\s*(.*?)\s*(?:</?tool_call>|</tool_response>|$)")
            .expect("invalid qwen3 tool_call regex")
    })
}

fn qwen35_function_regex() -> &'static Regex {
    // Match <function=name>...</function> inside a tool_call block
    QWEN35_FUNCTION_REGEX.get_or_init(|| {
        Regex::new(r"(?s)<function=([^>]+)>(.*?)(?:</function>|$)").expect("invalid qwen35 function regex")
    })
}

fn qwen35_parameter_regex() -> &'static Regex {
    // Match <parameter=name>value</parameter>
    QWEN35_PARAMETER_REGEX.get_or_init(|| {
        Regex::new(r"(?s)<parameter=([^>]+)>\n?(.*?)\n?</parameter>").expect("invalid qwen35 parameter regex")
    })
}

fn whitespace_regex() -> &'static Regex {
    WHITESPACE_REGEX.get_or_init(|| Regex::new(r"[^\S\n]+").expect("invalid whitespace regex"))
}

fn newline_regex() -> &'static Regex {
    NEWLINE_REGEX.get_or_init(|| Regex::new(r"\n{3,}").expect("invalid newline regex"))
}

/// Result of parsing an LLM response.
#[derive(Debug, Clone)]
pub struct ParsedResponse {
    /// Text content before any tool calls.
    pub text_before: String,
    /// Parsed tool calls (if any).
    pub tool_calls: Vec<ToolCall>,
    /// Text content after tool calls.
    pub text_after: String,
    /// Whether this response contains tool calls.
    pub has_tool_calls: bool,
    /// Thinking content from Qwen3's <think>...</think> blocks (if any).
    pub thinking: Option<String>,
}

impl ParsedResponse {
    /// Get the final text response (combines before and after, trimmed).
    ///
    /// Also cleans up any leaked instructions or formatting artifacts.
    pub fn final_text(&self) -> String {
        let combined = format!("{}\n{}", self.text_before, self.text_after);
        clean_answer_text(&combined)
    }
}

/// Clean up answer text, removing leaked instructions and formatting.
fn clean_answer_text(text: &str) -> String {
    let mut result = text.trim().to_string();

    // Remove common leaked instruction patterns
    let patterns_to_remove = [
        "Switching to ANSWER MODE.",
        "ANSWER MODE:",
        "TOOL MODE:",
        "Switching to TOOL MODE.",
    ];

    for pattern in patterns_to_remove {
        result = result.replace(pattern, "");
    }

    // Remove any trailing JSON that might have been included
    // (model sometimes outputs text then a tool call)
    if let Some(idx) = result.rfind("[{\"") {
        // Check if this looks like a tool call JSON at the end
        let suffix = &result[idx..];
        if suffix.contains("\"name\"") && suffix.trim_end().ends_with("}]") {
            result = result[..idx].to_string();
        }
    }

    // Clean up multiple consecutive spaces (but preserve newlines for markdown)
    result = whitespace_regex().replace_all(&result, " ").to_string();
    // Collapse 3+ consecutive newlines into 2 (preserve paragraph breaks)
    result = newline_regex().replace_all(&result, "\n\n").trim().to_string();

    result
}

/// Parse tool calls from an LLM response.
///
/// Extracts tool calls in multiple formats (tried in order):
/// 1. Qwen3.5 XML: `<tool_call><function=name><parameter=p>val</parameter></function></tool_call>`
/// 2. Qwen3 JSON wrapped: `<tool_call>{"name": "...", "arguments": {...}}</tool_call>`
/// 3. Legacy wrapped: `<|tool_call|>[{"name": "...", "arguments": {...}}]<|/tool_call|>`
/// 4. Bare JSON: `[{"name": "...", "parameters": {...}}]`
///
/// Also extracts Qwen3/3.5 `<think>...</think>` blocks into the `thinking` field.
///
/// # Arguments
/// * `response` - The raw LLM response text
///
/// # Returns
/// A `ParsedResponse` containing any tool calls, surrounding text, and thinking content.
pub fn parse_tool_calls(response: &str) -> Result<ParsedResponse> {
    // First extract thinking blocks (before cleaning other tokens)
    let (thinking, without_thinking) = extract_thinking(response);

    // Clean up any special tokens that shouldn't be in the response
    let mut cleaned = clean_special_tokens(&without_thinking);

    // Remove orphaned </think> tags that the model sometimes outputs
    // in place of </tool_call> (Qwen3 quirk)
    cleaned = cleaned.replace("</think>", "");

    // Try Qwen3.5 XML format first (native format for current models)
    let mut result = parse_qwen35_xml_tool_calls(&cleaned)?;
    if result.has_tool_calls {
        result.thinking = thinking;
        return Ok(result);
    }

    // Try legacy wrapped format
    let mut result = parse_wrapped_tool_calls(&cleaned)?;
    if result.has_tool_calls {
        result.thinking = thinking;
        return Ok(result);
    }

    // Try Qwen3 JSON wrapped format (fallback)
    let mut result = parse_qwen3_tool_calls(&cleaned)?;
    if result.has_tool_calls {
        result.thinking = thinking;
        return Ok(result);
    }

    // Try bare JSON format
    let mut result = parse_bare_json_tool_calls(&cleaned)?;
    result.thinking = thinking;
    Ok(result)
}

/// Regex for matching Qwen3 thinking blocks (complete or incomplete).
static THINK_BLOCK_REGEX: OnceLock<Regex> = OnceLock::new();

fn think_block_regex() -> &'static Regex {
    // Match complete <think>...</think> OR incomplete <think>... (to end of string)
    // Capture the content inside the tags
    THINK_BLOCK_REGEX.get_or_init(|| Regex::new(r"(?s)<think>(.*?)(</think>|$)").expect("invalid think block regex"))
}

/// Extract thinking content from response and return (thinking, cleaned_response).
fn extract_thinking(response: &str) -> (Option<String>, String) {
    let regex = think_block_regex();

    let mut thinking_parts = Vec::new();
    let mut cleaned = response.to_string();

    // Extract all thinking blocks
    for cap in regex.captures_iter(response) {
        if let Some(content) = cap.get(1) {
            let thinking_content = content.as_str().trim();
            if !thinking_content.is_empty() {
                thinking_parts.push(thinking_content.to_string());
            }
        }
    }

    // Remove thinking blocks from the response
    cleaned = regex.replace_all(&cleaned, "").to_string();

    let thinking = if thinking_parts.is_empty() {
        None
    } else {
        Some(thinking_parts.join("\n\n"))
    };

    (thinking, cleaned)
}

/// Clean special tokens and markdown formatting from response.
/// Does NOT remove thinking blocks - those are extracted separately.
fn clean_special_tokens(response: &str) -> String {
    let mut cleaned = response.to_string();

    // Remove legacy special tokens that shouldn't appear in the output
    for token in ["<|end|>", "<|assistant|>", "<|user|>", "<|system|>"] {
        cleaned = cleaned.replace(token, "");
    }

    // Remove Qwen3 special tokens that shouldn't appear in the output
    for token in ["<|im_end|>", "<|im_start|>", "<|endoftext|>", "<|start|>", "><|start|>"] {
        cleaned = cleaned.replace(token, "");
    }

    // Remove markdown code block wrappers (```json ... ``` or ``` ... ```)
    // The model sometimes wraps tool calls in markdown code blocks
    cleaned = strip_markdown_code_blocks(&cleaned);

    cleaned.trim().to_string()
}

/// Strip markdown code block wrappers from content.
///
/// Handles formats like:
/// - ```json\n[...]\n```
/// - ```\n[...]\n```
fn strip_markdown_code_blocks(content: &str) -> String {
    let mut result = content.to_string();

    // Pattern: ```json or ``` at start of a line, followed by content, then ```
    // We'll use a simple approach: remove ```json and ``` markers

    // Remove opening code block markers (```json, ```JSON, ```)
    for marker in ["```json", "```JSON", "```"] {
        result = result.replace(marker, "");
    }

    result
}

/// Parse legacy wrapped tool calls in format: `<|tool_call|>...<|/tool_call|>`
fn parse_wrapped_tool_calls(response: &str) -> Result<ParsedResponse> {
    let regex = tool_call_regex();

    let mut tool_calls = Vec::new();
    let mut text_before = String::new();
    let mut text_after = String::new();
    let mut last_end = 0;
    let mut first_match_start: Option<usize> = None;

    for cap in regex.captures_iter(response) {
        let full_match = cap.get(0).unwrap();
        let json_content = cap.get(1).unwrap().as_str().trim();

        if first_match_start.is_none() {
            first_match_start = Some(full_match.start());
            text_before = response[..full_match.start()].trim().to_string();
        }
        last_end = full_match.end();

        let parsed_calls = parse_tool_call_json(json_content)?;
        tool_calls.extend(parsed_calls);
    }

    if last_end > 0 {
        text_after = response[last_end..].trim().to_string();
    } else {
        text_before = response.trim().to_string();
    }

    Ok(ParsedResponse {
        text_before,
        tool_calls: tool_calls.clone(),
        text_after,
        has_tool_calls: !tool_calls.is_empty(),
        thinking: None,
    })
}

/// Parse Qwen3-style tool calls: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
///
/// Qwen3 outputs tool calls in this format. The JSON inside may be a single object
/// or wrapped in an array. Duplicate tool calls within a single response are
/// deduplicated (the model sometimes repeats the same call multiple times).
fn parse_qwen3_tool_calls(response: &str) -> Result<ParsedResponse> {
    let regex = qwen3_tool_call_regex();

    let mut tool_calls = Vec::new();
    let mut text_before = String::new();
    let mut text_after = String::new();
    let mut last_end = 0;
    let mut first_match_start: Option<usize> = None;
    let mut seen_json: std::collections::HashSet<String> = std::collections::HashSet::new();

    for cap in regex.captures_iter(response) {
        let full_match = cap.get(0).unwrap();
        let json_content = cap.get(1).unwrap().as_str().trim();

        if first_match_start.is_none() {
            first_match_start = Some(full_match.start());
            text_before = response[..full_match.start()].trim().to_string();
        }
        last_end = full_match.end();

        let parsed_calls = parse_tool_call_json(json_content)?;
        for call in parsed_calls {
            // Deduplicate: skip if we've already seen an identical tool call
            let key = serde_json::to_string(&call).unwrap_or_default();
            if seen_json.insert(key) {
                tool_calls.push(call);
            }
        }
    }

    if last_end > 0 {
        text_after = response[last_end..].trim().to_string();
    } else {
        text_before = response.trim().to_string();
    }

    Ok(ParsedResponse {
        text_before,
        tool_calls: tool_calls.clone(),
        text_after,
        has_tool_calls: !tool_calls.is_empty(),
        thinking: None,
    })
}

/// Parse Qwen3.5 XML-style tool calls.
///
/// Qwen3.5 uses XML tags for tool calls instead of JSON:
/// ```text
/// <tool_call>
/// <function=search_messages>
/// <parameter=query>
/// dinner restaurant
/// </parameter>
/// </function>
/// </tool_call>
/// ```
fn parse_qwen35_xml_tool_calls(response: &str) -> Result<ParsedResponse> {
    let regex = qwen3_tool_call_regex();
    let func_regex = qwen35_function_regex();
    let param_regex = qwen35_parameter_regex();

    let mut tool_calls = Vec::new();
    let mut text_before = String::new();
    let mut text_after = String::new();
    let mut last_end = 0;
    let mut first_match_start: Option<usize> = None;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for cap in regex.captures_iter(response) {
        let full_match = cap.get(0).unwrap();
        let inner = cap.get(1).unwrap().as_str().trim();

        // Check if this contains Qwen3.5 XML format (<function=...>)
        if let Some(func_cap) = func_regex.captures(inner) {
            let func_name = func_cap.get(1).unwrap().as_str().trim().to_string();
            let func_body = func_cap.get(2).unwrap().as_str();

            // Extract parameters
            let mut args = serde_json::Map::new();
            for param_cap in param_regex.captures_iter(func_body) {
                let param_name = param_cap.get(1).unwrap().as_str().trim().to_string();
                let param_value = param_cap.get(2).unwrap().as_str().trim();

                // Try to parse as JSON value (number, bool, etc.), fall back to string
                let value: Value =
                    serde_json::from_str(param_value).unwrap_or_else(|_| Value::String(param_value.to_string()));
                args.insert(param_name, value);
            }

            let call = ToolCall {
                name: func_name,
                arguments: Value::Object(args),
            };

            // Deduplicate
            let key = serde_json::to_string(&call).unwrap_or_default();
            if seen.insert(key) {
                if first_match_start.is_none() {
                    first_match_start = Some(full_match.start());
                    text_before = response[..full_match.start()].trim().to_string();
                }
                last_end = full_match.end();
                tool_calls.push(call);
            }
        }
    }

    if last_end > 0 {
        text_after = response[last_end..].trim().to_string();
    } else {
        text_before = response.trim().to_string();
    }

    Ok(ParsedResponse {
        text_before,
        tool_calls: tool_calls.clone(),
        text_after,
        has_tool_calls: !tool_calls.is_empty(),
        thinking: None,
    })
}

/// Parse bare JSON tool calls like: [{"name":"...", "parameters":{...}}]
fn parse_bare_json_tool_calls(response: &str) -> Result<ParsedResponse> {
    // Look for JSON array at the start or after some intro text
    // Pattern: optional text, then [{ ... }], then optional text

    let trimmed = response.trim();

    // Try to find a JSON array in the response
    if let Some(start_idx) = trimmed.find('[') {
        // Find matching closing bracket
        let mut depth = 0;
        let mut end_idx = None;

        for (i, ch) in trimmed[start_idx..].char_indices() {
            match ch {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end_idx = Some(start_idx + i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }

        if let Some(end) = end_idx {
            let json_str = &trimmed[start_idx..end];

            // Try to parse as tool call array
            if let Ok(parsed_calls) = parse_tool_call_json(json_str)
                && !parsed_calls.is_empty()
            {
                let text_before = trimmed[..start_idx].trim().to_string();
                let text_after = trimmed[end..].trim().to_string();

                return Ok(ParsedResponse {
                    text_before,
                    tool_calls: parsed_calls,
                    text_after,
                    has_tool_calls: true,
                    thinking: None,
                });
            }
        }
    }

    // No tool calls found
    Ok(ParsedResponse {
        text_before: response.trim().to_string(),
        tool_calls: vec![],
        text_after: String::new(),
        has_tool_calls: false,
        thinking: None,
    })
}

/// Parse the JSON content of a tool call block.
///
/// Handles both array format `[{...}]` and single object format `{...}`.
/// Also attempts to fix incomplete JSON (missing closing brackets).
fn parse_tool_call_json(json_str: &str) -> Result<Vec<ToolCall>> {
    let trimmed = json_str.trim();

    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    // Try to parse as JSON, with fallback to fix incomplete JSON
    let value: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            // Try to fix incomplete JSON by adding missing closing brackets
            let fixed = fix_incomplete_json(trimmed);
            serde_json::from_str(&fixed)
                .map_err(|e| InferenceError::ChatTemplateError(format!("invalid tool call JSON: {}", e)))?
        }
    };

    match value {
        // Array of tool calls
        Value::Array(arr) => {
            let mut calls = Vec::new();
            for item in arr {
                match parse_single_tool_call(item) {
                    Ok(call) => calls.push(call),
                    Err(e) => {
                        // Skip malformed tool call objects instead of failing the entire parse.
                        // Small models (4B) sometimes output unexpected JSON structures.
                        tracing::warn!(error = %e, "Skipping malformed tool call in array");
                    }
                }
            }
            Ok(calls)
        }
        // Single tool call object
        Value::Object(_) => match parse_single_tool_call(value) {
            Ok(call) => Ok(vec![call]),
            Err(e) => {
                tracing::warn!(error = %e, "Skipping malformed single tool call");
                Ok(vec![])
            }
        },
        _ => Ok(vec![]), // Not a valid tool call structure, treat as no tool calls
    }
}

/// Parse a single tool call JSON object.
///
/// Accepts multiple field name variants for compatibility with different models:
/// - "name" or "function" (string) for the tool name
/// - "arguments" or "parameters" for the arguments
/// - Nested format: {"function": {"name": "...", "parameters": {...}}}
///   (Qwen3 sometimes wraps the tool call inside a "function" object)
fn parse_single_tool_call(value: Value) -> Result<ToolCall> {
    let obj = value
        .as_object()
        .ok_or_else(|| InferenceError::ChatTemplateError("tool call must be an object".to_string()))?;

    // Handle nested format: {"function": {"name": "...", "parameters": {...}}}
    // Qwen3 sometimes wraps the entire tool call inside a "function" object.
    if let Some(func_val) = obj.get("function")
        && let Some(func_obj) = func_val.as_object()
    {
        let name = func_obj
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                InferenceError::ChatTemplateError("nested function object missing 'name' field".to_string())
            })?
            .to_string();

        let arguments = func_obj
            .get("arguments")
            .or_else(|| func_obj.get("parameters"))
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new()));

        return Ok(ToolCall { name, arguments });
    }

    // Flat format: {"name": "...", "arguments": {...}}
    // or: {"function": "tool_name", "parameters": {...}}
    let name = obj
        .get("name")
        .or_else(|| obj.get("function"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| InferenceError::ChatTemplateError("tool call missing 'name' or 'function' field".to_string()))?
        .to_string();

    // Accept both "arguments" and "parameters" for compatibility
    let arguments = obj
        .get("arguments")
        .or_else(|| obj.get("parameters"))
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    Ok(ToolCall { name, arguments })
}

/// Attempt to fix incomplete JSON by adding missing closing brackets.
///
/// This handles cases where the model's output was truncated mid-JSON,
/// leaving unclosed brackets or braces.
fn fix_incomplete_json(json_str: &str) -> String {
    let mut result = json_str.to_string();

    // Count open brackets and braces
    let mut open_brackets = 0i32;
    let mut open_braces = 0i32;
    let mut in_string = false;
    let mut prev_char = ' ';

    for c in json_str.chars() {
        if c == '"' && prev_char != '\\' {
            in_string = !in_string;
        } else if !in_string {
            match c {
                '[' => open_brackets += 1,
                ']' => open_brackets -= 1,
                '{' => open_braces += 1,
                '}' => open_braces -= 1,
                _ => {}
            }
        }
        prev_char = c;
    }

    // Add missing closing brackets/braces
    for _ in 0..open_braces {
        result.push('}');
    }
    for _ in 0..open_brackets {
        result.push(']');
    }

    result
}

/// Format a tool response for the LLM.
///
/// Wraps the result in `<tool_response>...</tool_response>` tags (Qwen3.5 native format).
pub fn format_tool_response(result: &Value) -> String {
    let json_str = serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
    format!("<tool_response>\n{}\n</tool_response>", json_str)
}

/// Format tool calls in Qwen3.5 XML format for conversation history.
///
/// Produces the native Qwen3.5 tool call format:
/// ```text
/// <tool_call>
/// <function=name>
/// <parameter=param_name>
/// value
/// </parameter>
/// </function>
/// </tool_call>
/// ```
pub fn format_tool_calls_xml(calls: &[ToolCall]) -> String {
    let mut parts = Vec::new();
    for call in calls {
        let mut xml = String::new();
        xml.push_str("<tool_call>\n");
        xml.push_str(&format!("<function={}>\n", call.name));
        if let Some(obj) = call.arguments.as_object() {
            for (key, value) in obj {
                // Skip internal parameters (e.g. _embedding) — they're huge vectors
                // injected by the agent and would overwhelm the model's context.
                if key.starts_with('_') {
                    continue;
                }
                xml.push_str(&format!("<parameter={}>\n", key));
                // Format value: strings as plain text, others as JSON
                match value {
                    Value::String(s) => xml.push_str(s),
                    other => xml.push_str(&other.to_string()),
                }
                xml.push_str("\n</parameter>\n");
            }
        }
        xml.push_str("</function>\n</tool_call>");
        parts.push(xml);
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tool_call_array() {
        let response = r#"Let me search for that.
<|tool_call|>[{"name": "search_messages", "arguments": {"query": "birthday party"}}]<|/tool_call|>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "birthday party");
        assert_eq!(parsed.text_before, "Let me search for that.");
    }

    #[test]
    fn test_parse_tool_call_single_object() {
        let response = r#"<|tool_call|>{"name": "list_contacts", "arguments": {}}<|/tool_call|>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
    }

    #[test]
    fn test_parse_no_tool_calls() {
        let response = "Here's your answer: the birthday party was great!";

        let parsed = parse_tool_calls(response).unwrap();
        assert!(!parsed.has_tool_calls);
        assert!(parsed.tool_calls.is_empty());
        assert_eq!(parsed.text_before, response);
    }

    #[test]
    fn test_parse_multiple_tool_calls() {
        let response = r#"<|tool_call|>[{"name": "list_contacts", "arguments": {}}, {"name": "search_messages", "arguments": {"query": "test"}}]<|/tool_call|>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert_eq!(parsed.tool_calls.len(), 2);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
        assert_eq!(parsed.tool_calls[1].name, "search_messages");
    }

    #[test]
    fn test_format_tool_response() {
        let result = serde_json::json!({"contacts": [{"name": "Alice", "count": 100}]});
        let formatted = format_tool_response(&result);
        assert!(formatted.starts_with("<tool_response>"));
        assert!(formatted.ends_with("</tool_response>"));
        assert!(formatted.contains("Alice"));
    }

    #[test]
    fn test_parse_bare_json_tool_call() {
        // Bare JSON format (fallback parser)
        let response = r#"I'll search for vacation messages.
[{"name": "search_messages", "parameters": {"query": "vacation recommendations"}}]"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect bare JSON tool calls");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "vacation recommendations");
        assert_eq!(parsed.text_before, "I'll search for vacation messages.");
    }

    #[test]
    fn test_parse_bare_json_with_special_tokens() {
        // Models sometimes include special tokens after tool calls
        let response = r#"Let me search for that.
[{"name": "search_messages", "parameters": {"query": "birthday"}}]<|end|><|assistant|>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(
            parsed.has_tool_calls,
            "Should detect tool calls even with trailing tokens"
        );
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
    }

    #[test]
    fn test_clean_special_tokens() {
        let response = "Hello there<|end|><|assistant|>";
        let cleaned = clean_special_tokens(response);
        assert_eq!(cleaned, "Hello there");
    }

    #[test]
    fn test_parse_markdown_code_block_tool_call() {
        // Models sometimes wrap tool calls in markdown code blocks
        let response = r#"```json
[{"name": "list_contacts", "parameters": {"limit": 10}}]
```"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(
            parsed.has_tool_calls,
            "Should detect tool calls in markdown code blocks"
        );
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
    }

    #[test]
    fn test_parse_markdown_with_hallucination() {
        // Model generates tool call then continues with fake response
        let response = r#"```json
[{"name": "list_contacts", "parameters": {"limit": 1}}]
```
I've received the data. Alex Smith has 120 messages."#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(
            parsed.has_tool_calls,
            "Should detect tool call despite hallucinated content"
        );
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
    }

    #[test]
    fn test_parameters_vs_arguments_compatibility() {
        // Test that both "parameters" and "arguments" work
        let with_params = r#"[{"name": "test", "parameters": {"foo": "bar"}}]"#;
        let with_args = r#"[{"name": "test", "arguments": {"foo": "bar"}}]"#;

        let parsed_params = parse_tool_calls(with_params).unwrap();
        let parsed_args = parse_tool_calls(with_args).unwrap();

        assert_eq!(parsed_params.tool_calls[0].arguments["foo"], "bar");
        assert_eq!(parsed_args.tool_calls[0].arguments["foo"], "bar");
    }

    #[test]
    fn test_clean_answer_text() {
        // Test cleaning up leaked instructions
        let messy = "You text Alice the most.Switching to ANSWER MODE. Alice has 5000 messages.";
        let cleaned = clean_answer_text(messy);
        assert_eq!(cleaned, "You text Alice the most. Alice has 5000 messages.");

        // Test removing trailing JSON tool calls
        let with_json = "Alice is your top contact.[{\"name\":\"get_context\",\"arguments\":{}}]";
        let cleaned = clean_answer_text(with_json);
        assert_eq!(cleaned, "Alice is your top contact.");

        // Test that newlines are preserved (critical for markdown rendering)
        let markdown =
            "Here are the results:\n\n1. **Alice**: Found 5 messages\n2. **Bob**: Found 3 messages\n\nLet me know!";
        let cleaned = clean_answer_text(markdown);
        assert!(cleaned.contains('\n'), "newlines should be preserved for markdown");
        assert!(
            cleaned.contains("1. **Alice**"),
            "markdown list structure should be preserved"
        );
        assert!(cleaned.contains("2. **Bob**"), "second list item should be preserved");

        // Test that excessive newlines are collapsed
        let too_many = "Hello\n\n\n\n\nWorld";
        let cleaned = clean_answer_text(too_many);
        assert_eq!(cleaned, "Hello\n\nWorld");
    }

    #[test]
    fn test_parse_qwen3_tool_call() {
        // Qwen3 uses <tool_call>...</tool_call> format
        let response = r#"I'll search for that information.
<tool_call>
{"name": "search_messages", "arguments": {"query": "birthday party"}}
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect Qwen3 tool calls");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "birthday party");
        assert_eq!(parsed.text_before, "I'll search for that information.");
    }

    #[test]
    fn test_parse_qwen3_with_think_block() {
        // Qwen3 outputs <think>...</think> blocks before tool calls
        let response = r#"<think>
The user wants to know who they text the most. I should use list_contacts.
</think>

<tool_call>
{
  "function": "list_contacts",
  "parameters": {
    "limit": 20
  }
}
<tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect tool call with think block");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
        assert_eq!(parsed.tool_calls[0].arguments["limit"], 20);
        // The think block should be stripped from text_before
        assert!(!parsed.text_before.contains("<think>"));
    }

    #[test]
    fn test_parse_think_block_then_tool_call_stop_sequence_stripped() {
        // Reproduces exact model output when </tool_call> stop sequence strips the closing tag.
        // This is the pattern that caused empty arguments in production.
        let response = "<think>\nThe user is asking about the last party they went to. I need to search for messages related to parties.\n\nLet me start by searching for messages about parties using relevant keywords like \"party\", \"celebration\", or gathering.\n</think>\n\n<tool_call>\n{\"name\": \"search_messages\", \"arguments\": {\"query\": \"party celebration gathering\"}}\n";

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect tool call after think block");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(
            parsed.tool_calls[0].arguments["query"], "party celebration gathering",
            "Arguments should be parsed correctly even without closing </tool_call> tag"
        );
        assert!(parsed.thinking.is_some(), "Should extract thinking content");
    }

    #[test]
    fn test_parse_qwen3_function_key() {
        // Qwen3 uses "function" instead of "name"
        let response = r#"<tool_call>
{"function": "get_contact_stats", "parameters": {"contact_id": "+1234567890"}}
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls[0].name, "get_contact_stats");
        assert_eq!(parsed.tool_calls[0].arguments["contact_id"], "+1234567890");
    }

    #[test]
    fn test_parse_qwen3_multiple_tool_calls() {
        // Qwen3 can output multiple separate tool_call blocks
        let response = r#"<tool_call>
{"name": "list_contacts", "arguments": {}}
</tool_call>
<tool_call>
{"name": "get_contact_stats", "arguments": {"contact_id": "+1234567890"}}
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect multiple Qwen3 tool calls");
        assert_eq!(parsed.tool_calls.len(), 2);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
        assert_eq!(parsed.tool_calls[1].name, "get_contact_stats");
    }

    #[test]
    fn test_parse_qwen3_tool_call_no_closing_tag() {
        // When stop sequences truncate generation before </tool_call>
        let response = r#"<think>

</think>

I'll help you find out where you last went to dinner.
<tool_call>
{
  "function": "search_messages",
  "parameters": {
    "query": "dinner, restaurant, eat out"
  }
}
"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect tool call without closing tag");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
    }

    #[test]
    fn test_parse_qwen3_think_instead_of_tool_call_close() {
        // Model outputs </think> instead of </tool_call> (Qwen3 quirk)
        let response = r#"<think>

</think>

<tool_call>
{
  "function": "search_messages",
  "parameters": {
    "query": "restaurants",
    "min_date": "2025-06-06"
  }
}
</think>

<tool_call>
{
  "function": "search_messages",
  "parameters": {
    "query": "restaurants",
    "min_date": "2025-06-06"
  }
}
</think>

<tool_call>
{
  "function": "search_messages",
  "parameters": {
    "query": "restaurants",
    "min_date": "2025-06-06"
  }
}
"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect tool calls despite </think> tags");
        // Should deduplicate: 3 identical calls -> 1
        assert_eq!(parsed.tool_calls.len(), 1, "Should deduplicate identical tool calls");
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "restaurants");
    }

    #[test]
    fn test_parse_qwen3_tool_response_closing_tag() {
        // Qwen3 sometimes outputs </tool_response> instead of </tool_call>
        let response = r#"<think>
I need to search for messages about dinner.
</think>

<tool_call>
{
  "function": "search_messages",
  "parameters": {
    "query": "dinner plans"
  }
}
</tool_response>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(
            parsed.has_tool_calls,
            "Should detect tool call with </tool_response> closing tag"
        );
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "dinner plans");
    }

    #[test]
    fn test_parse_nested_function_format() {
        // Qwen3 sometimes outputs a nested format where "function" is an object
        // containing "name" and "parameters" instead of a flat structure.
        let response = r#"<tool_call>
{"function": {"name": "search_messages", "parameters": {"query": "romantic terms", "contact_id": "Riley Chen"}}}
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect nested function tool call");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "romantic terms");
        assert_eq!(parsed.tool_calls[0].arguments["contact_id"], "Riley Chen");
    }

    #[test]
    fn test_parse_nested_function_with_arguments() {
        // Nested format using "arguments" key instead of "parameters"
        let response = r#"<tool_call>
{"function": {"name": "get_contact_stats", "arguments": {"contact_id": "+15551234567"}}}
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "get_contact_stats");
        assert_eq!(parsed.tool_calls[0].arguments["contact_id"], "+15551234567");
    }

    #[test]
    fn test_parse_nested_function_in_array() {
        // Nested format inside a JSON array (bare JSON path)
        let response = r#"[{"function": {"name": "list_contacts", "parameters": {"limit": 10}}}]"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect nested function in array");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
    }

    #[test]
    fn test_fix_incomplete_json() {
        // Test fixing unclosed brackets
        let incomplete = r#"[{"name": "test", "arguments": {"foo": "bar"}"#;
        let fixed = fix_incomplete_json(incomplete);
        assert!(fixed.ends_with("}]"));

        // Verify it parses after fixing
        let parsed: std::result::Result<serde_json::Value, _> = serde_json::from_str(&fixed);
        assert!(parsed.is_ok(), "Fixed JSON should parse: {}", fixed);
    }

    #[test]
    fn test_parse_qwen35_xml_tool_call() {
        // Qwen3.5 native XML format
        let response = r#"<tool_call>
<function=search_messages>
<parameter=query>
dinner restaurant
</parameter>
</function>
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect Qwen3.5 XML tool calls");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "dinner restaurant");
    }

    #[test]
    fn test_parse_qwen35_xml_with_think_block() {
        // Qwen3.5 with thinking before tool call
        let response = r#"<think>
The user wants to find where they went to dinner. I should search their messages.
</think>

<tool_call>
<function=search_messages>
<parameter=query>
dinner restaurant
</parameter>
<parameter=limit>
10
</parameter>
</function>
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls, "Should detect XML tool call with think block");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "dinner restaurant");
        assert_eq!(parsed.tool_calls[0].arguments["limit"], 10);
        assert!(parsed.thinking.is_some(), "Should extract thinking content");
    }

    #[test]
    fn test_parse_qwen35_xml_multiple_params() {
        let response = r#"<tool_call>
<function=search_messages>
<parameter=query>
vacation plans
</parameter>
<parameter=min_date>
2025-01-01
</parameter>
<parameter=max_date>
2025-12-31
</parameter>
</function>
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "vacation plans");
        assert_eq!(parsed.tool_calls[0].arguments["min_date"], "2025-01-01");
        assert_eq!(parsed.tool_calls[0].arguments["max_date"], "2025-12-31");
    }

    #[test]
    fn test_parse_qwen35_xml_no_params() {
        let response = r#"<tool_call>
<function=list_contacts>
</function>
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls[0].name, "list_contacts");
        assert!(parsed.tool_calls[0].arguments.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_parse_qwen35_xml_with_text_before() {
        let response = r#"Let me search for that.

<tool_call>
<function=search_messages>
<parameter=query>
birthday party
</parameter>
</function>
</tool_call>"#;

        let parsed = parse_tool_calls(response).unwrap();
        assert!(parsed.has_tool_calls);
        assert_eq!(parsed.tool_calls[0].name, "search_messages");
        assert_eq!(parsed.text_before, "Let me search for that.");
    }

    #[test]
    fn test_format_tool_calls_xml() {
        let calls = vec![ToolCall {
            name: "search_messages".to_string(),
            arguments: serde_json::json!({"query": "dinner", "limit": 5}),
        }];

        let xml = format_tool_calls_xml(&calls);
        assert!(xml.contains("<tool_call>"));
        assert!(xml.contains("<function=search_messages>"));
        assert!(xml.contains("<parameter=query>"));
        assert!(xml.contains("dinner"));
        assert!(xml.contains("</function>"));
        assert!(xml.contains("</tool_call>"));
    }
}

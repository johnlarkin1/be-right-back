//! Tool trait and registry for Casper agent.
//!
//! This module provides the core abstraction for agent tools:
//! - `Tool` trait for implementing tools
//! - `ToolRegistry` for managing available tools
//! - `ToolCall` and `ToolResult` types for tool execution

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

use crate::error::Result;

/// A tool that the agent can call.
///
/// Implement this trait to create new tools for the Casper agent.
pub trait Tool: Send + Sync {
    /// The name of the tool (used in tool calls).
    fn name(&self) -> &'static str;

    /// Human-readable description of what the tool does.
    fn description(&self) -> &'static str;

    /// JSON Schema for the tool's parameters.
    ///
    /// Should return an object with "type": "object", "properties": {...}, "required": [...]
    fn parameters(&self) -> Value;

    /// Execute the tool with the given arguments.
    ///
    /// Arguments are parsed from the LLM's tool call.
    fn execute(&self, args: Value) -> Result<ToolResult>;
}

/// Result of a tool execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// Whether the tool executed successfully.
    pub success: bool,
    /// The tool's output data (returned to the LLM).
    pub data: Value,
    /// Optional error message if success is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolResult {
    /// Create a successful result with data.
    pub fn success(data: Value) -> Self {
        Self {
            success: true,
            data,
            error: None,
        }
    }

    /// Create a failed result with an error message.
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            data: Value::Null,
            error: Some(message.into()),
        }
    }
}

/// A parsed tool call from the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// The name of the tool to call.
    pub name: String,
    /// The arguments to pass to the tool.
    pub arguments: Value,
}

/// Record of a tool call and its result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    /// The tool that was called.
    pub tool_name: String,
    /// Arguments passed to the tool.
    pub arguments: Value,
    /// Result returned by the tool.
    pub result: ToolResult,
    /// How long the tool took to execute (milliseconds).
    pub duration_ms: u64,
}

/// Registry of available tools.
///
/// The registry holds all tools that the agent can use and provides
/// methods for formatting tool definitions for the LLM.
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    /// Create an empty tool registry.
    pub fn new() -> Self {
        Self { tools: HashMap::new() }
    }

    /// Register a tool with the registry.
    pub fn register(&mut self, tool: impl Tool + 'static) {
        let name = tool.name().to_string();
        self.tools.insert(name, Arc::new(tool));
    }

    /// Get a tool by name.
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    /// Get all registered tool names.
    pub fn tool_names(&self) -> Vec<&str> {
        self.tools.keys().map(|s| s.as_str()).collect()
    }

    /// Check if a tool is registered.
    pub fn has_tool(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    /// Get the number of registered tools.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Check if the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Format tools for Qwen3 system prompt.
    ///
    /// Returns tools in OpenAI function calling format (standard JSON Schema).
    /// Qwen3 natively supports this format without conversion.
    pub fn format_for_qwen3(&self) -> Value {
        let tools: Vec<Value> = self
            .tools
            .values()
            .map(|tool| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": tool.name(),
                        "description": tool.description(),
                        "parameters": tool.parameters()  // Standard JSON Schema - no conversion needed
                    }
                })
            })
            .collect();

        Value::Array(tools)
    }

    /// Execute a tool call.
    ///
    /// Returns the tool result or an error if the tool is not found.
    pub fn execute(&self, call: &ToolCall) -> Result<ToolResult> {
        match self.get(&call.name) {
            Some(tool) => tool.execute(call.arguments.clone()),
            None => Ok(ToolResult::error(format!("unknown tool: {}", call.name))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockTool;

    impl Tool for MockTool {
        fn name(&self) -> &'static str {
            "mock_tool"
        }

        fn description(&self) -> &'static str {
            "A mock tool for testing"
        }

        fn parameters(&self) -> Value {
            serde_json::json!({
                "type": "object",
                "properties": {
                    "input": {
                        "type": "string",
                        "description": "Input text"
                    }
                },
                "required": ["input"]
            })
        }

        fn execute(&self, args: Value) -> Result<ToolResult> {
            let input = args.get("input").and_then(|v| v.as_str()).unwrap_or("default");
            Ok(ToolResult::success(serde_json::json!({
                "output": format!("processed: {}", input)
            })))
        }
    }

    #[test]
    fn test_tool_registry() {
        let mut registry = ToolRegistry::new();
        assert!(registry.is_empty());

        registry.register(MockTool);
        assert_eq!(registry.len(), 1);
        assert!(registry.has_tool("mock_tool"));
        assert!(!registry.has_tool("unknown"));
    }

    #[test]
    fn test_tool_execution() {
        let mut registry = ToolRegistry::new();
        registry.register(MockTool);

        let call = ToolCall {
            name: "mock_tool".to_string(),
            arguments: serde_json::json!({"input": "test"}),
        };

        let result = registry.execute(&call).unwrap();
        assert!(result.success);
        assert_eq!(result.data["output"], "processed: test");
    }
}

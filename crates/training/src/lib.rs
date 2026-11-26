/// Training pipeline for Be Right Back
///
/// This crate handles all training-related functionality:
/// - JSONL export for training data
/// - Persona statistics calculation
/// - LLM-based personality analysis
/// - System prompt generation
/// - Training orchestration
///
/// Note: Python environment management has been moved to `common::PythonEnvironment`.
pub mod constants;
pub mod export;

// Re-export key functionality
pub use export::{
    ConversationBlock, SampledMessage, analyze_persona_with_llm, build_fallback_prompt, build_system_prompt,
    calculate_persona_stats, export_self_to_jsonl, sample_conversation_blocks, sample_self_blocks,
};

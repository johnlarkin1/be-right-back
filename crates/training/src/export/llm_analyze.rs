/// LLM-based personality analysis via Python bridge
use crate::export::sampling::ConversationBlock;
use common::{PythonEnvironment, Result, SELF_PERSONA_ID, scripts};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use tracing::{debug, info, warn};

/// Input format matching the Python `analyze_persona.py` two-phase protocol.
///
/// The Python script expects `phase1_conversation_blocks` (quote extraction)
/// and `phase2_conversation_blocks` (personality synthesis). We send the same
/// sampled blocks to both phases for simplicity.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnalysisInput {
    contact_id: String,
    contact_name: String,
    phase1_conversation_blocks: Vec<ConversationBlock>,
    phase2_conversation_blocks: Vec<ConversationBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnalysisOutput {
    success: bool,
    personality_description: Option<String>,
    error: Option<String>,
}

/// Run LLM-based self-analysis of the user's own messages using Qwen3.5.
///
/// Calls a Python script that:
/// 1. Loads a Qwen3.5 base model (no fine-tuning)
/// 2. Analyzes the user's messages in the conversation blocks (self-analysis mode)
/// 3. Returns personality insights as natural language, in the second person
///
/// # Arguments
/// * `conversation_blocks` - Sampled exchanges, usually from `sample_self_blocks`
///
/// # Returns
/// Personality description string or None if analysis fails
///
/// # Graceful Fallback
/// If Python environment is unavailable or analysis fails, returns None
/// (caller should use fallback prompt)
pub fn analyze_persona_with_llm(conversation_blocks: Vec<ConversationBlock>) -> Result<Option<String>> {
    info!(
        blocks_count = conversation_blocks.len(),
        "Starting LLM-based personality analysis"
    );

    // Get Python environment
    let env = match PythonEnvironment::get() {
        Ok(env) => env,
        Err(e) => {
            warn!(error = %e, "Python environment not found, skipping LLM analysis");
            return Ok(None);
        }
    };

    let python_executable = &env.python_bin;
    let script_path = env.script(scripts::ANALYZE_PERSONA);

    if !script_path.exists() {
        warn!(
            script_path = ?script_path,
            "Analysis script not found, skipping LLM analysis"
        );
        return Ok(None);
    }

    // Prepare input -- send the same blocks to both phases
    // contact_id "you" routes the Python script to its self-analysis prompts
    let input = AnalysisInput {
        contact_id: SELF_PERSONA_ID.to_string(),
        contact_name: "You".to_string(),
        phase1_conversation_blocks: conversation_blocks.clone(),
        phase2_conversation_blocks: conversation_blocks,
    };

    let input_json = match serde_json::to_string(&input) {
        Ok(json) => json,
        Err(e) => {
            warn!(error = %e, "Failed to serialize analysis input");
            return Ok(None);
        }
    };

    debug!(
        python = ?python_executable,
        script = ?script_path,
        input_size = input_json.len(),
        "Calling Python analysis script"
    );

    // Call Python script with timeout
    match call_python_script(python_executable, &script_path, &input_json) {
        Ok(output) => {
            if output.success {
                info!("LLM analysis completed successfully");
                Ok(output.personality_description)
            } else {
                warn!(
                    error = ?output.error,
                    "Python script returned error"
                );
                Ok(None)
            }
        }
        Err(e) => {
            warn!(error = %e, "Failed to run Python analysis script");
            Ok(None) // Graceful fallback
        }
    }
}

/// Call Python script with input via stdin, read output from stdout
fn call_python_script(python_path: &PathBuf, script_path: &PathBuf, input_json: &str) -> Result<AnalysisOutput> {
    let mut child = Command::new(python_path)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Write input to stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input_json.as_bytes())?;
        // Drop stdin to signal EOF
    }

    // Wait for process with timeout (5 minutes for LLM generation)
    let output = wait_with_timeout(child, Duration::from_secs(300))?;

    // Parse output
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(stderr = %stderr, "Python script failed");
        return Ok(AnalysisOutput {
            success: false,
            personality_description: None,
            error: Some(stderr.to_string()),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    debug!(output_size = stdout.len(), "Received output from Python");

    // Parse JSON output
    let result: AnalysisOutput = serde_json::from_str(&stdout).map_err(|e| {
        warn!(error = %e, stdout = %stdout, "Failed to parse Python output");
        common::BrbError::Serialization(format!("failed to parse python output: {}", e))
    })?;

    Ok(result)
}

/// Wait for child process with timeout
fn wait_with_timeout(mut child: std::process::Child, timeout: Duration) -> Result<std::process::Output> {
    use std::thread;
    use std::time::Instant;

    let start = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Process finished
                let stdout = {
                    let mut buf = Vec::new();
                    if let Some(mut out) = child.stdout.take() {
                        std::io::Read::read_to_end(&mut out, &mut buf).ok();
                    }
                    buf
                };
                let stderr = {
                    let mut buf = Vec::new();
                    if let Some(mut err) = child.stderr.take() {
                        std::io::Read::read_to_end(&mut err, &mut buf).ok();
                    }
                    buf
                };
                return Ok(std::process::Output { status, stdout, stderr });
            }
            Ok(None) => {
                // Still running, check timeout
                if start.elapsed() > timeout {
                    warn!("Python script timed out after {:?}", timeout);
                    child.kill().ok();
                    return Err(common::BrbError::InvalidData("python script timed out".to_string()));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                return Err(common::BrbError::Io(e));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_script_name_constant() {
        // Verify the script name constant is what we expect
        assert_eq!(scripts::ANALYZE_PERSONA, "analyze_persona.py");
    }

    #[test]
    fn test_analysis_input_serialization() {
        use crate::export::sampling::SampledMessage;

        let block = ConversationBlock {
            messages: vec![SampledMessage {
                role: "user".to_string(),
                content: "Hello!".to_string(),
                timestamp: "2024-01-01 12:00".to_string(),
            }],
            start_time: "2024-01-01 12:00".to_string(),
            message_count: 1,
            contact_name: Some("Alice".to_string()),
        };

        let input = AnalysisInput {
            contact_id: SELF_PERSONA_ID.to_string(),
            contact_name: "You".to_string(),
            phase1_conversation_blocks: vec![block.clone()],
            phase2_conversation_blocks: vec![block],
        };

        let json = serde_json::to_string(&input);
        assert!(json.is_ok());
    }

    #[test]
    fn test_analysis_output_deserialization() {
        let json = r#"{
            "success": true,
            "personality_description": "Friendly and casual",
            "error": null
        }"#;

        let output: std::result::Result<AnalysisOutput, _> = serde_json::from_str(json);
        assert!(output.is_ok());

        let output = output.unwrap();
        assert!(output.success);
        assert_eq!(output.personality_description, Some("Friendly and casual".to_string()));
    }
}

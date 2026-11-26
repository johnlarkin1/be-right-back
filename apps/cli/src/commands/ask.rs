//! Ask Casper about your message history.
//!
//! This command uses the Casper agent to search and analyze your iMessage history.

use common::Result;
use inference::agent::{AgentConfig, CasperAgent};
use inference::engines::mlx_python::MLXPythonEngine;
use inference::traits::AsyncInferenceEngineBackend;
use tracing::{debug, info};

/// Handle the ask command.
///
/// Spawns an MLX Python daemon, creates a Casper agent, and runs the agent loop.
pub fn handle_ask(question: &str, verbose: bool, max_iterations: usize) -> Result<()> {
    info!(question = question, "Starting Casper agent");

    // Create a tokio runtime for async operations
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| common::BrbError::PythonError(format!("failed to create runtime: {e}")))?;

    rt.block_on(async { run_agent(question, verbose, max_iterations).await })
}

async fn run_agent(question: &str, verbose: bool, max_iterations: usize) -> Result<()> {
    println!("Initializing Casper agent...");

    // Try socket mode first (connects to shared daemon), fall back to pipe mode
    debug!("Attempting socket connection to agent daemon");
    let engine = match MLXPythonEngine::connect_for_agent().await {
        Ok(engine) => {
            debug!("Connected to agent daemon via socket");
            engine
        }
        Err(e) => {
            debug!("Socket mode failed ({e}), falling back to pipe mode");
            MLXPythonEngine::spawn_for_agent()
                .map_err(|e| common::BrbError::PythonError(format!("failed to spawn MLX engine: {e}")))?
        }
    };

    let is_socket = engine.is_socket_mode();

    // Create the agent with configuration
    let config = AgentConfig::default().with_max_iterations(max_iterations);
    let mut agent = CasperAgent::with_engine(config, engine)
        .map_err(|e| common::BrbError::PythonError(format!("failed to create agent: {e}")))?;

    println!("Thinking...\n");

    // Run the agent
    let response = agent
        .ask(question)
        .await
        .map_err(|e| common::BrbError::PythonError(format!("agent error: {e}")))?;

    // Display results
    if verbose {
        println!("--- Tool Calls ---");
        for (i, tc) in response.tool_calls.iter().enumerate() {
            println!("{}. {} ({}ms)", i + 1, tc.tool_name, tc.duration_ms);
            if let Some(ref err) = tc.result.error {
                println!("   Error: {}", err);
            }
        }
        println!("\n--- Response ---");
    }

    // Print the answer
    println!("{}", response.answer);

    if verbose {
        println!("\n--- Stats ---");
        println!("Iterations: {}", response.iterations);
        println!("Duration: {}ms", response.duration_ms);
        println!("Tool calls: {}", response.tool_calls.len());
    }

    // Shutdown the engine (in socket mode, just closes connection; daemon keeps running)
    if let Some(mut engine) = agent.take_engine() {
        if !is_socket {
            debug!("Shutting down MLX Python engine (pipe mode)");
        }
        let _ = engine.shutdown().await;
    }

    Ok(())
}

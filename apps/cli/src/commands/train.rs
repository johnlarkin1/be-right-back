/// Train the "You" persona from exported training data
use common::{BrbError, PythonEnvironment, Result, SELF_PERSONA_ID, get_brb_dir, scripts};
use std::process::{Command, Stdio};
use tracing::info;

#[allow(clippy::too_many_arguments)]
pub fn handle_train(
    base_model: &str,
    max_steps: usize,
    learning_rate: f64,
    batch_size: usize,
    lora_rank: usize,
    lora_alpha: usize,
    save_every: usize,
) -> Result<()> {
    info!("Training the \"You\" persona");

    // Resolve data directory
    let brb_dir = get_brb_dir()?;
    let data_dir = brb_dir.join("data/processed").join(SELF_PERSONA_ID);

    if !data_dir.exists() {
        return Err(BrbError::NotFound(format!(
            "No exported data found at {}\n\
             Run 'brb export' first",
            data_dir.display()
        )));
    }

    info!("Using data directory: {}", data_dir.display());

    // Get Python environment
    let env = PythonEnvironment::get()?;
    let venv_python = &env.python_bin;
    let train_script = env.script(scripts::TRAIN);

    if !train_script.exists() {
        return Err(BrbError::NotFound(format!(
            "Training script not found at {}\n\
             Make sure you're running this from the project root",
            train_script.display()
        )));
    }

    info!("Using Python: {}", venv_python.display());

    info!("Starting training with:");
    info!("  Base model: {}", base_model);
    info!("  Max steps: {}", max_steps);
    info!("  Learning rate: {}", learning_rate);
    info!("  Batch size: {}", batch_size);
    info!("  LoRA rank: {}", lora_rank);
    info!("  LoRA alpha: {}", lora_alpha);
    info!("  Save every: {} steps", save_every);
    println!();

    // Build Python command
    let mut cmd = Command::new(venv_python);
    cmd.arg(train_script.to_str().unwrap())
        .arg("--data")
        .arg(data_dir.to_str().unwrap())
        .arg("--base-model")
        .arg(base_model)
        .arg("--max-steps")
        .arg(max_steps.to_string())
        .arg("--learning-rate")
        .arg(learning_rate.to_string())
        .arg("--batch-size")
        .arg(batch_size.to_string())
        .arg("--lora-rank")
        .arg(lora_rank.to_string())
        .arg("--lora-alpha")
        .arg(lora_alpha.to_string())
        .arg("--save-every")
        .arg(save_every.to_string())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    info!("Running: {:?}", cmd);
    println!();
    println!("Training in progress...");
    println!("─────────────────────────────────────────────────────────────");
    println!();

    // Execute training
    let status = cmd
        .status()
        .map_err(|e| BrbError::PythonError(format!("failed to execute training script: {}", e)))?;

    println!();
    println!("─────────────────────────────────────────────────────────────");

    if status.success() {
        println!();
        println!("✓ Training completed successfully!");
        println!();
        println!("Next step: chat with \"You\" in the desktop app.");
        Ok(())
    } else {
        Err(BrbError::PythonError(format!(
            "Training failed with exit code: {}",
            status.code().unwrap_or(-1)
        )))
    }
}

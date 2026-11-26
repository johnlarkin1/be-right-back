use crate::commands::stats::handle_stats;
use common::{Result, get_stats_contact_dir};
use std::process::Command;
use tracing::info;

/// Handle the 'visualize' command - generate visualizations for a conversation
pub fn handle_visualize(contact_id: &str, output_dir: Option<String>) -> Result<()> {
    info!(?contact_id, "Generating visualizations");

    // First, run stats to ensure we have the distribution JSON
    info!("Computing stats to generate distribution JSON");
    handle_stats(contact_id, false)?;

    // Determine output directory (per-contact stats directory)
    let output_dir_path = if let Some(dir) = output_dir {
        std::path::PathBuf::from(dir)
    } else {
        get_stats_contact_dir(contact_id)?
    };

    // Get the distribution JSON path
    let dist_json = output_dir_path.join("distribution.json");

    if !dist_json.exists() {
        return Err(common::BrbError::NotFound(format!(
            "Distribution JSON not found: {}",
            dist_json.display()
        )));
    }

    // Find project root (where scripts/ directory is located)
    let project_root = std::env::current_dir()?
        .ancestors()
        .find(|p| p.join("scripts").join("dev").join("visualize.py").exists())
        .ok_or_else(|| common::BrbError::NotFound("Could not find scripts/dev/visualize.py".to_string()))?
        .to_path_buf();

    let visualize_script = project_root.join("scripts/dev/visualize.py");

    info!(?visualize_script, "Found visualization script");

    // Check if uv is available
    let uv_check = Command::new("uv").arg("--version").output();
    if uv_check.is_err() {
        return Err(common::BrbError::InvalidData(
            "uv not found. Please install uv: curl -LsSf https://astral.sh/uv/install.sh | sh".to_string(),
        ));
    }

    info!("Checking uv dependencies");

    // Sync dependencies
    let sync_output = Command::new("uv")
        .arg("sync")
        .current_dir(project_root.join("scripts/dev"))
        .output()?;

    if !sync_output.status.success() {
        let stderr = String::from_utf8_lossy(&sync_output.stderr);
        return Err(common::BrbError::InvalidData(format!(
            "Failed to sync uv dependencies: {}",
            stderr
        )));
    }

    info!("Running visualization script");

    // Run the visualization script
    let output = Command::new("uv")
        .arg("run")
        .arg("python")
        .arg(&visualize_script)
        .arg("--stats-json")
        .arg(&dist_json)
        .arg("--output-dir")
        .arg(&output_dir_path)
        .arg("--contact-id")
        .arg(contact_id)
        .current_dir(project_root.join("scripts/dev"))
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(common::BrbError::InvalidData(format!(
            "Visualization script failed: {}",
            stderr
        )));
    }

    // Print stdout from Python script
    let stdout = String::from_utf8_lossy(&output.stdout);
    println!("{}", stdout);

    Ok(())
}

use std::process::Command;

fn main() {
    // re-run if scripts or training scripts change
    println!("cargo:rerun-if-changed=scripts/");
    println!("cargo:rerun-if-changed=../../../../mlx/");

    // Only prepare bundled resources for release builds to avoid circular dev rebuild loops
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());

    if profile == "release" {
        // download Python (if not already downloaded)
        let python_status = Command::new("sh")
            .arg("scripts/download-python.sh")
            .status()
            .expect("Failed to run download-python.sh");

        if !python_status.success() {
            panic!("download-python.sh failed");
        }

        // download uv (if not already downloaded)
        let uv_status = Command::new("sh")
            .arg("scripts/download-uv.sh")
            .status()
            .expect("Failed to run download-uv.sh");

        if !uv_status.success() {
            panic!("download-uv.sh failed");
        }

        // copy training scripts from repo root
        let copy_status = Command::new("sh")
            .arg("scripts/copy-mlx.sh")
            .status()
            .expect("Failed to run copy-mlx.sh");

        if !copy_status.success() {
            panic!("copy-training.sh failed");
        }

        println!("resources prepared for bundling");
    } else {
        println!("cargo:warning=Skipping resource bundling in dev mode. Run in release mode to bundle Python/training resources.");
    }

    // build the app
    tauri_build::build()
}

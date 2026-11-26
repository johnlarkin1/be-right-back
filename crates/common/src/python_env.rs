//! Unified Python environment management.
//!
//! Provides a single `PythonEnvironment` struct for accessing Python binaries and MLX scripts.
//! All code paths should use this module instead of hardcoding paths.
//!
//! ## Usage
//!
//! ```rust,ignore
//! use common::{PythonEnvironment, scripts};
//!
//! // Non-Tauri: Get paths (assumes venv exists)
//! let env = PythonEnvironment::get()?;
//! Command::new(&env.python_bin).arg(env.script(scripts::EMBED));
//!
//! // Tauri: Setup + get paths (creates venv if needed)
//! let env = PythonEnvironment::ensure(&app).await?;
//! ```

use crate::{BrbError, Result, get_brb_dir};
use std::path::{Path, PathBuf};

#[cfg(feature = "tauri-support")]
use std::fs;
#[cfg(feature = "tauri-support")]
use std::process::Command;
#[cfg(feature = "tauri-support")]
use tauri::{AppHandle, Emitter, Manager};

/// Script names for MLX entry points.
///
/// Use these constants instead of hardcoding script names.
pub mod scripts {
    /// Embedding generation script
    pub const EMBED: &str = "embed.py";
    /// Personality analysis script
    pub const ANALYZE_PERSONA: &str = "analyze_persona.py";
    /// Inference daemon script
    pub const INFERENCE_DAEMON: &str = "inference_daemon.py";
    /// Analytics pipeline script
    pub const ANALYTICS: &str = "analytics.py";
    /// Training script
    pub const TRAIN: &str = "train.py";
    /// Cross-encoder reranking script
    pub const RERANK: &str = "rerank.py";
    /// Standalone query embedding script
    pub const EMBED_QUERY: &str = "embed_query.py";
}

/// Payload for the `setup-progress` event.
///
/// Tagged rather than a bare string: the frontend previously decided the banner was finished by
/// comparing against the display copy ("Setup complete!"), which silently breaks if either side
/// edits the wording, and had no way at all to represent a failure.
#[cfg(feature = "tauri-support")]
#[derive(Debug, Clone, serde::Serialize)]
pub struct SetupProgress {
    /// `running` while work is in flight, `done` on success, `failed` on error.
    pub status: &'static str,
    /// Human-readable description of the current step, or the error on `failed`.
    pub message: String,
}

/// Unified Python environment for MLX operations.
///
/// Provides paths to the Python binary, MLX scripts directory, and utilities
/// for accessing specific scripts. All code should use this struct instead
/// of constructing paths manually.
#[derive(Debug, Clone)]
pub struct PythonEnvironment {
    /// Path to Python binary in venv (e.g., `~/.be-right-back/mlx-venv/bin/python3`)
    pub python_bin: PathBuf,
    /// Path to MLX scripts directory (e.g., `~/.be-right-back/mlx/src/entry` or dev path)
    pub scripts_dir: PathBuf,
    /// Path to MLX base directory (e.g., `~/.be-right-back/mlx`)
    pub mlx_dir: PathBuf,
}

impl PythonEnvironment {
    /// Get Python environment, assuming venv already exists.
    ///
    /// Use this in CLI, inference, ingestion - anywhere that's not doing first-time Tauri setup.
    /// Returns an error if the venv doesn't exist.
    ///
    /// # Errors
    ///
    /// Returns `BrbError::NotFound` if:
    /// - The Python venv doesn't exist at `~/.be-right-back/mlx-venv/bin/python3`
    /// - The MLX scripts directory can't be found
    pub fn get() -> Result<Self> {
        let brb_dir = get_brb_dir()?;
        let python_bin = brb_dir.join("mlx-venv/bin/python3");

        if !python_bin.exists() {
            return Err(BrbError::NotFound(
                "Python venv not found. Run: uv venv ~/.be-right-back/mlx-venv && uv pip install -e mlx".into(),
            ));
        }

        let mlx_dir = brb_dir.join("mlx");
        let scripts_dir = Self::find_scripts_dir(&mlx_dir)?;

        Ok(Self {
            python_bin,
            scripts_dir,
            mlx_dir,
        })
    }

    /// Get path to a script by name.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use common::{PythonEnvironment, scripts};
    ///
    /// let env = PythonEnvironment::get()?;
    /// let embed_script = env.script(scripts::EMBED);  // ~/.be-right-back/mlx/src/entry/embed.py
    /// ```
    pub fn script(&self, name: &str) -> PathBuf {
        self.scripts_dir.join(name)
    }

    /// Find scripts directory (bundled or dev mode).
    ///
    /// In dev builds, checks workspace source first for always-fresh scripts.
    /// In release builds, checks only the bundled location.
    fn find_scripts_dir(mlx_dir: &Path) -> Result<PathBuf> {
        // Dev mode: prefer workspace source so we always use the latest scripts
        #[cfg(debug_assertions)]
        {
            // CARGO_MANIFEST_DIR is crates/common, go up to workspace root
            let workspace_root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent() // crates/
                .and_then(|p| p.parent()); // be-right-back/

            if let Some(root) = workspace_root {
                let dev_path = root.join("mlx/src/entry");
                if dev_path.exists() {
                    return Ok(dev_path);
                }
            }
        }

        // Bundled location (production, or dev fallback)
        let bundled = mlx_dir.join("src/entry");
        if bundled.exists() {
            return Ok(bundled);
        }

        Err(BrbError::NotFound("MLX scripts directory not found".into()))
    }

    // ========== Tauri-only: Full environment setup ==========

    /// Ensures Python environment is ready, creating it if needed.
    ///
    /// This is the primary entry point for Tauri apps. It will:
    /// 1. Check if venv exists at `~/.be-right-back/mlx-venv/`
    /// 2. If not: extract bundled resources, create venv, install dependencies
    /// 3. If yes but deps changed: re-copy scripts and re-install dependencies
    /// 4. Return paths to Python binary and MLX scripts
    ///
    /// Use `PythonEnvironment::get()` for non-Tauri code that assumes the venv exists.
    #[cfg(feature = "tauri-support")]
    pub async fn ensure(app: &AppHandle) -> Result<Self> {
        let brb_dir = get_brb_dir()?;
        let mlx_dir = brb_dir.join("mlx");
        let venv_dir = brb_dir.join("mlx-venv");
        let python_bin = venv_dir.join("bin/python3");

        if python_bin.exists() {
            // Venv exists — check if bundled dependencies have changed since last install
            if Self::deps_changed(app, &mlx_dir)? {
                Self::report_failure(app, Self::update_environment(app, &mlx_dir, &venv_dir).await)?;
            } else {
                tracing::info!("Python environment already set up");
            }
            let scripts_dir = Self::find_scripts_dir(&mlx_dir)?;
            return Ok(Self {
                python_bin,
                scripts_dir,
                mlx_dir,
            });
        }

        // Need to create environment from scratch
        tracing::info!("Setting up Python environment for the first time...");
        Self::emit_setup(app, "running", "Extracting Python runtime...");

        Self::report_failure(app, Self::setup_environment(app, &mlx_dir, &venv_dir).await)?;

        let scripts_dir = mlx_dir.join("src/entry");
        Ok(Self {
            python_bin,
            scripts_dir,
            mlx_dir,
        })
    }

    /// Emit a `setup-progress` event. Delivery failures are ignored — the UI banner is
    /// advisory, and setup should not abort because a window went away.
    #[cfg(feature = "tauri-support")]
    fn emit_setup(app: &AppHandle, status: &'static str, message: impl Into<String>) {
        app.emit(
            "setup-progress",
            SetupProgress {
                status,
                message: message.into(),
            },
        )
        .ok();
    }

    /// Emit a terminal `failed` event before propagating a setup error.
    ///
    /// Every step in setup/update exits via `?`, so without this the last thing the UI ever
    /// heard was a `running` message and the spinner stayed up forever — the same "looks hung"
    /// symptom the setup banner was added to remove, just moved onto the failure path.
    #[cfg(feature = "tauri-support")]
    fn report_failure<T>(app: &AppHandle, result: Result<T>) -> Result<T> {
        if let Err(e) = &result {
            Self::emit_setup(app, "failed", format!("Python setup failed: {}", e));
        }
        result
    }

    /// Performs first-time setup of Python environment.
    #[cfg(feature = "tauri-support")]
    async fn setup_environment(app: &AppHandle, mlx_dir: &Path, venv_dir: &Path) -> Result<()> {
        // Create MLX directory
        fs::create_dir_all(mlx_dir)?;

        // Step 1: Extract bundled Python
        Self::emit_setup(app, "running", "Extracting Python runtime...");
        Self::extract_python(app, mlx_dir)?;

        // Step 2: Extract bundled uv
        Self::emit_setup(app, "running", "Extracting uv package manager...");
        Self::extract_uv(app, mlx_dir)?;

        // Step 3: Copy MLX scripts
        Self::emit_setup(app, "running", "Copying MLX scripts...");
        Self::copy_mlx_scripts(app, mlx_dir)?;

        // Step 4: Create virtual environment
        Self::emit_setup(app, "running", "Creating virtual environment...");
        Self::create_venv(mlx_dir, venv_dir)?;

        // Step 5: Install dependencies
        Self::emit_setup(
            app,
            "running",
            "Installing Python packages (this may take 2-3 minutes)...",
        );
        Self::install_dependencies(mlx_dir, venv_dir)?;

        // Step 6: Verify installation
        Self::emit_setup(app, "running", "Verifying installation...");
        Self::verify_installation(mlx_dir, venv_dir)?;

        Self::emit_setup(app, "done", "Setup complete!");

        tracing::info!("Python environment setup complete");
        Ok(())
    }

    /// Check if bundled pyproject.toml differs from the installed copy.
    ///
    /// Returns `true` if dependencies need updating (installed file missing or different).
    /// Returns `false` in dev mode or if bundled resources aren't available.
    #[cfg(feature = "tauri-support")]
    fn deps_changed(app: &AppHandle, mlx_dir: &Path) -> Result<bool> {
        let resource_dir = match app.path().resource_dir() {
            Ok(dir) => dir.join("resources/mlx"),
            Err(_) => return Ok(false), // Can't check (dev mode), assume OK
        };

        if !resource_dir.join("pyproject.toml").exists() {
            // Dev mode or resources not bundled — skip check
            return Ok(false);
        }

        Self::manifests_differ(&resource_dir, mlx_dir)
    }

    /// Compare the bundled and installed dependency manifests.
    ///
    /// uv.lock is checked as well as pyproject.toml: pinned upgrades routinely change only the
    /// lock, and missing those would leave users on stale versions after an app update. A
    /// manifest absent from the bundle is skipped rather than treated as a change, so a partial
    /// bundle cannot force a reinstall on every launch.
    ///
    /// Split out from `deps_changed` so it can be tested without an `AppHandle`.
    ///
    /// Its only runtime caller is behind `tauri-support`, so a build without that feature
    /// only reaches this function from the tests below — allow `dead_code` for that case.
    #[cfg_attr(not(feature = "tauri-support"), allow(dead_code))]
    fn manifests_differ(resource_dir: &Path, installed_dir: &Path) -> Result<bool> {
        for name in ["pyproject.toml", "uv.lock"] {
            let bundled = resource_dir.join(name);
            let installed = installed_dir.join(name);

            if !bundled.exists() {
                continue;
            }

            if !installed.exists() {
                tracing::info!(file = name, "installed dependency manifest missing, update needed");
                return Ok(true);
            }

            if std::fs::read(&bundled)? != std::fs::read(&installed)? {
                tracing::info!(file = name, "dependency manifest changed between app versions");
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Update an existing Python environment when dependencies have changed.
    ///
    /// Re-copies MLX scripts (including pyproject.toml) and re-installs dependencies
    /// without recreating the venv or re-extracting Python/uv binaries.
    #[cfg(feature = "tauri-support")]
    async fn update_environment(app: &AppHandle, mlx_dir: &Path, venv_dir: &Path) -> Result<()> {
        tracing::info!("Updating Python environment (dependencies changed)...");

        Self::emit_setup(app, "running", "Updating MLX scripts...");
        Self::copy_mlx_scripts(app, mlx_dir)?;

        Self::emit_setup(
            app,
            "running",
            "Updating Python packages (this may take a few minutes)...",
        );
        Self::install_dependencies(mlx_dir, venv_dir)?;

        Self::emit_setup(app, "running", "Verifying installation...");
        Self::verify_installation(mlx_dir, venv_dir)?;

        Self::emit_setup(app, "done", "Update complete!");
        tracing::info!("Python environment update complete");
        Ok(())
    }

    /// Extract bundled Python to `~/.be-right-back/mlx/bin/python/`
    #[cfg(feature = "tauri-support")]
    fn extract_python(app: &AppHandle, mlx_dir: &Path) -> Result<()> {
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| BrbError::PythonError(format!("could not find resource directory: {}", e)))?
            .join("resources/binaries/python");

        let dest_dir = mlx_dir.join("bin/python");

        if !resource_path.exists() {
            return Err(BrbError::NotFound(format!(
                "bundled Python not found at {:?}",
                resource_path
            )));
        }

        tracing::info!("Copying Python from {:?} to {:?}", resource_path, dest_dir);

        copy_dir_recursive(&resource_path, &dest_dir)?;

        tracing::info!("Python extracted successfully");
        Ok(())
    }

    /// Extract bundled uv to `~/.be-right-back/mlx/bin/uv`
    #[cfg(feature = "tauri-support")]
    fn extract_uv(app: &AppHandle, mlx_dir: &Path) -> Result<()> {
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| BrbError::PythonError(format!("could not find resource directory: {}", e)))?
            .join("resources/binaries/uv");

        let dest_path = mlx_dir.join("bin/uv");

        if !resource_path.exists() {
            return Err(BrbError::NotFound(format!(
                "bundled uv not found at {:?}",
                resource_path
            )));
        }

        tracing::info!("Copying uv from {:?} to {:?}", resource_path, dest_path);

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&resource_path, &dest_path)?;

        // Make executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&dest_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dest_path, perms)?;
        }

        tracing::info!("uv extracted successfully");
        Ok(())
    }

    /// Copy MLX scripts to `~/.be-right-back/mlx/`
    #[cfg(feature = "tauri-support")]
    fn copy_mlx_scripts(app: &AppHandle, mlx_dir: &Path) -> Result<()> {
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| BrbError::PythonError(format!("could not find resource directory: {}", e)))?
            .join("resources/mlx");

        if !resource_path.exists() {
            return Err(BrbError::NotFound(format!(
                "bundled MLX scripts not found at {:?}",
                resource_path
            )));
        }

        tracing::info!("Copying MLX scripts from {:?} to {:?}", resource_path, mlx_dir);

        copy_dir_recursive(&resource_path, mlx_dir)?;

        tracing::info!("MLX scripts copied successfully");
        Ok(())
    }

    /// Create virtual environment using bundled uv and Python.
    #[cfg(feature = "tauri-support")]
    fn create_venv(mlx_dir: &Path, venv_dir: &Path) -> Result<()> {
        let uv_bin = mlx_dir.join("bin/uv");
        let python_bin = mlx_dir.join("bin/python/bin/python3");

        tracing::info!(
            "Creating virtual environment: uv={:?}, python={:?}, venv={:?}",
            uv_bin,
            python_bin,
            venv_dir
        );

        let status = Command::new(&uv_bin)
            .arg("venv")
            .arg(venv_dir)
            .arg("--python")
            .arg(&python_bin)
            .status()
            .map_err(|e| BrbError::PythonError(format!("failed to run uv venv: {}", e)))?;

        if !status.success() {
            return Err(BrbError::PythonError("failed to create virtual environment".into()));
        }

        tracing::info!("Virtual environment created");
        Ok(())
    }

    /// Install Python dependencies using uv.
    ///
    /// Prefers `uv sync --frozen` against the bundled `uv.lock` so every install gets the exact
    /// versions the release was tested against. `uv pip install -e` re-resolves from scratch,
    /// which means users would silently receive whatever is newest on PyPI that day.
    ///
    /// Falls back to `uv pip install -e` only when no lock file was bundled.
    #[cfg(feature = "tauri-support")]
    fn install_dependencies(mlx_dir: &Path, venv_dir: &Path) -> Result<()> {
        let uv_bin = mlx_dir.join("bin/uv");
        let venv_python = venv_dir.join("bin/python3");
        let lock_file = mlx_dir.join("uv.lock");

        // No unpinned fallback. Silently resolving from PyPI would hand each user whatever was
        // newest that day instead of the versions the release was tested against -- and it would
        // do so behind a `warn!` in a log file nobody reads. copy-mlx.sh refuses to build a
        // bundle without the lock, so reaching this is a packaging bug worth surfacing.
        if !lock_file.exists() {
            return Err(BrbError::PythonError(format!(
                "no uv.lock at {} -- the app bundle is incomplete and dependency versions \
                 cannot be guaranteed. Reinstall Be Right Back.",
                lock_file.display()
            )));
        }

        tracing::info!("Installing pinned Python dependencies from uv.lock");
        let mut cmd = Command::new(&uv_bin);
        cmd.arg("sync")
            .arg("--frozen")
            .arg("--no-dev")
            .arg("--project")
            .arg(mlx_dir)
            .arg("--python")
            .arg(&venv_python)
            // uv would otherwise create its own .venv inside the project directory.
            .env("UV_PROJECT_ENVIRONMENT", venv_dir);

        // Capture rather than inherit: a Finder-launched .app has no usable stdout, so an
        // inherited stderr would discard the one message explaining why setup failed.
        let output = cmd
            .output()
            .map_err(|e| BrbError::PythonError(format!("failed to run uv: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(stderr = %stderr, "uv dependency install failed");
            return Err(BrbError::PythonError(format!(
                "failed to install Python dependencies: {}",
                stderr.trim()
            )));
        }

        tracing::info!("Dependencies installed successfully");
        Ok(())
    }

    /// Verify that MLX and other dependencies are importable.
    #[cfg(feature = "tauri-support")]
    fn verify_installation(mlx_dir: &Path, venv_dir: &Path) -> Result<()> {
        let python_bin = venv_dir.join("bin/python3");

        tracing::info!("Verifying installation...");

        let output = Command::new(&python_bin)
            .arg("-c")
            .arg("import mlx; import mlx_lm; print('MLX and mlx_lm installed successfully')")
            .output()
            .map_err(|e| BrbError::PythonError(format!("failed to verify installation: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(BrbError::PythonError(format!("verification failed: {}", stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        tracing::info!("Verification passed: {}", stdout.trim());

        Self::verify_entry_scripts(mlx_dir, &python_bin)
    }

    /// Verify an entry script can import its first-party siblings.
    ///
    /// Third-party imports alone are not enough. `pyproject.toml` declares no `[build-system]`,
    /// so this is a *virtual* project and `uv sync` installs its dependencies but not the
    /// project itself -- nothing puts `mlx/src` on `sys.path`. Scripts bootstrap it themselves
    /// from `__file__`, and a script that forgets to would import cleanly here and then fail at
    /// first use with `ModuleNotFoundError`, long after setup reported success.
    ///
    /// `runpy` with a non-`__main__` run name executes the imports without running `main()`.
    #[cfg(feature = "tauri-support")]
    fn verify_entry_scripts(mlx_dir: &Path, python_bin: &Path) -> Result<()> {
        let script = match Self::find_scripts_dir(mlx_dir) {
            Ok(dir) => dir.join(scripts::EMBED),
            // Nothing to verify against (dev checkout without copied resources).
            Err(_) => return Ok(()),
        };

        if !script.exists() {
            tracing::warn!(script = %script.display(), "entry script missing, skipping import check");
            return Ok(());
        }

        let output = Command::new(python_bin)
            .arg("-c")
            .arg(format!(
                "import runpy; runpy.run_path(r'{}', run_name='__brb_verify__')",
                script.display()
            ))
            .output()
            .map_err(|e| BrbError::PythonError(format!("failed to verify entry scripts: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(stderr = %stderr, "entry script import check failed");
            return Err(BrbError::PythonError(format!(
                "Python setup finished but scripts cannot import their dependencies: {}",
                stderr.trim()
            )));
        }

        tracing::info!("Entry script imports verified");
        Ok(())
    }
}

/// Recursively copy a directory.
#[cfg(feature = "tauri-support")]
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_script_constants() {
        assert_eq!(scripts::EMBED, "embed.py");
        assert_eq!(scripts::ANALYZE_PERSONA, "analyze_persona.py");
        assert_eq!(scripts::INFERENCE_DAEMON, "inference_daemon.py");
        assert_eq!(scripts::ANALYTICS, "analytics.py");
        assert_eq!(scripts::TRAIN, "train.py");
        assert_eq!(scripts::RERANK, "rerank.py");
    }

    #[test]
    fn test_script_path() {
        // Mock environment for testing
        let env = PythonEnvironment {
            python_bin: PathBuf::from("/test/bin/python"),
            scripts_dir: PathBuf::from("/test/scripts"),
            mlx_dir: PathBuf::from("/test/mlx"),
        };

        assert_eq!(env.script(scripts::EMBED), PathBuf::from("/test/scripts/embed.py"));
        assert_eq!(env.script(scripts::TRAIN), PathBuf::from("/test/scripts/train.py"));
    }

    mod manifests_differ {
        use super::*;
        use std::fs;
        use tempfile::TempDir;

        /// Returns (bundled_dir, installed_dir) with the given file contents written.
        fn dirs(bundled: &[(&str, &str)], installed: &[(&str, &str)]) -> (TempDir, TempDir) {
            let b = TempDir::new().unwrap();
            let i = TempDir::new().unwrap();
            for (name, body) in bundled {
                fs::write(b.path().join(name), body).unwrap();
            }
            for (name, body) in installed {
                fs::write(i.path().join(name), body).unwrap();
            }
            (b, i)
        }

        #[test]
        fn identical_manifests_need_no_update() {
            let (b, i) = dirs(
                &[("pyproject.toml", "same"), ("uv.lock", "same")],
                &[("pyproject.toml", "same"), ("uv.lock", "same")],
            );
            assert!(!PythonEnvironment::manifests_differ(b.path(), i.path()).unwrap());
        }

        #[test]
        fn changed_pyproject_needs_update() {
            let (b, i) = dirs(&[("pyproject.toml", "new")], &[("pyproject.toml", "old")]);
            assert!(PythonEnvironment::manifests_differ(b.path(), i.path()).unwrap());
        }

        /// The reason the loop covers uv.lock at all: a pinned-version upgrade can leave
        /// pyproject.toml byte-identical and change only the lock.
        #[test]
        fn changed_lock_alone_needs_update() {
            let (b, i) = dirs(
                &[("pyproject.toml", "same"), ("uv.lock", "new pins")],
                &[("pyproject.toml", "same"), ("uv.lock", "old pins")],
            );
            assert!(PythonEnvironment::manifests_differ(b.path(), i.path()).unwrap());
        }

        #[test]
        fn missing_installed_manifest_needs_update() {
            let (b, i) = dirs(&[("pyproject.toml", "x"), ("uv.lock", "y")], &[("pyproject.toml", "x")]);
            assert!(PythonEnvironment::manifests_differ(b.path(), i.path()).unwrap());
        }

        /// A manifest absent from the *bundle* is skipped, not treated as a change — otherwise
        /// a partial bundle would reinstall dependencies on every single launch.
        #[test]
        fn missing_bundled_manifest_is_skipped() {
            let (b, i) = dirs(&[("pyproject.toml", "x")], &[("pyproject.toml", "x"), ("uv.lock", "y")]);
            assert!(!PythonEnvironment::manifests_differ(b.path(), i.path()).unwrap());
        }
    }
}

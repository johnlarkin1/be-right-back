//! Daemon lifecycle manager for long-lived inference daemons.
//!
//! Manages spawning, connecting to, and monitoring inference daemons that
//! communicate over Unix domain sockets. Each daemon role (persona, agent)
//! gets its own socket and process, allowing both to run simultaneously.

use std::fs;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::RwLock;

use common::{
    PythonEnvironment, get_daemon_log_path, get_daemon_pid_path, get_daemon_socket_path, recommended_agent_model,
    recommended_persona_model, scripts,
};
use tracing::{debug, info, warn};

use crate::daemon_connection::DaemonConnection;
use crate::error::{InferenceError, Result};

/// Role of an inference daemon, determining which model to load and
/// which socket path to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonRole {
    /// Persona chat daemon (8-bit model for quality).
    Persona,
    /// Casper agent daemon (4-bit model for speed + tool calling).
    Agent,
}

impl DaemonRole {
    /// Get the string identifier used in file paths.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Persona => "persona",
            Self::Agent => "agent",
        }
    }

    /// Get the recommended base model for this role.
    pub fn base_model(&self) -> &'static str {
        match self {
            Self::Persona => recommended_persona_model(),
            Self::Agent => recommended_agent_model(),
        }
    }
}

impl std::fmt::Display for DaemonRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Manages the lifecycle of an inference daemon process.
///
/// Handles spawning, connecting, health checking, and cleanup for a daemon
/// that communicates via Unix domain sockets.
pub struct DaemonManager {
    role: DaemonRole,
    socket_path: PathBuf,
    pid_path: PathBuf,
    log_path: PathBuf,
    default_base_model: String,
    /// Optional model override set by the user's model preference.
    /// When set, this takes precedence over `default_base_model`.
    base_model_override: RwLock<Option<String>>,
}

impl DaemonManager {
    /// Create a new daemon manager for the given role.
    pub fn new(role: DaemonRole) -> Result<Self> {
        let role_str = role.as_str();
        let socket_path = get_daemon_socket_path(role_str)
            .map_err(|e| InferenceError::BackendError(format!("failed to get socket path: {e}")))?;
        let pid_path = get_daemon_pid_path(role_str)
            .map_err(|e| InferenceError::BackendError(format!("failed to get PID path: {e}")))?;
        let log_path = get_daemon_log_path(role_str)
            .map_err(|e| InferenceError::BackendError(format!("failed to get log path: {e}")))?;

        Ok(Self {
            role,
            socket_path,
            pid_path,
            log_path,
            default_base_model: role.base_model().to_string(),
            base_model_override: RwLock::new(None),
        })
    }

    /// Get the daemon role.
    pub fn role(&self) -> DaemonRole {
        self.role
    }

    /// Get the effective base model (override if set, otherwise default).
    pub fn base_model(&self) -> String {
        let guard = self.base_model_override.read().expect("RwLock poisoned");
        guard.clone().unwrap_or_else(|| self.default_base_model.clone())
    }

    /// Set a model override. Pass `None` to revert to the default.
    pub fn set_base_model_override(&self, model: Option<String>) {
        let mut guard = self.base_model_override.write().expect("RwLock poisoned");
        *guard = model;
    }

    /// Check if the daemon process is alive by reading the PID file and
    /// sending signal 0.
    pub fn is_running(&self) -> bool {
        let pid = match self.read_pid() {
            Some(pid) => pid,
            None => return false,
        };

        // signal 0 checks if process exists without actually sending a signal
        // SAFETY: kill with signal 0 is a standard POSIX existence check
        let result = unsafe { libc::kill(pid, 0) };
        result == 0
    }

    /// Ensure the daemon is running, spawning it if necessary.
    ///
    /// Returns once the socket file exists and is connectable.
    pub async fn ensure_running(&self) -> Result<()> {
        if self.is_running() && self.socket_path.exists() {
            debug!(role = %self.role, "daemon already running");
            return Ok(());
        }

        // Clean up stale files if daemon is dead
        if !self.is_running() {
            self.cleanup_stale_files();
        }

        // Spawn the daemon
        self.spawn_daemon()?;

        // Wait for socket to appear (poll with timeout)
        self.wait_for_socket().await?;

        Ok(())
    }

    /// Connect to the daemon, ensuring it's running first.
    ///
    /// Returns a `DaemonConnection` that can send commands and read responses.
    pub async fn connect(&self) -> Result<DaemonConnection> {
        self.ensure_running().await?;

        let conn = DaemonConnection::connect(&self.socket_path).await?;

        Ok(conn)
    }

    /// Shut down the daemon by connecting and sending a Shutdown command.
    pub async fn shutdown(&self) -> Result<()> {
        if !self.is_running() {
            debug!(role = %self.role, "daemon not running, nothing to shut down");
            return Ok(());
        }

        info!(role = %self.role, "shutting down daemon");

        match DaemonConnection::connect(&self.socket_path).await {
            Ok(mut conn) => {
                // Consume the Ready message
                let _ = conn.read_response_skip_logs().await;

                // Send shutdown
                let cmd = crate::engines::mlx_python::DaemonCommand::Shutdown;
                if let Err(e) = conn.send_command(&cmd).await {
                    warn!(role = %self.role, error = %e, "failed to send shutdown command");
                }

                // Wait briefly for the process to exit
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                // Force kill if still running
                if self.is_running()
                    && let Some(pid) = self.read_pid()
                {
                    warn!(role = %self.role, pid, "daemon still running after shutdown, sending SIGKILL");
                    unsafe {
                        libc::kill(pid, libc::SIGKILL);
                    }
                }
            }
            Err(e) => {
                warn!(role = %self.role, error = %e, "could not connect to daemon for shutdown, killing by PID");
                if let Some(pid) = self.read_pid() {
                    unsafe {
                        libc::kill(pid, libc::SIGTERM);
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    if self.is_running() {
                        unsafe {
                            libc::kill(pid, libc::SIGKILL);
                        }
                    }
                }
            }
        }

        // Clean up files
        self.cleanup_stale_files();

        info!(role = %self.role, "daemon shut down");

        Ok(())
    }

    /// Spawn the daemon as a detached process.
    fn spawn_daemon(&self) -> Result<()> {
        let env = PythonEnvironment::get()
            .map_err(|e| InferenceError::BackendError(format!("Python environment not found: {e}")))?;

        let python_path = &env.python_bin;
        let script_path = env.script(scripts::INFERENCE_DAEMON);
        let socket_path = self.socket_path.clone();
        let base_model = self.base_model();

        info!(
            role = %self.role,
            python = %python_path.display(),
            script = %script_path.display(),
            socket = %socket_path.display(),
            model = %base_model,
            "spawning daemon process"
        );

        // Open log file for stderr
        let log_file = fs::File::create(&self.log_path).map_err(|e| {
            InferenceError::BackendError(format!(
                "failed to create daemon log file {}: {e}",
                self.log_path.display()
            ))
        })?;

        let mut cmd = Command::new(python_path);
        cmd.arg(&script_path)
            .arg("--base-model")
            .arg(&base_model)
            .arg("--mode")
            .arg("socket")
            .arg("--socket-path")
            .arg(&socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(log_file));

        // Detach the process so it survives parent exit.
        // SAFETY: setsid() creates a new session, making the child independent.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }

        let child = cmd
            .spawn()
            .map_err(|e| InferenceError::BackendError(format!("failed to spawn daemon process: {e}")))?;

        info!(role = %self.role, pid = child.id(), "daemon process spawned");

        // Note: PID file is written by the Python daemon itself in socket mode.

        Ok(())
    }

    /// Wait for the socket file to appear, indicating the daemon is ready.
    async fn wait_for_socket(&self) -> Result<()> {
        let timeout = std::time::Duration::from_secs(30);
        let poll_interval = std::time::Duration::from_millis(100);
        let start = std::time::Instant::now();

        debug!(role = %self.role, socket = %self.socket_path.display(), "waiting for daemon socket");

        while start.elapsed() < timeout {
            if self.socket_path.exists() {
                // Try to actually connect to verify it's ready
                match DaemonConnection::connect(&self.socket_path).await {
                    Ok(_conn) => {
                        info!(
                            role = %self.role,
                            elapsed_ms = start.elapsed().as_millis(),
                            "daemon socket ready"
                        );
                        return Ok(());
                    }
                    Err(_) => {
                        // Socket file exists but not ready yet
                    }
                }
            }
            tokio::time::sleep(poll_interval).await;
        }

        Err(InferenceError::BackendError(format!(
            "daemon socket did not appear within {}s at {}",
            timeout.as_secs(),
            self.socket_path.display()
        )))
    }

    /// Read the PID from the PID file.
    fn read_pid(&self) -> Option<i32> {
        fs::read_to_string(&self.pid_path)
            .ok()
            .and_then(|s| s.trim().parse::<i32>().ok())
    }

    /// Remove stale socket and PID files.
    fn cleanup_stale_files(&self) {
        if self.socket_path.exists() {
            if let Err(e) = fs::remove_file(&self.socket_path) {
                warn!(path = %self.socket_path.display(), error = %e, "failed to remove stale socket");
            } else {
                debug!(path = %self.socket_path.display(), "removed stale socket");
            }
        }
        if self.pid_path.exists() {
            if let Err(e) = fs::remove_file(&self.pid_path) {
                warn!(path = %self.pid_path.display(), error = %e, "failed to remove stale PID file");
            } else {
                debug!(path = %self.pid_path.display(), "removed stale PID file");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daemon_role_as_str() {
        assert_eq!(DaemonRole::Persona.as_str(), "persona");
        assert_eq!(DaemonRole::Agent.as_str(), "agent");
    }

    #[test]
    fn test_daemon_role_display() {
        assert_eq!(format!("{}", DaemonRole::Persona), "persona");
        assert_eq!(format!("{}", DaemonRole::Agent), "agent");
    }

    #[test]
    fn test_daemon_manager_new() {
        let manager = DaemonManager::new(DaemonRole::Agent).unwrap();
        assert_eq!(manager.role(), DaemonRole::Agent);
        assert!(manager.socket_path.to_string_lossy().contains("daemon-agent.sock"));
        assert!(manager.pid_path.to_string_lossy().contains("daemon-agent.pid"));
    }

    #[test]
    fn test_is_running_no_pid_file() {
        let manager = DaemonManager::new(DaemonRole::Agent).unwrap();
        // Unless there's actually a daemon running, this should return false
        // We just verify it doesn't panic
        let _ = manager.is_running();
    }
}

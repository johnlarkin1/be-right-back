use anyhow::Result;
use collab::Config;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("collab=info")))
        .init();

    let config = Config::from_env()?;
    let listener = TcpListener::bind(config.addr).await?;
    tracing::info!(
        addr = %config.addr,
        db = %config.db_path.display(),
        disabled = config.disabled,
        "listening"
    );
    collab::serve(config, listener, shutdown_signal()).await
}

/// Resolves on SIGTERM (Fly stops machines with it) or Ctrl-C.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        let mut sig =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("install SIGTERM handler");
        sig.recv().await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = term => {}
    }
}

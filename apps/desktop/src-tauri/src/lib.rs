mod commands;
mod queries;
mod state;

use inference::InferenceBackend;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, RunEvent};
use tracing::{debug, info, warn};

pub use state::{AppState, IngestionState};

use crate::commands::contacts::prewarm_contacts_cache;

/// How many daily log files to keep in `~/.be-right-back/logs/` before the oldest is deleted.
const LOG_RETENTION_DAYS: usize = 14;

/// Set up tracing to write to both stdout and a rolling file in `~/.be-right-back/logs/`.
///
/// A Finder-launched .app has no usable stdout, so without the file layer there is no way to
/// diagnose a failure on a user's machine. Returns the appender guard, which must be held for
/// the lifetime of the process or buffered lines are dropped on exit.
fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

    let filter = || EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into());

    // Fall back to stdout-only rather than failing to boot if the log dir is unwritable.
    //
    // Retention is bounded: `rolling::daily` keeps every file forever, and these logs live under
    // $HOME on a user's machine rather than a CI runner that gets wiped.
    let file_writer = common::get_log_dir()
        .map_err(|e| eprintln!("could not create log directory, logging to stdout only: {e}"))
        .and_then(|dir| {
            tracing_appender::rolling::Builder::new()
                .rotation(tracing_appender::rolling::Rotation::DAILY)
                .filename_prefix("be-right-back.log")
                .max_log_files(LOG_RETENTION_DAYS)
                .build(dir)
                .map_err(|e| eprintln!("could not open log file, logging to stdout only: {e}"))
        })
        .ok();

    match file_writer {
        Some(writer) => {
            let (non_blocking, guard) = tracing_appender::non_blocking(writer);
            tracing_subscriber::registry()
                .with(fmt::layer().with_filter(filter()))
                .with(
                    fmt::layer()
                        .with_ansi(false)
                        .with_writer(non_blocking)
                        .with_filter(filter()),
                )
                .init();
            Some(guard)
        }
        None => {
            tracing_subscriber::registry()
                .with(fmt::layer().with_filter(filter()))
                .init();
            None
        }
    }
}

/// Process-wide home for the appender guard.
///
/// It cannot just be a local in `run`: the Ctrl+C handler calls `std::process::exit`, which
/// runs no destructors, so a local guard would never flush and the last buffered lines --
/// including the shutdown messages -- would be lost on the one path that exits abruptly.
static LOG_GUARD: OnceLock<Mutex<Option<tracing_appender::non_blocking::WorkerGuard>>> = OnceLock::new();

/// Drop the appender guard, blocking until buffered log lines reach disk.
///
/// Safe to call more than once; the second call finds the slot already empty.
fn flush_logs() {
    // No let-chain: this crate is still edition 2021, unlike the workspace crates.
    if let Some(slot) = LOG_GUARD.get() {
        if let Ok(mut guard) = slot.lock() {
            drop(guard.take());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    LOG_GUARD.set(Mutex::new(init_logging())).ok();

    let backend = InferenceBackend::MLXPython;

    info!("Starting Be Right Back desktop app");
    info!(backend = %backend, "configured inference backend");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::with_backend(backend))
        .setup(|app| {
            // Register Ctrl+C handler to shut down daemon processes.
            // RunEvent::Exit doesn't fire reliably on SIGINT (e.g. Ctrl+C during `tauri dev`),
            // so we need an explicit signal handler.
            let app_handle = app.handle().clone();
            ctrlc::set_handler(move || {
                info!("Ctrl+C received, shutting down daemon processes");
                let state = app_handle.state::<AppState>();
                let persona_daemon = state.persona_daemon.clone();
                let agent_daemon = state.agent_daemon.clone();
                // Best-effort synchronous shutdown — process is about to exit
                std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("failed to create shutdown runtime");
                    rt.block_on(async {
                        let _ = persona_daemon.shutdown().await;
                        let _ = agent_daemon.shutdown().await;
                    });
                })
                .join()
                .ok();
                info!("daemon processes shut down, exiting");
                flush_logs();
                std::process::exit(0);
            })
            .expect("failed to set Ctrl+C handler");

            // Pre-warm the contacts cache in background
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                debug!("Pre-warming contacts cache in background...");
                match prewarm_contacts_cache(app_handle).await {
                    Ok(count) => info!(count, "Contacts cache pre-warmed"),
                    Err(e) => debug!(error = %e, "Cache pre-warm skipped (no snapshot yet)"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Contact commands (new chat interface)
            commands::contacts::get_all_contacts,
            commands::contacts::get_contact_detail_stats,
            // Training commands
            commands::training::train_persona,
            commands::training::cancel_training,
            commands::training::get_training_plan,
            commands::training::save_loss_chart,
            commands::training::list_personas,
            // Inference commands
            commands::inference::chat_with_persona_streaming,
            // System/initialization commands
            commands::system::get_initialization_status,
            commands::system::open_fda_settings,
            commands::system::run_ingestion,
            commands::system::cancel_ingestion,
            // Ingestion settings commands
            commands::system::get_message_date_range,
            commands::system::check_ingestion_freshness,
            commands::system::save_ingestion_settings,
            commands::system::get_ingestion_settings,
            commands::system::run_analytics_only,
            commands::system::get_recommended_base_model,
            // Model picker commands
            commands::system::get_available_models,
            commands::system::check_model_compatibility,
            commands::system::set_model_preference,
            commands::system::reset_model_preference,
            // Insights commands (legacy combined endpoint)
            commands::insights::get_word_frequencies_for_range,
            commands::insights::get_embeddings_for_viz,
            // Insights commands (granular endpoints)
            commands::insights::get_insights_stats,
            commands::insights::get_insights_timeline,
            commands::insights::get_insights_calendar,
            commands::insights::get_word_frequencies,
            commands::insights::get_day_details,
            commands::insights::get_tapback_summary,
            commands::insights::get_tapback_contacts,
            commands::insights::get_tapback_monthly,
            commands::insights::get_most_reacted_messages,
            commands::insights::get_tapback_emojis,
            // Conversation analysis commands
            commands::analysis::get_conversation_analysis,
            commands::analysis::analyze_conversation,
            // Casper agent commands
            commands::casper::ask_casper_streaming,
            commands::casper::cancel_casper,
            commands::casper::get_casper_model_info,
            // Casper thread persistence commands
            commands::casper::create_casper_thread,
            commands::casper::list_casper_threads,
            commands::casper::append_casper_message,
            commands::casper::load_casper_thread,
            commands::casper::rename_casper_thread,
            commands::casper::delete_casper_thread,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                info!("app exiting, shutting down daemon processes");
                let state = app.state::<AppState>();
                let persona_daemon = state.persona_daemon.clone();
                let agent_daemon = state.agent_daemon.clone();
                // Block on async shutdown — we're exiting anyway
                tauri::async_runtime::block_on(async {
                    if let Err(e) = persona_daemon.shutdown().await {
                        warn!(error = %e, "error shutting down persona daemon");
                    }
                    if let Err(e) = agent_daemon.shutdown().await {
                        warn!(error = %e, "error shutting down agent daemon");
                    }
                    info!("daemon processes shut down");
                });
            }
        });

    flush_logs();
}

/// brb CLI entry point
use clap::Parser;
use tracing::{error, info};

mod cli;
mod commands;
mod constants;

use cli::{Cli, Commands};
use commands::{
    handle_ask, handle_export, handle_ingest, handle_list, handle_search, handle_stats, handle_train, handle_view,
    handle_visualize,
};

fn main() {
    // Initialize tracing: use RUST_LOG env var if set, otherwise default to INFO
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt().with_env_filter(filter).init();

    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Snapshot => match messages_db::db::snapshot::create_snapshot() {
            Ok(path) => {
                info!(?path, "Snapshot created");
                println!("Snapshot created: {}", path.display());
                Ok(())
            }
            Err(e) => Err(e),
        },
        Commands::Ingest { force_snapshot } => handle_ingest(force_snapshot),
        Commands::List {
            min_messages,
            format,
            include_groups,
        } => handle_list(min_messages, format, include_groups),
        Commands::Export {
            output_dir,
            date_from,
            date_to,
        } => handle_export(output_dir, date_from, date_to),
        Commands::Stats { contact, json } => handle_stats(&contact, json),
        Commands::View { contact, limit, offset } => handle_view(&contact, limit, offset),
        Commands::Visualize { contact, output_dir } => handle_visualize(&contact, output_dir),
        Commands::Train {
            base_model,
            max_steps,
            learning_rate,
            batch_size,
            lora_rank,
            lora_alpha,
            save_every,
        } => handle_train(
            &base_model,
            max_steps,
            learning_rate,
            batch_size,
            lora_rank,
            lora_alpha,
            save_every,
        ),
        Commands::Ask {
            question,
            verbose,
            max_iterations,
        } => handle_ask(&question, verbose, max_iterations),
        Commands::Search {
            query,
            contact_id,
            limit,
            json,
            breakdown,
        } => handle_search(&query, contact_id.as_deref(), limit, json, breakdown),
    };

    if let Err(e) = result {
        error!(?e, "Error");
        std::process::exit(1);
    }
}

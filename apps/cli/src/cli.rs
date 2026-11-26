/// CLI interface for brb
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(name = "brb")]
#[command(about = "interact with your iMessage history", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum OutputFormat {
    /// Pretty table format (default)
    Table,
    /// CSV format
    Csv,
    /// JSON format
    Json,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Create a snapshot of the Messages database
    Snapshot,

    /// Run full ingestion pipeline (snapshot + embeddings + vector DB)
    Ingest {
        /// Force create a new snapshot even if one exists
        #[arg(short, long)]
        force_snapshot: bool,
    },

    /// List all contacts with message counts
    List {
        /// Minimum number of messages to display
        #[arg(short, long, default_value_t = 0)]
        min_messages: usize,

        /// Output format
        #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
        format: OutputFormat,

        /// Include messages from group chats (shows overall interaction frequency)
        #[arg(short = 'g', long)]
        include_groups: bool,
    },

    /// Export your own replies across your 1:1 chats as "You" training data (JSONL)
    Export {
        /// Output directory (default: ~/.be-right-back/data/processed/)
        #[arg(short, long)]
        output_dir: Option<String>,

        /// Filter by start date (YYYY-MM-DD)
        #[arg(long)]
        date_from: Option<String>,

        /// Filter by end date (YYYY-MM-DD)
        #[arg(long)]
        date_to: Option<String>,
    },

    /// Show conversation statistics
    Stats {
        /// Contact ID (phone number or email)
        contact: String,

        /// Output as JSON instead of plain text
        #[arg(long)]
        json: bool,
    },

    /// View messages from a conversation
    View {
        /// Contact ID (phone number or email)
        contact: String,

        /// Number of messages to display
        #[arg(short, long, default_value_t = 50)]
        limit: usize,

        /// Skip first N messages
        #[arg(short, long, default_value_t = 0)]
        offset: usize,
    },

    /// Generate visualizations for a conversation
    Visualize {
        /// Contact ID (phone number or email)
        contact: String,

        /// Output directory for PNG files (default: ~/.be-right-back/data/stats/)
        #[arg(short, long)]
        output_dir: Option<String>,
    },

    /// Train the "You" persona from data written by `brb export`
    Train {
        /// Base model to use for training
        #[arg(long, default_value = "mlx-community/Qwen3.5-9B-8bit")]
        base_model: String,

        /// Maximum training steps
        #[arg(long, default_value_t = 500)]
        max_steps: usize,

        /// Learning rate
        #[arg(long, default_value_t = 1e-5)]
        learning_rate: f64,

        /// Batch size
        #[arg(long, default_value_t = 4)]
        batch_size: usize,

        /// LoRA rank
        // #[arg(long, default_value_t = 16)]
        #[arg(long, default_value_t = 4)]
        lora_rank: usize,

        /// LoRA alpha
        // #[arg(long, default_value_t = 32)]
        #[arg(long, default_value_t = 8)]
        lora_alpha: usize,

        /// Save checkpoint every N steps
        #[arg(long, default_value_t = 100)]
        save_every: usize,
    },

    /// Ask Casper about your message history
    Ask {
        /// Question to ask Casper (e.g., "who do I text the most?")
        question: String,

        /// Show detailed tool call information
        #[arg(short, long)]
        verbose: bool,

        /// Maximum tool call iterations (default: 5)
        #[arg(long, default_value_t = 5)]
        max_iterations: usize,
    },

    /// Search message history using hybrid search (semantic + BM25)
    Search {
        /// Natural language search query
        query: String,

        /// Filter to a specific contact
        #[arg(short, long)]
        contact_id: Option<String>,

        /// Maximum number of results (default: auto from query planner)
        #[arg(short, long)]
        limit: Option<usize>,

        /// Output as JSON (for programmatic use)
        #[arg(long)]
        json: bool,

        /// Print per-ranker (semantic / BM25 / ilike) rankings + RRF scores
        /// to stderr before the fused output. Useful for debugging RRF.
        #[arg(long)]
        breakdown: bool,
    },
}

/**
 * Layers, stations, and guided tours for the 3D system view.
 *
 * Every caption here is UI copy. Keep each one to a sentence and keep it true
 * to the code. To change what the tour says, edit this file only.
 *
 * Layout: an exploded stack of four layers, like a chip cross-section. Each
 * station sits on one layer at position `x`.
 */

export type Layer = "apps" | "rust" | "python" | "disk";

/**
 * How a station runs. The scene draws each kind as its own shape.
 * - call: runs when called (rounded box)
 * - daemon: long-lived process (hex prism)
 * - store: a file or database (cylinder)
 */
export type Kind = "call" | "daemon" | "store";

export interface Station {
  id: string;
  label: string;
  /** Path in the repo or on disk. */
  path: string;
  /** One sentence on what this part does. */
  blurb: string;
  kind: Kind;
  layer: Layer;
  x: number;
}

export interface TourStop {
  station: string;
  /** Short tag on the packet as it leaves for this stop. */
  tag: string;
  caption: string;
}

export interface Tour {
  id: string;
  name: string;
  /** Tab label on narrow screens. */
  short: string;
  stops: TourStop[];
}

/**
 * Layers, top to bottom. Colors come from the middle of Fabio Crameri's oslo
 * colormap, by depth. The near-white end is left out, so no layer outshines
 * the current one. Use them only as fills, swatches, or edges, never for text.
 */
export const LAYERS: { id: Layer; letter: string; label: string; color: string }[] = [
  { id: "apps", letter: "A", label: "Desktop app", color: "#a9b5cb" },
  { id: "rust", letter: "B", label: "Rust crates", color: "#859dc7" },
  { id: "python", letter: "C", label: "Python + MLX", color: "#5f84c2" },
  { id: "disk", letter: "D", label: "On disk", color: "#3d68a6" },
];

export const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

export const STATIONS: Station[] = [
  // Apps
  { id: "ui", label: "React UI", path: "apps/desktop/src", blurb: "The window you click around in. It calls Rust with invoke() and listens for progress events.", kind: "call", layer: "apps", x: -3.5 },
  { id: "tauri", label: "Tauri backend", path: "apps/desktop/src-tauri", blurb: "Rust side of the desktop app. Every command is registered in generate_handler![].", kind: "call", layer: "apps", x: 3.5 },

  // Rust crates
  { id: "messages-db", label: "messages-db", path: "crates/messages-db", blurb: "Read-only access to the iMessage database, plus snapshots.", kind: "call", layer: "rust", x: -10 },
  { id: "training", label: "training", path: "crates/training", blurb: "Exports one contact's 1:1 chat as JSONL. The contact's replies are the assistant turns.", kind: "call", layer: "rust", x: 4.5 },
  { id: "ingestion", label: "ingestion", path: "crates/ingestion", blurb: "Runs the ingestion pipeline and the hybrid search behind RAG.", kind: "call", layer: "rust", x: -1 },
  { id: "inference", label: "inference", path: "crates/inference", blurb: "Starts the MLX daemons and runs Casper's tool loop.", kind: "call", layer: "rust", x: -5.5 },
  { id: "personas", label: "personas", path: "crates/personas", blurb: "Persona metadata and where each LoRA adapter lives.", kind: "call", layer: "rust", x: 9.5 },

  // Python + MLX
  { id: "train-py", label: "train.py", path: "mlx/src/entry/train.py", blurb: "LoRA fine-tuning with MLX.", kind: "call", layer: "python", x: 6.6 },
  { id: "embed-py", label: "embed.py", path: "mlx/src/entry/embed.py", blurb: "Chunks messages (window 8, stride 4; PR #318 moves the stride to 8) and embeds them with ModernBERT.", kind: "call", layer: "python", x: -6.6 },
  { id: "embed-query-py", label: "embed_query.py", path: "mlx/src/entry/embed_query.py", blurb: "Embeds one search query for the Search screen and persona chat.", kind: "call", layer: "python", x: -2.2 },
  { id: "rerank-py", label: "rerank.py", path: "mlx/src/entry/rerank.py", blurb: "Cold-start cross-encoder (ms-marco-MiniLM-L-6-v2), used when the daemon cannot rerank.", kind: "call", layer: "python", x: 2.2 },
  { id: "agent-daemon", label: "Casper daemon", path: "daemon-agent.sock", blurb: "Long-lived MLX process for the agent model. It also embeds queries and reranks hits.", kind: "daemon", layer: "python", x: -11 },
  { id: "persona-daemon", label: "Persona daemon", path: "daemon-persona.sock", blurb: "Long-lived MLX process: base model plus your LoRA adapter.", kind: "daemon", layer: "python", x: 11 },

  // Data
  { id: "chat-db", label: "chat.db", path: "~/Library/Messages/chat.db", blurb: "Apple's iMessage database. Be Right Back only reads it.", kind: "store", layer: "disk", x: -11 },
  { id: "raw", label: "Snapshots", path: "data/raw/", blurb: "A copy of chat.db, so ingestion never touches the live file.", kind: "store", layer: "disk", x: -6.6 },
  { id: "jsonl", label: "Training JSONL", path: "data/processed/", blurb: "Prompt and reply pairs ready for fine-tuning.", kind: "store", layer: "disk", x: 6.6 },
  { id: "brb-db", label: "brb.db", path: "data/db/brb.db", blurb: "SQLite metadata about ingestion runs.", kind: "store", layer: "disk", x: -2.2 },
  { id: "duckdb", label: "brb.duckdb", path: "data/db/brb.duckdb", blurb: "768-dim vectors and a BM25 full-text index.", kind: "store", layer: "disk", x: 2.2 },
  { id: "models", label: "Models", path: "models/", blurb: "Downloaded base models and trained LoRA adapters.", kind: "store", layer: "disk", x: 11 },
];

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

export const TOURS: Tour[] = [
  {
    id: "ingest",
    name: "Ingest iMessages",
    short: "Ingest",
    stops: [
      { station: "chat-db", tag: "message", caption: "Your messages start in Apple's chat.db." },
      { station: "messages-db", tag: "message", caption: "messages-db opens it read-only." },
      { station: "raw", tag: "snapshot", caption: "messages-db copies chat.db into a snapshot." },
      { station: "ingestion", tag: "snapshot", caption: "The ingestion crate runs the pipeline and reports progress to the UI." },
      { station: "brb-db", tag: "run record", caption: "The ingestion crate writes a metadata row for each run to brb.db." },
      { station: "embed-py", tag: "8 messages", caption: "embed.py slides an 8-message window with stride 4 and embeds each chunk." },
      { station: "duckdb", tag: "768-dim", caption: "Vectors land in DuckDB, next to a BM25 full-text index." },
    ],
  },
  {
    id: "casper",
    name: "Ask Casper",
    short: "Ask Casper",
    stops: [
      { station: "ui", tag: "question", caption: "You ask Casper a question in the app." },
      { station: "tauri", tag: "question", caption: "The UI calls the Tauri backend with invoke()." },
      { station: "inference", tag: "question", caption: "The inference crate starts Casper's tool loop." },
      { station: "agent-daemon", tag: "search_messages", caption: "Over a Unix socket, the agent model picks a tool: search_messages." },
      { station: "ingestion", tag: "query plan", caption: "The query planner pulls out dates and cleans the query." },
      { station: "agent-daemon", tag: "768-dim", caption: "The daemon embeds the query with ModernBERT." },
      { station: "duckdb", tag: "top hits", caption: "Hybrid search merges vector and BM25 hits with RRF." },
      { station: "agent-daemon", tag: "answer", caption: "The daemon's cross-encoder reranks the hits, and Casper answers." },
      { station: "ui", tag: "answer", caption: "The answer comes back to the app as events." },
    ],
  },
  {
    id: "persona",
    name: "Train a persona",
    short: "Train",
    stops: [
      { station: "ui", tag: "your sent texts", caption: "You start training from the app." },
      { station: "training", tag: "your sent texts", caption: "The training crate collects your sent messages." },
      { station: "jsonl", tag: "JSONL", caption: "The training crate writes them to disk as JSONL pairs." },
      { station: "train-py", tag: "JSONL", caption: "train.py fine-tunes a LoRA adapter with MLX." },
      { station: "models", tag: "LoRA adapter", caption: "train.py saves the adapter under models/personas/." },
      { station: "personas", tag: "LoRA adapter", caption: "The personas crate records where it lives." },
      { station: "persona-daemon", tag: "base + LoRA", caption: "The persona daemon loads the base model plus your adapter." },
      { station: "ui", tag: "reply", caption: "Now you can chat with your Digital You." },
    ],
  },
];

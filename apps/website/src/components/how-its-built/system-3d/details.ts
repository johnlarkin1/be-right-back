/**
 * Click-in details for each block and layer of the 3D system view.
 *
 * Every row cites the code it came from in `src` (repo path and line). The
 * page does not render `src`. It is here so the next editor can check a row
 * against the code before changing it. Keep values short and concrete.
 *
 * A `changing` note marks a fact that an open PR or a planned change will
 * alter. The page shows a numbered "changing" tag on the row and lists the
 * notes at the foot of the panel.
 *
 * Section order: "Model" first, then "Data split", then the rest. Keep those
 * two titles exact, so readers find them in the same place on every block.
 */

import type { Layer } from "./data";

export interface Changing {
  /** Open PR that changes this fact, if there is one. */
  pr?: number;
  /** One sentence on what changes. Listed at the foot of the panel. */
  note: string;
}

export interface DetailRow {
  k: string;
  v: string;
  /** Repo path and line the fact comes from. Not rendered. */
  src: string;
  changing?: Changing[];
}

export interface DetailSection {
  title: string;
  /** Groups sections under a heading, for a block that does two jobs. */
  part?: string;
  rows: DetailRow[];
}

export interface StationDetail {
  summary: string;
  changing?: Changing[];
  sections: DetailSection[];
}

export interface LayerDetail {
  summary: string;
  rows: DetailRow[];
}

const r = (
  k: string,
  v: string,
  src: string,
  ...changing: Changing[]
): DetailRow => (changing.length ? { k, v, src, changing } : { k, v, src });

/* ------------------------------------------------------- changing notes */

const STRIDE_318: Changing = {
  pr: 318,
  note: "PR #318 sets the stride to 8, so chunks stop overlapping.",
};
const BATCH_318: Changing = {
  pr: 318,
  note: "PR #318 drops the 128 batch for 32GB+ Macs, so every Mac with 16GB+ uses 64.",
};
const STATS_318: Changing = {
  pr: 318,
  note: "PR #318 computes these stats in one pass, on a background thread while Python embeds.",
};
const WRITE_318: Changing = {
  pr: 318,
  note: "PR #318 inserts each batch from memory with Arrow, with no temp Parquet file.",
};
const DECODE_318: Changing = {
  pr: 318,
  note: "PR #318 adds a typedstream fast path ahead of the Foundation decoders.",
};
const CMDS_316: Changing = {
  pr: 316,
  note: "PR #316 adds cancel_casper and cancel_training (40 commands), and the token_reset and cancelled Casper events.",
};
const SPLIT_311: Changing = {
  pr: 311,
  note: "PR #311 adds a seeded held-out split, saved as heldout.json.",
};
const STREAM_316: Changing = {
  pr: 316,
  note: "PR #316 streams real Casper tokens.",
};
const STEPS_311: Changing = {
  pr: 311,
  note: "The step math assumes a 90% train share. PR #311 replaces the 90/10 split.",
};
const YOU_ONLY: Changing = {
  note: "Training moves to one You persona, built from every 1:1 chat with 50+ messages. Per-contact training and the passphrase go away.",
};
const YOU_ROLES: Changing = {
  note: "The You persona flips the roles. Your replies become assistant, and the other person becomes user.",
};
const PROFILE: Changing = {
  note: "The You persona rework may change these training settings.",
};

/* ------------------------------------------------------------- stations */

export const STATION_DETAILS: Record<string, StationDetail> = {
  /* ---------------------------------------------------------------- apps */

  ui: {
    summary:
      "React 19 window with three tabs. It calls Rust with invoke() and listens for seven events.",
    sections: [
      {
        title: "Screens",
        rows: [
          r("Tabs", "3: Home, Chat, Insights (retro: ./home, ./chat, ./insights)", "apps/desktop/src/components/Navigation.tsx:25"),
          r("Tab ids", "home | chat | insights", "apps/desktop/src/types.ts:97"),
          r("Chat sidebar", "contacts | personas", "apps/desktop/src/types.ts:121"),
        ],
      },
      {
        title: "State",
        rows: [
          r("Zustand stores", "modelStore, themeStore, insightsStore", "apps/desktop/src/stores/modelStore.ts:33"),
          r("UI mode key", "brb-ui-mode (retro or modern), localStorage", "apps/desktop/src/stores/themeStore.ts:41"),
          r("Thinking toggle", "brb-thinking-mode, default off", "apps/desktop/src/components/chat/ChatLayout.tsx:67"),
          r("Onboarding key", "brb-onboarding-state", "apps/desktop/src/hooks/useOnboarding.ts:11"),
          r("Insights data", "Not persisted; resets on restart", "apps/desktop/src/stores/insightsStore.ts:11"),
        ],
      },
      {
        title: "Events listened",
        rows: [
          r("Casper", "casper-progress", "apps/desktop/src/hooks/useCasperAgent.ts:186", CMDS_316),
          r("Persona chat", "chat-meta, chat-token", "apps/desktop/src/hooks/useChatMessages.ts:74"),
          r("Ingestion", "setup-progress, ingestion-progress", "apps/desktop/src/hooks/useIngestion.ts:128"),
          r("Training", "training-progress", "apps/desktop/src/components/chat/TrainingModal.tsx:133"),
          r("Analysis", "analysis-progress", "apps/desktop/src/hooks/useConversationAnalysis.ts:72"),
        ],
      },
      {
        title: "Stack",
        rows: [
          r("React", "^19.1.0", "apps/desktop/package.json:25"),
          r("State lib", "zustand ^5.0.0", "apps/desktop/package.json:32"),
          r("Charts", "recharts ^2.15.0", "apps/desktop/package.json:29"),
          r("Build", "Vite ^7.0.4, Tailwind ^4", "apps/desktop/package.json:50"),
        ],
      },
    ],
  },

  tauri: {
    summary:
      "Rust side of the app: 38 commands and 7 emitted events. It holds one handle per MLX daemon.",
    sections: [
      {
        title: "Commands",
        rows: [
          r("Registered", "38 in generate_handler![]", "apps/desktop/src-tauri/src/lib.rs:137", CMDS_316),
          r("By group", "contacts 3, training 3, chat 1, system + ingestion 10, model picker 4, insights 6, analysis 2, Casper 8, search 1", "apps/desktop/src-tauri/src/lib.rs:138", CMDS_316, YOU_ONLY),
          r("Casper defaults", "Up to 5 tool rounds, thinking off", "apps/desktop/src-tauri/src/commands/casper.rs:125"),
          r("Casper answer stream", "Char by char, 10 ms delay (simulated)", "apps/desktop/src-tauri/src/commands/casper.rs:249", STREAM_316),
        ],
      },
      {
        title: "Events emitted",
        rows: [
          r("Persona chat", "chat-meta {rag_result_count}, chat-token {token, done}", "apps/desktop/src-tauri/src/commands/inference.rs:69"),
          r("Casper", "casper-progress: started, thinking, tool_start, tool_complete, token, complete, error", "apps/desktop/src-tauri/src/commands/casper.rs:39", CMDS_316),
          r("Training", "training-progress", "apps/desktop/src-tauri/src/commands/training.rs:61"),
          r("Other", "ingestion-progress, analysis-progress, setup-progress", "apps/desktop/src-tauri/src/commands/system.rs:726"),
        ],
      },
      {
        title: "Persona chat RAG",
        rows: [
          r("Skip RAG", "Message under 10 chars", "apps/desktop/src-tauri/src/commands/inference.rs:146"),
          r("Query embed", "embed_query.py on the full sentence (not the daemon)", "apps/desktop/src-tauri/src/commands/inference.rs:177"),
          r("Search", "Semantic only, 100 hits, min similarity 0.15, one contact", "apps/desktop/src-tauri/src/commands/inference.rs:204"),
          r("Profile", "Conversation Analysis, up to 1500 chars", "apps/desktop/src-tauri/src/commands/inference.rs:296"),
        ],
      },
      {
        title: "State",
        rows: [
          r("Daemons", "One persona and one agent engine, each with its own daemon manager", "apps/desktop/src-tauri/src/state.rs:137"),
          r("Model preference", "e.g. \"4b:4bit\"; sets the base model of both daemons", "apps/desktop/src-tauri/src/state.rs:187"),
          r("Casper threads", "brb.db: casper_threads, casper_messages", "crates/ingestion/sql/sqlite_schema.sql:173"),
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- rust */

  "messages-db": {
    summary:
      "Rust crate for read-only iMessage access. It snapshots chat.db and decodes attributedBody blobs.",
    sections: [
      {
        title: "attributedBody decoding",
        rows: [
          r("Formats", "NSKeyedArchive (bplist00) or NSArchiver (streamtyped)", "crates/messages-db/src/utils/attributed_body.rs:43"),
          r("Strategies", "Secure keyed → legacy keyed → NSUnarchiver", "crates/messages-db/src/utils/attributed_body.rs:130", DECODE_318),
          r("Class allowlist", "19 classes: 12 Foundation required + 7 AppKit optional", "crates/messages-db/src/utils/attributed_body.rs:179"),
          r("URL recovery", "Appends http(s) links found in the blob bytes", "crates/messages-db/src/utils/attributed_body.rs:86"),
          r("Linked frameworks", "Foundation + AppKit (objc FFI)", "crates/messages-db/build.rs:9"),
        ],
      },
      {
        title: "Text rules",
        rows: [
          r("Order", "text column first, else decoded attributedBody", "crates/messages-db/src/db/parser.rs:13"),
          r("Normalize", "Unicode NFC", "crates/messages-db/src/db/parser.rs:34"),
        ],
      },
      {
        title: "Queries",
        rows: [
          r("list_contacts", "1:1 contacts, min_messages default 1, groups off", "crates/messages-db/src/db/queries.rs:38"),
          r("Contact SQL", "Count, earliest, latest per handle.id; ORDER BY count DESC", "crates/messages-db/src/db/query_strs.rs:7"),
          r("Per-contact messages", "Merged by person_centric_id, ORDER BY date, ROWID", "crates/messages-db/src/db/query_strs.rs:87"),
          r("Name lookup", "E.164 phone map (US default region) and lowercased email map from AddressBook", "crates/messages-db/src/db/queries.rs:313"),
        ],
      },
    ],
  },

  ingestion: {
    summary:
      "Rust crate for ingestion and search. Ingestion snapshots, writes stats to brb.db, then runs embed.py. Search plans the query, fuses three rankers, and ranks the hits.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Embeddings", "nomicai-modernbert-embed-base-8bit, 768-dim, run by embed.py", "mlx/src/config/embedding.py:29"),
          r("Reranker", "ms-marco-MiniLM-L-6-v2 cross-encoder, in the daemon or rerank.py", "mlx/src/ml/reranker.py:30"),
        ],
      },
      {
        title: "Data split",
        rows: [
          r("Chunks", "8 messages per chunk, stride 4 (50% overlap), one contact each", "mlx/src/config/embedding.py:39", STRIDE_318),
          r("User filters", "Start date, end date, min messages per contact", "crates/ingestion/src/python.rs:118"),
        ],
      },
      {
        part: "Ingest",
        title: "Stages",
        rows: [
          r("Order", "Snapshot → Parsing → Chunking → Embedding → Saving", "crates/ingestion/src/progress.rs:3"),
          r("Snapshot", "Copy chat.db and AddressBook, write per-contact and \"you\" stats, resolve names, set up DuckDB", "crates/ingestion/src/lib.rs:252", STATS_318),
          r("Parsing … Saving", "Run inside embed.py, which reports progress back", "crates/ingestion/src/python.rs:104"),
          r("Run record", "ingestion_meta: model, dims, time, window, stride, counts", "crates/ingestion/src/lib.rs:515"),
        ],
      },
      {
        part: "Ingest",
        title: "Python bridge",
        rows: [
          r("Not passed", "Window, stride, batch size (script defaults apply)", "crates/ingestion/src/python.rs:215"),
          r("Progress line", "{\"type\":\"stage_progress\", stage, percent, message, stats}", "crates/ingestion/src/python.rs:18"),
        ],
      },
      {
        part: "Search",
        title: "Query planner",
        rows: [
          r("Temporal patterns", "18 (yesterday, last N days, in March 2025, seasons …)", "crates/ingestion/src/query_planner.rs:96"),
          r("Hit count", "7 by default; 20 for \"favorite\", \"most\", \"usually\" …", "crates/ingestion/src/query_planner.rs:29"),
          r("Superlative", "\"latest\" or \"first\" sorts by time", "crates/ingestion/src/query_planner.rs:41"),
        ],
      },
      {
        part: "Search",
        title: "Retrieval and fusion",
        rows: [
          r("Rankers", "Semantic (per vector) + BM25 + keyword match", "crates/ingestion/src/search.rs:214"),
          r("Candidates", "3× the hit count per ranker", "crates/ingestion/src/search.rs:206"),
          r("Semantic", "Exact cosine scan over an in-memory copy of every vector (no HNSW)", "crates/ingestion/src/embedding_matrix.rs:1"),
          r("RRF", "score = Σ 1 / (60 + rank), rank from 1", "crates/ingestion/src/search.rs:741"),
        ],
      },
      {
        part: "Search",
        title: "Ranking",
        rows: [
          r("Recency", "× 1 / (1 + 0.01 × age in days), off for superlatives", "crates/ingestion/src/search.rs:762"),
          r("MMR lambda", "0.7", "crates/ingestion/src/search.rs:270"),
          r("Contact penalty", "Halves a score once its contact has 2 hits, and again for each hit after", "crates/ingestion/src/search.rs:871"),
        ],
      },
      {
        part: "Search",
        title: "Callers and context",
        rows: [
          r("Casper tool", "Hit count + 5, min similarity 0.25, MMR on", "crates/inference/src/agent/builtin/search_messages.rs:175"),
          r("Desktop search", "max(3× hits, 30), min similarity 0.1, then rerank", "apps/desktop/src-tauri/src/commands/search.rs:78"),
          r("Persona chat RAG", "Semantic only, 100 hits, min similarity 0.15, one contact", "apps/desktop/src-tauri/src/commands/inference.rs:203"),
          r("Context budget", "6000 chars, 300 per chunk, 3 excerpts per day", "crates/ingestion/src/context_builder.rs:9"),
          r("Speaker labels", "\"Me:\" becomes \"Friend:\"; friend-only chunks dropped", "crates/ingestion/src/context_builder.rs:66"),
        ],
      },
    ],
  },

  inference: {
    summary:
      "Starts the two MLX daemons and runs Casper's tool loop. It picks the model tier from total memory.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Persona chat", "The tier's 4-bit model plus the persona's LoRA adapter", "crates/common/src/model_tiers.rs:278"),
          r("Casper", "Always Qwen3.5-9B-4bit, whatever the tier", "crates/inference/src/agent/mod.rs:441"),
          r("Tier pick", "By total memory, less a 5 GB reserve. The Models block lists the tiers", "crates/common/src/model_tiers.rs:262"),
        ],
      },
      {
        title: "Sampling",
        rows: [
          r("Persona chat", "temp 0.8, top_p 0.95, top_k 40, repetition 1.1, 256 tokens", "crates/inference/src/config.rs:78"),
          r("Casper", "temp 0.6, top_p 0.95, top_k 20, repetition 1.3, 4096 tokens", "crates/inference/src/config.rs:119"),
          r("Date planner", "temp 0, top_k 1, seed 42, 200 tokens, no thinking", "crates/inference/src/agent/planning.rs:75"),
        ],
      },
      {
        title: "Casper loop",
        rows: [
          r("Tools (7)", "list_contacts, get_contact_stats, get_conversation_context, search_messages, get_message_volume_by_period, get_conversation_analysis, get_topic_clusters", "crates/inference/src/agent/mod.rs:244"),
          r("Max iterations", "5, then one synthesis pass", "crates/inference/src/agent/mod.rs:477"),
          r("Hit count", "7 hits by default; 20 for aggregation questions", "crates/ingestion/src/query_planner.rs:29"),
          r("Rerank", "Daemon cross-encoder when there are 2+ hits", "crates/inference/src/agent/mod.rs:1334"),
          r("@mention", "One tagged contact limits search to that contact", "crates/inference/src/agent/mod.rs:426"),
        ],
      },
      {
        title: "Daemon lifecycle",
        rows: [
          r("Spawn", "inference_daemon.py in socket mode, detached", "crates/inference/src/daemon_manager.rs:241"),
          r("Startup wait", "30 s, polls the socket every 100 ms", "crates/inference/src/daemon_manager.rs:275"),
          r("Read timeout", "60 s per JSON line", "crates/inference/src/daemon_connection.rs:16"),
        ],
      },
    ],
  },

  training: {
    summary:
      "Rust crate that turns one contact's iMessage thread into chat-format JSONL. It also builds the persona system prompt.",
    changing: [YOU_ONLY],
    sections: [
      {
        title: "Data split",
        rows: [
          r("Scope", "One contact's 1:1 conversation per persona", "apps/desktop/src-tauri/src/commands/training.rs:366", YOU_ONLY),
          r("Roles", "You = user, contact = assistant", "crates/training/src/export/jsonl.rs:364", YOU_ROLES),
          r("Message filter", "Drops text under 2 chars, attachment-only (U+FFFC), and text with no letters or digits", "crates/training/src/export/jsonl.rs:118"),
          r("Session gap", "Over 4 h of silence starts a new segment", "crates/training/src/constants.rs:16"),
          r("Example start", "A question from me (\"?\" or a leading question word)", "crates/training/src/export/jsonl.rs:290"),
          r("Example length", "Up to 8 turns, ends on assistant, no overlap", "crates/training/src/constants.rs:20"),
          r("Cap", "50,000 most recent examples", "crates/training/src/export/jsonl.rs:63"),
        ],
      },
      {
        title: "Prompt and analysis",
        rows: [
          r("Analysis sample", "100 conversation blocks go to the LLM analysis", "apps/desktop/src-tauri/src/commands/training.rs:329"),
          r("Recency weight", "Exponential decay, lambda 0.2 per month", "crates/training/src/export/sampling.rs:12"),
          r("Min block size", "3 messages", "crates/training/src/export/sampling.rs:15"),
          r("System prompt", "\"You are {contact}. You are texting with {user, else 'your friend'}.\" + stats + LLM analysis", "crates/training/src/export/prompt_template.rs:31", YOU_ONLY),
          r("Fallback", "Generic prompt when there is no LLM analysis and no emoji use", "apps/desktop/src-tauri/src/commands/training.rs:409"),
        ],
      },
      {
        title: "Hardware profile",
        rows: [
          r("Min memory", "8 GB to train", "crates/common/src/training_profile.rs:36"),
          r("Step target", "4 epochs over 90% of examples, max 10 epochs, floor 120 steps", "crates/common/src/training_profile.rs:40", STEPS_311),
          r("Low-data warning", "Under 100 examples", "crates/common/src/training_profile.rs:56"),
        ],
      },
    ],
  },

  personas: {
    summary:
      "Rust crate that registers, lists, and deletes trained personas from their metadata.json files.",
    sections: [
      {
        title: "Storage",
        rows: [
          r("Root", "~/.be-right-back/models/personas", "crates/common/src/paths.rs:15"),
          r("Metadata", "{persona_dir}/metadata.json", "crates/personas/src/storage.rs:21"),
          r("Adapter lookup", "adapters.safetensors, else adapter/adapters.safetensors", "crates/personas/src/storage.rs:26"),
          r("Listing", "Skips dirs without metadata.json", "crates/personas/src/registry.rs:28"),
        ],
      },
      {
        title: "Metadata fields",
        rows: [
          r("Identity", "persona_id, display_name, base_model, created_at", "crates/personas/src/metadata.rs:8"),
          r("training_config", "lora_rank, lora_alpha, learning_rate, max_steps, batch_size", "crates/personas/src/metadata.rs:30"),
          r("metrics", "final_loss, training_duration_secs, total_examples", "crates/personas/src/metadata.rs:40"),
          r("learning_rate", "Recorded as a fixed 1e-5", "apps/desktop/src-tauri/src/commands/training.rs:290"),
        ],
      },
      {
        title: "Per-tier profile",
        rows: [
          r("9B / 4B", "rank 16, alpha 32, seq 1024, top 50% of layers (16), cap 500 steps", "crates/common/src/training_profile.rs:98", PROFILE),
          r("2B", "rank 8, alpha 16, seq 768, all layers, cap 400 steps", "crates/common/src/training_profile.rs:127", PROFILE),
          r("0.8B", "rank 8, alpha 16, seq 512, all layers, cap 350 steps", "crates/common/src/training_profile.rs:143", PROFILE),
          r("Batch", "1 × grad accum 4 on every tier", "crates/common/src/training_profile.rs:102"),
        ],
      },
    ],
  },

  /* -------------------------------------------------------------- python */

  "embed-py": {
    summary:
      "Python MLX script. It splits 1:1 chats into overlapping chunks, embeds them, and writes DuckDB.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Model", "mlx-community/nomicai-modernbert-embed-base-8bit", "mlx/src/config/embedding.py:29"),
          r("Dims", "768", "mlx/src/config/embedding.py:30"),
          r("Quantization", "8-bit", "mlx/src/config/embedding.py:29"),
          r("Prefix", "\"search_document: \" (queries: \"search_query: \")", "mlx/src/config/embedding.py:32"),
          r("Token ceiling", "max_length 512, truncation on", "mlx/src/ml/embeddings.py:116"),
          r("Pooling", "text_embeds, else mean pool + L2 normalize", "mlx/src/ml/embeddings.py:124"),
        ],
      },
      {
        title: "Data split",
        rows: [
          r("Scope", "Chunks per contact, never across contacts", "mlx/src/pipelines/embedding.py:434"),
          r("Conversation break", "A gap over 4 hours starts a new conversation", "mlx/src/pipelines/embedding.py:39"),
          r("Window", "8 messages, inside one conversation", "mlx/src/config/embedding.py:39"),
          r("Stride", "4 messages (50% overlap)", "mlx/src/config/embedding.py:40", STRIDE_318),
          r("Min chunk", "50 chars, header included", "mlx/src/config/embedding.py:42"),
          r("Chunk text", "[Contact: Name | YYYY-MM-DD], then \"Me: …\" and \"Name: …\" lines", "mlx/src/pipelines/embedding.py:116"),
          r("Dropped", "Tapback text, text under 2 chars; U+FFFC removed", "mlx/src/data/loaders.py:45"),
        ],
      },
      {
        title: "Batching",
        rows: [
          r("Embed batch", "128 (32 GB+ RAM), 64 (16 GB+), 32 below", "mlx/src/config/embedding.py:17", BATCH_318),
          r("Sort", "By text length, to cut padding", "mlx/src/pipelines/embedding.py:190"),
          r("Contact batches", "10 contacts for the top 50, then 50", "mlx/src/pipelines/embedding.py:155"),
          r("Write buffer", "2000 chunks → temp Parquet → COPY", "mlx/src/pipelines/embedding.py:192", WRITE_318),
          r("Metal cache", "512 MB limit, cleared after each embed batch", "mlx/src/ml/embeddings.py:19"),
          r("DuckDB writer", "memory_limit 4 GB, threads 2, spills to /tmp/brb_duckdb_tmp", "mlx/src/data/storage.py:20"),
          r("Checkpoint", "DuckDB CHECKPOINT every 5 contact batches", "mlx/src/pipelines/embedding.py:499"),
        ],
      },
    ],
  },

  "embed-query-py": {
    summary:
      "Embeds one search query as a 768-dim vector. The daemon does this warm; this script is the cold fallback.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Embedding model", "mlx-community/nomicai-modernbert-embed-base-8bit", "mlx/src/config/embedding.py:29"),
          r("Dims", "768", "mlx/src/config/embedding.py:30"),
          r("Query prefix", "\"search_query: \" (chunks use \"search_document: \")", "mlx/src/config/embedding.py:32"),
          r("Token ceiling", "max_length 512, truncation on, padding on", "mlx/src/ml/embeddings.py:111"),
          r("Pooling", "text_embeds if present, else mean pool, then L2 normalize", "mlx/src/ml/embeddings.py:124"),
        ],
      },
      {
        title: "Inputs and outputs",
        rows: [
          r("Input", "One line of query text on stdin", "mlx/src/entry/embed_query.py:41"),
          r("Output line", "{\"type\":\"embedding\", \"vector\":[…], \"dims\":768}", "mlx/src/entry/embed_query.py:74"),
          r("Error line", "{\"type\":\"error\", \"message\":\"Embedding failed: …\"}", "mlx/src/entry/embed_query.py:77"),
          r("Logs", "stderr only", "mlx/src/entry/embed_query.py:46"),
        ],
      },
      {
        title: "When it runs",
        rows: [
          r("Fast path", "Daemon embed_query command over the socket; the model stays loaded; same JSON reply", "mlx/src/entry/inference_daemon.py:1052"),
          r("Fallback", "Rust spawns the script once per query if the daemon call fails", "apps/desktop/src-tauri/src/commands/search.rs:143"),
          r("Rust caller", "ingestion::embed_query() writes the query to stdin and reads JSON stdout", "crates/ingestion/src/python.rs:336"),
          r("Casper sub-queries", "Cleaned query + longest words (3+ chars), 3 vectors max", "crates/ingestion/src/query_planner.rs:308"),
          r("Casper caller", "Embeds each sub-query through the daemon", "crates/inference/src/agent/mod.rs:1282"),
        ],
      },
    ],
  },

  "rerank-py": {
    summary:
      "Scores (query, chunk) pairs with a cross-encoder. Rust reorders the hits by that score.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Cross-encoder", "cross-encoder/ms-marco-MiniLM-L-6-v2", "mlx/src/ml/reranker.py:30"),
          r("Size", "22M params, 6 layers, trained on MS MARCO", "mlx/src/ml/reranker.py:24"),
          r("Library", "sentence-transformers CrossEncoder", "mlx/src/ml/reranker.py:17"),
          r("Score", "Raw logits, not 0–1; higher means more relevant", "mlx/src/ml/reranker.py:59"),
          r("Latency", "~50–150 ms for 30 candidates on Apple Silicon", "mlx/src/ml/reranker.py:27"),
        ],
      },
      {
        title: "Inputs and outputs",
        rows: [
          r("Request line", "{\"query\":…, \"candidates\":[{chunk_id, text}]}", "mlx/src/entry/rerank.py:9"),
          r("Response line", "{\"scores\":[{chunk_id, score}]}, sorted by score, highest first", "mlx/src/ml/reranker.py:114"),
          r("Error line", "{\"error\":\"…\"}", "mlx/src/entry/rerank.py:25"),
          r("Protocol", "Newline-delimited JSON; one line in, one line out; the model stays loaded", "mlx/src/entry/rerank.py:62"),
        ],
      },
      {
        title: "When it runs",
        rows: [
          r("Fast path", "Daemon rerank command: {query, passages} in, {type: rerank_result, scores: [floats]} out, in passage order", "mlx/src/entry/inference_daemon.py:1073"),
          r("Subprocess role", "Cold fallback when the daemon is down, plus the CLI", "crates/ingestion/src/rerank.rs:25"),
          r("Subprocess timeout", "30 s (cold load ~5–7 s)", "crates/ingestion/src/rerank.rs:33"),
          r("Daemon socket timeout", "60 s per read", "crates/inference/src/daemon_connection.rs:16"),
          r("Retries", "Respawns once on a broken pipe or closed stdout, then gives up", "crates/ingestion/src/rerank.rs:191"),
          r("On failure", "Keeps the original order", "crates/ingestion/src/search.rs:304"),
        ],
      },
    ],
  },

  "train-py": {
    summary:
      "Python script that runs MLX-LM LoRA fine-tuning and streams JSON progress lines to Rust.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Default base", "mlx-community/Qwen3.5-9B-4bit", "mlx/src/constants.py:8"),
          r("Desktop base", "The caller passes base_model; its tier sets the profile, else the memory tier does", "apps/desktop/src-tauri/src/commands/training.rs:96"),
          r("LoRA targets", "linear_attn in_proj_qkv / out_proj, self_attn q / k / v / o, mlp gate / up / down", "mlx/src/config/training.py:24"),
          r("Adapted layers", "Top N layers when the profile sets --num-layers, else all", "mlx/src/core/train.py:150"),
          r("Added token", "<MSG_BREAK>, seeded from the \\n\\n row, with LoRA on its output row", "mlx/src/utils/msg_break.py:1"),
        ],
      },
      {
        title: "Data split",
        rows: [
          r("Train / valid", "First 90% train, last 10% valid, in file order", "mlx/src/core/train.py:60", SPLIT_311),
          r("Loss mask", "mask_prompt=True: loss on assistant turns only", "mlx/src/config/training.py:75"),
          r("Val batches", "25", "mlx/src/core/train.py:169"),
        ],
      },
      {
        title: "Settings",
        rows: [
          r("LoRA defaults", "rank 16, alpha 32 (scale alpha / rank = 2), dropout 0.1", "mlx/src/config/training.py:9", PROFILE),
          r("Desktop LoRA", "Rank, alpha, seq len, steps, and grad accum come from the tier profile", "apps/desktop/src-tauri/src/commands/training.rs:138"),
          r("Optimizer", "AdamW, lr 1e-5, weight decay 0.01, warmup 50", "mlx/src/config/training.py:60"),
          r("Batch", "1 × grad accum 4 = effective 4", "mlx/src/config/training.py:61"),
          r("Max steps", "500 (CLI default)", "mlx/src/entry/train.py:42"),
          r("Max seq len", "1024 (CLI default)", "mlx/src/entry/train.py:49"),
          r("Eval / save", "Eval every 50 steps, save every 200, report every 10", "mlx/src/config/training.py:64"),
          r("Early stop", "Patience 3 evals, min gain 0.05", "mlx/src/config/training.py:83"),
          r("Other", "seed 0, gradient checkpointing on", "mlx/src/core/train.py:158"),
        ],
      },
      {
        title: "Outputs",
        rows: [
          r("Progress line", "{\"type\":\"training_progress\", phase, step, total_steps, progress, loss, message}", "mlx/src/core/callbacks.py:47"),
          r("Validation line", "phase \"validating\" with val_loss and best_val_loss", "mlx/src/core/callbacks.py:77"),
          r("Phases", "loading_data, downloading, training, validating, finalizing, complete", "apps/desktop/src-tauri/src/commands/training.rs:194"),
        ],
      },
    ],
  },

  "agent-daemon": {
    summary:
      "Long-lived MLX process for Casper. It also embeds queries and reranks hits for search and analysis.",
    sections: [
      {
        title: "Model",
        rows: [
          r("LLM", "Base only (__base__, no adapter)", "crates/inference/src/engines/mlx_python/engine.rs:357"),
          r("Reload rule", "Skips the load if model and persona match", "mlx/src/entry/inference_daemon.py:162"),
          r("Embedder", "nomicai-modernbert-embed-base-8bit, 768-dim, lazy", "mlx/src/config/embedding.py:29"),
          r("Query prefix", "\"search_query: \"", "mlx/src/config/embedding.py:33"),
          r("Reranker", "cross-encoder/ms-marco-MiniLM-L-6-v2, lazy", "mlx/src/ml/reranker.py:30"),
        ],
      },
      {
        title: "Process",
        rows: [
          r("Socket", "~/.be-right-back/run/daemon-agent.sock", "crates/common/src/paths.rs:151"),
          r("PID and log", "run/daemon-agent.pid, run/daemon-agent.log", "crates/common/src/paths.rs:158"),
          r("Permissions", "Owner-only socket (umask 0o177)", "mlx/src/entry/inference_daemon.py:768"),
          r("Idle exit", "After 30 min idle with no clients, checked every 60 s", "mlx/src/entry/inference_daemon.py:747"),
          r("Callers", "Casper, the search_messages command, conversation analysis", "apps/desktop/src-tauri/src/commands/search.rs:71"),
        ],
      },
      {
        title: "Protocol",
        rows: [
          r("Wire", "JSON lines; {\"cmd\": …} in, {\"type\": …} out", "crates/inference/src/engines/mlx_python/protocol.rs:11"),
          r("Commands", "load, generate, embed_query, rerank, analyze_persona, ping, shutdown", "crates/inference/src/engines/mlx_python/protocol.rs:12"),
          r("Responses", "ready, loaded, token, complete, embedding, rerank_result, analysis_*, error, pong, shutting_down, log", "crates/inference/src/engines/mlx_python/protocol.rs:92"),
          r("On connect", "Sends {\"type\":\"ready\"}", "mlx/src/entry/inference_daemon.py:820"),
          r("GPU queue", "One asyncio queue runs all GPU work in order; ping and shutdown skip it", "mlx/src/entry/inference_daemon.py:754"),
        ],
      },
    ],
  },

  "persona-daemon": {
    summary:
      "Long-lived MLX process for persona chat: the tier's base model plus a LoRA adapter.",
    sections: [
      {
        title: "Model",
        rows: [
          r("Base model", "The tier's 4-bit model; the model preference overrides it", "crates/common/src/model_tiers.rs:278"),
          r("Adapter", "models/personas/{contact}/adapter/ or adapters.safetensors", "mlx/src/entry/inference_daemon.py:186", YOU_ONLY),
          r("No adapter", "Falls back to the base model", "mlx/src/entry/inference_daemon.py:213"),
        ],
      },
      {
        title: "Process",
        rows: [
          r("Socket", "~/.be-right-back/run/daemon-persona.sock", "crates/common/src/paths.rs:151"),
          r("Protocol", "Same JSON-lines daemon as Casper, with its own socket and process", "crates/inference/src/daemon_manager.rs:4"),
          r("Output", "One complete line per generate in socket mode", "mlx/src/entry/inference_daemon.py:1048"),
        ],
      },
      {
        title: "Prompt and sampling",
        rows: [
          r("Template", "ChatML <|im_start|>role … <|im_end|>", "mlx/src/entry/inference_daemon.py:391"),
          r("Thinking off", "Appends an empty <think></think> block", "mlx/src/entry/inference_daemon.py:400"),
          r("Repetition penalty", "Looks back over the last 20 tokens", "mlx/src/entry/inference_daemon.py:1017"),
          r("Default stops", "\\n\\n\\n, \"Have a great day\", \"You're welcome!\", \">):\", \"If you have any\", \"Feel free to\"", "mlx/src/entry/inference_daemon.py:122"),
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- disk */

  "chat-db": {
    summary:
      "Apple's live iMessage SQLite file. The app copies it and reads the copy.",
    sections: [
      {
        title: "Source",
        rows: [
          r("Path", "~/Library/Messages/chat.db", "crates/common/src/constants.rs:11"),
          r("Live open", "Read-only, file:…?immutable=1 (date range only)", "crates/messages-db/src/db/snapshot.rs:93"),
          r("Access", "Needs Full Disk Access", "crates/messages-db/src/db/snapshot.rs:99"),
          r("Contacts source", "~/Library/Application Support/AddressBook, highest-version AddressBook-v*.abcddb (newest mtime breaks ties)", "crates/messages-db/src/db/snapshot.rs:144"),
        ],
      },
      {
        title: "Tables read",
        rows: [
          r("Tables", "message, chat, handle, chat_message_join, chat_handle_join", "mlx/src/queries/sqlite.py:5"),
          r("Message columns", "ROWID, text, attributedBody, is_from_me, date, service", "crates/messages-db/src/db/query_strs.rs:105"),
          r("Contact key", "handle.id (display: uncanonicalized_id)", "mlx/src/queries/sqlite.py:122"),
          r("AddressBook", "ZABCDPHONENUMBER.ZFULLNUMBER + ZABCDRECORD first and last name", "mlx/src/queries/sqlite.py:131"),
        ],
      },
      {
        title: "Filters",
        rows: [
          r("1:1 only", "room_name IS NULL, guid NOT LIKE '%;chat%', 1 distinct person", "mlx/src/queries/sqlite.py:5"),
          r("Message type", "item_type = 0, is_system_message = 0", "mlx/src/queries/sqlite.py:19"),
          r("Tapbacks", "Drops rows with associated_message_type 2000-3999", "mlx/src/queries/sqlite.py:23"),
          r("Epoch", "Cocoa epoch, 978307200 s after the Unix epoch", "crates/common/src/constants.rs:8"),
          r("Timestamp unit", "Nanoseconds if date > 2e9, else seconds", "mlx/src/queries/sqlite.py:43"),
          r("Contact order", "By message count DESC; min-messages counts only in-window messages", "mlx/src/queries/sqlite.py:92"),
        ],
      },
    ],
  },

  raw: {
    summary:
      "One timestamped copy of chat.db and AddressBook. Every later step reads this copy.",
    sections: [
      {
        title: "Layout",
        rows: [
          r("Dir", "~/.be-right-back/data/raw/YYYYMMDD_HHMMSS/ (UTC)", "crates/messages-db/src/db/snapshot.rs:139"),
          r("Messages", "chat_snapshot.db (+ .db-wal and .db-shm if present)", "crates/messages-db/src/db/snapshot.rs:38"),
          r("Contacts", "addressbook_snapshot.db (+ wal and shm)", "crates/messages-db/src/db/snapshot.rs:186"),
          r("Copy method", "fs::copy of the files", "crates/messages-db/src/db/snapshot.rs:43"),
        ],
      },
      {
        title: "Retention",
        rows: [
          r("Kept", "MAX_SNAPSHOTS = 1 (older dirs are deleted)", "crates/common/src/constants.rs:25"),
          r("Cleanup", "Sorts newest first, then remove_dir_all on the rest", "crates/messages-db/src/db/snapshot.rs:262"),
          r("Missing AddressBook", "Warns and continues without names", "crates/messages-db/src/db/snapshot.rs:26"),
        ],
      },
    ],
  },

  "brb-db": {
    summary:
      "SQLite app metadata: run history, contact stats, names, settings, and Casper threads.",
    sections: [
      {
        title: "Storage",
        rows: [
          r("Path", "~/.be-right-back/data/db/brb.db", "crates/common/src/paths.rs:19"),
          r("Schema", "sql/sqlite_schema.sql, run on every open", "crates/ingestion/src/metadata.rs:311"),
          r("Migrations", "ALTER TABLE ADD COLUMN, errors ignored", "crates/ingestion/src/metadata.rs:329"),
        ],
      },
      {
        title: "Ingestion tables",
        rows: [
          r("ingestion_meta", "One row per run: snapshot_dir, counts, embedding_model and dims, chunk_window_size, chunk_stride, date range", "crates/ingestion/sql/sqlite_schema.sql:5"),
          r("contact_stats", "PK (contact_id, ingestion_id): counts, date range, avg length, emoji_rate, top_emojis, response time", "crates/ingestion/sql/sqlite_schema.sql:68"),
          r("contacts", "handle id, normalized_id, display_name, message_count per run", "crates/ingestion/sql/sqlite_schema.sql:106"),
          r("ingestion_settings", "Single row: start_date, end_date, min_messages_per_contact, analytics JSON", "crates/ingestion/sql/sqlite_schema.sql:123"),
        ],
      },
      {
        title: "App tables",
        rows: [
          r("app_state", "Single row: curr_ingestion_id, FDA, base model, model_preference, onboarding", "crates/ingestion/sql/sqlite_schema.sql:26"),
          r("conversation_analysis", "Cached LLM markdown per contact per run", "crates/ingestion/sql/sqlite_schema.sql:144"),
          r("casper_threads, casper_messages", "Saved Casper chats: role, content, thinking, tool_calls JSON", "crates/ingestion/sql/sqlite_schema.sql:173"),
        ],
      },
    ],
  },

  duckdb: {
    summary:
      "Vector store for RAG: one row per chunk with a 768-dim vector, plus a BM25 full-text index.",
    sections: [
      {
        title: "Storage",
        rows: [
          r("Path", "~/.be-right-back/data/db/brb.duckdb", "crates/common/src/paths.rs:20"),
          r("Ingest limits", "memory_limit 4 GB, threads 2", "crates/ingestion/src/vectordb.rs:180"),
          r("Read limits", "One shared read-only connection, 2 GB, threads 2", "crates/ingestion/src/vectordb.rs:60"),
          r("Re-ingest", "TRUNCATE chunk_projections, message_chunks, daily_messages", "mlx/src/pipelines/embedding.py:371"),
        ],
      },
      {
        title: "message_chunks",
        rows: [
          r("Key", "chunk_id BIGINT PK", "crates/ingestion/sql/duckdb_schema.sql:10"),
          r("Vector", "embedding FLOAT[768]", "crates/ingestion/sql/duckdb_schema.sql:16"),
          r("Content", "chunk_data JSON {messages[sender, text, ts, message_id], formatted}, formatted_text", "mlx/src/data/storage.py:177"),
          r("Range", "start / end_message_id, message_ids[], start / end_timestamp", "crates/ingestion/sql/duckdb_schema.sql:18"),
          r("Flags", "has_from_me, has_from_them, has_questions, message_count, total_chars", "crates/ingestion/sql/duckdb_schema.sql:28"),
          r("Run link", "ingestion_id → brb.db ingestion_meta.id", "crates/ingestion/sql/duckdb_schema.sql:41"),
        ],
      },
      {
        title: "Indexes",
        rows: [
          r("Vector search", "No index. Rust keeps every vector in memory (~700 MB at 229k chunks) and scans them exactly, ~11 ms", "crates/ingestion/src/embedding_matrix.rs:7"),
          r("Built by", "BM25: embed.py after writing; Rust re-creates it if missing", "mlx/src/data/storage.py:237"),
          r("Why no HNSW", "It found ~24% of the true top 10 for questions", "crates/ingestion/src/embedding_matrix.rs:3"),
          r("FTS / BM25", "fts extension on formatted_text, english stemmer + stopwords", "crates/ingestion/src/queries.rs:439"),
          r("Secondary indexes", "(contact_id, end_timestamp DESC), end_timestamp, ingestion_id", "crates/ingestion/sql/duckdb_schema.sql:44"),
          r("Warm-up", "A background thread loads the vectors into memory once", "crates/ingestion/src/vectordb.rs:118"),
        ],
      },
      {
        title: "Other tables",
        rows: [
          r("daily_messages", "PK (date, contact_id, is_from_me), message_count", "crates/ingestion/sql/duckdb_schema.sql:258"),
          r("analytics_chunks", "Non-overlapping, topic-aware chunks for HDBSCAN", "crates/ingestion/sql/duckdb_schema.sql:123"),
          r("chunk_projections", "2D and 3D UMAP x, y, z + cluster_id, label, color", "crates/ingestion/sql/duckdb_schema.sql:170"),
          r("Also", "clustering_runs, analytics_runs, daily_activity, daily_word_counts", "crates/ingestion/sql/duckdb_schema.sql:65"),
        ],
      },
    ],
  },

  jsonl: {
    summary:
      "Per-contact training folder with train.jsonl and metadata.json. The trainer reads both.",
    changing: [YOU_ONLY],
    sections: [
      {
        title: "Data split",
        rows: [
          r("Scope", "One contact's 1:1 chat per folder", "apps/desktop/src-tauri/src/commands/training.rs:366", YOU_ONLY),
          r("Roles", "You = user, contact = assistant; no system turn", "crates/training/src/export/jsonl.rs:364", YOU_ROLES),
          r("Train / valid", "train.py takes the first 90% to train, the last 10% to validate", "mlx/src/core/train.py:60", SPLIT_311),
        ],
      },
      {
        title: "Record format",
        rows: [
          r("Line", "{\"messages\":[{\"role\":\"user\", …}, {\"role\":\"assistant\", …}]}", "crates/training/src/export/jsonl.rs:14"),
          r("Double texts", "Same-sender runs joined with <MSG_BREAK>", "crates/training/src/export/jsonl.rs:372"),
          r("Validation", "Needs a user turn and ends on assistant", "crates/training/src/export/jsonl.rs:403"),
        ],
      },
      {
        title: "Storage",
        rows: [
          r("Folder", "~/.be-right-back/data/processed/{contact}/", "apps/desktop/src-tauri/src/commands/training.rs:82", YOU_ONLY),
          r("Files", "train.jsonl, metadata.json", "apps/desktop/src-tauri/src/commands/training.rs:344"),
          r("Reuse", "Skips the export if train.jsonl exists", "apps/desktop/src-tauri/src/commands/training.rs:347"),
        ],
      },
      {
        title: "metadata.json",
        rows: [
          r("Fields", "contact_id, contact_name, export_date, total_messages, training_examples, date_range_start / end", "crates/common/src/models.rs:162"),
          r("More fields", "Avg user and assistant message length, context_window, msg_break_token, system_prompt, persona_stats, llm_analysis", "crates/common/src/models.rs:170"),
          r("context_window", "10 on the desktop path", "apps/desktop/src-tauri/src/commands/training.rs:333"),
        ],
      },
    ],
  },

  models: {
    summary:
      "Base models load by Hugging Face id. Each persona gets one adapter folder.",
    sections: [
      {
        title: "Model",
        rows: [
          r("9B tier", "Qwen3.5-9B-4bit: 24 GB+ Mac (19 GB after the 5 GB reserve). 32 layers, ~5.95 GB", "crates/common/src/model_tiers.rs:69"),
          r("4B tier", "Qwen3.5-4B-4bit: 16 GB+ Mac (11 GB after the 5 GB reserve). 32 layers, ~2.5 GB", "crates/common/src/model_tiers.rs:79"),
          r("2B tier", "Qwen3.5-2B-4bit: 12 GB+ Mac (7 GB after the 5 GB reserve). 24 layers, ~1.5 GB", "crates/common/src/model_tiers.rs:89"),
          r("0.8B tier", "Qwen3.5-0.8B-4bit: fallback below 12 GB. 24 layers, ~0.6 GB", "crates/common/src/model_tiers.rs:99"),
          r("Casper", "Always Qwen3.5-9B-4bit, whatever the tier", "crates/inference/src/agent/mod.rs:441"),
          r("Quantization", "4-bit for chat, Casper, and training", "crates/common/src/model_tiers.rs:278"),
        ],
      },
      {
        title: "Storage",
        rows: [
          r("Base dir", "~/.be-right-back/models/base", "crates/common/src/paths.rs:14"),
          r("Adapter dir", "~/.be-right-back/models/personas/{contact}/", "apps/desktop/src-tauri/src/commands/training.rs:85", YOU_ONLY),
          r("Adapter", "adapters.safetensors", "mlx/src/core/train.py:310"),
          r("Run files", "loss_history.json, loss_plot.png, training_metadata.json, chat_metadata.json", "mlx/src/core/train.py:261"),
        ],
      },
    ],
  },
};

/* --------------------------------------------------------------- layers */

export const LAYER_DETAILS: Record<Layer, LayerDetail> = {
  apps: {
    summary:
      "Three apps: the Tauri desktop app, the brb CLI, and the Next.js site.",
    rows: [
      r("Desktop", "Be Right Back 0.1.0, Tauri v2 + React 19", "apps/desktop/src-tauri/tauri.conf.json:3"),
      r("CLI", "brb binary", "apps/cli/Cargo.toml:13"),
      r("Website", "Next 16.2.9, three ^0.187.0", "apps/website/package.json:29"),
      r("Tauri commands", "38", "apps/desktop/src-tauri/src/lib.rs:137", CMDS_316),
      r("Events", "7 app events + setup-progress", "apps/desktop/src-tauri/src/commands/inference.rs:69"),
      r("Tabs", "home, chat, insights", "apps/desktop/src/types.ts:97"),
      r("Daemon handles", "Persona + agent engines in AppState", "apps/desktop/src-tauri/src/state.rs:137"),
    ],
  },
  rust: {
    summary:
      "8 Cargo workspace members: 6 library crates, the CLI, and the Tauri backend. Every crate depends on common.",
    rows: [
      r("Members", "common, messages-db, training, personas, inference, ingestion, apps/cli, apps/desktop/src-tauri", "Cargo.toml:2"),
      r("Resolver / MSRV", "resolver 2, rust-version 1.91", "Cargo.toml:12"),
      r("Edition", "2024 for the 6 crates and the CLI", "crates/common/Cargo.toml:4"),
      r("Desktop edition", "src-tauri still uses edition 2021", "apps/desktop/src-tauri/Cargo.toml:5"),
      r("messages-db, training, personas", "Each depends on common only", "crates/training/Cargo.toml:13"),
      r("ingestion", "common + messages-db", "crates/ingestion/Cargo.toml:15"),
      r("inference", "common + personas + ingestion + messages-db", "crates/inference/Cargo.toml:15"),
      r("cli (brb)", "All 6 crates", "apps/cli/Cargo.toml:18"),
      r("desktop", "All 6 crates; common with tauri-support", "apps/desktop/src-tauri/Cargo.toml:32"),
      r("Storage crates", "DuckDB 2.0.1 bundled (crate = 1.20001.0), rusqlite 0.37 bundled", "Cargo.toml:35"),
    ],
  },
  python: {
    summary:
      "Python 3.13 and MLX scripts. Two long-lived daemons; the rest are one-shot subprocesses.",
    rows: [
      r("Python", ">=3.13, <3.14", "mlx/pyproject.toml:6"),
      r("MLX", "mlx >=0.31.2, mlx-lm >=0.31.3", "mlx/pyproject.toml:8"),
      r("DuckDB", "==2.0.1, pinned to match the Rust crate", "mlx/pyproject.toml:24"),
      r("Entry scripts", "7: embed, analyze_persona, inference_daemon, analytics, train, rerank, embed_query", "crates/common/src/python_env.rs:32"),
      r("venv", "~/.be-right-back/mlx-venv/bin/python3", "crates/common/src/python_env.rs:91"),
      r("Scripts dir", "~/.be-right-back/mlx/src/entry (bundled app)", "crates/common/src/python_env.rs:145"),
      r("Daemons", "2 roles (persona, agent), one socket each", "crates/inference/src/daemon_manager.rs:25"),
    ],
  },
  disk: {
    summary:
      "All user data lives under ~/.be-right-back. Nothing leaves the Mac.",
    rows: [
      r("Root", "~/.be-right-back", "crates/common/src/paths.rs:9"),
      r("Snapshots", "data/raw/YYYYMMDD_HHMMSS/ (1 kept)", "crates/common/src/paths.rs:10"),
      r("Training data", "data/processed/", "crates/common/src/paths.rs:11"),
      r("Stats", "data/stats/{contact}/", "crates/common/src/paths.rs:89"),
      r("Databases", "data/db/brb.db (SQLite) + brb.duckdb (vectors)", "crates/common/src/paths.rs:13"),
      r("Models", "models/base/, models/personas/", "crates/common/src/paths.rs:14"),
      r("Runtime", "run/ (daemon sockets, PIDs, logs)", "crates/common/src/paths.rs:16"),
      r("Snapshot retention", "MAX_SNAPSHOTS = 1", "crates/common/src/constants.rs:25"),
    ],
  },
};

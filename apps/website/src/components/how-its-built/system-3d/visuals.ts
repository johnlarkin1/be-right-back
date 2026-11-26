/**
 * Small diagrams for the click-in detail panel, one set per block and layer.
 *
 * Each figure is data. `visual.tsx` draws it. Every number here must match a
 * row in `details.ts`, which cites the code. Change the row first, then the
 * figure. Example text (sample messages, chunk names) is marked as an example
 * in the figure's note.
 */

import type { Layer } from "./data";

/** Fill and edge color. a-d are the layer colors; hi is the amber accent. */
export type Tone = "a" | "b" | "c" | "d" | "hi" | "dim";

export interface Step {
  label: string;
  sub?: string;
  tone?: Tone;
  /** Draws several boxes stacked in this step, for parallel work. */
  stack?: { label: string; sub?: string; tone?: Tone }[];
}

export type Viz =
  /** Boxes joined by arrows. `loop` draws a return arrow under them. */
  | { t: "flow"; rows: { label?: string; steps: Step[] }[]; loop?: string }
  /** Messages as dots on a line, with brackets under them. */
  | {
      t: "timeline";
      /** me, them, or a gap marker. A trailing "?" marks a question. */
      msgs: ("me" | "them" | "me?" | "gap")[];
      spans: { from: number; to: number; label: string; row: number }[];
      meLabel: string;
      themLabel: string;
    }
  /** One bar cut into shares. */
  | { t: "split"; parts: { label: string; pct: number; tone: Tone }[] }
  /** A folder tree. `gone` strikes a line through it. */
  | {
      t: "tree";
      lines: {
        depth: number;
        name: string;
        note?: string;
        tone?: Tone;
        gone?: boolean;
      }[];
    }
  /** Table cards with their main columns. */
  | {
      t: "tables";
      tables: { name: string; cols: string[]; tone?: Tone; note?: string }[];
      links?: string[];
    }
  /** Horizontal bars, one series. */
  | {
      t: "bars";
      unit?: string;
      rows: {
        label: string;
        value: number;
        text?: string;
        note?: string;
        tone?: Tone;
      }[];
    }
  /** Grouped bars to compare a few series row by row. */
  | {
      t: "meters";
      series: string[];
      rows: { k: string; values: number[]; text?: string[] }[];
    }
  /** Messages between two lanes, top to bottom. */
  | {
      t: "wire";
      lanes: [string, string];
      msgs: { dir: "r" | "l"; text: string; sub?: string }[];
    }
  /** A 768-dim vector as a grid of cells. */
  | { t: "vector"; dims: number }
  /** Transformer layers, with the LoRA-adapted ones marked. */
  | { t: "layers"; total: number; adapted: number }
  /** A process box with the models it holds. */
  | {
      t: "process";
      name: string;
      sub: string;
      slots: { label: string; sub?: string; tone?: Tone }[];
    }
  /** Prompt or record lines, each with a role and an optional side note. */
  | {
      t: "chat";
      lines: { role: string; text: string; note?: string; tone?: Tone }[];
    }
  /** Big numbers. */
  | { t: "stats"; items: { v: string; k: string }[] }
  /** Lines from an old order to a new order. `after[i]` is an old index. */
  | {
      t: "reorder";
      items: string[];
      after: number[];
      left: string;
      right: string;
    };

export interface Figure {
  title: string;
  /** One or two short sentences under the figure. */
  note?: string;
  /** Spans both columns on wide screens. */
  wide?: boolean;
  viz: Viz;
}

/* ----------------------------------------------------------- stations */

export const STATION_VISUALS: Record<string, Figure[]> = {
  ui: [
    {
      title: "How the window talks to Rust",
      note: "One call goes down with invoke(). Progress comes back as events.",
      viz: {
        t: "wire",
        lanes: ["React UI", "Tauri backend"],
        msgs: [
          { dir: "r", text: 'invoke("get_all_contacts")', sub: "command" },
          { dir: "l", text: "chat-meta, chat-token", sub: "persona chat" },
          { dir: "l", text: "casper-progress", sub: "Casper" },
          {
            dir: "l",
            text: "setup-progress, ingestion-progress",
            sub: "ingestion",
          },
          { dir: "l", text: "training-progress", sub: "training" },
          { dir: "l", text: "analysis-progress", sub: "analysis" },
        ],
      },
    },
    {
      title: "Screens and state",
      viz: {
        t: "stats",
        items: [
          { v: "3", k: "tabs: Home, Chat, Insights" },
          { v: "3", k: "Zustand stores" },
          { v: "7", k: "events listened" },
        ],
      },
    },
  ],

  tauri: [
    {
      title: "38 commands, by group",
      viz: {
        t: "bars",
        rows: [
          { label: "system + ingestion", value: 10 },
          { label: "Casper", value: 8 },
          { label: "insights", value: 6 },
          { label: "model picker", value: 4 },
          { label: "contacts", value: 3 },
          { label: "training", value: 3 },
          { label: "analysis", value: 2 },
          { label: "chat", value: 1 },
          { label: "search", value: 1 },
        ],
      },
    },
    {
      title: "One handle per daemon",
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "AppState", tone: "a" },
              {
                label: "engines",
                stack: [
                  {
                    label: "persona engine",
                    sub: "daemon-persona.sock",
                    tone: "c",
                  },
                  {
                    label: "agent engine",
                    sub: "daemon-agent.sock",
                    tone: "c",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      title: "A persona chat message",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "your message", tone: "a" },
              {
                label: "semantic search",
                sub: "100 hits, sim ≥ 0.15, one contact",
                tone: "b",
              },
              { label: "+ profile", sub: "analysis, ≤ 1500 chars", tone: "d" },
              { label: "persona daemon", sub: "base + LoRA", tone: "c" },
              { label: "chat-token events", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],

  "messages-db": [
    {
      title: "Getting the text of one message",
      note: "Newer macOS often leaves the text column empty. The text then lives in an attributedBody blob.",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "text column", sub: "used when set", tone: "d" },
              {
                label: "attributedBody",
                sub: "bplist00 or streamtyped",
                tone: "d",
              },
              {
                label: "decoders",
                stack: [
                  { label: "secure keyed", tone: "b" },
                  { label: "legacy keyed", tone: "b" },
                  { label: "NSUnarchiver", tone: "b" },
                ],
              },
              {
                label: "+ links",
                sub: "http(s) found in the bytes",
                tone: "b",
              },
              { label: "NFC text", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Putting a name on a handle",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            label: "phone",
            steps: [
              { label: "handle.id", tone: "d" },
              { label: "E.164", sub: "US default region", tone: "b" },
              { label: "AddressBook name", tone: "hi" },
            ],
          },
          {
            label: "email",
            steps: [
              { label: "handle.id", tone: "d" },
              { label: "lowercase", tone: "b" },
              { label: "AddressBook name", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],

  ingestion: [
    {
      title: "Ingest: five stages",
      note: "Rust takes the snapshot and writes stats. embed.py runs the rest and reports progress back.",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "Snapshot", sub: "Rust", tone: "b" },
              { label: "Parsing", sub: "embed.py", tone: "c" },
              { label: "Chunking", sub: "8 msgs, stride 4", tone: "c" },
              { label: "Embedding", sub: "768-dim", tone: "c" },
              { label: "Saving", sub: "brb.duckdb", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Search: from a question to k hits",
      note: 'k is 7 by default and 20 for questions like "most" or "usually". Each ranker fetches 3× k.',
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              {
                label: "query planner",
                sub: "dates, clean text, k",
                tone: "b",
              },
              {
                label: "rankers",
                stack: [
                  { label: "semantic", sub: "exact cosine scan", tone: "d" },
                  { label: "BM25", sub: "full text", tone: "d" },
                  { label: "keyword", tone: "d" },
                ],
              },
              { label: "RRF + recency", sub: "Σ 1/(60+rank)", tone: "b" },
              { label: "MMR λ 0.7", sub: "or contact penalty", tone: "b" },
              { label: "rerank", sub: "optional", tone: "c" },
              { label: "top k", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Minimum similarity, by caller",
      viz: {
        t: "bars",
        rows: [
          {
            label: "Casper tool",
            value: 0.25,
            text: "0.25",
            note: "k + 5",
          },
          {
            label: "persona chat",
            value: 0.15,
            text: "0.15",
            note: "100 hits",
          },
          {
            label: "desktop search",
            value: 0.1,
            text: "0.10",
            note: "then rerank",
          },
        ],
      },
    },
    {
      title: "Context handed to the LLM",
      viz: {
        t: "stats",
        items: [
          { v: "6000", k: "chars in total" },
          { v: "300", k: "chars per chunk" },
          { v: "3", k: "excerpts per day" },
        ],
      },
    },
  ],

  inference: [
    {
      title: "Casper's tool loop",
      note: "The agent model can call 7 tools. After 5 rounds, one last pass writes the answer.",
      wide: true,
      viz: {
        t: "flow",
        loop: "the result goes back to the agent model, up to 5 rounds",
        rows: [
          {
            steps: [
              { label: "question", tone: "a" },
              { label: "agent model", sub: "Qwen3.5-9B-4bit", tone: "c" },
              { label: "tool call", sub: "e.g. search_messages", tone: "b" },
              { label: "tool result", tone: "d" },
              { label: "answer", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Sampling: persona chat vs Casper",
      viz: {
        t: "meters",
        series: ["Persona chat", "Casper"],
        rows: [
          { k: "temp", values: [0.8, 0.6] },
          { k: "top_p", values: [0.95, 0.95] },
          { k: "top_k", values: [40, 20] },
          { k: "repetition", values: [1.1, 1.3] },
          { k: "max tokens", values: [256, 4096] },
        ],
      },
    },
    {
      title: "Starting a daemon",
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "spawn", sub: "inference_daemon.py", tone: "b" },
              {
                label: "poll socket",
                sub: "every 100 ms, 30 s max",
                tone: "b",
              },
              { label: "ready", sub: "60 s per reply", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],

  training: [
    {
      title: "Cutting a chat into examples",
      note: "Example messages. An example starts at your question, ends on their reply, and never overlaps the next.",
      wide: true,
      viz: {
        t: "timeline",
        msgs: [
          "me?",
          "them",
          "me",
          "them",
          "them",
          "me?",
          "them",
          "me",
          "gap",
          "me",
          "me?",
          "them",
          "them",
        ],
        spans: [
          { from: 0, to: 4, label: "example 1", row: 0 },
          { from: 5, to: 6, label: "example 2", row: 0 },
          { from: 10, to: 12, label: "example 3", row: 0 },
        ],
        meLabel: "you (user)",
        themLabel: "contact (assistant)",
      },
    },
    {
      title: "From messages to JSONL",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "1:1 messages", tone: "d" },
              {
                label: "filter",
                sub: "< 2 chars, attachments, no letters",
                tone: "b",
              },
              { label: "split at 4 h gaps", tone: "b" },
              { label: "examples", sub: "≤ 8 turns", tone: "b" },
              { label: "newest 50,000", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Training budget",
      viz: {
        t: "stats",
        items: [
          { v: "8 GB", k: "min memory" },
          { v: "4", k: "target epochs" },
          { v: "120", k: "step floor" },
          { v: "< 100", k: "examples warns" },
        ],
      },
    },
  ],

  personas: [
    {
      title: "On disk",
      viz: {
        t: "tree",
        lines: [
          { depth: 0, name: "models/personas/" },
          { depth: 1, name: "{contact}/", tone: "hi" },
          {
            depth: 2,
            name: "metadata.json",
            note: "id, base model, config, metrics",
          },
          {
            depth: 2,
            name: "adapters.safetensors",
            note: "or adapter/adapters.safetensors",
          },
          {
            depth: 1,
            name: "no-metadata/",
            note: "skipped when listing",
            gone: true,
          },
        ],
      },
    },
    {
      title: "LoRA profile by tier",
      viz: {
        t: "meters",
        series: ["9B / 4B", "2B", "0.8B"],
        rows: [
          { k: "rank", values: [16, 8, 8] },
          { k: "alpha", values: [32, 16, 16] },
          { k: "seq len", values: [1024, 768, 512] },
          {
            k: "adapted layers",
            values: [16, 24, 24],
            text: ["top 16", "all 24", "all 24"],
          },
          { k: "step cap", values: [500, 400, 350] },
        ],
      },
    },
  ],

  "embed-py": [
    {
      title: "Chunking: window 8, stride 4",
      note: "Example chat. Windows overlap by half and stop at a 4-hour gap. PR #318 moves the stride to 8.",
      wide: true,
      viz: {
        t: "timeline",
        msgs: [
          "me",
          "them",
          "them",
          "me",
          "them",
          "me",
          "me",
          "them",
          "them",
          "me",
          "them",
          "me",
          "gap",
          "them",
          "me",
          "them",
          "me",
        ],
        spans: [
          { from: 0, to: 7, label: "chunk 1", row: 0 },
          { from: 4, to: 11, label: "chunk 2", row: 1 },
          { from: 8, to: 11, label: "chunk 3", row: 2 },
          { from: 13, to: 16, label: "chunk 4", row: 0 },
        ],
        meLabel: "Me",
        themLabel: "contact",
      },
    },
    {
      title: "One chunk becomes one vector",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              {
                label: "chunk text",
                sub: "header + Me / Name lines",
                tone: "d",
              },
              { label: "+ prefix", sub: "search_document:", tone: "c" },
              { label: "ModernBERT", sub: "8-bit, ≤ 512 tokens", tone: "c" },
              { label: "pool + L2", tone: "c" },
              { label: "768 floats", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "The vector",
      viz: { t: "vector", dims: 768 },
    },
    {
      title: "Embed batch size by RAM",
      note: "PR #318 uses 64 on every Mac with 16 GB or more.",
      viz: {
        t: "bars",
        rows: [
          { label: "32 GB+", value: 128 },
          { label: "16 GB+", value: 64 },
          { label: "below", value: 32 },
        ],
      },
    },
  ],

  "embed-query-py": [
    {
      title: "A query becomes a vector",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "query", tone: "a" },
              { label: "+ prefix", sub: "search_query:", tone: "c" },
              { label: "ModernBERT", sub: "8-bit, ≤ 512 tokens", tone: "c" },
              { label: "pool + L2", tone: "c" },
              { label: "768 floats", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Warm path and cold path",
      note: "The daemon keeps the model loaded. The script loads it on every call.",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            label: "warm",
            steps: [
              { label: "Rust", tone: "b" },
              {
                label: "daemon embed_query",
                sub: "over the socket",
                tone: "c",
              },
              { label: "vector", tone: "hi" },
            ],
          },
          {
            label: "cold",
            steps: [
              { label: "Rust", tone: "b" },
              {
                label: "embed_query.py",
                sub: "stdin → JSON stdout",
                tone: "dim",
              },
              { label: "vector", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],

  "rerank-py": [
    {
      title: "Reranking reorders the hits",
      note: "Example. The cross-encoder reads the query and each chunk together, then sorts by score.",
      viz: {
        t: "reorder",
        items: ["chunk A", "chunk B", "chunk C", "chunk D", "chunk E"],
        after: [2, 0, 4, 1, 3],
        left: "hybrid search",
        right: "cross-encoder",
      },
    },
    {
      title: "Scoring",
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "(query, chunk)", sub: "one pair per hit", tone: "d" },
              { label: "MiniLM-L-6", sub: "22M params", tone: "c" },
              { label: "logit", sub: "higher is better", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Which path runs",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            label: "warm",
            steps: [
              { label: "daemon rerank", sub: "model stays loaded", tone: "c" },
              { label: "scores", tone: "hi" },
            ],
          },
          {
            label: "cold",
            steps: [
              {
                label: "rerank.py",
                sub: "cold load ~5-7 s, 30 s timeout",
                tone: "dim",
              },
              { label: "scores", tone: "hi" },
            ],
          },
          {
            label: "fails",
            steps: [{ label: "keep original order", tone: "dim" }],
          },
        ],
      },
    },
  ],

  "train-py": [
    {
      title: "Where the adapter goes (9B profile)",
      note: "LoRA trains small matrices on the top 16 of 32 layers. The 4-bit base stays frozen.",
      wide: true,
      viz: { t: "layers", total: 32, adapted: 16 },
    },
    {
      title: "Train / valid split",
      note: "In file order. PR #311 adds a seeded held-out split.",
      viz: {
        t: "split",
        parts: [
          { label: "train", pct: 90, tone: "c" },
          { label: "valid", pct: 10, tone: "hi" },
        ],
      },
    },
    {
      title: "Loss mask",
      note: "Example record. Only the assistant turn counts toward the loss.",
      viz: {
        t: "chat",
        lines: [
          {
            role: "user",
            text: "you around tonight?",
            note: "no loss",
            tone: "dim",
          },
          {
            role: "assistant",
            text: "yeah<MSG_BREAK>what time",
            note: "loss",
            tone: "hi",
          },
        ],
      },
    },
    {
      title: "Defaults",
      wide: true,
      viz: {
        t: "stats",
        items: [
          { v: "16 / 32", k: "LoRA rank / alpha" },
          { v: "1e-5", k: "AdamW learning rate" },
          { v: "1 × 4", k: "batch × grad accum" },
          { v: "500", k: "max steps" },
          { v: "3", k: "evals of patience" },
        ],
      },
    },
  ],

  "agent-daemon": [
    {
      title: "Three models in one process",
      viz: {
        t: "process",
        name: "Casper daemon",
        sub: "run/daemon-agent.sock",
        slots: [
          { label: "Qwen3.5-9B-4bit", sub: "base, no adapter", tone: "hi" },
          { label: "ModernBERT embedder", sub: "768-dim, lazy", tone: "c" },
          { label: "MiniLM cross-encoder", sub: "lazy", tone: "c" },
        ],
      },
    },
    {
      title: "One GPU queue",
      note: "GPU work runs one job at a time, in order. ping and shutdown answer at once.",
      viz: {
        t: "flow",
        rows: [
          {
            label: "GPU",
            steps: [
              {
                label: "commands",
                stack: [
                  { label: "generate", tone: "b" },
                  { label: "embed_query", tone: "b" },
                  { label: "rerank", tone: "b" },
                ],
              },
              { label: "asyncio queue", tone: "c" },
              { label: "MLX", tone: "hi" },
            ],
          },
          {
            label: "now",
            steps: [
              { label: "ping, shutdown", tone: "dim" },
              { label: "reply", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "On the socket",
      note: "JSON lines. The daemon exits after 30 minutes with no clients.",
      wide: true,
      viz: {
        t: "wire",
        lanes: ["Rust caller", "Casper daemon"],
        msgs: [
          { dir: "l", text: '{"type":"ready"}', sub: "on connect" },
          { dir: "r", text: '{"cmd":"embed_query"}' },
          { dir: "l", text: '{"type":"embedding"}' },
          { dir: "r", text: '{"cmd":"rerank"}' },
          { dir: "l", text: '{"type":"rerank_result"}' },
          { dir: "r", text: '{"cmd":"generate"}' },
          { dir: "l", text: '{"type":"complete"}' },
        ],
      },
    },
  ],

  "persona-daemon": [
    {
      title: "Base model plus your adapter",
      viz: {
        t: "process",
        name: "Persona daemon",
        sub: "run/daemon-persona.sock",
        slots: [
          { label: "LoRA adapter", sub: "models/personas/…", tone: "hi" },
          { label: "base model", sub: "the tier's 4-bit model", tone: "c" },
        ],
      },
    },
    {
      title: "The prompt it builds",
      note: "ChatML. With thinking off, an empty think block goes before the reply.",
      viz: {
        t: "chat",
        lines: [
          { role: "system", text: "You are {contact}. …", tone: "d" },
          { role: "user", text: "{your message}", tone: "a" },
          {
            role: "assistant",
            text: "<think></think>",
            note: "thinking off",
            tone: "hi",
          },
        ],
      },
    },
  ],

  "chat-db": [
    {
      title: "Tables read",
      note: "Two join tables link messages to chats and chats to people.",
      wide: true,
      viz: {
        t: "tables",
        tables: [
          {
            name: "message",
            cols: [
              "ROWID",
              "text",
              "attributedBody",
              "is_from_me",
              "date",
              "service",
            ],
            tone: "hi",
          },
          {
            name: "chat_message_join",
            cols: ["chat_id", "message_id"],
            tone: "dim",
          },
          { name: "chat", cols: ["ROWID", "room_name", "guid"] },
          {
            name: "chat_handle_join",
            cols: ["chat_id", "handle_id"],
            tone: "dim",
          },
          { name: "handle", cols: ["ROWID", "id", "uncanonicalized_id"] },
        ],
        links: [
          "message ← chat_message_join → chat",
          "chat ← chat_handle_join → handle",
        ],
      },
    },
    {
      title: "Which rows count",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "all rows", tone: "d" },
              { label: "1:1 chats", sub: "no room_name, 1 person", tone: "b" },
              {
                label: "real messages",
                sub: "item_type 0, not system",
                tone: "b",
              },
              { label: "no tapbacks", tone: "b" },
              { label: "Unix time", sub: "+ 978307200 s", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],

  raw: [
    {
      title: "Copy, then read the copy",
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "chat.db", sub: "+ AddressBook", tone: "d" },
              { label: "fs::copy", tone: "b" },
              { label: "snapshot", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "data/raw/",
      note: "Example timestamps. Only the newest snapshot is kept.",
      viz: {
        t: "tree",
        lines: [
          { depth: 0, name: "data/raw/" },
          { depth: 1, name: "20261122_211103/", note: "UTC, kept", tone: "hi" },
          { depth: 2, name: "chat_snapshot.db", note: "+ -wal, -shm" },
          { depth: 2, name: "addressbook_snapshot.db", note: "+ -wal, -shm" },
          { depth: 1, name: "20261120_093012/", note: "deleted", gone: true },
        ],
      },
    },
  ],

  "brb-db": [
    {
      title: "Tables",
      note: "Every run gets an ingestion_meta row. Stats, contacts, and analyses point back to it with ingestion_id.",
      wide: true,
      viz: {
        t: "tables",
        tables: [
          {
            name: "ingestion_meta",
            cols: [
              "id",
              "snapshot_dir",
              "embedding_model",
              "chunk_window_size",
              "chunk_stride",
            ],
            tone: "hi",
          },
          {
            name: "contact_stats",
            cols: ["contact_id", "ingestion_id", "message_count", "emoji_rate"],
          },
          {
            name: "contacts",
            cols: [
              "contact_id",
              "ingestion_id",
              "display_name",
              "message_count",
            ],
          },
          {
            name: "ingestion_settings",
            cols: ["start_date", "end_date", "min_messages_per_contact"],
          },
          {
            name: "app_state",
            cols: ["curr_ingestion_id", "model_preference"],
          },
          {
            name: "conversation_analysis",
            cols: ["contact_id", "ingestion_id", "analysis_markdown"],
          },
          { name: "casper_threads", cols: ["id", "title"], tone: "dim" },
          {
            name: "casper_messages",
            cols: ["thread_id", "role", "content", "tool_calls"],
            tone: "dim",
          },
        ],
      },
    },
  ],

  duckdb: [
    {
      title: "One row per chunk",
      wide: true,
      viz: {
        t: "tables",
        tables: [
          {
            name: "message_chunks",
            cols: [
              "chunk_id",
              "contact_id",
              "embedding FLOAT[768]",
              "formatted_text",
              "chunk_data JSON",
              "message_ids[]",
              "end_timestamp",
              "ingestion_id",
            ],
            tone: "hi",
          },
          {
            name: "daily_messages",
            cols: ["date", "contact_id", "is_from_me", "message_count"],
          },
          {
            name: "analytics_chunks",
            cols: ["topic-aware chunks", "for HDBSCAN"],
          },
          {
            name: "chunk_projections",
            cols: ["x", "y", "z", "cluster_id", "label"],
          },
        ],
        links: ["ingestion_id → brb.db ingestion_meta.id"],
      },
    },
    {
      title: "How each ranker reads it",
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              { label: "embedding", tone: "d" },
              {
                label: "in-memory scan",
                sub: "exact cosine, no index",
                tone: "hi",
              },
            ],
          },
          {
            steps: [
              { label: "formatted_text", tone: "d" },
              { label: "BM25", sub: "english stemmer", tone: "hi" },
            ],
          },
        ],
      },
    },
    {
      title: "Memory limits",
      viz: {
        t: "stats",
        items: [
          { v: "4 GB", k: "while ingesting" },
          { v: "2 GB", k: "shared read-only" },
          { v: "2", k: "threads" },
        ],
      },
    },
  ],

  jsonl: [
    {
      title: "One line of train.jsonl",
      note: "Example record. Back-to-back texts join with <MSG_BREAK>.",
      viz: {
        t: "chat",
        lines: [
          {
            role: "user",
            text: "did you see the game",
            note: "you",
            tone: "a",
          },
          {
            role: "assistant",
            text: "YES<MSG_BREAK>that ending",
            note: "contact",
            tone: "hi",
          },
        ],
      },
    },
    {
      title: "data/processed/",
      viz: {
        t: "tree",
        lines: [
          { depth: 0, name: "data/processed/" },
          { depth: 1, name: "{contact}/", tone: "hi" },
          { depth: 2, name: "train.jsonl", note: "one example per line" },
          { depth: 2, name: "metadata.json", note: "stats, system prompt" },
        ],
      },
    },
    {
      title: "How train.py splits it",
      note: "In file order. PR #311 adds a seeded held-out split.",
      wide: true,
      viz: {
        t: "split",
        parts: [
          { label: "train", pct: 90, tone: "c" },
          { label: "valid", pct: 10, tone: "hi" },
        ],
      },
    },
  ],

  models: [
    {
      title: "Base model by Mac memory",
      note: "Bar length is the download size. Casper always uses 9B.",
      wide: true,
      viz: {
        t: "bars",
        unit: "GB",
        rows: [
          {
            label: "Qwen3.5-9B-4bit",
            value: 5.95,
            text: "~5.95 GB",
            note: "24 GB+ Mac",
            tone: "hi",
          },
          {
            label: "Qwen3.5-4B-4bit",
            value: 2.5,
            text: "~2.5 GB",
            note: "16 GB+ Mac",
          },
          {
            label: "Qwen3.5-2B-4bit",
            value: 1.5,
            text: "~1.5 GB",
            note: "12 GB+ Mac",
          },
          {
            label: "Qwen3.5-0.8B-4bit",
            value: 0.6,
            text: "~0.6 GB",
            note: "below 12 GB",
          },
        ],
      },
    },
    {
      title: "models/",
      wide: true,
      viz: {
        t: "tree",
        lines: [
          { depth: 0, name: "models/" },
          { depth: 1, name: "base/", note: "downloaded base models" },
          { depth: 1, name: "personas/" },
          { depth: 2, name: "{contact}/", tone: "hi" },
          { depth: 3, name: "adapters.safetensors", note: "the LoRA adapter" },
          { depth: 3, name: "loss_history.json", note: "+ loss_plot.png" },
          { depth: 3, name: "training_metadata.json" },
        ],
      },
    },
  ],
};

/* ------------------------------------------------------------- layers */

export const LAYER_VISUALS: Record<Layer, Figure[]> = {
  apps: [
    {
      title: "Three apps",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              {
                label: "apps",
                stack: [
                  { label: "Desktop", sub: "Tauri v2 + React 19", tone: "hi" },
                  { label: "CLI", sub: "brb", tone: "a" },
                  { label: "Website", sub: "Next 16", tone: "a" },
                ],
              },
              { label: "Rust crates", tone: "b" },
            ],
          },
        ],
      },
    },
  ],
  rust: [
    {
      title: "Who depends on whom",
      note: "Arrows point at a dependency. Every crate also uses common.",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            steps: [
              {
                label: "apps",
                stack: [
                  { label: "desktop", tone: "a" },
                  { label: "cli (brb)", tone: "a" },
                ],
              },
              { label: "inference", tone: "b" },
              {
                label: "",
                stack: [
                  { label: "ingestion", tone: "b" },
                  { label: "personas", tone: "b" },
                ],
              },
              {
                label: "",
                stack: [
                  { label: "messages-db", tone: "b" },
                  { label: "training", tone: "b" },
                ],
              },
              { label: "common", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],
  python: [
    {
      title: "Two ways Rust runs Python",
      wide: true,
      viz: {
        t: "flow",
        rows: [
          {
            label: "one-shot",
            steps: [
              { label: "Rust", tone: "b" },
              {
                label: "subprocess",
                stack: [
                  { label: "embed.py", tone: "c" },
                  { label: "train.py", tone: "c" },
                  { label: "analytics.py", tone: "c" },
                  { label: "analyze_persona.py", tone: "c" },
                  {
                    label: "rerank.py, embed_query.py",
                    sub: "cold fallbacks",
                    tone: "dim",
                  },
                ],
              },
              { label: "JSON lines on stdout", tone: "hi" },
            ],
          },
          {
            label: "daemon",
            steps: [
              { label: "Rust", tone: "b" },
              {
                label: "inference_daemon.py",
                stack: [
                  { label: "persona", sub: "daemon-persona.sock", tone: "c" },
                  { label: "agent", sub: "daemon-agent.sock", tone: "c" },
                ],
              },
              { label: "JSON lines on a socket", tone: "hi" },
            ],
          },
        ],
      },
    },
  ],
  disk: [
    {
      title: "~/.be-right-back",
      note: "Nothing leaves the Mac.",
      wide: true,
      viz: {
        t: "tree",
        lines: [
          { depth: 0, name: "~/.be-right-back/" },
          { depth: 1, name: "data/" },
          { depth: 2, name: "raw/", note: "snapshots, 1 kept" },
          { depth: 2, name: "processed/", note: "training JSONL" },
          { depth: 2, name: "stats/", note: "per contact" },
          { depth: 2, name: "db/", note: "brb.db + brb.duckdb", tone: "hi" },
          { depth: 1, name: "models/", note: "base/, personas/" },
          { depth: 1, name: "run/", note: "daemon sockets, PIDs, logs" },
          { depth: 1, name: "mlx-venv/", note: "Python 3.13" },
        ],
      },
    },
  ],
};

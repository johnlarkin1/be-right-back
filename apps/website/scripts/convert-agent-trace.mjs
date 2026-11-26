#!/usr/bin/env node
/**
 * Convert real Casper turn traces (written by the Rust agent loop when
 * CASPER_TRACE_DIR is set) into the step format the `agent-loop` playground
 * replays, anonymizing contact names and ids along the way.
 *
 * The Rust side lives in `crates/inference/src/agent/trace.rs` — each turn file
 * is `{ question, plan, iterations, duration_ms, thinking, answer, tool_calls,
 * events }`, where `events` is the ordered loop transcript
 * (think → tool_call → tool_response → guard → answer). This script reads those
 * `events`, maps each to a demo step, scrubs real identities, and writes a single
 * `agent-loop-traces.json` the demo fetches.
 *
 * Usage:
 *   node scripts/convert-agent-trace.mjs <trace.json...> [options]
 *   node scripts/convert-agent-trace.mjs --dir ~/.be-right-back/traces [options]
 *
 * Options:
 *   --out FILE         Output path (default: public/demos/agent-loop-traces.json)
 *   --names FILE       JSON map of { "Real Name": "Alias", "+1555…": "Alias" } to
 *                      pin specific aliases. Anything unmapped is auto-aliased.
 *   --names-out FILE   Write the final realName/id → alias mapping here (for review
 *                      and reuse on the next capture so aliases stay stable).
 *   --redact-snippets  Replace every message snippet with a placeholder, keeping
 *                      only the meta line (date/score). Use if you don't want any
 *                      real message text on the public site.
 *   --snippet-len N    Max snippet length before truncation (default 160).
 *   --footer-note STR  Override the demo's footer disclaimer (default notes these
 *                      are real, anonymized captures).
 *
 * IMPORTANT: anonymization is best-effort. It maps known contacts → aliases and
 * masks stray emails/phones, but it cannot know that a *third* person named in a
 * message body is sensitive. Always eyeball the output JSON before shipping.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(__dirname, "..");
const DEFAULT_OUT = join(WEBSITE_ROOT, "public", "demos", "agent-loop-traces.json");

// Friendly, unambiguous first names used as aliases, in assignment order.
const ALIAS_POOL = [
  "Sarah", "Mike", "Jordan", "Maya", "Alex", "Priya", "Sam", "Nadia",
  "Leo", "Ella", "Tom", "Ruth", "Ben", "Noah", "Iris", "Chris",
];

// ── CLI parsing ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    files: [],
    out: DEFAULT_OUT,
    names: null,
    namesOut: null,
    redactSnippets: false,
    snippetLen: 160,
    footerNote:
      "These are real Casper turns captured via CASPER_TRACE_DIR and converted by " +
      "scripts/convert-agent-trace.mjs, with contact names anonymized. The shape and " +
      "the loop itself — the Qwen3.5 tool_call/tool_response format, the iteration cap, " +
      "the synthesis fallback, and the anti-loop guards — are exactly what runs in " +
      "crates/inference/src/agent/mod.rs.",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = resolve(argv[++i]);
    else if (a === "--names") opts.names = resolve(argv[++i]);
    else if (a === "--names-out") opts.namesOut = resolve(argv[++i]);
    else if (a === "--redact-snippets") opts.redactSnippets = true;
    else if (a === "--snippet-len") opts.snippetLen = Number(argv[++i]);
    else if (a === "--footer-note") opts.footerNote = argv[++i];
    else if (a === "--dir") {
      const dir = resolve(argv[++i]);
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".json")) opts.files.push(join(dir, f));
      }
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      opts.files.push(resolve(a));
    }
  }
  return opts;
}

// ── Anonymization ─────────────────────────────────────────────────────────
function isSelf(s) {
  const t = (s || "").trim().toLowerCase();
  return t === "" || t === "me" || t === "you" || t === "self";
}

// Relationship labels read naturally and aren't identifying ("my Mom's favorite
// restaurant" beats "my Maya's favorite restaurant"). Keep the label as-is, but
// still mask the underlying phone/email id it's linked to.
const SAFE_NAMES = new Set([
  "mom", "mum", "mommy", "mother", "mama", "ma",
  "dad", "daddy", "father", "papa", "pa", "pop",
  "grandma", "grandpa", "granny", "nana", "papa",
  "bro", "sis", "sister", "brother", "wife", "husband",
  "son", "daughter", "home", "family",
]);
function safeName(name) {
  const t = (name || "").trim().toLowerCase();
  return SAFE_NAMES.has(t) ? name.trim() : null;
}

class Anonymizer {
  constructor(pinned) {
    this.aliasByKey = new Map(); // "n:<name>" | "i:<id>" (lowercased) -> alias
    this.pairs = []; // observed (name, id) references, linked in resolve()
    this.poolIdx = 0;
    this.contactCount = 0;
    // Seed pinned aliases (both as name keys and id keys — caller decides).
    for (const [k, v] of Object.entries(pinned || {})) {
      this.aliasByKey.set("n:" + k.toLowerCase(), v);
      this.aliasByKey.set("i:" + k.toLowerCase(), v);
    }
  }

  /** Note a (name, id) reference; linked later in resolve(). */
  observe(name, id) {
    this.pairs.push({ name, id });
  }

  /**
   * Assign aliases. Identities that carry a real name are linked first, so a
   * relationship label ("Mom") or display name wins before a bare phone/email id
   * (often seen first, in tool-call args) can grab a generic alias.
   */
  resolve() {
    const hasName = (p) => p.name && !isSelf(p.name);
    for (const p of this.pairs.filter(hasName)) this.link(p.name, p.id);
    for (const p of this.pairs.filter((p) => !hasName(p))) this.link(p.name, p.id);
    this.finalize();
  }

  alloc() {
    if (this.poolIdx < ALIAS_POOL.length) return ALIAS_POOL[this.poolIdx++];
    return `Contact ${++this.contactCount}`;
  }

  /** Link a (name, id) pair to one alias and return it. Self → "Me". */
  link(name, id) {
    if (isSelf(name) && isSelf(id)) return "Me";
    const nKey = name && !isSelf(name) ? "n:" + name.toLowerCase() : null;
    const iKey = id && !isSelf(id) ? "i:" + id.toLowerCase() : null;
    // Precedence: a pinned/prior alias wins, then a relationship label keeps
    // itself, otherwise allocate a fresh first name.
    const alias =
      (nKey && this.aliasByKey.get(nKey)) ||
      (iKey && this.aliasByKey.get(iKey)) ||
      safeName(name) ||
      this.alloc();
    if (nKey) this.aliasByKey.set(nKey, alias);
    if (iKey) this.aliasByKey.set(iKey, alias);
    // Display names are usually "First Last" but questions/snippets use the first
    // name alone. Register that token too so "Bob" maps the same as "Bob Smith".
    // Guard against short/common tokens and relationship labels to limit noise.
    if (nKey && !safeName(name)) {
      const tokens = name.trim().split(/\s+/);
      if (tokens.length > 1) {
        const first = tokens[0];
        const fk = "n:" + first.toLowerCase();
        if (first.length >= 3 && /^[A-Za-z][A-Za-z'’-]*$/.test(first) && !safeName(first) && !this.aliasByKey.has(fk)) {
          this.aliasByKey.set(fk, alias);
        }
      }
    }
    return alias;
  }

  /** Build replacement rules once all identities are linked. */
  finalize() {
    // Longest literals first so "Mike R." is replaced before "Mike".
    const entries = [...this.aliasByKey.entries()]
      .map(([key, alias]) => ({ literal: key.slice(2), kind: key[0], alias }))
      .filter((e) => e.literal.length > 0)
      .sort((a, b) => b.literal.length - a.literal.length);
    this.rules = entries.map((e) => {
      const esc = e.literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Names get word-ish boundaries; ids (phones/emails) are matched raw.
      const pattern =
        e.kind === "n" ? `(?<![\\w])${esc}(?![\\w])` : esc;
      return { re: new RegExp(pattern, "gi"), alias: e.alias };
    });
  }

  /** Scrub a string: known identities → aliases, then mask stray emails/phones. */
  scrub(text) {
    if (typeof text !== "string" || text.length === 0) return text;
    let out = text;
    for (const { re, alias } of this.rules) out = out.replace(re, alias);
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
    // Phone-ish: 7+ digits with optional separators / leading +.
    out = out.replace(/\+?\d[\d().\-\s]{6,}\d/g, "[phone]");
    return out;
  }

  mapping() {
    const m = {};
    for (const [key, alias] of this.aliasByKey.entries()) {
      m[key.slice(2)] = alias;
    }
    return m;
  }
}

/** Collect every (contact_name, contact_id) identity referenced in a turn. */
function collectIdentities(turn, anon) {
  const seen = (name, id) => anon.observe(name, id);
  const fromResultData = (data) => {
    if (!data || typeof data !== "object") return;
    for (const r of data.results || []) seen(r.contact_name, r.contact_id);
    for (const c of data.contacts || []) seen(c.contact_name ?? c.name, c.contact_id);
    if (data.contact_name || data.contact_id) seen(data.contact_name, data.contact_id);
  };
  for (const e of turn.events || []) {
    if (e.kind === "tool_call" && e.arguments) {
      if (e.arguments.contact_id) seen(undefined, e.arguments.contact_id);
    }
    if (e.kind === "tool_response") fromResultData(e.data);
  }
  // Fallback to the flat summary if events are absent (older traces).
  for (const tc of turn.tool_calls || []) {
    if (tc.arguments?.contact_id) seen(undefined, tc.arguments.contact_id);
    fromResultData(tc.data);
  }
}

// ── plan → readable step text ───────────────────────────────────────────────
function planText(plan) {
  if (!plan) return "Query planner runs first.";
  const parts = [];
  if (plan.min_date && plan.max_date) parts.push(`date filter ${plan.min_date} → ${plan.max_date}`);
  else if (plan.min_date) parts.push(`date filter from ${plan.min_date}`);
  else if (plan.max_date) parts.push(`date filter up to ${plan.max_date}`);
  else parts.push("no date words → no date filter");
  if (plan.prefer_recent) parts.push("prefer_recent (sort by recency)");
  if (plan.is_aggregation) parts.push("aggregation detected → wider result set");
  parts.push(`result_count = ${plan.result_count}`);
  return "Query planner runs first: " + parts.join("; ") + ".";
}

// ── tool result → demo {meta, snip}[] ───────────────────────────────────────
function collapse(text, max, anon, redact) {
  if (redact) return "[message text redacted — fill in before shipping]";
  const s = anon.scrub(String(text || "").replace(/\s+/g, " ").trim());
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

function mapResults(toolName, data, anon, opts) {
  if (!data || typeof data !== "object") return [];
  const snip = (t) => collapse(t, opts.snippetLen, anon, opts.redactSnippets);

  // search_messages / search
  if (Array.isArray(data.results)) {
    if (data.results.length === 0 && data.note) {
      return [{ meta: "no results", snip: anon.scrub(data.note) }];
    }
    return data.results.map((r) => ({
      meta: `${anon.scrub(r.contact_name) || "Contact"} · ${r.date ?? "?"} · score ${r.similarity ?? "?"}`,
      snip: snip(r.conversation ?? r.text ?? r.snippet),
    }));
  }

  // get_message_volume_by_period
  if (Array.isArray(data.contacts) && data.contacts.length && data.contacts[0].total_messages !== undefined) {
    return data.contacts.map((c, i) => ({
      meta: `rank ${i + 1}`,
      snip: `${anon.scrub(c.contact_name ?? c.name) || "Contact"} — ${Number(c.total_messages).toLocaleString()} messages`,
    }));
  }

  // list_contacts
  if (Array.isArray(data.contacts)) {
    if (data.contacts.length === 0 && data.note) return [{ meta: "no results", snip: anon.scrub(data.note) }];
    return data.contacts.map((c, i) => ({
      meta: `rank ${i + 1}`,
      snip: `${anon.scrub(c.name ?? c.contact_name) || "Contact"} — ${Number(c.message_count ?? 0).toLocaleString()} messages`,
    }));
  }

  // get_conversation_context
  if (Array.isArray(data.messages)) {
    if (data.messages.length === 0 && data.note) return [{ meta: "no results", snip: anon.scrub(data.note) }];
    return data.messages.map((m) => ({
      meta: `${m.is_from_me ? "Me" : "Them"} · ${m.date ?? "?"}`,
      snip: snip(m.text),
    }));
  }

  // get_contact_stats (single object)
  if (data.total_messages !== undefined && data.messages_from_you !== undefined) {
    const name = anon.scrub(data.contact_name) || "Contact";
    const rows = [
      { meta: name, snip: `${Number(data.total_messages).toLocaleString()} messages total` },
      { meta: "split", snip: `${Number(data.messages_from_you).toLocaleString()} from you · ${Number(data.messages_from_them).toLocaleString()} from them` },
    ];
    if (data.date_range?.start) rows.push({ meta: "range", snip: `${data.date_range.start} → ${data.date_range.end}` });
    if (Array.isArray(data.top_emojis) && data.top_emojis.length) rows.push({ meta: "top emojis", snip: data.top_emojis.join(" ") });
    return rows;
  }

  // Fallback: a single note, or a compact JSON dump.
  if (data.note) return [{ meta: "note", snip: anon.scrub(data.note) }];
  return [{ meta: toolName, snip: collapse(JSON.stringify(data), opts.snippetLen, anon, opts.redactSnippets) }];
}

// ── tool_call arguments → display-safe object ───────────────────────────────
function mapArgs(args, anon) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k.startsWith("_")) continue; // belt-and-suspenders; Rust already strips these
    if (typeof v === "string") out[k] = anon.scrub(v);
    else if (Array.isArray(v) || (v && typeof v === "object")) out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

// ── events → demo steps ─────────────────────────────────────────────────────
function buildSteps(turn, anon, opts) {
  const steps = [];
  steps.push({ kind: "user", text: anon.scrub(turn.question) });
  steps.push({ kind: "plan", text: planText(turn.plan) });

  const events = turn.events || [];
  if (events.length === 0) {
    throw new Error(
      `Trace for "${turn.question}" has no \`events\` array. Re-capture with an ` +
        `agent build that includes the ordered transcript (trace.rs TraceEvent).`,
    );
  }

  for (const e of events) {
    switch (e.kind) {
      case "think":
        steps.push({ kind: "think", iter: e.iteration, text: anon.scrub(e.text) });
        break;
      case "tool_call":
        steps.push({ kind: "tool_call", iter: e.iteration, name: e.tool_name, args: mapArgs(e.arguments, anon) });
        break;
      case "tool_response":
        steps.push({ kind: "tool_response", iter: e.iteration, results: mapResults(e.tool_name, e.data, anon, opts) });
        break;
      case "guard":
        steps.push({ kind: "guard", text: anon.scrub(e.detail) });
        break;
      case "answer": {
        if (e.outcome === "synthesis") {
          steps.push({ kind: "synthesis", iter: e.iteration, text: anon.scrub(e.text) });
        } else {
          const step = { kind: "answer", iter: e.iteration, text: anon.scrub(e.text) };
          if (e.outcome === "forced") step.forced = true;
          if (e.outcome === "narrated") step.narrated = true;
          steps.push(step);
        }
        break;
      }
      default:
        // Unknown event kind — skip rather than break the whole demo.
        process.stderr.write(`  ⚠ skipping unknown event kind: ${e.kind}\n`);
    }
  }
  return steps;
}

// ── label / tag / slug derivation ───────────────────────────────────────────
function deriveTag(turn) {
  const guards = new Set((turn.events || []).filter((e) => e.kind === "guard").map((e) => e.reason));
  if (guards.has("duplicate_tool_call")) return "duplicate call → forced";
  if (guards.has("narrated_intent")) return "narrated intent → nudge";
  if (guards.has("empty_response")) return "empty response → nudge";
  if (guards.has("repetitive_text")) return "repetition → synthesis";
  const searches = (turn.events || []).filter((e) => e.kind === "tool_call").length;
  if (searches <= 1) return "1 search → answer";
  return `${searches} tool calls → answer`;
}

function deriveLabel(question) {
  const q = (question || "turn").trim().replace(/\s+/g, " ");
  const label = q.charAt(0).toUpperCase() + q.slice(1);
  return label.length > 48 ? label.slice(0, 47).trimEnd() + "…" : label;
}

function slugify(question, used) {
  const base =
    (question || "turn")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join("-") || "turn";
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.files.length === 0) {
    process.stderr.write(
      "No trace files given.\n" +
        "  node scripts/convert-agent-trace.mjs <trace.json...> [--out FILE]\n" +
        "  node scripts/convert-agent-trace.mjs --dir ~/.be-right-back/traces\n",
    );
    process.exit(1);
  }

  const pinned = opts.names ? JSON.parse(readFileSync(opts.names, "utf8")) : {};

  // Sort files by mtime so capture order → scenario order is stable.
  const files = opts.files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
  const turns = files.map((f) => ({ file: f, turn: JSON.parse(readFileSync(f, "utf8")) }));

  // One Anonymizer shared across all turns → a contact keeps the same alias
  // everywhere. Pass 1: link every identity. Pass 2: build steps.
  const anon = new Anonymizer(pinned);
  for (const { turn } of turns) collectIdentities(turn, anon);
  anon.resolve();

  // `__meta` is read by the demo for the footer note and skipped when building
  // the scenario list (keys starting with "__" are reserved).
  const out = { __meta: { footerNote: opts.footerNote, source: "CASPER_TRACE_DIR" } };
  const usedSlugs = new Set();
  for (const { file, turn } of turns) {
    // Anonymize the question once and derive everything user-facing from it, so no
    // real name leaks into the scenario label or slug.
    const question = anon.scrub(turn.question);
    const slug = slugify(question, usedSlugs);
    out[slug] = {
      label: deriveLabel(question),
      tag: deriveTag(turn),
      question,
      steps: buildSteps(turn, anon, opts),
    };
    process.stderr.write(`✓ ${file.split("/").pop()} → "${slug}" (${out[slug].steps.length} steps)\n`);
  }

  writeFileSync(opts.out, JSON.stringify(out, null, 2) + "\n");
  const traceCount = Object.keys(out).filter((k) => !k.startsWith("__")).length;
  process.stderr.write(`\nWrote ${traceCount} trace(s) → ${opts.out}\n`);

  const mapping = anon.mapping();
  if (opts.namesOut) {
    writeFileSync(opts.namesOut, JSON.stringify(mapping, null, 2) + "\n");
    process.stderr.write(`Wrote alias mapping → ${opts.namesOut}\n`);
  }
  process.stderr.write("\nAlias mapping (review before shipping):\n");
  for (const [real, alias] of Object.entries(mapping)) {
    process.stderr.write(`  ${real}  →  ${alias}\n`);
  }
  process.stderr.write(
    "\n⚠ Anonymization is best-effort. Open the output JSON and confirm no real " +
      "names/addresses survive in snippets or answers before committing.\n",
  );
}

main();

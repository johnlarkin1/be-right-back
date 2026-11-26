# Capturing real Casper traces for the `agent-loop` playground

The [`agent-loop` playground](../public/demos/agent-loop.html) replays real Casper
turns step-by-step. The traces it shows live in
[`public/demos/agent-loop-traces.json`](../public/demos/agent-loop-traces.json) and
are produced from **real runs of the Casper agent**, with contact names
anonymized.

This is a three-step pipeline: **capture → convert → review/ship**.

```
Casper turn (desktop app)
  └─ CASPER_TRACE_DIR set ─► ~/.be-right-back/traces/*.json   (raw, unredacted)
        └─ scripts/convert-agent-trace.mjs ─► agent-loop-traces.json  (anonymized)
```

## 1. Capture

Tracing is **off by default** and a complete no-op unless `CASPER_TRACE_DIR` is
set (see `crates/inference/src/agent/trace.rs`). Run the desktop app with the env
var pointed at a scratch dir:

```sh
mkdir -p ~/.be-right-back/traces
cd apps/desktop
CASPER_TRACE_DIR=~/.be-right-back/traces npm run tauri dev
```

Then ask Casper a few questions in the app. Each completed turn writes one JSON
file (`YYYYMMDD-HHMMSS-<question-slug>.json`) containing the question, the
resolved date plan, the **ordered loop transcript** (`events`: think → tool_call →
tool_response → guard → answer), and the final answer.

Good turns to capture (they map to nice scenarios):

- A clean **happy path** — one search that answers the question.
- A turn that trips an **anti-loop guard** — e.g. a vague "favorite …" /
  "who do I … most" question can make a small model narrate instead of acting
  (`narrated_intent`) or repeat a call (`duplicate_tool_call`). These are the
  most interesting traces because they show the guards firing.

> ⚠ These files contain **raw, unredacted message content**. They're a local/dev
> artifact — keep them under `~/.be-right-back/`, never commit them.

## 2. Convert (anonymize → demo format)

```sh
cd apps/website
node scripts/convert-agent-trace.mjs --dir ~/.be-right-back/traces \
  --names-out ~/.be-right-back/traces/aliases.json
```

This reads every `*.json` in the dir (oldest first → scenario order), maps each
turn's `events` into the demo's step shape, and writes
`public/demos/agent-loop-traces.json`. Contact names and phone/email ids are
replaced with stable aliases (one alias per contact, consistent across all
turns). Relationship labels like "Mom"/"Dad" are kept as-is. The
`--names-out` file records the real→alias mapping so re-running a later capture
keeps the same aliases (`--names <file>` to pin them back in).

Useful flags:

| Flag | Effect |
|------|--------|
| `<trace.json> …` | Convert specific files instead of a whole `--dir`. |
| `--out FILE` | Output path (default `public/demos/agent-loop-traces.json`). |
| `--names FILE` | Pin specific real→alias mappings (JSON object). |
| `--names-out FILE` | Write the final mapping for review/reuse. |
| `--redact-snippets` | Drop all message text, keep only meta (date/score). |
| `--snippet-len N` | Truncate snippets at N chars (default 160). |
| `--footer-note STR` | Override the demo's footer disclaimer. |

## 3. Review, then ship

Anonymization is **best-effort**. It maps the contacts it can see and masks
stray emails/phones, but it can't know that a *third* person named in a message
body is sensitive. **Open `public/demos/agent-loop-traces.json` and read every
snippet and answer before committing.** Edit text directly in the JSON if needed —
it's the source of truth the demo fetches.

The demo loads this JSON at runtime and falls back to a small hand-authored set
(inlined in `agent-loop.html`) only if the fetch fails. The footer disclaimer is
driven by the JSON's `__meta.footerNote`, so it always reflects the data actually
shown.

Then verify locally:

```sh
BRB_UNLOCK_WEBSITE=true npm run dev
# open http://localhost:3000/playground/agent-loop  (or /demos/agent-loop.html)
```

#!/usr/bin/env python3
"""Run LLM structured query-planning over the planner eval dataset.

Loads an MLX model and, for each query, asks it to emit a JSON plan
(date range, recency preference, result count, cleaned query). Records
whether the raw output parsed as JSON. Writes eval/planner/llm_out_<tag>.json.

Usage:
    python eval/planner/run_llm_planner.py mlx-community/Qwen3.5-4B-4bit 4b
"""

import json
import re
import sys
import time

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

MODEL = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/Qwen3.5-4B-4bit"
TAG = sys.argv[2] if len(sys.argv) > 2 else "4b"

DATASET = "eval/planner/dataset.json"
OUT = f"eval/planner/llm_out_{TAG}.json"

SYSTEM = """You extract structured search parameters from a question about the user's message history.

Today is Monday, 2026-02-09.

Output ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
- "date_min": earliest date to include as "YYYY-MM-DD", or null if the question has no time constraint
- "date_max": latest date to include as "YYYY-MM-DD", or null
- "prefer_recent": true if the user wants the most recent matches (words like recently, lately, last, latest), else false
- "result_count": 20 if the question is aggregative (favorite, most, usually, how often), else 7
- "search_query": the question's core search terms with time expressions removed

Resolve relative and fuzzy dates against today's date. Use world knowledge for events (e.g. holidays, seasons, "when covid started"). If the time reference is unknowable from the question alone (e.g. "my birthday" with no known date), set both dates to null."""


def extract_json(text: str):
    """Pull the first JSON object out of model output; return (obj, ok)."""
    text = text.strip()
    # strip ```json ... ``` fences
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    # drop any <think>...</think>
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    start = text.find("{")
    if start == -1:
        return None, False
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                blob = text[start : i + 1]
                try:
                    return json.loads(blob), True
                except json.JSONDecodeError:
                    return None, False
    return None, False


def main():
    ds = json.load(open(DATASET))
    cases = ds["cases"]

    print(f"Loading {MODEL} ...", file=sys.stderr)
    t0 = time.time()
    model, tokenizer = load(MODEL)
    print(f"Loaded in {time.time() - t0:.1f}s", file=sys.stderr)

    sampler = make_sampler(temp=0.0)
    results = []

    for c in cases:
        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": c["query"]},
        ]
        try:
            prompt = tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, enable_thinking=False
            )
        except TypeError:
            prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True)

        t0 = time.time()
        raw = generate(model, tokenizer, prompt=prompt, sampler=sampler, max_tokens=300, verbose=False)
        dt = time.time() - t0

        obj, ok = extract_json(raw)
        results.append(
            {
                "id": c["id"],
                "query": c["query"],
                "min": (obj or {}).get("date_min") if ok else None,
                "max": (obj or {}).get("date_max") if ok else None,
                "prefer_recent": (obj or {}).get("prefer_recent") if ok else None,
                "result_count": (obj or {}).get("result_count") if ok else None,
                "search_query": (obj or {}).get("search_query") if ok else None,
                "parse_ok": ok,
                "latency_s": round(dt, 2),
                "raw": raw[:400],
            }
        )
        print(f"{c['id']:22} ok={ok!s:5} min={results[-1]['min']} max={results[-1]['max']} ({dt:.1f}s)", file=sys.stderr)

    json.dump(results, open(OUT, "w"), indent=2)
    print(f"\nWrote {len(results)} results to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()

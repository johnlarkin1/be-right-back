#!/usr/bin/env python3
"""Score regex planner vs LLM planner(s) against the labeled dataset.

Rubric per case:
  - match=crisp : hit if both endpoints within 1 day of ground truth (exact
                  calendar arithmetic is what matters here)
  - match=fuzzy : hit if predicted range is non-null and overlaps ground truth
                  (the bar is "found the right region", not exact days)
  - match=none  : hit if predicted both null (correctly abstains)

Usage: python eval/planner/score.py regex_out.json llm_out_4b.json llm_out_9b.json
"""

import json
import sys
from datetime import date


def d(s):
    if not s:
        return None
    try:
        y, m, dd = map(int, s.split("-"))
        return date(y, m, dd)
    except (ValueError, AttributeError):
        return None


def overlaps(a_min, a_max, b_min, b_max):
    if not (a_min and a_max and b_min and b_max):
        return False
    return a_min <= b_max and b_min <= a_max


def score_case(case, pred):
    gt_min, gt_max = d(case["min"]), d(case["max"])
    p_min, p_max = d(pred.get("min")), d(pred.get("max"))
    m = case["match"]

    if m == "none":
        return p_min is None and p_max is None
    if m == "crisp":
        if not (p_min and p_max and gt_min and gt_max):
            return False
        return abs((p_min - gt_min).days) <= 1 and abs((p_max - gt_max).days) <= 1
    # fuzzy
    return overlaps(p_min, p_max, gt_min, gt_max)


def main():
    ds = json.load(open("eval/planner/dataset.json"))
    cases = {c["id"]: c for c in ds["cases"]}

    runs = {}
    for path in sys.argv[1:]:
        name = path.split("/")[-1].replace(".json", "").replace("_out", "").replace("llm_", "")
        preds = {r["id"]: r for r in json.load(open(path))}
        runs[name] = preds

    # Synthesize the regex-first -> LLM-fallback policy ("hybrid") for each LLM
    # run present: use the regex range when it found one, else the LLM's range.
    # This is the exact merge crates/inference/src/agent/planning.rs implements;
    # it lets us validate the policy ceiling offline before trusting the live
    # Rust path (whose output is loaded under a name starting with "hybrid").
    if "regex" in runs:
        for name in [n for n in list(runs) if n != "regex" and not n.startswith("hybrid")]:
            regex_preds, llm_preds, hyb = runs["regex"], runs[name], {}
            for cid in cases:
                r, l = regex_preds.get(cid, {}), llm_preds.get(cid, {})
                src = r if (r.get("min") or r.get("max")) else l
                hyb[cid] = {"id": cid, "min": src.get("min"), "max": src.get("max")}
            runs[f"hybrid_{name}"] = hyb

    rows = []
    for cid, case in cases.items():
        row = {"id": cid, "set": case["set"], "match": case["match"], "query": case["query"]}
        for name, preds in runs.items():
            p = preds.get(cid, {})
            row[name] = "✓" if score_case(case, p) else "✗"
            row[f"{name}_range"] = f"{p.get('min')}..{p.get('max')}"
        rows.append(row)

    # ---- summary ----
    names = list(runs.keys())
    lines = ["# Query Planner: regex vs LLM\n", f"now = {ds['now']}  |  {len(cases)} cases\n"]

    # JSON parse rate for LLM runs
    for name, preds in runs.items():
        if any("parse_ok" in p for p in preds.values()):
            ok = sum(1 for p in preds.values() if p.get("parse_ok"))
            lat = [p["latency_s"] for p in preds.values() if "latency_s" in p]
            avg = sum(lat) / len(lat) if lat else 0
            lines.append(f"- **{name}** JSON parse rate: {ok}/{len(preds)} ({100*ok/len(preds):.0f}%), avg latency {avg:.1f}s")
    lines.append("")

    for subset in ("A", "B", "ALL"):
        sel = [c for c in cases.values() if subset == "ALL" or c["set"] == subset]
        label = {"A": "Set A (in-distribution — regex has unit tests)",
                 "B": "Set B (paraphrase / world-knowledge — regex never built for)",
                 "ALL": "Overall"}[subset]
        lines.append(f"## {label} — {len(sel)} cases")
        header = "| run | hits | accuracy |"
        lines.append(header)
        lines.append("|---|---|---|")
        for name, preds in runs.items():
            hits = sum(1 for c in sel if score_case(c, preds.get(c["id"], {})))
            lines.append(f"| {name} | {hits}/{len(sel)} | {100*hits/len(sel):.0f}% |")
        # regex "total miss" count on this subset (returned null when GT wanted a range)
        regex = runs.get("regex")
        if regex:
            misses = sum(1 for c in sel if c["match"] != "none"
                         and not d(regex.get(c["id"], {}).get("min"))
                         and not d(regex.get(c["id"], {}).get("max")))
            lines.append(f"\nregex returned NO range on {misses}/{len([c for c in sel if c['match']!='none'])} cases that expected one.")
        lines.append("")

    # ---- per-case table ----
    lines.append("## Per-case detail\n")
    cols = "| id | set | match | " + " | ".join(names) + " | query |"
    lines.append(cols)
    lines.append("|" + "---|" * (4 + len(names)))
    for r in rows:
        verdicts = " | ".join(r[n] for n in names)
        lines.append(f"| {r['id']} | {r['set']} | {r['match']} | {verdicts} | {r['query']} |")

    # ---- ranges appendix ----
    lines.append("\n## Predicted ranges (for inspection)\n")
    cols = "| id | gt | " + " | ".join(f"{n}" for n in names) + " |"
    lines.append(cols)
    lines.append("|" + "---|" * (2 + len(names)))
    for r in rows:
        case = cases[r["id"]]
        gt = f"{case['min']}..{case['max']}"
        ranges = " | ".join(r[f"{n}_range"] for n in names)
        lines.append(f"| {r['id']} | {gt} | {ranges} |")

    report = "\n".join(lines)
    open("eval/planner/REPORT.md", "w").write(report)
    print(report)


if __name__ == "__main__":
    main()

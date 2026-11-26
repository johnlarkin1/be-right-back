"""Fidelity report: verdict logic and a Markdown summary."""

from typing import Any


def verdict(ppl: dict[str, Any] | None) -> str:
    """One-line pass/fail from the perplexity delta. Not a quality score.

    `improved` needs a positive delta both with and without `<MSG_BREAK>` targets,
    so a gain that comes only from learning the break token does not count.
    """
    if not ppl:
        return "not_measured"
    deltas = [ppl["all_tokens"]["delta"], ppl["excl_break"]["delta"]]
    if any(d is None for d in deltas):
        return "not_measured"
    if all(d > 0 for d in deltas):
        return "improved"
    if all(d <= 0 for d in deltas):
        return "not_improved"
    return "mixed"


def _fmt(x: Any, digits: int = 3) -> str:
    if x is None:
        return "n/a"
    if isinstance(x, float):
        return f"{x:.{digits}f}"
    return str(x)


def _boundary_lines(base: dict[str, Any] | None, adapter: dict[str, Any] | None) -> list[str]:
    """Table of the break vs end-of-turn choice at the person's real bubble ends."""
    if not base or not adapter:
        return []
    rows = [
        ("Picks break over end", "breaks_pick_break_rate", "ends_pick_break_rate"),
        ("Mean P(break)", "breaks_mean_p_break", "ends_mean_p_break"),
        ("Mean P(end of turn)", "breaks_mean_p_end", "ends_mean_p_end"),
    ]
    lines = [
        "## Bubble breaks",
        "",
        f"At a real break ({adapter['breaks']}), the person sent another bubble. "
        f"At a real end ({adapter['ends']}), they stopped. A model that double-texts "
        "like the person picks break at real breaks and end at real ends.",
        "",
        "| | At real breaks: base | adapter | At real ends: base | adapter |",
        "|---|---|---|---|---|",
    ]
    for label, at_break, at_end in rows:
        lines.append(
            f"| {label} | {_fmt(base[at_break])} | {_fmt(adapter[at_break])} "
            f"| {_fmt(base[at_end])} | {_fmt(adapter[at_end])} |"
        )
    return [*lines, ""]


def to_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Persona fidelity: {report.get('contact_name') or report['persona_dir']}",
        "",
        f"- Verdict: **{report['verdict']}**",
        f"- Base model: `{report['base_model']}`",
        f"- Held-out examples: {report['heldout']['used']} of {report['heldout']['available']} "
        f"(split: {report['heldout']['method']})",
        f"- System prompt: {report['system_prompt']}",
        "",
    ]

    ppl = report.get("perplexity")
    if ppl:
        b, a = ppl["base"], ppl["adapter"]
        lines += [
            "## Held-out perplexity",
            "",
            "Lower is better. Delta = base - adapter, so positive means the adapter helps.",
            "",
            "| Targets | Base | Adapter | Delta | Improvement |",
            "|---|---|---|---|---|",
            f"| All tokens ({a['tokens']}) | {_fmt(b['perplexity'])} | {_fmt(a['perplexity'])} "
            f"| {_fmt(ppl['all_tokens']['delta'])} | {_fmt(ppl['all_tokens']['improvement_pct'], 1)}% |",
            f"| Without `<MSG_BREAK>` ({a['tokens_excl_break']}) | {_fmt(b['perplexity_excl_break'])} "
            f"| {_fmt(a['perplexity_excl_break'])} | {_fmt(ppl['excl_break']['delta'])} "
            f"| {_fmt(ppl['excl_break']['improvement_pct'], 1)}% |",
            "",
        ]
        lines += _boundary_lines(b.get("boundaries"), a.get("boundaries"))

    style = report.get("style")
    if style:
        tally = style["closer_count"]
        lines += [
            "## Style distance",
            "",
            f"Replies to {style['profiles']['real']['replies']} held-out prompts. "
            f"Adapter closer to real on {tally['adapter']} features, base on {tally['base']}, "
            f"tie on {tally['tie']}.",
            "",
            "| Feature | Real | Base | Adapter | Base dist | Adapter dist | Closer |",
            "|---|---|---|---|---|---|---|",
        ]
        for name, f in style["features"].items():
            lines.append(
                f"| {name} | {_fmt(f.get('real'), 2)} | {_fmt(f.get('base'), 2)} "
                f"| {_fmt(f.get('adapter'), 2)} | {_fmt(f['base_distance'])} "
                f"| {_fmt(f['adapter_distance'])} | {f['closer']} |"
            )
        p = style["profiles"]
        lines += [
            "",
            "| | Real | Base | Adapter |",
            "|---|---|---|---|",
            f"| Bubbles per reply | {_fmt(p['real']['mean_bubbles_per_reply'], 2)} "
            f"| {_fmt(p['base']['mean_bubbles_per_reply'], 2)} "
            f"| {_fmt(p['adapter']['mean_bubbles_per_reply'], 2)} |",
            f"| Words per bubble | {_fmt(p['real']['mean_words_per_bubble'], 1)} "
            f"| {_fmt(p['base']['mean_words_per_bubble'], 1)} "
            f"| {_fmt(p['adapter']['mean_words_per_bubble'], 1)} |",
            "",
        ]
    return "\n".join(lines)

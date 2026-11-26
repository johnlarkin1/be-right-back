"""Cluster labeling: c-TF-IDF keywords, then a short LLM label checked by rules.

The LLM sees the cluster's keywords and excerpts that use them. Thinking is off
in the chat template. Each answer must pass `validate_label` and differ from
the labels already taken. A rejected answer goes back to the model with the
reason, up to `LABEL_ATTEMPTS` times, then the labeler falls back to keywords.
"""

import re
from collections import Counter

import numpy as np
from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

from constants import FILLER_WORDS, HF_DEFAULT_AGENT_MODEL, is_label_specific
from ml.keywords import c_tf_idf_keywords, cluster_word_counts, keyword_label
from progress.analytics import AnalyticsStage, emit_progress
from progress.base import log_info, log_warn
from prompts import CLUSTER_LABEL_SYSTEM_PROMPT, build_cluster_label_prompt
from utils.chunk_text import name_tokens
from utils.llm import clean_llm_response

LABEL_MAX_TOKENS = 16
LABEL_MAX_WORDS = 4
LABEL_MAX_CHARS = 32
N_KEYWORDS = 10
N_SAMPLES = 10
SAMPLE_MAX_CHARS = 240
# Keywords a sample is ranked by, and the most samples from one contact.
SAMPLE_KEYWORDS = 6
MAX_SAMPLES_PER_CONTACT = 2
# Sampling temperature per attempt. Later attempts carry the earlier rejections.
LABEL_TEMPS = (0.2, 0.5, 0.8)

# Words that show the model is reasoning or echoing the prompt, not naming a topic.
_SCAFFOLD_WORDS = {
    "analyze", "analysis", "request", "constraint", "constraints", "label", "labels",
    "topic", "topics", "cluster", "keywords", "keyword", "excerpt", "excerpts", "output",
    "thinking", "think", "step", "answer", "user", "assistant", "here", "okay", "the",
}  # fmt: skip

_SPEAKER_RE = re.compile(r"(?m)^(?:Me|Them): ")
_LABEL_CHARS_RE = re.compile(r"^[A-Za-z][A-Za-z&'/ -]*$")
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_DIGITS_RE = re.compile(r"\d+")
_TOKEN_RE = re.compile(r"[a-z]+")


def load_llm():
    """Load the LLM for cluster labeling. Called once per pipeline run."""
    try:
        log_info("Loading LLM for cluster labeling...")
        model, tokenizer = load(
            HF_DEFAULT_AGENT_MODEL,
            tokenizer_config={"trust_remote_code": True},
        )
        log_info("LLM loaded successfully")
        return model, tokenizer
    except Exception as e:
        log_warn(f"Failed to load LLM: {e}, using keyword labels")
        return None, None


def normalize_label(label: str) -> str:
    words = re.findall(r"\w+", label.lower())
    words = [w for w in words if w not in FILLER_WORDS]
    return " ".join(sorted(words))


def format_label_prompt(tokenizer, user_content: str) -> str:
    """Chat prompt with thinking disabled through the template.

    `enable_thinking=False` makes the Qwen3.5 template emit an empty, closed
    think block, so the model answers at once. A `/no_think` suffix does not.
    """
    messages = [
        {"role": "system", "content": CLUSTER_LABEL_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
    except Exception:
        # Same text the Qwen3.5 template produces with thinking off.
        return (
            f"<|im_start|>system\n{CLUSTER_LABEL_SYSTEM_PROMPT}<|im_end|>\n"
            f"<|im_start|>user\n{user_content}<|im_end|>\n"
            "<|im_start|>assistant\n<think>\n\n</think>\n\n"
        )


def clean_label(raw: str) -> str:
    """First line of the answer without think blocks, markdown, quotes or a trailing period."""
    text = clean_llm_response(raw)
    line = next((ln for ln in text.split("\n") if ln.strip()), "")
    line = re.sub(r"^\s*(?:label|topic)\s*:\s*", "", line, flags=re.IGNORECASE)
    line = re.sub(r"[*_#`\"“”‘’]", "", line)
    return line.strip().rstrip(".,;:!?").strip()


def validate_label(label: str, banned_tokens: set[str]) -> str | None:
    """Return the reason a label is unusable, or None when it is fine."""
    if not label:
        return "empty"
    if len(label) > LABEL_MAX_CHARS:
        return "too long"
    if not _LABEL_CHARS_RE.match(label):
        return "bad characters"
    words = label.split()
    if len(words) > LABEL_MAX_WORDS:
        return "too many words"
    lowered = {w.lower().strip("&/-'") for w in words}
    if lowered & _SCAFFOLD_WORDS:
        return "reasoning scaffold"
    if lowered & banned_tokens:
        return "contains a contact name"
    if not is_label_specific(label):
        return "too generic"
    return None


def _is_duplicate(label: str, existing_labels: list[str]) -> bool:
    normalized = normalize_label(label)
    return any(normalize_label(lbl) == normalized for lbl in existing_labels)


def get_llm_label(
    model,
    tokenizer,
    keywords: list[str],
    samples: list[str],
    cluster_id: int,
    existing_labels: list[str],
    banned_tokens: set[str],
) -> str | None:
    """Ask the LLM for a label. Returns None when no answer passes validation.

    Each retry tells the model which answers were rejected and why, so it does
    not repeat a duplicate or an unusable label.
    """
    rejected: list[tuple[str, str]] = []
    for temp in LABEL_TEMPS:
        prompt = format_label_prompt(
            tokenizer, build_cluster_label_prompt(keywords, samples, existing_labels, rejected)
        )
        try:
            raw = generate(
                model,
                tokenizer,
                prompt=prompt,
                max_tokens=LABEL_MAX_TOKENS,
                verbose=False,
                sampler=make_sampler(temp=temp),
            )
        except Exception as err:
            log_warn(f"LLM labeling failed for cluster {cluster_id}: {err}")
            return None
        label = clean_label(raw)
        reason = validate_label(label, banned_tokens)
        if reason is None and _is_duplicate(label, existing_labels):
            reason = "duplicate"
        if reason is None:
            return label
        log_info(f"  Cluster {cluster_id}: rejected {raw.strip()[:60]!r} ({reason})")
        if label and all(label != lbl for lbl, _ in rejected):
            rejected.append((label, reason))
    return None


def keyword_snippet(dialogue: str, keywords: set[str], max_chars: int = SAMPLE_MAX_CHARS) -> str:
    """The lines of a chunk that use a keyword, with one line of context.

    Links become `<link>`. Gaps between kept lines show as `...`. A chunk
    without a keyword returns its first lines.
    """
    lines = [_URL_RE.sub("<link>", line).strip() for line in dialogue.split("\n")]
    lines = [line for line in lines if line]
    hits = [i for i, line in enumerate(lines) if keywords & set(_TOKEN_RE.findall(line.lower()))]
    if not hits:
        return "\n".join(lines)[:max_chars]
    keep = sorted({j for i in hits for j in (i - 1, i, i + 1) if 0 <= j < len(lines)})
    out: list[str] = []
    for prev, j in zip([None, *keep], keep):
        if prev is not None and j != prev + 1:
            out.append("...")
        out.append(lines[j])
    return "\n".join(out)[:max_chars]


def representative_samples(
    cluster_embeddings: np.ndarray,
    cluster_dialogues: list[str],
    keywords: list[str],
    contacts: list[str],
    n_samples: int = N_SAMPLES,
) -> list[str]:
    """Excerpts that show what the cluster's keywords mean, from several contacts.

    The excerpts nearest the centroid of a large cluster are mostly small talk
    that never uses the keywords: the model then labels the small talk. A
    cluster of automated texts (bank codes) is one template many times over.
    So chunks rank by the top keywords they use, each weighted by how many
    chunks of the cluster use it, then by distance to the centroid. Near-copies (same text with other digits) are skipped, and one
    contact gives at most `MAX_SAMPLES_PER_CONTACT` excerpts.
    """
    top = set(keywords[:SAMPLE_KEYWORDS])
    centroid = cluster_embeddings.mean(axis=0)
    dist = np.linalg.norm(cluster_embeddings - centroid, axis=1)
    used = [top & set(_TOKEN_RE.findall(d.lower())) for d in cluster_dialogues]
    # Weight each keyword by the share of chunks that use it. A rare keyword
    # ("filler" in a cluster of quick replies) would otherwise pull in its few
    # off-topic chunks.
    share = Counter(w for u in used for w in u)
    score = np.array([sum(share[w] for w in u) for u in used], dtype=float)
    order = np.lexsort((dist, -score))

    samples: list[str] = []
    seen: set[str] = set()
    per_contact: Counter = Counter()
    for i in order:
        if per_contact[contacts[i]] >= MAX_SAMPLES_PER_CONTACT:
            continue
        text = keyword_snippet(cluster_dialogues[i], top)
        key = _DIGITS_RE.sub("#", text.lower())
        if not text or key in seen:
            continue
        seen.add(key)
        per_contact[contacts[i]] += 1
        samples.append(text)
        if len(samples) >= n_samples:
            break
    return samples


def deduplicate_labels(labels: dict[int, str], keywords: dict[int, list[str]]) -> dict[int, str]:
    """Make labels unique by adding the best keyword the label does not already use."""
    seen: dict[str, int] = {}
    for cid in sorted(c for c in labels if c >= 0):
        label = labels[cid]
        norm = normalize_label(label)
        if norm not in seen:
            seen[norm] = cid
            continue
        used = set(norm.split())
        extra = next((w for w in keywords.get(cid, []) if w not in used), None)
        new_label = f"{label} ({extra.capitalize()})" if extra else f"{label} {cid + 1}"
        log_info(f"  Cluster {cid}: '{label}' -> '{new_label}'")
        labels[cid] = new_label
        seen[normalize_label(new_label)] = cid
    return labels


def cluster_name_tokens(
    names: list[str], tokens_of: dict[str, set[str]], min_share: float = 0.05
) -> set[str]:
    """Name tokens of contacts with at least `min_share` of a cluster's chunks.

    Only these names can plausibly leak into the cluster's label.
    """
    banned: set[str] = set()
    for name, n in Counter(names).items():
        if n >= min_share * len(names):
            banned |= tokens_of.get(name, set())
    return banned


def generate_cluster_labels(
    cluster_labels: np.ndarray,
    metadata: list[dict],
    embeddings_50d: np.ndarray,
) -> dict[int, str]:
    """Label every cluster. Clusters are processed largest first."""
    labels: dict[int, str] = {-1: "Uncategorized"}
    ids, sizes = np.unique(cluster_labels[cluster_labels >= 0], return_counts=True)
    real_clusters = [int(c) for c in ids[np.argsort(-sizes)]]
    if not real_clusters:
        return labels

    emit_progress(AnalyticsStage.LABELING, 0, "Finding cluster keywords...")
    # Ban a contact's name only in that contact's own chunks. A global ban
    # would drop "mom", "work" or "summer" everywhere for one contact's name.
    names = [m.get("contact_name", "") for m in metadata]
    tokens_of = {n: name_tokens([n]) for n in set(names)}
    chunk_names = [tokens_of[n] for n in names]
    dialogues = [m.get("dialogue", "") for m in metadata]
    bodies = [_SPEAKER_RE.sub("", d) for d in dialogues]
    keywords = c_tf_idf_keywords(
        cluster_word_counts(cluster_labels, bodies, {"me", "them"}, chunk_names),
        top_n=N_KEYWORDS,
    )

    emit_progress(
        AnalyticsStage.LABELING,
        5,
        f"Generating labels for {len(real_clusters)} clusters...",
    )
    model, tokenizer = load_llm()

    for i, cluster_id in enumerate(real_clusters):
        emit_progress(
            AnalyticsStage.LABELING,
            5 + int(i / len(real_clusters) * 90),
            f"Labeling cluster {i + 1}/{len(real_clusters)}...",
        )
        kws = keywords.get(cluster_id, [])
        label = None
        if model is not None and kws:
            mask = cluster_labels == cluster_id
            samples = representative_samples(
                embeddings_50d[mask],
                [d for d, m in zip(dialogues, mask) if m],
                kws,
                [n for n, m in zip(names, mask) if m],
            )
            existing = [lbl for cid, lbl in labels.items() if cid >= 0]
            banned = cluster_name_tokens([n for n, m in zip(names, mask) if m], tokens_of)
            label = get_llm_label(model, tokenizer, kws, samples, cluster_id, existing, banned)
        if label is None:
            label = keyword_label(kws, cluster_id)
        labels[cluster_id] = label
        log_info(
            f"  Cluster {cluster_id}: '{label}' "
            f"({int((cluster_labels == cluster_id).sum())} points; {', '.join(kws[:6])})"
        )

    labels = deduplicate_labels(labels, keywords)
    emit_progress(AnalyticsStage.LABELING, 100, f"Labeled {len(real_clusters)} clusters")
    return labels

"""Insights topic clusters: header-free text, keywords, label checks, contact offsets."""

import numpy as np
import pytest

from config.analytics import AnalyticsConfig
from ml.clustering import merge_small_clusters, remove_contact_offsets, run_leiden
from ml.keywords import c_tf_idf_keywords, cluster_word_counts, keyword_label
from ml.labeling import (
    clean_label,
    cluster_name_tokens,
    deduplicate_labels,
    format_label_prompt,
    get_llm_label,
    keyword_snippet,
    representative_samples,
    validate_label,
)
from prompts import build_cluster_label_prompt
from utils.chunk_text import chunk_body, chunk_dialogue, extract_words, name_tokens

FORMATTED = (
    "[Contact: Riley Chen | 2024-03-15]\n"
    "Riley Chen: are we still on for dinner\n"
    "Me: yes 7pm at the ramen place\n"
    "second line of my message"
)


class TestChunkText:
    def test_messages_field_wins(self):
        data = {
            "messages": [
                {"sender": "Riley", "text": "pizza tonight?"},
                {"sender": "Me", "text": "yes"},
            ],
            "formatted": FORMATTED,
        }
        assert chunk_dialogue(data, "Riley") == "Them: pizza tonight?\nMe: yes"

    def test_formatted_fallback_strips_header_and_names(self):
        data = {"formatted": FORMATTED}
        body = chunk_body(data, "Riley Chen")
        assert "Contact" not in body
        assert "Riley" not in body
        assert body.splitlines()[0] == "are we still on for dinner"
        assert "second line of my message" in chunk_dialogue(data, "Riley Chen")

    def test_extract_words_drops_laughs_names_and_stop_words(self):
        counts = extract_words(
            "Hahahaha yeahhh lolol Riley we're getting ramen, RAMEN", {"riley"}
        )
        assert counts == {"ramen": 2}

    def test_links_are_not_words(self):
        words = extract_words("status page https://stspg.io/abc123 and www.example.com/utm down")
        assert set(words) == {"status", "page"}

    def test_contractions_are_not_words(self):
        words = extract_words("we'd love to, she\u2019ll bring dad's guitar, don't")
        assert set(words) == {"bring", "dad", "guitar"}

    def test_name_tokens(self):
        assert name_tokens(["Sam Doe (Sam Doe)", "Dad"]) == {"sam", "doe", "dad"}


class TestKeywords:
    def test_c_tf_idf_prefers_distinctive_words(self):
        labels = np.array([0, 0, 1, 1, -1])
        bodies = [
            "ramen dinner ramen pizza",
            "ramen pizza dinner sushi",
            "flight airport dinner",
            "flight airport uber",
            "ignored noise text",
        ]
        counts = cluster_word_counts(labels, bodies, exclude=set())
        kws = c_tf_idf_keywords(counts, top_n=2, min_count=1)
        assert kws[0][0] == "ramen"
        assert set(kws[1]) == {"flight", "airport"}
        assert -1 not in kws

    def test_contact_name_is_dropped_only_from_its_own_chunks(self):
        labels = np.array([0, 0])
        bodies = ["summer trip to the beach", "summer trip to the lake"]
        counts = cluster_word_counts(labels, bodies, set(), [{"summer", "rice"}, set()])
        assert counts[0]["summer"] == 1
        assert counts[0]["trip"] == 2

    def test_keyword_label(self):
        assert keyword_label(["flight", "airport"], 0) == "Flight & Airport"
        assert keyword_label([], 4) == "Topic 5"


class TestLabelValidation:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Travel Plans", "Travel Plans"),
            ("<think>\n\n</think>\n\n**Fantasy Football**", "Fantasy Football"),
            ('"Apartment Hunting".', "Apartment Hunting"),
            ("Label: Job Search", "Job Search"),
        ],
    )
    def test_clean_label(self, raw, expected):
        assert clean_label(raw) == expected

    @pytest.mark.parametrize(
        "label",
        [
            "1. Analyze the Request",  # screenshot: numbered reasoning
            "Constraints",  # screenshot: reasoning scaffold after stripping "* "
            "Contact Haha What",  # screenshot: header word
            "Riley Chen",
            "General Chat",
            "A very long label with far too many words",
            "",
        ],
    )
    def test_rejects_bad_labels(self, label):
        banned = name_tokens(["Riley Chen"]) | {"contact"}
        assert validate_label(clean_label(label), banned) is not None

    @pytest.mark.parametrize("label", ["Plans & Updates", "Chat/Updates", "Plans-Updates"])
    def test_rejects_generic_label_with_punctuation(self, label):
        assert validate_label(label, set()) == "too generic"

    def test_cluster_name_tokens_bans_only_big_contributors(self):
        names = ["Riley Chen"] * 19 + ["Summer Rice"]
        tokens_of = {n: name_tokens([n]) for n in set(names)}
        assert cluster_name_tokens(names, tokens_of, min_share=0.1) == {"riley", "chen"}

    def test_accepts_topic_label(self):
        assert validate_label("Wedding Planning", {"riley"}) is None

    def test_deduplicate_adds_a_keyword_not_a_name(self):
        labels = {-1: "Uncategorized", 0: "Food", 1: "Food"}
        out = deduplicate_labels(labels, {0: ["ramen"], 1: ["food", "pizza"]})
        assert out[0] == "Food"
        assert out[1] == "Food (Pizza)"


class _FakeTokenizer:
    def __init__(self):
        self.kwargs: dict = {}

    def apply_chat_template(self, messages, **kwargs):
        self.kwargs = kwargs
        return "|".join(m["content"] for m in messages)


def test_label_prompt_disables_thinking_in_template():
    tok = _FakeTokenizer()
    prompt = format_label_prompt(tok, "Keywords: ramen")
    assert tok.kwargs["enable_thinking"] is False
    assert "/no_think" not in prompt


def test_label_prompt_fallback_closes_think_block():
    class Broken:
        def apply_chat_template(self, *_a, **_k):
            raise ValueError("no template")

    assert format_label_prompt(Broken(), "x").endswith("<think>\n\n</think>\n\n")


def test_remove_contact_offsets_breaks_per_contact_grouping():
    """Two contacts, two topics. Raw vectors group by contact; centered ones by topic."""
    rng = np.random.default_rng(0)
    dim = 64
    contact_dir = rng.normal(size=(2, dim)) * 3.0
    topic_dir = rng.normal(size=(2, dim))
    rows, contacts, topics = [], [], []
    for c in range(2):
        for t in range(2):
            for _ in range(200):
                rows.append(contact_dir[c] + topic_dir[t] + rng.normal(scale=0.3, size=dim))
                contacts.append(f"c{c}")
                topics.append(t)
    raw = np.array(rows, dtype=np.float32)
    raw /= np.linalg.norm(raw, axis=1, keepdims=True)
    topics_arr = np.array(topics)

    def topic_separation(x: np.ndarray) -> float:
        """Mean cosine within a topic minus mean cosine across topics."""
        sims = x @ x.T
        same = topics_arr[:, None] == topics_arr[None, :]
        return float(sims[same].mean() - sims[~same].mean())

    centered = remove_contact_offsets(raw, contacts, shrinkage=20.0)
    assert centered.dtype == np.float32
    np.testing.assert_allclose(np.linalg.norm(centered, axis=1), 1.0, rtol=1e-5)
    assert topic_separation(centered) > 2 * topic_separation(raw)


def _blobs(
    n_per: int, n_blobs: int, dims: int = 50, seed: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    centers = rng.normal(size=(n_blobs, dims))
    truth = np.repeat(np.arange(n_blobs), n_per)
    return centers[truth] + 0.3 * rng.normal(size=(truth.size, dims)), truth


def test_run_leiden_finds_topics_and_assigns_every_chunk():
    points, truth = _blobs(120, 6)
    labels = run_leiden(points, AnalyticsConfig(n_topics=6))
    assert labels.min() == 0
    assert 5 <= labels.max() + 1 <= 7
    from sklearn.metrics import normalized_mutual_info_score

    assert normalized_mutual_info_score(truth, labels) > 0.9


def test_run_leiden_handles_tiny_input():
    points, _ = _blobs(5, 2)
    labels = run_leiden(points, AnalyticsConfig())
    assert labels.shape == (10,)
    assert (labels >= 0).all()


def test_merge_small_clusters_moves_to_nearest_and_renumbers_by_size():
    unit = np.array([[1, 0], [1, 0], [1, 0], [0, 1], [0, 1], [0.9, 0.1]], dtype=np.float32)
    labels = np.array([7, 7, 7, 3, 3, 9])
    out = merge_small_clusters(labels, unit, min_size=2)
    assert out.tolist() == [0, 0, 0, 1, 1, 0]


class TestSamples:
    def test_snippet_keeps_keyword_lines_with_context(self):
        dialogue = "Me: hey\nThem: yo\nMe: how was the flight\nThem: delayed\nMe: ok\nMe: bye\nThem: airport again"
        snippet = keyword_snippet(dialogue, {"flight", "airport"})
        assert snippet == (
            "Them: yo\nMe: how was the flight\nThem: delayed\n...\nMe: bye\nThem: airport again"
        )

    def test_snippet_replaces_links(self):
        assert keyword_snippet("Them: code https://x.co/a1", {"code"}) == "Them: code <link>"

    def test_samples_prefer_keyword_chunks_over_centroid_small_talk(self):
        # Chunks 0-2 sit on the centroid but never use a keyword.
        dialogues = [
            "Me: lol ok",
            "Them: haha",
            "Me: sure",
            "Me: tennis match at 5",
            "Them: tennis?",
        ]
        emb = np.array([[0.0], [0.0], [0.0], [5.0], [-5.0]])
        samples = representative_samples(emb, dialogues, ["tennis", "match"], list("abcde"), 2)
        assert samples == ["Me: tennis match at 5", "Them: tennis?"]

    def test_samples_skip_template_copies_and_cap_each_contact(self):
        bank = [f"Them: Your PNC passcode is {n}" for n in (111, 222, 333)]
        other = ["Them: DraftKings code 9", "Them: passcode 4 from Venmo", "Them: passcode reset"]
        dialogues = bank + other
        contacts = ["pnc", "pnc2", "pnc3", "dk", "venmo", "venmo"]
        emb = np.zeros((6, 2))
        samples = representative_samples(emb, dialogues, ["passcode", "code"], contacts, 10)
        assert sum("PNC" in s for s in samples) == 1  # digits differ, same template
        assert len(samples) == 4

    def test_one_contact_gives_at_most_two_samples(self):
        dialogues = [f"Me: gym day {c}" for c in "abcdef"]
        samples = representative_samples(np.zeros((6, 1)), dialogues, ["gym"], ["x"] * 6, 10)
        assert len(samples) == 2


class TestLabelRetries:
    def test_prompt_lists_rejected_answers_with_reasons(self):
        prompt = build_cluster_label_prompt(
            ["code"], ["Them: code 1"], ["Job Search"], [("Job Search", "duplicate")]
        )
        assert "These answers were rejected" in prompt
        assert '"Job Search": another group already has this label' in prompt
        assert prompt.rstrip().endswith("Label:")

    def test_duplicate_answer_is_retried_with_feedback(self, monkeypatch):
        import ml.labeling as labeling

        answers = iter(["Travel Plans", "Airport Logistics"])
        prompts: list[str] = []

        def fake_generate(model, tokenizer, prompt, **kwargs):
            prompts.append(prompt)
            return next(answers)

        monkeypatch.setattr(labeling, "generate", fake_generate)
        monkeypatch.setattr(labeling, "make_sampler", lambda temp: temp)
        label = get_llm_label(
            None, _FakeTokenizer(), ["flight"], ["Me: flight"], 3, ["Travel Plans"], set()
        )
        assert label == "Airport Logistics"
        assert "rejected" not in prompts[0]
        assert '"Travel Plans": another group already has this label' in prompts[1]

    def test_gives_up_after_all_attempts(self, monkeypatch):
        import ml.labeling as labeling

        monkeypatch.setattr(labeling, "generate", lambda *a, **k: "Topic Analysis")
        monkeypatch.setattr(labeling, "make_sampler", lambda temp: temp)
        assert get_llm_label(None, _FakeTokenizer(), ["x"], [], 0, [], set()) is None

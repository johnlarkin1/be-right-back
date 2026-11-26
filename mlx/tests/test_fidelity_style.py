"""Tests for the stylometric features and distances."""

import pytest

from fidelity.style import compare, js_divergence, profile, split_bubbles

BREAK = "<MSG_BREAK>"

REAL = [
    "lol yeah<MSG_BREAK>omw",
    "idk tbh<MSG_BREAK>maybe later?",
    "haha ok<MSG_BREAK>see u there 😂",
    "nah im good",
]
ADAPTER = [
    "yeah lol<MSG_BREAK>on my way",
    "idk<MSG_BREAK>later maybe?",
    "haha sure<MSG_BREAK>see u 😂",
    "nah all good",
]
BASE = [
    "Hello! I would be happy to help you with that.",
    "That is a great question. Let me think about it carefully.",
    "Sure. Here are a few options you might consider for this evening.",
    "I appreciate you reaching out. Have a wonderful day.",
]


def test_split_bubbles_drops_empty_parts():
    assert split_bubbles("a<MSG_BREAK> <MSG_BREAK>b", BREAK) == ["a", "b"]


def test_profile_rates():
    p = profile(REAL, BREAK)
    assert p.replies == 4
    assert p.bubbles == 7
    assert p.rates["all_lowercase"] == pytest.approx(1.0)
    assert p.rates["has_emoji"] == pytest.approx(1 / 7)
    assert p.rates["has_question"] == pytest.approx(1 / 7)
    assert p.rates["has_laugh"] == pytest.approx(3 / 7)  # "lol", "haha", "😂"


def test_profile_of_nothing_is_zero():
    p = profile([], BREAK)
    assert p.bubbles == 0
    assert all(v == 0.0 for v in p.rates.values())


def test_js_divergence_bounds():
    assert js_divergence([0.5, 0.5], [0.5, 0.5]) == pytest.approx(0.0)
    assert js_divergence([1.0, 0.0], [0.0, 1.0]) == pytest.approx(1.0)
    d = js_divergence([0.7, 0.3], [0.4, 0.6])
    assert 0 < d < 1
    assert d == pytest.approx(js_divergence([0.4, 0.6], [0.7, 0.3]))


def test_compare_prefers_the_closer_condition():
    result = compare(REAL, BASE, ADAPTER, break_token=BREAK)
    tally = result["closer_count"]
    assert tally["adapter"] > tally["base"]
    assert result["features"]["all_lowercase"]["closer"] == "adapter"
    assert result["features"]["bubbles_per_reply"]["closer"] == "adapter"
    assert result["features"]["word_distribution"]["closer"] == "adapter"


def test_compare_is_a_tie_when_conditions_match():
    result = compare(REAL, ADAPTER, ADAPTER, break_token=BREAK)
    assert result["closer_count"] == {"adapter": 0, "base": 0, "tie": 11}

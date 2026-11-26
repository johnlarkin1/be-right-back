"""Tests for LLM response cleaning in the inference daemon and utils/llm.py."""

import pytest

from entry.inference_daemon import InferenceDaemon
from utils.llm import clean_llm_response

# ---------------------------------------------------------------------------
# InferenceDaemon._clean_response (special token stripping)
# ---------------------------------------------------------------------------


class TestCleanResponse:
    """Tests for InferenceDaemon._clean_response()."""

    @pytest.fixture
    def daemon(self):
        return InferenceDaemon(base_model="test-model")

    def test_no_special_tokens(self, daemon):
        assert daemon._clean_response("Hello world") == "Hello world"

    def test_strips_trailing_im_end(self, daemon):
        assert daemon._clean_response("Hello<|im_end|>") == "Hello"

    def test_strips_trailing_endoftext(self, daemon):
        assert daemon._clean_response("Hello<|endoftext|>") == "Hello"

    def test_strips_trailing_end(self, daemon):
        assert daemon._clean_response("Hello<|end|>") == "Hello"

    def test_strips_multiple_trailing_tokens(self, daemon):
        result = daemon._clean_response("Hello<|im_end|><|endoftext|>")
        assert result == "Hello"

    def test_removes_im_end_in_middle(self, daemon):
        result = daemon._clean_response("Hello<|im_end|> world")
        assert result == "Hello world"

    def test_removes_im_start_in_middle(self, daemon):
        result = daemon._clean_response("Hello<|im_start|>extra")
        assert result == "Helloextra"

    def test_strips_whitespace(self, daemon):
        assert daemon._clean_response("  Hello  ") == "Hello"

    def test_empty_string(self, daemon):
        assert daemon._clean_response("") == ""

    def test_only_special_tokens(self, daemon):
        assert daemon._clean_response("<|im_end|><|endoftext|>") == ""

    def test_multiple_qwen3_tokens_removed(self, daemon):
        text = "Hello<|im_end|>middle<|im_start|>end<|endoftext|>"
        result = daemon._clean_response(text)
        assert "<|im_end|>" not in result
        assert "<|im_start|>" not in result
        assert "<|endoftext|>" not in result
        assert "Hello" in result


# ---------------------------------------------------------------------------
# InferenceDaemon._truncate_after_tool_call
# ---------------------------------------------------------------------------


class TestTruncateAfterToolCall:
    """Tests for InferenceDaemon._truncate_after_tool_call()."""

    @pytest.fixture
    def daemon(self):
        return InferenceDaemon(base_model="test-model")

    def test_no_tool_call(self, daemon):
        text = "Just a normal response."
        assert daemon._truncate_after_tool_call(text) == text

    def test_simple_tool_call(self, daemon):
        text = '[{"name": "search", "arguments": {"q": "cats"}}]Some extra text'
        result = daemon._truncate_after_tool_call(text)
        assert result == '[{"name": "search", "arguments": {"q": "cats"}}]'

    def test_nested_brackets(self, daemon):
        text = '[{"name": "fn", "args": {"list": [1, 2, 3]}}]trailing'
        result = daemon._truncate_after_tool_call(text)
        assert result == '[{"name": "fn", "args": {"list": [1, 2, 3]}}]'

    def test_no_closing_bracket(self, daemon):
        text = '[{"name": "incomplete"'
        assert daemon._truncate_after_tool_call(text) == text

    def test_text_before_tool_call(self, daemon):
        text = 'Let me search for that. [{"name": "search"}]extra'
        result = daemon._truncate_after_tool_call(text)
        assert result == 'Let me search for that. [{"name": "search"}]'


# ---------------------------------------------------------------------------
# clean_llm_response() from utils/llm.py
# ---------------------------------------------------------------------------


class TestCleanLlmResponse:
    """Tests for utils.llm.clean_llm_response()."""

    def test_strips_endoftext(self):
        result = clean_llm_response("Hello world<|endoftext|> more stuff")
        assert result == "Hello world"

    def test_strips_im_end(self):
        result = clean_llm_response("Answer here<|im_end|>")
        assert result == "Answer here"

    def test_strips_eos_s(self):
        result = clean_llm_response("Output</s>")
        assert result == "Output"

    def test_no_eos_tokens(self):
        assert clean_llm_response("Normal text") == "Normal text"

    def test_empty_string(self):
        assert clean_llm_response("") == ""

    def test_strip_preamble_false_by_default(self):
        text = "Some preamble\n### Section\nContent"
        result = clean_llm_response(text)
        assert "Some preamble" in result

    def test_strip_preamble_true(self):
        text = "Some preamble\n### Section\nContent"
        result = clean_llm_response(text, strip_preamble=True)
        assert result.startswith("### Section")
        assert "Some preamble" not in result

    def test_strip_preamble_no_header(self):
        text = "No headers here at all"
        result = clean_llm_response(text, strip_preamble=True)
        assert result == "No headers here at all"

    def test_eos_token_takes_first_occurrence(self):
        text = "First<|endoftext|>Second<|endoftext|>Third"
        result = clean_llm_response(text)
        assert result == "First"

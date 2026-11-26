"""Tests for chat prompt formatting in the inference daemon."""

import pytest

from entry.inference_daemon import InferenceDaemon


@pytest.fixture
def daemon():
    return InferenceDaemon(base_model="test-model")


class TestQwen3ChatFormatting:
    """Tests for _format_chat_prompt()."""

    def test_simple_user_message(self, daemon):
        messages = [{"role": "user", "content": "Hello"}]
        result = daemon._format_chat_prompt(messages)
        assert "<|im_start|>user\nHello<|im_end|>" in result
        assert result.endswith("<|im_start|>assistant\n")

    def test_system_message(self, daemon):
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hi"},
        ]
        result = daemon._format_chat_prompt(messages)
        assert "<|im_start|>system\nYou are helpful.<|im_end|>" in result
        assert "<|im_start|>user\nHi<|im_end|>" in result

    def test_multi_turn_conversation(self, daemon, sample_chat_messages):
        result = daemon._format_chat_prompt(sample_chat_messages)
        assert (
            result.count("<|im_start|>") == 5
        )  # system + user + assistant + user + final assistant
        assert result.count("<|im_end|>") == 4  # all except the final assistant prefix
        assert result.endswith("<|im_start|>assistant\n")

    def test_tool_response_formatted_as_user(self, daemon, sample_tool_messages):
        result = daemon._format_chat_prompt(sample_tool_messages)
        # Tool messages should be wrapped as user messages
        assert "<|im_start|>tool" not in result
        # Legacy tokens should be stripped
        assert "<|tool_response|>" not in result
        assert "<|/tool_response|>" not in result
        # The content should still be present
        assert "Found 5 results about cats" in result

    def test_empty_messages(self, daemon):
        result = daemon._format_chat_prompt([])
        assert result == "<|im_start|>assistant\n"

    def test_missing_content_defaults_to_empty(self, daemon):
        messages = [{"role": "user"}]
        result = daemon._format_chat_prompt(messages)
        assert "<|im_start|>user\n<|im_end|>" in result

    def test_missing_role_defaults_to_user(self, daemon):
        messages = [{"content": "Hello"}]
        result = daemon._format_chat_prompt(messages)
        assert "<|im_start|>user\nHello<|im_end|>" in result


class TestDefaultStopSequences:
    """Tests for the default stop sequences."""

    def test_stop_sequences_are_strings(self):
        for seq in InferenceDaemon.DEFAULT_STOP_SEQUENCES:
            assert isinstance(seq, str)
            assert len(seq) > 0

    def test_known_stop_sequences_present(self):
        stops = InferenceDaemon.DEFAULT_STOP_SEQUENCES
        assert "Have a great day" in stops
        assert "\n\n\n" in stops

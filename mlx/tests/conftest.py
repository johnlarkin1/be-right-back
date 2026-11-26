"""Shared fixtures for Be Right Back Python tests.

All tests import from the mlx/src/ package tree. This conftest ensures
the src/ directory is on sys.path so imports like `from utils.ipc import ...`
work the same way they do in the entry point scripts.
"""

import sys
from pathlib import Path

import pytest

# Add mlx/src/ to sys.path so tests can use the same import style as entry points
_src_dir = str(Path(__file__).resolve().parent.parent / "src")
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)


@pytest.fixture
def sample_chat_messages():
    """Sample chat messages in the format the inference daemon expects."""
    return [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, how are you?"},
        {"role": "assistant", "content": "I'm doing well, thanks!"},
        {"role": "user", "content": "Tell me a joke."},
    ]


@pytest.fixture
def sample_tool_messages():
    """Messages that include tool responses."""
    return [
        {"role": "system", "content": "You are a search assistant."},
        {"role": "user", "content": "Search for cats"},
        {
            "role": "assistant",
            "content": '[{"name": "search", "arguments": {"query": "cats"}}]',
        },
        {
            "role": "tool",
            "content": "<|tool_response|>Found 5 results about cats<|/tool_response|>",
        },
        {"role": "user", "content": "Thanks!"},
    ]


@pytest.fixture
def sample_jsonl_data():
    """Sample JSONL training data entries."""
    return [
        {
            "messages": [
                {"role": "user", "content": "Hi"},
                {"role": "assistant", "content": "Hello!"},
            ]
        },
        {
            "messages": [
                {"role": "user", "content": "How are you?"},
                {"role": "assistant", "content": "Good, you?"},
                {"role": "user", "content": "Fine"},
            ]
        },
    ]

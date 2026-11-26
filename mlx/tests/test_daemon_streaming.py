"""Tests for token streaming and cancellation in the inference daemon."""

import asyncio
from types import SimpleNamespace

import pytest

import entry.inference_daemon as daemon_module
from entry.inference_daemon import (
    GenerationCancelledError,
    InferenceDaemon,
    is_cancel_command,
    preview_special_tokens,
    stop_holdback,
)


@pytest.fixture
def daemon():
    return InferenceDaemon(base_model="test-model")


def fake_stream(chunks):
    """Replace mlx_lm.stream_generate with one that yields `chunks`."""

    def _stream_generate(**_kwargs):
        for chunk in chunks:
            yield SimpleNamespace(text=chunk)

    return _stream_generate


def run(daemon, chunks, monkeypatch, **kwargs):
    monkeypatch.setattr(daemon_module, "stream_generate", fake_stream(chunks))
    streamed: list[str] = []
    result = daemon._generate_with_stop_sequences(
        "prompt", 64, sampler=None, on_token=streamed.append, **kwargs
    )
    return result, streamed


class TestHelpers:
    def test_holdback_is_longest_stop_minus_one(self):
        assert stop_holdback(["abc", "a"]) == 2

    def test_holdback_is_zero_without_stops(self):
        assert stop_holdback([]) == 0

    def test_is_cancel_command(self):
        assert is_cancel_command(b'{"cmd": "cancel"}\n')
        assert not is_cancel_command(b'{"cmd": "generate"}\n')
        assert not is_cancel_command(b"not json")
        assert not is_cancel_command(b"[1, 2]")


class TestStreaming:
    def test_streams_every_chunk_without_stops(self, daemon, monkeypatch):
        result, streamed = run(
            daemon,
            ["Hel", "lo ", "world"],
            monkeypatch,
            stop_sequences=[],
            use_default_stops=False,
        )
        assert result == "Hello world"
        assert "".join(streamed) == "Hello world"

    def test_never_streams_part_of_a_stop_sequence(self, daemon, monkeypatch):
        # "STOP" arrives split over two chunks. No streamed text may include it.
        result, streamed = run(
            daemon,
            ["Hi there", " ST", "OP and more"],
            monkeypatch,
            stop_sequences=["STOP"],
            use_default_stops=False,
        )
        assert result == "Hi there"
        assert "S" not in "".join(streamed)
        assert "Hi there".startswith("".join(streamed).rstrip())

    def test_flushes_held_back_text_at_the_end(self, daemon, monkeypatch):
        result, streamed = run(
            daemon,
            ["ab", "cd"],
            monkeypatch,
            stop_sequences=["xyz"],
            use_default_stops=False,
        )
        assert result == "abcd"
        assert "".join(streamed) == "abcd"

    def test_no_callback_still_generates(self, daemon, monkeypatch):
        monkeypatch.setattr(daemon_module, "stream_generate", fake_stream(["a", "b"]))
        result = daemon._generate_with_stop_sequences(
            "prompt", 64, sampler=None, stop_sequences=[], use_default_stops=False
        )
        assert result == "ab"


class TestSpecialTokens:
    def test_list_comes_from_the_tokenizer_longest_first(self):
        tokenizer = SimpleNamespace(all_special_tokens=["<|a|>", "<|im_end|>", "", "<|a|>"])
        assert preview_special_tokens(tokenizer) == ["<|im_end|>", "<|a|>"]

    def test_structural_tags_are_never_stripped(self):
        tokenizer = SimpleNamespace(all_special_tokens=["<tool_call>", "<think>", "<|im_end|>"])
        assert preview_special_tokens(tokenizer) == ["<|im_end|>"]

    def test_missing_tokenizer_strips_nothing(self):
        assert preview_special_tokens(None) == []

    def test_split_special_token_never_reaches_the_preview(self, daemon, monkeypatch):
        daemon.llm_tokenizer = SimpleNamespace(all_special_tokens=["<|im_end|>"])
        result, streamed = run(
            daemon,
            ["Done.", "<|im_", "end|>", " Bye"],
            monkeypatch,
            stop_sequences=[],
            use_default_stops=False,
        )
        assert "".join(streamed) == "Done. Bye"
        assert "<" not in "".join(streamed)
        # The returned text keeps the token; _clean_response() removes it later.
        assert result == "Done.<|im_end|> Bye"


class TestCancellation:
    def test_cancel_raises(self, daemon, monkeypatch):
        calls = {"n": 0}

        def is_cancelled():
            calls["n"] += 1
            return calls["n"] > 1

        monkeypatch.setattr(daemon_module, "stream_generate", fake_stream(["a", "b", "c"]))
        with pytest.raises(GenerationCancelledError):
            daemon._generate_with_stop_sequences(
                "prompt",
                64,
                sampler=None,
                stop_sequences=[],
                use_default_stops=False,
                is_cancelled=is_cancelled,
            )


class TestReadClientLines:
    """The socket reader routes `cancel` to its request's event and queues the rest."""

    @staticmethod
    async def feed(daemon, payload: bytes):
        reader = asyncio.StreamReader()
        reader.feed_data(payload)
        reader.feed_eof()
        lines: asyncio.Queue = asyncio.Queue()
        events: dict = {}
        await daemon._read_client_lines(reader, lines, events)
        queued = []
        while not lines.empty():
            queued.append(lines.get_nowait())
        return queued, events

    def test_cancel_sets_the_event_of_the_request_it_names(self, daemon):
        queued, events = asyncio.run(
            self.feed(daemon, b'{"cmd": "generate", "id": 1}\n{"cmd": "cancel", "id": 1}\n')
        )
        assert [item[0] if item else None for item in queued] == [
            b'{"cmd": "generate", "id": 1}\n',
            None,
        ]
        assert queued[0][1] is events[1]
        assert events[1].is_set()

    def test_cancel_for_another_request_is_ignored(self, daemon):
        async def scenario():
            reader = asyncio.StreamReader()
            lines: asyncio.Queue = asyncio.Queue()
            events: dict = {}
            task = asyncio.create_task(daemon._read_client_lines(reader, lines, events))

            reader.feed_data(b'{"cmd": "generate", "id": 2}\n{"cmd": "cancel", "id": 1}\n')
            _line, event = await lines.get()
            await asyncio.sleep(0)
            stopped = event.is_set()

            reader.feed_eof()
            await task
            return stopped

        assert not asyncio.run(scenario())

    def test_disconnect_sets_every_event(self, daemon):
        queued, events = asyncio.run(self.feed(daemon, b'{"cmd": "generate", "id": 5}\n'))
        assert queued[-1] is None
        assert events[5].is_set()

    def test_ping_registers_no_event(self, daemon):
        _queued, events = asyncio.run(self.feed(daemon, b'{"cmd": "ping", "id": 3}\n'))
        assert events == {}

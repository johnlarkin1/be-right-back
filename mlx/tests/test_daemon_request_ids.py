"""Tests for request ids in the inference daemon.

Every reply carries the id of its command, so the Rust client matches replies
by id. These tests drive the pipe loop and a real socket server with a fake
generation, so no model loads.
"""

import asyncio
import io
import sys
import threading
import time
from pathlib import Path

import pytest
import ujson as json

import entry.inference_daemon as daemon_module
from entry.inference_daemon import GenerationCancelledError, InferenceDaemon, with_id


class TestWithId:
    def test_stamps_a_copy(self):
        response = {"type": "pong"}
        assert with_id(response, 4) == {"type": "pong", "id": 4}
        assert response == {"type": "pong"}

    def test_no_id_leaves_the_response_unstamped(self):
        assert with_id({"type": "pong"}, None) == {"type": "pong"}


def run_pipe(daemon, monkeypatch, capsys, commands: list[str]) -> list[dict]:
    monkeypatch.setattr(sys, "stdin", io.StringIO("".join(c + "\n" for c in commands)))
    daemon.run()
    return [json.loads(line) for line in capsys.readouterr().out.splitlines()]


class TestPipeMode:
    def test_every_reply_carries_its_command_id(self, monkeypatch, capsys):
        daemon = InferenceDaemon(base_model="test-model")
        daemon.llm_model = object()
        monkeypatch.setattr(daemon, "_run_generation", lambda data, on_token=None: "answer")

        frames = run_pipe(
            daemon,
            monkeypatch,
            capsys,
            [
                '{"cmd": "ping", "id": 1}',
                '{"cmd": "cancel", "id": 1}',
                '{"cmd": "generate", "id": 2, "messages": []}',
                '{"cmd": "rerank", "id": 3, "query": "q", "passages": []}',
                "not json",
                '{"cmd": "shutdown", "id": 4}',
            ],
        )

        assert frames == [
            {"type": "ready", "protocol": 2},
            {"type": "pong", "id": 1},
            {"type": "complete", "text": "answer", "id": 2},
            {"type": "rerank_result", "scores": [], "id": 3},
            {"type": "error", "message": frames[4]["message"]},
            {"type": "shutting_down", "id": 4},
        ]

    def test_streamed_tokens_carry_the_generation_id(self, monkeypatch, capsys):
        daemon = InferenceDaemon(base_model="test-model")
        daemon.llm_model = object()

        def fake_generation(data, on_token=None):
            on_token("Hel")
            on_token("lo")
            return "Hello"

        monkeypatch.setattr(daemon, "_run_generation", fake_generation)
        frames = run_pipe(
            daemon,
            monkeypatch,
            capsys,
            ['{"cmd": "generate", "id": 9, "stream": true, "messages": []}'],
        )

        assert [f.get("id") for f in frames[1:]] == [9, 9, 9]
        assert frames[-1] == {"type": "complete", "text": "Hello", "id": 9}


class SocketClient:
    """A JSON-lines client for the daemon's socket server."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer

    async def send(self, command: dict) -> None:
        self.writer.write((json.dumps(command) + "\n").encode())
        await self.writer.drain()

    async def recv(self) -> dict:
        line = await asyncio.wait_for(self.reader.readline(), timeout=5)
        assert line, "daemon closed the socket"
        return json.loads(line)


@pytest.fixture
def socket_path():
    # macOS caps socket paths near 104 bytes, so keep this short.
    path = Path(f"/tmp/brb-test-{threading.get_ident()}-{time.monotonic_ns()}.sock")
    yield str(path)
    path.unlink(missing_ok=True)


async def serve(daemon: InferenceDaemon, socket_path: str):
    """Start the socket server pieces `_run_socket_server` sets up, minus the PID file."""
    daemon._main_loop = asyncio.get_running_loop()
    daemon._gpu_queue = asyncio.Queue()
    daemon._connected_clients = 0
    daemon._shutdown_requested = False
    daemon._last_activity = 0.0
    server = await asyncio.start_unix_server(daemon._handle_client, path=socket_path)
    worker = asyncio.create_task(daemon._gpu_worker())
    reader, writer = await asyncio.open_unix_connection(socket_path)
    client = SocketClient(reader, writer)
    assert await client.recv() == {"type": "ready", "protocol": 2}
    return server, worker, client


async def stop(server, worker, client) -> None:
    # Close the client first: its handler ends once the GPU worker answers.
    client.writer.close()
    server.close()
    await asyncio.wait_for(server.wait_closed(), timeout=5)
    worker.cancel()


def slow_generation(release: threading.Event):
    """A fake generation that streams until it is cancelled or released."""

    def generate(data, on_token=None, is_cancelled=None):
        for _ in range(500):
            if is_cancelled is not None and is_cancelled():
                raise GenerationCancelledError()
            if release.is_set():
                break
            if on_token is not None:
                on_token("x")
            time.sleep(0.01)
        return f"answer {data['id']}"

    return generate


class TestSocketMode:
    def test_cancel_stops_only_the_generation_it_names(self, monkeypatch, socket_path):
        daemon = InferenceDaemon(base_model="test-model")
        daemon.llm_model = object()
        release = threading.Event()
        monkeypatch.setattr(daemon, "_run_generation", slow_generation(release))

        async def scenario():
            server, worker, client = await serve(daemon, socket_path)
            try:
                await client.send({"cmd": "generate", "id": 1, "stream": True, "messages": []})
                assert await client.recv() == {"type": "token", "text": "x", "done": False, "id": 1}

                # A cancel for another request has no effect.
                await client.send({"cmd": "cancel", "id": 7})
                assert (await client.recv())["type"] == "token"

                await client.send({"cmd": "cancel", "id": 1})
                frame = await client.recv()
                while frame["type"] == "token":
                    assert frame["id"] == 1
                    frame = await client.recv()
                assert frame == {"type": "cancelled", "id": 1}

                # A late cancel for request 1 must not stop request 3.
                await client.send({"cmd": "ping", "id": 2})
                assert await client.recv() == {"type": "pong", "id": 2}
                await client.send({"cmd": "generate", "id": 3, "messages": []})
                await client.send({"cmd": "cancel", "id": 1})
                await asyncio.sleep(0.05)
                release.set()
                assert await client.recv() == {"type": "complete", "text": "answer 3", "id": 3}
            finally:
                release.set()
                await stop(server, worker, client)

        asyncio.run(scenario())

    def test_replies_to_an_abandoned_generation_keep_their_id(self, monkeypatch, socket_path):
        daemon = InferenceDaemon(base_model="test-model")
        daemon.llm_model = object()
        release = threading.Event()
        monkeypatch.setattr(daemon, "_run_generation", slow_generation(release))

        async def scenario():
            server, worker, client = await serve(daemon, socket_path)
            try:
                await client.send({"cmd": "generate", "id": 1, "stream": True, "messages": []})
                assert (await client.recv())["id"] == 1
                # The client gave up on request 1 and sent a new command.
                await client.send({"cmd": "embed_query", "id": 2, "text": ""})
                release.set()
                frames = []
                while not frames or frames[-1].get("id") != 2:
                    frames.append(await client.recv())
                assert all(f["id"] == 1 for f in frames[:-1])
                assert frames[-2] == {"type": "complete", "text": "answer 1", "id": 1}
                assert frames[-1] == {"type": "error", "message": "text is required", "id": 2}
            finally:
                release.set()
                await stop(server, worker, client)

        asyncio.run(scenario())

    def test_unknown_command_error_carries_the_id(self, socket_path):
        daemon = InferenceDaemon(base_model="test-model")

        async def scenario():
            server, worker, client = await serve(daemon, socket_path)
            try:
                await client.send({"cmd": "dance", "id": 11})
                assert await client.recv() == {
                    "type": "error",
                    "message": "Unknown command: dance",
                    "id": 11,
                }
            finally:
                await stop(server, worker, client)

        asyncio.run(scenario())


def test_module_has_no_shared_socket_request_id():
    """Socket handlers must get the id through `reply`, never a global."""
    assert not hasattr(daemon_module, "_current_request_id")

"""Tests for asyncio event loop handling in socket mode.

Verifies that GPU worker threads (created by asyncio.to_thread()) have
a valid asyncio event loop set, which is required by Python 3.12+ where
asyncio.get_event_loop() raises RuntimeError in threads without a loop.

This bug manifests as:
    ERROR: failed to load model: There is no current event loop in thread 'asyncio_0'.

Root cause: asyncio.to_thread() runs functions in threads named 'asyncio_0',
'asyncio_1', etc. Libraries like huggingface_hub (used by mlx_lm.load())
call asyncio.get_event_loop() in those threads. Python 3.12+ raises
RuntimeError instead of silently creating a loop.
"""

import asyncio
import threading

import pytest


class TestAsyncioGetEventLoopInThread:
    """Verify the underlying Python 3.12+ behavior that causes the bug."""

    def test_get_event_loop_fails_in_bare_thread(self):
        """asyncio.get_event_loop() raises RuntimeError in threads without a loop.

        This is the core behavior change in Python 3.12+ that triggers the bug.
        Prior to 3.12, this would just emit a DeprecationWarning and create a loop.
        """
        error = None

        def thread_fn():
            nonlocal error
            try:
                asyncio.get_event_loop()
            except RuntimeError as e:
                error = e

        t = threading.Thread(target=thread_fn)
        t.start()
        t.join()

        assert error is not None
        assert "no current event loop" in str(
            error
        ).lower() or "There is no current event loop" in str(error)

    def test_get_event_loop_works_after_set_event_loop(self):
        """Setting an event loop on a thread makes get_event_loop() work."""
        result = None

        def thread_fn():
            nonlocal result
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                got_loop = asyncio.get_event_loop()
                result = got_loop is loop
            finally:
                loop.close()

        t = threading.Thread(target=thread_fn)
        t.start()
        t.join()

        assert result is True

    @pytest.mark.asyncio
    async def test_to_thread_worker_has_no_event_loop(self):
        """asyncio.to_thread() workers ('asyncio_0') have no event loop by default.

        This reproduces the exact error from the bug report:
        'There is no current event loop in thread asyncio_0'
        """
        error_info = {}

        def check_loop():
            error_info["thread_name"] = threading.current_thread().name
            try:
                asyncio.get_event_loop()
                error_info["has_loop"] = True
            except RuntimeError as e:
                error_info["has_loop"] = False
                error_info["error"] = str(e)

        await asyncio.to_thread(check_loop)

        assert error_info["has_loop"] is False
        # Thread name should be 'asyncio_0' or similar
        assert error_info["thread_name"].startswith("asyncio_")
        assert "asyncio_" in error_info["thread_name"]


class TestRunInGpuThreadFix:
    """Test the _run_in_gpu_thread wrapper that fixes the event loop issue."""

    @staticmethod
    def _ensure_event_loop():
        """The fix: ensure current thread has an event loop before running GPU code."""
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())

    @pytest.mark.asyncio
    async def test_fix_makes_get_event_loop_work_in_thread(self):
        """After applying the fix, asyncio.get_event_loop() works in worker threads."""
        result = {}

        def gpu_work():
            self._ensure_event_loop()
            try:
                loop = asyncio.get_event_loop()
                result["success"] = True
                result["loop"] = loop
            except RuntimeError:
                result["success"] = False

        await asyncio.to_thread(gpu_work)

        assert result["success"] is True
        assert result["loop"] is not None

    @pytest.mark.asyncio
    async def test_fix_is_idempotent(self):
        """Calling the fix multiple times doesn't create extra loops."""
        loops = []

        def gpu_work():
            self._ensure_event_loop()
            loops.append(asyncio.get_event_loop())
            self._ensure_event_loop()
            loops.append(asyncio.get_event_loop())

        await asyncio.to_thread(gpu_work)

        # Both calls should return the same loop
        assert len(loops) == 2
        assert loops[0] is loops[1]

    @pytest.mark.asyncio
    async def test_fix_wraps_handler_correctly(self):
        """The wrapper calls the handler function with correct args."""
        call_log = []

        def run_in_gpu_thread(fn, *args):
            try:
                asyncio.get_event_loop()
            except RuntimeError:
                asyncio.set_event_loop(asyncio.new_event_loop())
            fn(*args)

        def mock_handler(data, writer):
            call_log.append(("handler", data, writer))

        await asyncio.to_thread(run_in_gpu_thread, mock_handler, {"cmd": "load"}, "mock_writer")

        assert len(call_log) == 1
        assert call_log[0] == ("handler", {"cmd": "load"}, "mock_writer")


class TestSendSyncMainLoop:
    """Test that _send_sync uses the stored main loop reference."""

    @pytest.mark.asyncio
    async def test_main_loop_is_accessible_from_worker_thread(self):
        """The stored main loop can be used from worker threads for run_coroutine_threadsafe."""
        main_loop = asyncio.get_running_loop()
        result = {}

        async def async_op():
            result["ran"] = True

        def worker():
            # This is what _send_sync does — schedule a coroutine on the main loop
            future = asyncio.run_coroutine_threadsafe(async_op(), main_loop)
            future.result(timeout=5)

        await asyncio.to_thread(worker)

        assert result["ran"] is True

    @pytest.mark.asyncio
    async def test_get_event_loop_from_thread_would_fail(self):
        """Calling asyncio.get_event_loop() from worker thread fails — proving _send_sync was buggy."""
        error_caught = False

        def worker():
            nonlocal error_caught
            try:
                asyncio.get_event_loop()
            except RuntimeError:
                error_caught = True

        await asyncio.to_thread(worker)

        assert error_caught, (
            "asyncio.get_event_loop() should fail in worker threads on Python 3.12+. "
            "The old _send_sync code used this pattern and would crash."
        )


class TestSocketModeIntegration:
    """Integration tests simulating the socket mode daemon's GPU dispatch pattern."""

    @pytest.mark.asyncio
    async def test_full_gpu_dispatch_pattern(self):
        """Simulate the full socket mode GPU dispatch: to_thread → ensure loop → handler → send_sync."""
        main_loop = asyncio.get_running_loop()
        responses = []

        async def mock_send_response_async(writer, response):
            responses.append(response)

        def send_sync(writer, response):
            """Fixed _send_sync using stored main_loop."""
            asyncio.run_coroutine_threadsafe(
                mock_send_response_async(writer, response), main_loop
            ).result(timeout=5)

        def handle_load(data, writer):
            """Simulated _handle_load_for_socket."""
            # Simulate mlx_lm.load() calling asyncio.get_event_loop().
            # The call is the assertion here -- it raises without the fix.
            asyncio.get_event_loop()
            send_sync(writer, {"type": "loaded", "persona_id": data["persona_id"]})

        def run_in_gpu_thread(fn, *args):
            """The fix wrapper."""
            try:
                asyncio.get_event_loop()
            except RuntimeError:
                asyncio.set_event_loop(asyncio.new_event_loop())
            fn(*args)

        # Simulate dispatch
        await asyncio.to_thread(
            run_in_gpu_thread,
            handle_load,
            {"persona_id": "__base__", "base_model": "test-model"},
            "mock_writer",
        )

        assert len(responses) == 1
        assert responses[0] == {"type": "loaded", "persona_id": "__base__"}

    @pytest.mark.asyncio
    async def test_gpu_dispatch_without_fix_fails(self):
        """Without the fix, the GPU dispatch pattern fails on Python 3.12+."""

        def handle_load_broken(data, writer):
            """Handler that calls asyncio.get_event_loop() without the fix."""
            asyncio.get_event_loop()  # This should fail

        error_caught = False
        try:
            await asyncio.to_thread(handle_load_broken, {"persona_id": "test"}, "mock_writer")
        except RuntimeError:
            error_caught = True

        assert error_caught, "Should fail without the event loop fix"

    @pytest.mark.asyncio
    async def test_error_in_handler_still_sends_response(self):
        """When a handler fails, the error response is sent via the main loop (not get_event_loop)."""
        main_loop = asyncio.get_running_loop()
        responses = []

        async def mock_send_response_async(writer, response):
            responses.append(response)

        def send_sync(writer, response):
            """Fixed _send_sync using stored main_loop."""
            asyncio.run_coroutine_threadsafe(
                mock_send_response_async(writer, response), main_loop
            ).result(timeout=5)

        def handle_load_that_fails(data, writer):
            """Handler that simulates mlx_lm.load() failing."""
            raise ValueError("Model not found")

        def handle_load_for_socket(data, writer):
            """Socket handler with error recovery."""
            try:
                handle_load_that_fails(data, writer)
                send_sync(writer, {"type": "loaded", "persona_id": data["persona_id"]})
            except Exception as e:
                send_sync(writer, {"type": "error", "message": f"Failed to load: {e}"})

        def run_in_gpu_thread(fn, *args):
            try:
                asyncio.get_event_loop()
            except RuntimeError:
                asyncio.set_event_loop(asyncio.new_event_loop())
            fn(*args)

        await asyncio.to_thread(
            run_in_gpu_thread, handle_load_for_socket, {"persona_id": "test"}, "mock_writer"
        )

        assert len(responses) == 1
        assert responses[0]["type"] == "error"
        assert "Model not found" in responses[0]["message"]

    @pytest.mark.asyncio
    async def test_multiple_sequential_gpu_commands(self):
        """Multiple GPU commands can run sequentially through the thread pool."""
        main_loop = asyncio.get_running_loop()
        responses = []

        async def mock_send(writer, response):
            responses.append(response)

        def send_sync(writer, response):
            asyncio.run_coroutine_threadsafe(mock_send(writer, response), main_loop).result(
                timeout=5
            )

        def handle_ping(data, writer):
            send_sync(writer, {"type": "pong"})

        def run_in_gpu_thread(fn, *args):
            try:
                asyncio.get_event_loop()
            except RuntimeError:
                asyncio.set_event_loop(asyncio.new_event_loop())
            fn(*args)

        # Run multiple commands
        for i in range(3):
            await asyncio.to_thread(run_in_gpu_thread, handle_ping, {}, f"writer_{i}")

        assert len(responses) == 3
        assert all(r["type"] == "pong" for r in responses)

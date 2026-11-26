"""Tests for the JSON-lines IPC protocol between Python and Rust.

Verifies that send_response() and the various send_* helpers produce
valid JSON that matches what the Rust subprocess handler expects.
"""

import ujson as json

from utils.ipc import send_response


class TestSendResponse:
    """Tests for utils.ipc.send_response()."""

    def test_outputs_valid_json(self, capsys):
        send_response({"type": "ready"})
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed == {"type": "ready"}

    def test_outputs_single_line(self, capsys):
        send_response({"type": "token", "text": "hello\nworld"})
        captured = capsys.readouterr()
        lines = captured.out.strip().split("\n")
        assert len(lines) == 1

    def test_preserves_all_fields(self, capsys):
        data = {"type": "embedding", "vector": [0.1, 0.2, 0.3], "dims": 3}
        send_response(data)
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["type"] == "embedding"
        assert parsed["vector"] == [0.1, 0.2, 0.3]
        assert parsed["dims"] == 3


class TestDaemonMessageTypes:
    """Test that daemon helper functions produce correct message types.

    These functions are imported from entry.inference_daemon but they
    all delegate to send_response(), so we capture stdout.
    """

    def test_send_ready(self, capsys):
        from entry.inference_daemon import send_ready

        send_ready()
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "ready", "protocol": 2}

    def test_send_loaded(self, capsys):
        from entry.inference_daemon import send_loaded

        send_loaded("persona-123")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "loaded", "persona_id": "persona-123"}

    def test_send_token(self, capsys):
        from entry.inference_daemon import send_token

        send_token("hello", done=False)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "token", "text": "hello", "done": False}

    def test_send_token_done(self, capsys):
        from entry.inference_daemon import send_token

        send_token("!", done=True)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["done"] is True

    def test_send_complete(self, capsys):
        from entry.inference_daemon import send_complete

        send_complete("Full response text")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "complete", "text": "Full response text"}

    def test_send_error(self, capsys):
        from entry.inference_daemon import send_error

        send_error("something broke")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "error", "message": "something broke"}

    def test_send_embedding(self, capsys):
        from entry.inference_daemon import send_embedding

        send_embedding([0.1, 0.2], 2)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "embedding", "vector": [0.1, 0.2], "dims": 2}

    def test_send_pong(self, capsys):
        from entry.inference_daemon import send_pong

        send_pong()
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "pong"}

    def test_send_rerank_result(self, capsys):
        from entry.inference_daemon import send_rerank_result

        send_rerank_result([0.95, 0.3, 0.1])
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "rerank_result", "scores": [0.95, 0.3, 0.1]}

    def test_send_shutting_down(self, capsys):
        from entry.inference_daemon import send_shutting_down

        send_shutting_down()
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "shutting_down"}


class TestProgressBaseProtocol:
    """Test progress/base.py emit functions."""

    def test_emit_result_success(self, capsys):
        from progress.base import emit_result

        emit_result(True, data={"count": 42})
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["type"] == "result"
        assert parsed["success"] is True
        assert parsed["data"]["count"] == 42

    def test_emit_result_failure(self, capsys):
        from progress.base import emit_result

        emit_result(False, error="disk full")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["type"] == "result"
        assert parsed["success"] is False
        assert parsed["error"] == "disk full"

    def test_emit_result_default_data(self, capsys):
        from progress.base import emit_result

        emit_result(True)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["data"] == {}

    def test_emit_log(self, capsys):
        from progress.base import emit_log

        emit_log("info", "hello world")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed == {"type": "log", "level": "info", "message": "hello world"}

    def test_log_info_emits_to_both(self, capsys):
        from progress.base import log_info

        log_info("test message")
        captured = capsys.readouterr()
        # stdout: JSON
        parsed = json.loads(captured.out.strip())
        assert parsed["level"] == "info"
        # stderr: human-readable
        assert "test message" in captured.err

    def test_log_warn_emits_to_both(self, capsys):
        from progress.base import log_warn

        log_warn("careful!")
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["level"] == "warn"
        assert "warning: careful!" in captured.err

    def test_log_error_emits_to_both(self, capsys):
        from progress.base import log_error

        log_error("bad thing")
        captured = capsys.readouterr()
        parsed = json.loads(captured.out.strip())
        assert parsed["level"] == "error"
        assert "error: bad thing" in captured.err


class TestIngestionProgress:
    """Test ingestion progress protocol."""

    def test_emit_stage_progress_basic(self, capsys):
        from progress.ingestion import IngestionStage, emit_stage_progress

        emit_stage_progress(IngestionStage.EMBEDDING, 50, "Embedding chunks...")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["type"] == "stage_progress"
        assert parsed["stage"] == "embedding"
        assert parsed["percent"] == 50
        assert parsed["message"] == "Embedding chunks..."

    def test_emit_stage_progress_clamps_percent(self, capsys):
        from progress.ingestion import IngestionStage, emit_stage_progress

        emit_stage_progress(IngestionStage.SAVING, 150, "Over limit")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["percent"] == 100

        emit_stage_progress(IngestionStage.SAVING, -10, "Under limit")
        lines = capsys.readouterr().out.strip().split("\n")
        parsed = json.loads(lines[-1])
        assert parsed["percent"] == 0

    def test_emit_stage_progress_with_stats(self, capsys):
        from progress.ingestion import (
            IngestionStage,
            ProgressStats,
            emit_stage_progress,
        )

        stats = ProgressStats(items_processed=10, total_items=100, chunks_created=50)
        emit_stage_progress(IngestionStage.CHUNKING, 75, "Chunking...", stats=stats)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["stats"]["items_processed"] == 10
        assert parsed["stats"]["chunks_created"] == 50

    def test_emit_stage_progress_with_contact(self, capsys):
        from progress.ingestion import (
            ContactProgress,
            IngestionStage,
            emit_stage_progress,
        )

        contact = ContactProgress(contact_id="abc", contact_name="Alice", messages_in_contact=42)
        emit_stage_progress(IngestionStage.PARSING, 25, "Parsing...", current_contact=contact)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["current_contact"]["contact_id"] == "abc"
        assert parsed["current_contact"]["contact_name"] == "Alice"
        assert parsed["current_contact"]["messages_in_contact"] == 42

    def test_all_stages_have_correct_values(self):
        from progress.ingestion import IngestionStage

        assert IngestionStage.PARSING.value == "parsing"
        assert IngestionStage.CHUNKING.value == "chunking"
        assert IngestionStage.EMBEDDING.value == "embedding"
        assert IngestionStage.SAVING.value == "saving"


class TestAnalyticsProgress:
    """Test analytics progress protocol."""

    def test_emit_progress_basic(self, capsys):
        from progress.analytics import AnalyticsStage, emit_progress

        emit_progress(AnalyticsStage.PCA, 30, "Running PCA...")
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["type"] == "analytics_progress"
        assert parsed["stage"] == "pca"
        assert parsed["percent"] == 30

    def test_emit_progress_with_stats(self, capsys):
        from progress.analytics import AnalyticsStage, AnalyticsStats, emit_progress

        stats = AnalyticsStats(n_clusters=5, noise_ratio=0.12)
        emit_progress(AnalyticsStage.CLUSTERING, 100, "Done", stats=stats)
        parsed = json.loads(capsys.readouterr().out.strip())
        assert parsed["stats"]["n_clusters"] == 5
        assert parsed["stats"]["noise_ratio"] == 0.12

    def test_all_stages_have_correct_values(self):
        from progress.analytics import AnalyticsStage

        expected = [
            "loading",
            "pca",
            "clustering",
            "umap_2d",
            "umap_3d",
            "labeling",
            "saving_clusters",
            "activity",
            "words",
            "complete",
        ]
        actual = [s.value for s in AnalyticsStage]
        assert actual == expected

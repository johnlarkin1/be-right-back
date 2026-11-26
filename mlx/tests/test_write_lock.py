"""The write-lock handshake with the desktop app (data/write_lock.py)."""

import io
import json

import pytest

from data.write_lock import HANDSHAKE_ENV, WriteLockError, write_lock


def _requests(out: str) -> list[str]:
    return [json.loads(line)["action"] for line in out.splitlines() if line]


def test_no_handshake_without_env(monkeypatch, capsys):
    monkeypatch.delenv(HANDSHAKE_ENV, raising=False)
    with write_lock():
        pass
    assert capsys.readouterr().out == ""


def test_acquire_and_release(monkeypatch, capsys):
    monkeypatch.setenv(HANDSHAKE_ENV, "1")
    monkeypatch.setattr("sys.stdin", io.StringIO("ok\nok\n"))
    with write_lock():
        assert _requests(capsys.readouterr().out) == ["acquire"]
    assert _requests(capsys.readouterr().out) == ["release"]


def test_release_runs_when_body_raises(monkeypatch, capsys):
    monkeypatch.setenv(HANDSHAKE_ENV, "1")
    monkeypatch.setattr("sys.stdin", io.StringIO("ok\nok\n"))
    with pytest.raises(ValueError), write_lock():
        raise ValueError("write failed")
    assert _requests(capsys.readouterr().out) == ["acquire", "release"]


def test_refused_lock_raises_before_body(monkeypatch):
    monkeypatch.setenv(HANDSHAKE_ENV, "1")
    monkeypatch.setattr("sys.stdin", io.StringIO("error: 2 read connection(s) did not close\n"))
    ran = False
    with pytest.raises(WriteLockError, match="did not close"), write_lock():
        ran = True
    assert not ran


def test_closed_channel_raises(monkeypatch):
    monkeypatch.setenv(HANDSHAKE_ENV, "1")
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    with pytest.raises(WriteLockError, match="closed"), write_lock():
        pass

"""Ask the desktop app for the brb.duckdb write lock before writing.

The app keeps a read-only connection to brb.duckdb open while it runs, and
DuckDB refuses a writer while any reader holds the file. When the app spawns a
script, it sets ``BRB_WRITE_LOCK_HANDSHAKE=1`` and pipes stdin. The script then
asks for the lock on stdout, and the app closes its connection and replies
``ok`` on stdin. See ``crates/ingestion/src/write_lock.rs``.

Without the variable (a manual run from a shell), the lock is a no-op.
"""

import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager

import ujson as json

HANDSHAKE_ENV = "BRB_WRITE_LOCK_HANDSHAKE"


class WriteLockError(RuntimeError):
    """The app refused the write lock or closed the channel."""


def _request(action: str) -> None:
    print(json.dumps({"type": "write_lock", "action": action}), flush=True)
    reply = sys.stdin.readline().strip()
    if reply != "ok":
        raise WriteLockError(reply or f"app closed the write-lock channel during {action}")


@contextmanager
def write_lock() -> Iterator[None]:
    """Hold the app's brb.duckdb write lock for the body of the block.

    Keep the block short: app reads (Insights, Casper) fail while it is held.
    """
    if os.environ.get(HANDSHAKE_ENV) != "1":
        yield
        return
    _request("acquire")
    try:
        yield
    finally:
        _request("release")

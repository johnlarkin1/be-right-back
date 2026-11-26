"""Shared progress reporting utilities for Be Right Back Python scripts.

All Python scripts use JSON-lines format for progress reporting.
Each line is a complete JSON object that Rust can parse.

Message Types:
    {"type": "result", "success": true, "data": {...}}
    {"type": "error", "message": "...", "code": "..."}
    {"type": "log", "level": "info|warn|error", "message": "..."}

Human-readable output goes to stderr; JSON progress goes to stdout.
"""

import sys
from typing import Any

import ujson as json


def emit_result(success: bool, data: dict[str, Any] | None = None, error: str | None = None):
    """Emit a final result to stdout for Rust to parse."""
    result: dict[str, Any] = {"type": "result", "success": success, "data": data or {}}
    if error:
        result["error"] = error
    print(json.dumps(result), flush=True)


def emit_log(level: str, message: str):
    """Emit a structured log message for Rust to capture via tracing."""
    print(json.dumps({"type": "log", "level": level, "message": message}), flush=True)


def log_info(message: str):
    """Log an info message to both JSON stdout and human-readable stderr."""
    emit_log("info", message)
    print(message, file=sys.stderr)


def log_warn(message: str):
    """Log a warning message to both JSON stdout and human-readable stderr."""
    emit_log("warn", message)
    print(f"warning: {message}", file=sys.stderr)


def log_error(message: str):
    """Log an error message to both JSON stdout and human-readable stderr."""
    emit_log("error", message)
    print(f"error: {message}", file=sys.stderr)

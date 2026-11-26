#!/usr/bin/env python3
"""LLM-based personality analysis CLI with two-phase streaming progress support.

Uses a two-phase approach for higher quality analysis:
- Phase 1: Extract 5 notable quotes, topics, and insights (optimized for speed)
- Phase 2: Generate personality analysis using the curated data

Reads conversation blocks from stdin, analyzes personality using local LLM,
and returns personality description as JSON to stdout.

Input format:
{
    "contact_name": "Alice",
    "phase1_conversation_blocks": [...],  // 15-25 blocks for quote extraction
    "phase2_conversation_blocks": [...],  // 20-30 blocks for analysis context
    "streaming": true,
    "metadata": {
        "total_messages": 5000,
        "messages_from_me": 2500,
        "messages_from_them": 2500,
        "first_message_date": "2020-01-15",
        "last_message_date": "2024-12-01",
        "conversation_span_days": 1782,
        "avg_messages_per_week": 28.5
    },
    "max_tokens_phase1": 1200,
    "max_tokens_phase2": 3200
}

Output format (streaming mode - JSON lines):
{"type": "phase", "phase": "loading_model"}
{"type": "phase", "phase": "extracting_quotes"}
{"type": "phase", "phase": "analyzing_personality"}
{"type": "phase1_complete", "quotes_count": 25, "topics_count": 8, "insights_count": 4}
{"type": "complete", "content": "...", "duration_secs": 90}

Output format (non-streaming mode - single JSON):
{"success": true, "personality_description": "...", "curated_data": {...}, "error": null}
"""

import sys
import time
import traceback
from pathlib import Path

import ujson as json

# Add mlx/src/ to path so entry points can import sibling packages.
# This is necessary because entry point scripts are invoked directly by the Rust
# subprocess runner (not via `python -m`), so the package root isn't automatically
# on sys.path. Imports below this block depend on this path setup.
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from core.analyze_persona import (  # noqa: E402
    analyze_personality_two_phase,
    analyze_self_two_phase,
)


def emit_event(event_type: str, **kwargs) -> None:
    """Emit a JSON line event to stdout."""
    event = {"type": event_type, **kwargs}
    print(json.dumps(event), flush=True)


def main():
    start_time = time.time()
    streaming = False  # Default value for error handling

    try:
        input_data = json.loads(sys.stdin.read())
        contact_id = input_data.get("contact_id", "")
        contact_name = input_data.get("contact_name", "Unknown")
        phase1_blocks = input_data.get("phase1_conversation_blocks", [])
        phase2_blocks = input_data.get("phase2_conversation_blocks", [])
        streaming = input_data.get("streaming", False)
        metadata = input_data.get("metadata", None)
        max_tokens_phase1 = input_data.get("max_tokens_phase1", 1200)
        max_tokens_phase2 = input_data.get("max_tokens_phase2", 3200)

        # Determine if this is a self-analysis ("You" persona)
        is_self_analysis = contact_id.lower() == "you" or contact_name.lower() == "you"

        print(f"Analyzing personality for: {contact_name} (id={contact_id})", file=sys.stderr)
        print(f"Self-analysis mode: {is_self_analysis}", file=sys.stderr)
        print(f"Phase 1 conversation blocks: {len(phase1_blocks)}", file=sys.stderr)
        print(f"Phase 2 conversation blocks: {len(phase2_blocks)}", file=sys.stderr)
        print(f"Streaming mode: {streaming}", file=sys.stderr)
        if metadata:
            print(f"Metadata: total_messages={metadata.get('total_messages')}", file=sys.stderr)

        if not phase1_blocks:
            error_msg = "No phase1_conversation_blocks provided"
            if streaming:
                emit_event("error", error=error_msg)
            else:
                output = {
                    "success": False,
                    "personality_description": None,
                    "curated_data": None,
                    "error": error_msg,
                }
                print(json.dumps(output))
            return

        if not phase2_blocks:
            error_msg = "No phase2_conversation_blocks provided"
            if streaming:
                emit_event("error", error=error_msg)
            else:
                output = {
                    "success": False,
                    "personality_description": None,
                    "curated_data": None,
                    "error": error_msg,
                }
                print(json.dumps(output))
            return

        # Define progress callback for streaming mode
        def progress_callback(phase: str) -> None:
            if streaming:
                emit_event("phase", phase=phase)

        # Run two-phase analysis (route to self-analysis or contact analysis)
        if is_self_analysis:
            description, curated_data = analyze_self_two_phase(
                phase1_blocks=phase1_blocks,
                phase2_blocks=phase2_blocks,
                progress_callback=progress_callback,
                metadata=metadata,
                max_tokens_phase1=max_tokens_phase1,
                max_tokens_phase2=max_tokens_phase2,
            )
        else:
            description, curated_data = analyze_personality_two_phase(
                contact_name=contact_name,
                phase1_blocks=phase1_blocks,
                phase2_blocks=phase2_blocks,
                progress_callback=progress_callback,
                metadata=metadata,
                max_tokens_phase1=max_tokens_phase1,
                max_tokens_phase2=max_tokens_phase2,
            )

        duration_secs = int(time.time() - start_time)

        # Emit phase1_complete event with summary
        if streaming and curated_data:
            emit_event(
                "phase1_complete",
                quotes_count=len(curated_data.get("quotes", [])),
                topics_count=len(curated_data.get("topics", [])),
                insights_count=len(curated_data.get("insights", [])),
            )

        if streaming:
            if description:
                emit_event("complete", content=description, duration_secs=duration_secs)
            else:
                emit_event("error", error="LLM analysis failed")
        else:
            if description:
                output = {
                    "success": True,
                    "personality_description": description,
                    "curated_data": curated_data,
                    "error": None,
                    "duration_secs": duration_secs,
                }
            else:
                output = {
                    "success": False,
                    "personality_description": None,
                    "curated_data": None,
                    "error": "LLM analysis failed",
                }
            print(json.dumps(output))

    except json.JSONDecodeError as e:
        error_msg = f"Invalid JSON input: {e}"
        if streaming:
            emit_event("error", error=error_msg)
        else:
            output = {
                "success": False,
                "personality_description": None,
                "curated_data": None,
                "error": error_msg,
            }
            print(json.dumps(output))
        sys.exit(1)

    except Exception as e:
        error_msg = f"Unexpected error: {e}"
        if streaming:
            emit_event("error", error=error_msg)
        else:
            output = {
                "success": False,
                "personality_description": None,
                "curated_data": None,
                "error": error_msg,
            }
            print(json.dumps(output))
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

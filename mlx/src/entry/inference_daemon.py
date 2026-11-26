#!/usr/bin/env python3
"""MLX inference daemon for Be Right Back.

This script runs as a long-lived subprocess that handles:
- Loading personas (base model + LoRA adapter)
- Generating responses from messages
- Generating query embeddings for semantic search

Communication is via JSON lines over stdin/stdout:
- Commands: {"cmd": "load"|"generate"|"embed_query"|"rerank"|"ping"|"shutdown"|"cancel", ...}
- Responses: {"type": "ready"|"loaded"|"token"|"complete"|"cancelled"|"embedding"|"rerank_result"|"error"|"pong"|"shutting_down", ...}

Every command carries a request `id`. Every response to it carries the same
`id`, so the client matches replies by id, not by arrival order. The `ready`
frame has no id and reports `protocol`, the version of this format.

A `generate` command with `"stream": true` sends `token` frames as text arrives,
then one `complete` frame with the cleaned response. The `complete` text is
authoritative: tokens are a raw preview. In socket mode, a `cancel` command
stops the generation whose id it carries, which then answers `cancelled`.
"""

import argparse
import asyncio
import os
import signal
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import ujson as json

# Add mlx/src/ to path so entry points can import sibling packages.
# This is necessary because entry point scripts are invoked directly by the Rust
# subprocess runner (not via `python -m`), so the package root isn't automatically
# on sys.path. Imports below this block depend on this path setup.
_src_dir = str(Path(__file__).resolve().parent.parent)
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)


# Import after path setup
from mlx_lm import load, stream_generate  # noqa: E402
from mlx_lm.sample_utils import make_sampler  # noqa: E402

from config.embedding import EmbeddingConfig  # noqa: E402
from core.analyze_persona import (  # noqa: E402
    analyze_personality_with_quotes,
    analyze_self_personality,
    extract_quotes_from_conversations,
    extract_self_quotes,
)
from ml.embeddings import embed_batch_mlx, load_embedding_model  # noqa: E402
from ml.reranker import CrossEncoderReranker  # noqa: E402
from utils.ipc import send_response as write_response  # noqa: E402
from utils.ipc import send_response_async  # noqa: E402
from utils.msg_break import read_msg_break_token, register_msg_break  # noqa: E402
from utils.sampling import make_repetition_penalty, structure_token_ids  # noqa: E402

# Version of the command/response format. Version 2 added request ids. The
# Rust client restarts a daemon that reports another version.
PROTOCOL_VERSION = 2

# Request id of the pipe-mode command in progress. Pipe mode handles one
# command at a time on one thread, so one module-level value is safe. Socket
# mode never reads it: each socket handler gets a `reply` bound to its id.
_pipe_request_id: Any = None

Reply = Callable[[dict], None]


def with_id(response: dict, request_id: Any) -> dict:
    """Return a copy of `response` stamped with `request_id`, if there is one."""
    if request_id is None:
        return response
    return {**response, "id": request_id}


def send_response(response: dict) -> None:
    """Write a pipe-mode response, stamped with the current request id."""
    write_response(with_id(response, _pipe_request_id))


def send_ready() -> None:
    """Signal that the daemon is ready."""
    send_response({"type": "ready", "protocol": PROTOCOL_VERSION})


def send_loaded(persona_id: str) -> None:
    """Signal that a persona was loaded."""
    send_response({"type": "loaded", "persona_id": persona_id})


def send_token(text: str, done: bool = False) -> None:
    """Send a generated token."""
    send_response({"type": "token", "text": text, "done": done})


def send_complete(text: str) -> None:
    """Send a complete generation."""
    send_response({"type": "complete", "text": text})


class GenerationCancelledError(Exception):
    """Raised when a cancel command stops a generation."""


def is_cancel_command(line: bytes | str) -> bool:
    """Return True if a raw command line is a `cancel` command."""
    try:
        data = json.loads(line)
    except (ValueError, TypeError):
        return False
    return isinstance(data, dict) and data.get("cmd") == "cancel"


# Tags the Rust answer preview reads to hide thinking and tool calls. They are
# never stripped from streamed text, even if a tokenizer marks them special.
PREVIEW_STRUCTURAL_TAGS = frozenset({"<think>", "</think>", "<tool_call>", "</tool_call>"})


def preview_special_tokens(tokenizer: Any, keep: frozenset[str] = frozenset()) -> list[str]:
    """Special tokens to strip from streamed text, longest first.

    The list comes from the tokenizer, so it matches whatever model is loaded.
    Tokens in `keep` stay in the text, like the persona's bubble break token,
    which the chat UI splits on.
    """
    tokens = getattr(tokenizer, "all_special_tokens", None) or []
    skip = PREVIEW_STRUCTURAL_TAGS | keep
    strip = {t for t in tokens if isinstance(t, str) and t and t not in skip}
    return sorted(strip, key=len, reverse=True)


def strip_tokens(text: str, tokens: list[str]) -> str:
    """Remove every occurrence of each token from text."""
    for token in tokens:
        text = text.replace(token, "")
    return text


def stop_holdback(stop_sequences: list[str]) -> int:
    """Number of trailing characters to hold back while streaming.

    A stop sequence can arrive split over several tokens. Holding back
    `max_len - 1` characters means no streamed text is ever part of a stop
    sequence that completes later.
    """
    if not stop_sequences:
        return 0
    return max(len(s) for s in stop_sequences) - 1


def send_embedding(vector: list[float], dims: int) -> None:
    """Send an embedding result."""
    send_response({"type": "embedding", "vector": vector, "dims": dims})


def send_error(message: str) -> None:
    """Send an error response."""
    send_response({"type": "error", "message": message})


def send_pong() -> None:
    """Respond to ping."""
    send_response({"type": "pong"})


def send_rerank_result(scores: list[float]) -> None:
    """Send rerank scores."""
    send_response({"type": "rerank_result", "scores": scores})


def send_analysis_progress(phase: str) -> None:
    """Send analysis progress update."""
    send_response({"type": "analysis_progress", "phase": phase})


def send_analysis_phase1_complete(
    quotes_count: int, topics_count: int, insights_count: int
) -> None:
    """Send phase 1 completion with stats."""
    send_response(
        {
            "type": "analysis_phase1_complete",
            "quotes_count": quotes_count,
            "topics_count": topics_count,
            "insights_count": insights_count,
        }
    )


def send_analysis_complete(content: str, duration_secs: int) -> None:
    """Send completed analysis result."""
    send_response({"type": "analysis_complete", "content": content, "duration_secs": duration_secs})


def send_shutting_down() -> None:
    """Signal shutdown."""
    send_response({"type": "shutting_down"})


class InferenceDaemon:
    """Long-running daemon for MLX inference."""

    # Default stop sequences to prevent looping/pleasantries
    DEFAULT_STOP_SEQUENCES = [
        "\n\n\n",
        "Have a great day",
        "You're welcome!",
        ">):",
        "If you have any",
        "Feel free to",
    ]

    def __init__(self, base_model: str):
        self.base_model = base_model
        self.current_persona_id: str | None = None
        self.current_loaded_model: str | None = None  # Track which model is actually loaded

        # LLM model/tokenizer (loaded on demand)
        self.llm_model: Any = None
        self.llm_tokenizer: Any = None
        # The loaded persona's bubble break token, from its chat_metadata.json.
        self.msg_break_token: str | None = None

        # Embedding model/tokenizer (loaded on demand)
        self.embed_model: Any = None
        self.embed_tokenizer: Any = None
        self.embed_config = EmbeddingConfig()

        # Cross-encoder reranker (loaded on demand)
        self.reranker: Any = None

    def load_llm(self, persona_id: str, model_override: str | None = None) -> None:
        """Load the LLM with optional model override and persona's LoRA adapter.

        If persona_id is "__base__", loads only the base model without any adapter.
        This is used by agents that don't need persona-specific models.

        Args:
            persona_id: The persona ID to load, or "__base__" for base model only.
            model_override: Optional model to load instead of self.base_model.
                           Used for hot-swapping between different models.
        """
        model_to_load = model_override or self.base_model

        # Check if we need to reload (different model or different persona)
        if (
            self.current_loaded_model == model_to_load
            and self.current_persona_id == persona_id
            and self.llm_model is not None
        ):
            sys.stderr.write(f"Model {model_to_load} already loaded for {persona_id}, skipping\n")
            sys.stderr.flush()
            return

        # Special sentinel for base model only (no adapter)
        if persona_id == "__base__":
            sys.stderr.write(f"Loading base model only (no adapter): {model_to_load}\n")
            sys.stderr.flush()
            self.llm_model, self.llm_tokenizer, *_ = load(model_to_load)
            self.msg_break_token = None
            self.current_persona_id = persona_id
            self.current_loaded_model = model_to_load
            sys.stderr.write("Base model loaded successfully\n")
            sys.stderr.flush()
            return

        # Determine adapter path -- check both flat and nested locations.
        # Training saves adapters.safetensors directly in the persona dir (flat),
        # while mlx_lm train_model may also create an adapter/ subdirectory (nested).
        # mlx_lm.load() expects adapter_path to be the directory containing adapters.safetensors.
        brb_dir = Path.home() / ".be-right-back"
        persona_dir = brb_dir / "models" / "personas" / persona_id
        nested_adapter_dir = persona_dir / "adapter"
        flat_adapter_file = persona_dir / "adapters.safetensors"
        nested_adapter_file = nested_adapter_dir / "adapters.safetensors"

        # Resolve which adapter location to use
        adapter_dir = None
        if nested_adapter_file.exists():
            adapter_dir = nested_adapter_dir
        elif flat_adapter_file.exists():
            adapter_dir = persona_dir

        # Load base model
        sys.stderr.write(f"Loading base model: {model_to_load}\n")
        sys.stderr.flush()

        if adapter_dir is not None:
            # Load with adapter
            sys.stderr.write(f"Loading adapter from: {adapter_dir}\n")
            sys.stderr.flush()
            self.llm_model, self.llm_tokenizer, *_ = load(
                model_to_load,
                adapter_path=str(adapter_dir),
            )
        else:
            # Load base model only
            sys.stderr.write(f"No adapter found in {persona_dir}, using base model only\n")
            sys.stderr.flush()
            self.llm_model, self.llm_tokenizer, *_ = load(model_to_load)

        # Training registered the persona's break token, and the adapter holds its
        # trained rows. Register it the same way so it gets the same id here.
        self.msg_break_token = None
        chat_metadata_path = persona_dir / "chat_metadata.json"
        if chat_metadata_path.exists():
            chat_metadata = json.loads(chat_metadata_path.read_text(encoding="utf-8"))
            self.msg_break_token = read_msg_break_token(chat_metadata, str(chat_metadata_path))
            register_msg_break(self.llm_tokenizer, self.msg_break_token, self.llm_model)

        self.current_persona_id = persona_id
        self.current_loaded_model = model_to_load
        sys.stderr.write(f"Model loaded for persona: {persona_id}\n")
        sys.stderr.flush()

    def load_embedding_model(self) -> None:
        """Load the embedding model (lazy initialization)."""
        if self.embed_model is not None:
            return

        sys.stderr.write("Loading embedding model...\n")
        sys.stderr.flush()

        self.embed_model, self.embed_tokenizer = load_embedding_model(self.embed_config)

        sys.stderr.write("Embedding model loaded\n")
        sys.stderr.flush()

    def handle_load(self, data: dict) -> None:
        """Handle load command.

        Supports model override for hot-swapping between different models.
        """
        persona_id = data.get("persona_id")
        base_model = data.get("base_model")  # Can be None to use default

        if not persona_id:
            send_error("persona_id is required")
            return

        try:
            # Pass model override to load_llm (will use self.base_model if None)
            self.load_llm(persona_id, model_override=base_model)
            send_loaded(persona_id)

        except Exception as e:
            send_error(f"Failed to load persona: {e}")

    def handle_generate(self, data: dict) -> None:
        """Handle generate command (pipe mode).

        Pipe mode reads stdin on this thread, so it cannot see a `cancel`
        command mid-generation. The Rust client cancels a pipe daemon by
        killing the process.
        """
        if self.llm_model is None:
            send_error("No model loaded. Call 'load' first.")
            return

        on_token = (lambda text: send_token(text)) if data.get("stream", False) else None

        try:
            response = self._run_generation(data, on_token=on_token)
            send_complete(response)
        except Exception as e:
            send_error(f"Generation failed: {e}")

    def _run_generation(
        self,
        data: dict,
        on_token: Callable[[str], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> str:
        """Generate a cleaned response for a `generate` command.

        `on_token` receives raw text as it arrives (streaming mode). The return
        value is the cleaned response that goes in the `complete` frame.
        Raises `GenerationCancelledError` when `is_cancelled` turns true.
        """
        messages = data.get("messages", [])
        max_tokens = data.get("max_tokens", 256)
        temperature = data.get("temperature", 0.7)
        top_p = data.get("top_p", 0.9)
        repetition_penalty = data.get("repetition_penalty", 1.1)
        stop_sequences = data.get("stop_sequences", [])
        top_k = data.get("top_k", 0)
        use_default_stops = data.get("use_default_stops", True)
        enable_thinking = data.get("enable_thinking", False)

        # Format messages using appropriate chat template
        prompt = self._format_chat_prompt(messages, enable_thinking=enable_thinking)

        # Debug: print the full prompt being sent
        sys.stderr.write(f"\n=== PROMPT ===\n{prompt}\n=== END PROMPT ===\n\n")
        sys.stderr.flush()

        # Create sampler with temperature and top_p (and top_k if non-zero)
        # Note: mlx-lm 0.28+ requires sampler instead of temp/top_p kwargs
        sampler_kwargs = {"temp": temperature, "top_p": top_p}
        if top_k > 0:
            sampler_kwargs["top_k"] = top_k
        sampler = make_sampler(**sampler_kwargs)

        # The penalty skips the break and end-of-turn tokens, so a reply with
        # several bubbles does not penalize its own breaks (utils/sampling.py).
        logits_processors = [
            make_repetition_penalty(
                repetition_penalty,
                20,
                structure_token_ids(self.llm_tokenizer, self.msg_break_token),
            )
        ]

        # When thinking is enabled, the prompt ends with <think>\n so the
        # model's output starts mid-think (no opening tag). Stream the tag
        # first so the client sees the same text it will see in `complete`.
        if enable_thinking and on_token is not None:
            on_token("<think>\n")

        # Stop-sequence and JSON tool-call detection only apply when stops are
        # in play. This matches the old split between generate() and the
        # stop-aware loop.
        use_stops = bool(stop_sequences) or use_default_stops
        response = self._generate_with_stop_sequences(
            prompt,
            max_tokens,
            sampler,
            logits_processors=logits_processors,
            stop_sequences=stop_sequences if use_stops else [],
            use_default_stops=use_default_stops if use_stops else False,
            detect_json_tool_call=use_stops,
            on_token=on_token,
            is_cancelled=is_cancelled,
        )

        # Prepend the opening think tag so the Rust parser can extract the
        # thinking block.
        if enable_thinking:
            response = "<think>\n" + response

        # Debug: print the raw response
        sys.stderr.write(f"\n=== RAW RESPONSE ===\n{response}\n=== END RESPONSE ===\n\n")
        sys.stderr.flush()

        # Clean up response (remove trailing special tokens)
        response = self._clean_response(response)

        # Post-process: truncate any content after a complete tool call XML/JSON
        return self._truncate_after_tool_call(response)

    def handle_embed_query(self, data: dict) -> None:
        """Handle embed_query command."""
        text = data.get("text")

        if not text:
            send_error("text is required")
            return

        try:
            # Load embedding model if needed
            self.load_embedding_model()

            # Generate embedding with search_query prefix
            embedding = embed_batch_mlx(
                self.embed_model,
                self.embed_tokenizer,
                [text],
                prefix=self.embed_config.prefix_query,
            )

            # Convert to list for JSON serialization
            vector = embedding[0].tolist()
            dims = len(vector)

            send_embedding(vector, dims)

        except Exception as e:
            send_error(f"Embedding failed: {e}")

    def _format_chat_prompt(self, messages: list[dict], *, enable_thinking: bool = False) -> str:
        """Format messages using the Qwen3/ChatML chat template.

        Qwen3.5 uses ChatML: <|im_start|>role\ncontent<|im_end|>

        Tool responses are wrapped in <tool_response>...</tool_response> inside user messages.
        When enable_thinking is True, appends <think> to trigger chain-of-thought.
        """
        prompt_parts = []

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "tool":
                # Tool responses: wrap in <tool_response> tags inside a user message
                # Strip any legacy tokens that might be in the content
                clean_content = content.replace("<|tool_response|>", "").replace(
                    "<|/tool_response|>", ""
                )
                # If the content already has <tool_response> tags, use as-is
                if "<tool_response>" in clean_content:
                    prompt_parts.append(f"<|im_start|>user\n{clean_content}<|im_end|>\n")
                else:
                    prompt_parts.append(
                        f"<|im_start|>user\n<tool_response>\n{clean_content}\n</tool_response><|im_end|>\n"
                    )
            else:
                prompt_parts.append(f"<|im_start|>{role}\n{content}<|im_end|>\n")

        # Add assistant prefix for generation.
        # When thinking is enabled, append <think>\n to trigger Qwen3.5's
        # chain-of-thought reasoning before the response. When disabled, append an
        # already-closed empty think block — this is exactly what
        # tokenizer.apply_chat_template(enable_thinking=False) injects for Qwen3.5,
        # and it is what actually suppresses CoT. Without it the model thinks by
        # default and can exhaust the token budget before emitting its answer.
        if enable_thinking:
            prompt_parts.append("<|im_start|>assistant\n<think>\n")
        else:
            prompt_parts.append("<|im_start|>assistant\n<think>\n\n</think>\n\n")

        return "".join(prompt_parts)

    def _generate_with_stop_sequences(
        self,
        prompt: str,
        max_tokens: int,
        sampler,
        logits_processors=None,
        stop_sequences: list[str] | None = None,
        use_default_stops: bool = True,
        detect_json_tool_call: bool = True,
        on_token: Callable[[str], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> str:
        """Generate text with stop sequence detection.

        Stops generation early when:
        1. A complete JSON tool call array is detected (if `detect_json_tool_call`)
        2. A stop sequence is encountered (e.g., "Have a great day")
        3. Max tokens is reached
        4. `is_cancelled()` returns True (raises `GenerationCancelledError`)

        `on_token` receives text as it arrives, with the tokenizer's special
        tokens removed. It never receives any part of a stop sequence or of a
        special token: the last few characters wait until the next token proves
        they are not the start of one. The return value keeps special tokens;
        `_clean_response()` handles those.
        """
        tokens: list[str] = []
        in_tool_call = False
        bracket_depth = 0
        tool_call_complete = False
        streamed_len = 0

        # Build effective stop sequences
        effective_stops = list(stop_sequences or [])
        if use_default_stops:
            effective_stops += self.DEFAULT_STOP_SEQUENCES
        keep = frozenset({self.msg_break_token}) if self.msg_break_token else frozenset()
        special_tokens = preview_special_tokens(self.llm_tokenizer, keep) if on_token else []
        holdback = max(stop_holdback(effective_stops), stop_holdback(special_tokens))

        # Build kwargs for stream_generate
        generate_kwargs = {
            "model": self.llm_model,
            "tokenizer": self.llm_tokenizer,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "sampler": sampler,
        }

        # Add logits_processors if available
        if logits_processors is not None:
            generate_kwargs["logits_processors"] = logits_processors

        for response in stream_generate(**generate_kwargs):
            if is_cancelled is not None and is_cancelled():
                raise GenerationCancelledError()

            text = response.text
            tokens.append(text)

            current_text = "".join(tokens)

            # Check for stop sequences FIRST (before tool call detection)
            for stop_seq in effective_stops:
                if stop_seq in current_text:
                    # Found stop sequence - truncate and return
                    idx = current_text.find(stop_seq)
                    return current_text[:idx].strip()

            if on_token is not None:
                # Stripping only ever removes text, so the held-back tail of the
                # preview still covers the tail of the raw text.
                preview = strip_tokens(current_text, special_tokens)
                safe_end = len(preview) - holdback
                if safe_end > streamed_len:
                    on_token(preview[streamed_len:safe_end])
                    streamed_len = safe_end

            if not detect_json_tool_call:
                continue

            # Detect when we enter a JSON array (tool call) - require it at start of text
            if not in_tool_call and current_text.lstrip().startswith("[{"):
                in_tool_call = True

            # Track bracket depth to detect complete JSON
            if in_tool_call:
                for char in text:
                    if char == "[":
                        bracket_depth += 1
                    elif char == "]":
                        bracket_depth -= 1
                        # When we close the outermost bracket, tool call is complete
                        if bracket_depth == 0:
                            tool_call_complete = True
                            break

            # Stop generation once tool call JSON is complete
            if tool_call_complete:
                break

        current_text = "".join(tokens)
        if on_token is not None:
            preview = strip_tokens(current_text, special_tokens)
            if len(preview) > streamed_len:
                on_token(preview[streamed_len:])
        return current_text

    def _truncate_after_tool_call(self, response: str) -> str:
        """Truncate response after a complete tool call JSON array.

        This is a safety fallback to remove any hallucinated content
        that appears after a valid tool call JSON.
        """
        # Find the start of a JSON array
        start_idx = response.find("[{")
        if start_idx == -1:
            return response

        # Find the matching closing bracket
        bracket_depth = 0
        for i, char in enumerate(response[start_idx:]):
            if char == "[":
                bracket_depth += 1
            elif char == "]":
                bracket_depth -= 1
                if bracket_depth == 0:
                    # Found complete JSON array - truncate everything after
                    end_idx = start_idx + i + 1
                    return response[:end_idx]

        # No complete JSON found, return as-is
        return response

    def _clean_response(self, response: str) -> str:
        """Clean up generated response by removing special tokens."""
        # Qwen3/ChatML tokens
        qwen3_tokens = ["<|im_end|>", "<|im_start|>", "<|endoftext|>"]

        # Legacy tokens (kept for robustness)
        legacy_tokens = ["<|end|>", "<|assistant|>", "<|user|>", "<|system|>"]

        # Remove all trailing special tokens (may need multiple passes)
        all_tokens = qwen3_tokens + legacy_tokens
        changed = True
        while changed:
            changed = False
            for token in all_tokens:
                if response.endswith(token):
                    response = response[: -len(token)]
                    changed = True

        # Also remove any tokens that appear in the middle for Qwen3
        # (sometimes <|im_end|> appears before the model finishes)
        for token in qwen3_tokens:
            response = response.replace(token, "")

        return response.strip()

    def load_reranker(self) -> None:
        """Load the cross-encoder reranker model (lazy initialization).

        Uses the CrossEncoderReranker from ml.reranker module for consistency
        with the standalone rerank.py entry point.
        """
        if self.reranker is not None:
            return

        sys.stderr.write("Loading cross-encoder reranker model...\n")
        sys.stderr.flush()

        self.reranker = CrossEncoderReranker()
        # Force model load now (rather than on first score() call)
        self.reranker._ensure_loaded()

        sys.stderr.write("Cross-encoder reranker loaded\n")
        sys.stderr.flush()

    def handle_rerank(self, data: dict) -> None:
        """Handle rerank command.

        Accepts a query and list of passages, returns relevance scores
        from the cross-encoder model.
        """
        query = data.get("query")
        passages = data.get("passages", [])

        if not query:
            send_error("query is required for rerank")
            return

        if not passages:
            send_rerank_result([])
            return

        try:
            self.load_reranker()

            # Use the CrossEncoderReranker.score() method
            score_list = self.reranker.score(query, passages)

            send_rerank_result(score_list)

        except Exception as e:
            send_error(f"Rerank failed: {e}")

    def handle_analyze_persona(self, data: dict) -> None:
        """Handle analyze_persona command.

        Runs two-phase personality analysis using the already-loaded LLM,
        avoiding the ~5-10s cold start of spawning a separate subprocess.
        """
        import time

        contact_id = data.get("contact_id", "")
        contact_name = data.get("contact_name", "")
        phase1_blocks = data.get("phase1_conversation_blocks", [])
        phase2_blocks = data.get("phase2_conversation_blocks", [])
        metadata = data.get("metadata")
        max_tokens_phase1 = data.get("max_tokens_phase1", 1200)
        max_tokens_phase2 = data.get("max_tokens_phase2", 3200)

        try:
            # Ensure LLM is loaded (base model, no adapter)
            if self.llm_model is None:
                send_analysis_progress("loading_model")
                self.load_llm("__base__")

            start_time = time.time()
            is_self = contact_id.lower() == "you"

            def progress_cb(phase_name: str) -> None:
                send_analysis_progress(phase_name)

            # Phase 1: Extract quotes
            send_analysis_progress("extracting_quotes")

            if is_self:
                curated_data = extract_self_quotes(
                    conversation_blocks=phase1_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase1,
                )
            else:
                curated_data = extract_quotes_from_conversations(
                    contact_name=contact_name,
                    conversation_blocks=phase1_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase1,
                )

            # Report Phase 1 stats
            quotes_count = len(curated_data.get("quotes", []))
            topics_count = len(curated_data.get("topics", []))
            insights_count = len(curated_data.get("insights", []))
            send_analysis_phase1_complete(quotes_count, topics_count, insights_count)

            # Phase 2: Personality analysis
            send_analysis_progress("analyzing_personality")

            if is_self:
                description = analyze_self_personality(
                    curated_data=curated_data,
                    conversation_blocks=phase2_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase2,
                )
            else:
                description = analyze_personality_with_quotes(
                    contact_name=contact_name,
                    curated_data=curated_data,
                    conversation_blocks=phase2_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase2,
                )

            duration_secs = int(time.time() - start_time)
            send_analysis_complete(description, duration_secs)

        except Exception as e:
            sys.stderr.write(f"analyze_persona error: {e}\n")
            sys.stderr.flush()
            send_error(f"Analysis failed: {e}")

    def handle_ping(self) -> None:
        """Handle ping command."""
        send_pong()

    def handle_shutdown(self) -> None:
        """Handle shutdown command."""
        sys.stderr.write("Received shutdown command\n")
        sys.stderr.flush()
        send_shutting_down()

    def run(self) -> None:
        """Main daemon loop (pipe mode -- stdin/stdout)."""
        global _pipe_request_id

        # Signal ready
        send_ready()

        # Process commands from stdin
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            _pipe_request_id = None
            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                send_error(f"Invalid JSON: {e}")
                continue

            cmd = data.get("cmd")
            if cmd != "cancel":
                _pipe_request_id = data.get("id")

            if cmd == "load":
                self.handle_load(data)
            elif cmd == "generate":
                self.handle_generate(data)
            elif cmd == "embed_query":
                self.handle_embed_query(data)
            elif cmd == "rerank":
                self.handle_rerank(data)
            elif cmd == "analyze_persona":
                self.handle_analyze_persona(data)
            elif cmd == "cancel":
                # Pipe mode handles one command at a time, so nothing is
                # running here to cancel. Stay silent: an error frame would be
                # read as the reply to the next command.
                continue
            elif cmd == "ping":
                self.handle_ping()
            elif cmd == "shutdown":
                self.handle_shutdown()
                break
            else:
                send_error(f"Unknown command: {cmd}")

        _pipe_request_id = None
        self._cleanup()

    def _cleanup(self) -> None:
        """Release model references and exit."""
        sys.stderr.write("Daemon loop exited, cleaning up...\n")
        sys.stderr.flush()

        self.llm_model = None
        self.llm_tokenizer = None
        self.embed_model = None
        self.embed_tokenizer = None
        self.reranker = None

        sys.stderr.write("Daemon exiting\n")
        sys.stderr.flush()

    # ── Socket mode ──────────────────────────────────────────────────

    def run_socket(self, socket_path: str) -> None:
        """Run as a Unix domain socket server."""
        asyncio.run(self._run_socket_server(socket_path))

    async def _run_socket_server(self, socket_path: str) -> None:
        """Asyncio socket server main loop."""
        self._socket_path = socket_path
        self._pid_path = socket_path.replace(".sock", ".pid")
        self._connected_clients: int = 0
        self._shutdown_requested = False
        self._idle_timeout_secs = 30 * 60  # 30 minutes

        # Store reference to the main asyncio loop so worker threads can
        # schedule coroutines back onto it (used by _send_sync).
        self._main_loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()

        # GPU command queue -- serializes all GPU work
        self._gpu_queue: asyncio.Queue = asyncio.Queue()

        # Write PID file
        pid = os.getpid()
        Path(self._pid_path).write_text(str(pid))
        sys.stderr.write(f"PID {pid} written to {self._pid_path}\n")
        sys.stderr.flush()

        # Remove stale socket if it exists
        sock_path = Path(socket_path)
        if sock_path.exists():
            sock_path.unlink()

        # Set restrictive permissions on socket (owner-only)
        old_umask = os.umask(0o177)
        try:
            server = await asyncio.start_unix_server(self._handle_client, path=socket_path)
            self._server = server
        finally:
            os.umask(old_umask)

        sys.stderr.write(f"Socket server listening on {socket_path}\n")
        sys.stderr.flush()

        # Register signal handlers for cleanup
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(
                sig, lambda: asyncio.ensure_future(self._signal_shutdown(server))
            )

        # Start GPU worker
        gpu_task = asyncio.create_task(self._gpu_worker())

        # Start idle timeout monitor
        self._last_activity = asyncio.get_event_loop().time()
        idle_task = asyncio.create_task(self._idle_monitor(server))

        try:
            async with server:
                await server.serve_forever()
        except asyncio.CancelledError:
            pass
        finally:
            gpu_task.cancel()
            idle_task.cancel()
            self._cleanup_socket_files()
            self._cleanup()

    async def _signal_shutdown(self, server: asyncio.AbstractServer) -> None:
        """Handle SIGTERM/SIGINT by stopping the server."""
        sys.stderr.write("Received signal, shutting down socket server\n")
        sys.stderr.flush()
        server.close()

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """Handle a single client connection."""
        self._connected_clients += 1
        self._last_activity = asyncio.get_event_loop().time()
        peer = writer.get_extra_info("peername") or "unknown"
        sys.stderr.write(f"Client connected ({self._connected_clients} total): {peer}\n")
        sys.stderr.flush()

        # Send Ready to this client
        await send_response_async(writer, {"type": "ready", "protocol": PROTOCOL_VERSION})

        # A separate task reads the socket, so a `cancel` command reaches the
        # running generation while this loop waits on the GPU worker. Each
        # command has its own cancel event, keyed by request id. Every event
        # fires when the client disconnects, so a dropped client never leaves
        # the GPU busy on an answer nobody will read.
        events: dict[Any, threading.Event] = {}
        lines: asyncio.Queue[tuple[bytes, threading.Event] | None] = asyncio.Queue()
        reader_task = asyncio.create_task(self._read_client_lines(reader, lines, events))

        try:
            while not self._shutdown_requested:
                item = await lines.get()

                if item is None:
                    break  # Client disconnected
                line, cancel_event = item

                line_str = line.decode().strip()
                if not line_str:
                    continue

                try:
                    data = json.loads(line_str)
                except json.JSONDecodeError as e:
                    await send_response_async(
                        writer, {"type": "error", "message": f"Invalid JSON: {e}"}
                    )
                    continue

                cmd = data.get("cmd")
                request_id = data.get("id")

                # Non-GPU commands handled inline
                if cmd == "ping":
                    await send_response_async(writer, with_id({"type": "pong"}, request_id))
                elif cmd == "shutdown":
                    sys.stderr.write("Received shutdown command from client\n")
                    sys.stderr.flush()
                    await send_response_async(
                        writer, with_id({"type": "shutting_down"}, request_id)
                    )
                    self._shutdown_requested = True
                    # Stop the server from the event loop
                    asyncio.get_event_loop().call_soon(self._stop_server)
                    break
                else:
                    # GPU commands go through the queue
                    future: asyncio.Future = asyncio.get_event_loop().create_future()
                    await self._gpu_queue.put((cmd, data, writer, future, cancel_event))
                    try:
                        await future
                    except (ConnectionError, BrokenPipeError):
                        break
                    finally:
                        events.pop(request_id, None)

        except (ConnectionError, BrokenPipeError):
            sys.stderr.write(f"Client disconnected (broken pipe): {peer}\n")
            sys.stderr.flush()
        finally:
            for event in events.values():
                event.set()
            reader_task.cancel()
            self._connected_clients -= 1
            self._last_activity = asyncio.get_event_loop().time()
            sys.stderr.write(f"Client disconnected ({self._connected_clients} remaining): {peer}\n")
            sys.stderr.flush()
            try:
                writer.close()
                await writer.wait_closed()
            except Exception as e:
                sys.stderr.write(f"debug: socket cleanup error for {peer}: {e}\n")
                sys.stderr.flush()

    async def _read_client_lines(
        self,
        reader: asyncio.StreamReader,
        lines: "asyncio.Queue[tuple[bytes, threading.Event] | None]",
        events: dict[Any, threading.Event],
    ) -> None:
        """Read command lines from one client.

        Each command line goes to `lines`, in order, with a new cancel event.
        `events` maps the request id of each command to its event until the
        command answers. A `cancel` sets the event of the request it names and
        goes no further. A cancel for a request that already answered finds no
        event, so it never stops a later command. A disconnect sets every event
        and queues `None`.
        """
        while True:
            try:
                line = await reader.readline()
            except ConnectionError:
                line = b""

            if not line:
                for event in events.values():
                    event.set()
                await lines.put(None)
                return

            try:
                data = json.loads(line)
            except ValueError:
                data = None
            request_id = data.get("id") if isinstance(data, dict) else None

            if is_cancel_command(line):
                target = events.get(request_id)
                if target is not None:
                    target.set()
                continue

            event = threading.Event()
            cmd = data.get("cmd") if isinstance(data, dict) else None
            if request_id is not None and cmd not in ("ping", "shutdown"):
                events[request_id] = event
            await lines.put((line, event))

    def _stop_server(self) -> None:
        """Stop the server -- called from event loop context."""
        # Close the server gracefully. This causes serve_forever() to return,
        # which triggers the finally block for cleanup (socket/PID file removal).
        # Previously used SystemExit(0) which could bypass the finally block
        # since SystemExit inherits from BaseException, not Exception.
        if hasattr(self, "_server") and self._server is not None:
            self._server.close()

    async def _gpu_worker(self) -> None:
        """Process GPU commands sequentially from the queue."""
        while True:
            try:
                cmd, data, writer, future, cancel_event = await self._gpu_queue.get()
            except asyncio.CancelledError:
                return

            self._last_activity = asyncio.get_event_loop().time()

            try:
                await self._dispatch_gpu_command(cmd, data, writer, cancel_event)
                if not future.done():
                    future.set_result(None)
            except (ConnectionError, BrokenPipeError) as e:
                if not future.done():
                    future.set_exception(e)
            except Exception as e:
                sys.stderr.write(f"GPU worker error: {e}\n")
                sys.stderr.flush()
                try:
                    await send_response_async(
                        writer, with_id({"type": "error", "message": str(e)}, data.get("id"))
                    )
                    if not future.done():
                        future.set_result(None)
                except (ConnectionError, BrokenPipeError) as send_err:
                    # Client disconnected before we could send the error response.
                    # Signal the broken connection to the handler so it doesn't
                    # hang waiting for a response that will never arrive.
                    if not future.done():
                        future.set_exception(send_err)

    def _run_in_gpu_thread(self, fn, *args) -> None:
        """Run fn in a worker thread, ensuring it has an asyncio event loop.

        Libraries like huggingface_hub spawn internal threads (e.g. 'asyncio_0')
        that call asyncio.get_event_loop(). Python 3.12+ raises RuntimeError if
        no loop exists in the current thread. Setting a loop on the worker thread
        before calling into MLX/huggingface avoids this.
        """
        try:
            asyncio.get_event_loop()
        except RuntimeError:
            asyncio.set_event_loop(asyncio.new_event_loop())
        fn(*args)

    async def _dispatch_gpu_command(
        self, cmd: str, data: dict, writer, cancel_event: threading.Event | None = None
    ) -> None:
        """Dispatch a GPU command, running blocking MLX calls in a thread.

        Each handler gets a `reply` that stamps the command's request id, so
        frames sent from the worker thread always carry the right id.
        """
        request_id = data.get("id")

        def reply(response: dict) -> None:
            self._send_sync(writer, with_id(response, request_id))

        if cmd == "load":
            await asyncio.to_thread(
                self._run_in_gpu_thread, self._handle_load_for_socket, data, reply
            )
        elif cmd == "generate":
            await asyncio.to_thread(
                self._run_in_gpu_thread,
                self._handle_generate_for_socket,
                data,
                reply,
                cancel_event,
            )
        elif cmd == "embed_query":
            await asyncio.to_thread(
                self._run_in_gpu_thread, self._handle_embed_query_for_socket, data, reply
            )
        elif cmd == "rerank":
            await asyncio.to_thread(
                self._run_in_gpu_thread, self._handle_rerank_for_socket, data, reply
            )
        elif cmd == "analyze_persona":
            await asyncio.to_thread(
                self._run_in_gpu_thread, self._handle_analyze_persona_for_socket, data, reply
            )
        else:
            await send_response_async(
                writer, with_id({"type": "error", "message": f"Unknown command: {cmd}"}, request_id)
            )

    def _send_sync(self, writer, response: dict) -> None:
        """Send a response synchronously from a thread (blocking until drain completes)."""
        asyncio.run_coroutine_threadsafe(
            send_response_async(writer, response), self._main_loop
        ).result()

    def _handle_load_for_socket(self, data: dict, reply: Reply) -> None:
        """Handle load command for socket mode."""
        persona_id = data.get("persona_id")
        base_model = data.get("base_model")

        if not persona_id:
            reply({"type": "error", "message": "persona_id is required"})
            return

        try:
            self.load_llm(persona_id, model_override=base_model)
            reply({"type": "loaded", "persona_id": persona_id})
        except Exception as e:
            reply({"type": "error", "message": f"Failed to load persona: {e}"})

    def _handle_generate_for_socket(
        self, data: dict, reply: Reply, cancel_event: threading.Event | None = None
    ) -> None:
        """Handle generate command for socket mode."""
        if self.llm_model is None:
            reply({"type": "error", "message": "No model loaded. Call 'load' first."})
            return

        def on_token(text: str) -> None:
            reply({"type": "token", "text": text, "done": False})

        try:
            response = self._run_generation(
                data,
                on_token=on_token if data.get("stream", False) else None,
                is_cancelled=cancel_event.is_set if cancel_event is not None else None,
            )
            reply({"type": "complete", "text": response})
        except GenerationCancelledError:
            sys.stderr.write("Generation cancelled by client\n")
            sys.stderr.flush()
            reply({"type": "cancelled"})
        except (ConnectionError, BrokenPipeError):
            raise
        except Exception as e:
            reply({"type": "error", "message": f"Generation failed: {e}"})

    def _handle_embed_query_for_socket(self, data: dict, reply: Reply) -> None:
        """Handle embed_query command for socket mode."""
        text = data.get("text")
        if not text:
            reply({"type": "error", "message": "text is required"})
            return

        try:
            self.load_embedding_model()
            embedding = embed_batch_mlx(
                self.embed_model,
                self.embed_tokenizer,
                [text],
                prefix=self.embed_config.prefix_query,
            )
            vector = embedding[0].tolist()
            dims = len(vector)
            reply({"type": "embedding", "vector": vector, "dims": dims})
        except Exception as e:
            reply({"type": "error", "message": f"Embedding failed: {e}"})

    def _handle_rerank_for_socket(self, data: dict, reply: Reply) -> None:
        """Handle rerank command for socket mode."""
        query = data.get("query")
        passages = data.get("passages", [])

        if not query:
            reply({"type": "error", "message": "query is required for rerank"})
            return

        if not passages:
            reply({"type": "rerank_result", "scores": []})
            return

        try:
            self.load_reranker()
            score_list = self.reranker.score(query, passages)
            reply({"type": "rerank_result", "scores": score_list})
        except Exception as e:
            reply({"type": "error", "message": f"Rerank failed: {e}"})

    def _handle_analyze_persona_for_socket(self, data: dict, reply: Reply) -> None:
        """Handle analyze_persona command for socket mode."""
        import time

        contact_id = data.get("contact_id", "")
        contact_name = data.get("contact_name", "")
        phase1_blocks = data.get("phase1_conversation_blocks", [])
        phase2_blocks = data.get("phase2_conversation_blocks", [])
        metadata = data.get("metadata")
        max_tokens_phase1 = data.get("max_tokens_phase1", 1200)
        max_tokens_phase2 = data.get("max_tokens_phase2", 3200)

        try:
            if self.llm_model is None:
                reply({"type": "analysis_progress", "phase": "loading_model"})
                self.load_llm("__base__")

            start_time = time.time()
            is_self = contact_id.lower() == "you"

            def progress_cb(phase_name: str) -> None:
                reply({"type": "analysis_progress", "phase": phase_name})

            reply({"type": "analysis_progress", "phase": "extracting_quotes"})

            if is_self:
                curated_data = extract_self_quotes(
                    conversation_blocks=phase1_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase1,
                )
            else:
                curated_data = extract_quotes_from_conversations(
                    contact_name=contact_name,
                    conversation_blocks=phase1_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase1,
                )

            quotes_count = len(curated_data.get("quotes", []))
            topics_count = len(curated_data.get("topics", []))
            insights_count = len(curated_data.get("insights", []))
            reply(
                {
                    "type": "analysis_phase1_complete",
                    "quotes_count": quotes_count,
                    "topics_count": topics_count,
                    "insights_count": insights_count,
                },
            )

            reply({"type": "analysis_progress", "phase": "analyzing_personality"})

            if is_self:
                description = analyze_self_personality(
                    curated_data=curated_data,
                    conversation_blocks=phase2_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase2,
                )
            else:
                description = analyze_personality_with_quotes(
                    contact_name=contact_name,
                    curated_data=curated_data,
                    conversation_blocks=phase2_blocks,
                    model=self.llm_model,
                    tokenizer=self.llm_tokenizer,
                    progress_callback=progress_cb,
                    metadata=metadata,
                    max_tokens=max_tokens_phase2,
                )

            duration_secs = int(time.time() - start_time)
            reply(
                {
                    "type": "analysis_complete",
                    "content": description,
                    "duration_secs": duration_secs,
                },
            )

        except Exception as e:
            sys.stderr.write(f"analyze_persona error: {e}\n")
            sys.stderr.flush()
            reply({"type": "error", "message": f"Analysis failed: {e}"})

    async def _idle_monitor(self, server: asyncio.AbstractServer) -> None:
        """Monitor for idle timeout -- shut down if no clients connected for too long."""
        while True:
            await asyncio.sleep(60)  # Check every minute
            if self._connected_clients == 0:
                idle_secs = asyncio.get_event_loop().time() - self._last_activity
                if idle_secs >= self._idle_timeout_secs:
                    sys.stderr.write(
                        f"Idle timeout ({self._idle_timeout_secs}s) reached with no clients, shutting down\n"
                    )
                    sys.stderr.flush()
                    server.close()
                    return

    def _cleanup_socket_files(self) -> None:
        """Remove socket and PID files on exit."""
        for path in (self._socket_path, self._pid_path):
            try:
                p = Path(path)
                if p.exists():
                    p.unlink()
                    sys.stderr.write(f"Removed {path}\n")
                    sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"Failed to remove {path}: {e}\n")
                sys.stderr.flush()


def main():
    parser = argparse.ArgumentParser(description="MLX inference daemon")
    parser.add_argument(
        "--base-model",
        type=str,
        default="mlx-community/Qwen3.5-9B-4bit",
        help="Base model to use (default: mlx-community/Qwen3.5-9B-4bit)",
    )
    parser.add_argument(
        "--mode",
        type=str,
        choices=["pipe", "socket"],
        default="pipe",
        help="Communication mode: pipe (stdin/stdout) or socket (Unix domain socket)",
    )
    parser.add_argument(
        "--socket-path",
        type=str,
        default=None,
        help="Path to Unix domain socket (required for socket mode)",
    )
    args = parser.parse_args()

    sys.stderr.write(
        f"Starting inference daemon with base model: {args.base_model} (mode: {args.mode})\n"
    )
    sys.stderr.flush()

    daemon = InferenceDaemon(args.base_model)

    if args.mode == "socket":
        if not args.socket_path:
            sys.stderr.write("Error: --socket-path is required for socket mode\n")
            sys.stderr.flush()
            sys.exit(1)
        daemon.run_socket(args.socket_path)
    else:
        # Ensure an asyncio event loop exists for the main thread.
        # Libraries like huggingface_hub (used by mlx_lm.load()) spawn internal
        # threads (e.g., 'asyncio_0') that call asyncio.get_event_loop() and fail
        # with "There is no current event loop in thread" if none has been set.
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            daemon.run()
        finally:
            loop.close()


if __name__ == "__main__":
    main()

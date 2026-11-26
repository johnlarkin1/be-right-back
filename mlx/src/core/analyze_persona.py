#!/usr/bin/env python3
"""LLM-based personality analysis for contacts.

Uses Qwen3.5 with proper chat template and XML-formatted conversations
for high-quality personality insights.
"""

import re
import sys
import traceback
import xml.etree.ElementTree as ET
from collections.abc import Callable
from typing import Any

import ujson as json
from mlx_lm import generate, load

from constants import HF_DEFAULT_BASE_MODEL
from prompts import (
    build_personality_with_quotes_system_prompt,
    build_personality_with_quotes_user_prompt,
    build_quote_extraction_system_prompt,
    build_quote_extraction_user_prompt,
    build_self_personality_system_prompt,
    build_self_personality_user_prompt,
    # Self-analysis prompts
    build_self_quote_extraction_system_prompt,
    build_self_quote_extraction_user_prompt,
)
from utils.llm import clean_llm_response


def format_conversation_blocks_xml(blocks: list[dict], contact_name: str) -> str:
    """Format conversation blocks as XML for the LLM.

    Uses xml.etree.ElementTree for proper XML generation and escaping.
    XML format provides clearer structural boundaries than plain text formatting.

    Args:
        blocks: List of conversation block dictionaries with messages
        contact_name: Name of the contact being analyzed

    Returns:
        XML-formatted string with conversations and messages
    """
    root = ET.Element("conversations", contact=contact_name)

    for i, block in enumerate(blocks, 1):
        timestamp = block.get("start_time", "unknown")
        conv_elem = ET.SubElement(root, "conversation", id=str(i), timestamp=timestamp)

        for msg in block["messages"]:
            role = "user" if msg["role"] == "user" else "contact"
            msg_elem = ET.SubElement(conv_elem, "message", role=role)
            msg_elem.text = msg["content"]

    # Skip indentation for faster processing (minor optimization)
    return ET.tostring(root, encoding="unicode")


# =============================================================================
# TWO-PHASE PERSONALITY ANALYSIS
# =============================================================================


def extract_quotes_from_conversations(
    contact_name: str,
    conversation_blocks: list[dict],
    model: Any,
    tokenizer: Any,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens: int = 1200,
) -> dict:
    """Phase 1: Extract notable quotes, topics, and insights from conversations.

    Optimized for speed: requests 5 quotes with simplified JSON structure.
    Target: ~30 seconds generation time at 40 tokens/sec.

    Args:
        contact_name: Name of the contact being analyzed
        conversation_blocks: List of conversation block dictionaries (larger sample)
        model: Pre-loaded MLX model
        tokenizer: Pre-loaded tokenizer
        progress_callback: Optional callback for progress updates
        metadata: Optional relationship metadata
        max_tokens: Maximum tokens to generate (default 1200 for simplified JSON)

    Returns:
        Dict containing quotes, topics, and insights
    """
    if progress_callback:
        progress_callback("extracting_quotes")

    # Format conversations as XML
    conversations_xml = format_conversation_blocks_xml(conversation_blocks, contact_name)
    print(
        f"Phase 1: Formatted {len(conversation_blocks)} conversation blocks as XML", file=sys.stderr
    )

    # Build prompts
    system_prompt = build_quote_extraction_system_prompt()
    user_prompt = build_quote_extraction_user_prompt(contact_name, conversations_xml, metadata)

    # Apply chat template
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    print(
        f"Phase 1: Applied chat template, prompt length: {len(prompt)} characters", file=sys.stderr
    )

    # Generate
    print("Phase 1: Extracting quotes and insights...", file=sys.stderr)
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )

    # Extract response content
    output = response.strip()
    if prompt in output:
        output = output[len(prompt) :].strip()

    output = clean_llm_response(output)

    # Parse JSON - try to extract JSON from the response
    print(f"Phase 1: Raw output length: {len(output)} characters", file=sys.stderr)

    # Try to find JSON in the output
    json_match = re.search(r"\{[\s\S]*\}", output)
    if not json_match:
        print("Phase 1: WARNING - No JSON found in output, using fallback", file=sys.stderr)
        return {
            "quotes": [],
            "topics": [],
            "insights": ["Unable to extract insights from conversation data"],
        }

    json_str = json_match.group(0)

    try:
        result = json.loads(json_str)
        quotes_count = len(result.get("quotes", []))
        topics_count = len(result.get("topics", []))
        insights_count = len(result.get("insights", []))
        print(
            f"Phase 1: Extracted {quotes_count} quotes, {topics_count} topics, {insights_count} insights",
            file=sys.stderr,
        )
        return result
    except json.JSONDecodeError as e:
        print(f"Phase 1: JSON parse error: {e}", file=sys.stderr)
        print(f"Phase 1: Attempted to parse: {json_str[:500]}...", file=sys.stderr)
        return {
            "quotes": [],
            "topics": [],
            "insights": ["Unable to parse extracted data"],
        }


def analyze_personality_with_quotes(
    contact_name: str,
    curated_data: dict,
    conversation_blocks: list[dict],
    model: Any,
    tokenizer: Any,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens: int = 3200,
) -> str:
    """Phase 2: Generate personality analysis using pre-curated quotes.

    Args:
        contact_name: Name of the contact being analyzed
        curated_data: Dict from Phase 1 containing quotes, topics, insights
        conversation_blocks: List of conversation block dictionaries (smaller sample for context)
        model: Pre-loaded MLX model
        tokenizer: Pre-loaded tokenizer
        progress_callback: Optional callback for progress updates
        metadata: Optional relationship metadata
        max_tokens: Maximum tokens to generate

    Returns:
        Markdown-formatted personality analysis
    """
    if progress_callback:
        progress_callback("analyzing_personality")

    # Format conversations as XML (smaller sample for context)
    conversations_xml = format_conversation_blocks_xml(conversation_blocks, contact_name)
    print(
        f"Phase 2: Formatted {len(conversation_blocks)} conversation blocks as XML for context",
        file=sys.stderr,
    )

    # Build prompts with curated data
    system_prompt = build_personality_with_quotes_system_prompt()
    user_prompt = build_personality_with_quotes_user_prompt(
        contact_name, curated_data, conversations_xml, metadata
    )

    # Apply chat template
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    print(
        f"Phase 2: Applied chat template, prompt length: {len(prompt)} characters", file=sys.stderr
    )

    # Generate
    print("Phase 2: Generating personality analysis...", file=sys.stderr)
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )
    print("Phase 2: Analysis complete", file=sys.stderr)

    # Extract response content
    description = response.strip()
    if prompt in description:
        description = description[len(prompt) :].strip()

    description = clean_llm_response(description, strip_preamble=True)
    return description


def analyze_personality_two_phase(
    contact_name: str,
    phase1_blocks: list[dict],
    phase2_blocks: list[dict],
    model_name: str = HF_DEFAULT_BASE_MODEL,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens_phase1: int = 1200,
    max_tokens_phase2: int = 3200,
) -> tuple[str, dict]:
    """Run two-phase personality analysis with a single model load.

    This is the main entry point for the improved analysis pipeline.

    Args:
        contact_name: Name of the contact being analyzed
        phase1_blocks: Larger sample of conversation blocks for quote extraction
        phase2_blocks: Smaller sample of conversation blocks for analysis context
        model_name: HuggingFace model ID to use
        progress_callback: Optional callback for progress updates
        metadata: Optional relationship metadata
        max_tokens_phase1: Max tokens for Phase 1 (quote extraction)
        max_tokens_phase2: Max tokens for Phase 2 (personality analysis)

    Returns:
        Tuple of (markdown_analysis, curated_data_dict)
    """
    try:
        # Load model once
        if progress_callback:
            progress_callback("loading_model")

        print("Loading model...", file=sys.stderr)
        model, tokenizer = load(model_name, tokenizer_config={"trust_remote_code": True})  # type: ignore[misc]
        print(f"Model loaded: {model_name}", file=sys.stderr)

        # Phase 1: Extract quotes
        curated_data = extract_quotes_from_conversations(
            contact_name=contact_name,
            conversation_blocks=phase1_blocks,
            model=model,
            tokenizer=tokenizer,
            progress_callback=progress_callback,
            metadata=metadata,
            max_tokens=max_tokens_phase1,
        )

        # Phase 2: Generate analysis with curated quotes
        analysis = analyze_personality_with_quotes(
            contact_name=contact_name,
            curated_data=curated_data,
            conversation_blocks=phase2_blocks,
            model=model,
            tokenizer=tokenizer,
            progress_callback=progress_callback,
            metadata=metadata,
            max_tokens=max_tokens_phase2,
        )

        return analysis, curated_data

    except Exception as e:
        print(f"Error during two-phase analysis: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise e


# =============================================================================
# SELF-ANALYSIS (for "You" persona)
# =============================================================================


def format_self_conversation_blocks_xml(blocks: list[dict]) -> str:
    """Format conversation blocks for self-analysis as XML.

    Similar to regular formatting, but includes the contact_name attribute
    in each conversation so the LLM can see style variation across contacts.

    Args:
        blocks: List of conversation block dictionaries with messages and contact_name

    Returns:
        XML-formatted string with conversations grouped by contact
    """
    root = ET.Element("your_conversations")

    for i, block in enumerate(blocks, 1):
        timestamp = block.get("start_time", "unknown")
        contact_name = block.get("contact_name", "Unknown")
        conv_elem = ET.SubElement(
            root, "conversation", id=str(i), timestamp=timestamp, with_contact=contact_name
        )

        for msg in block["messages"]:
            role = "user" if msg["role"] == "user" else "contact"
            msg_elem = ET.SubElement(conv_elem, "message", role=role)
            msg_elem.text = msg["content"]

    return ET.tostring(root, encoding="unicode")


def extract_self_quotes(
    conversation_blocks: list[dict],
    model: Any,
    tokenizer: Any,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens: int = 1200,
) -> dict:
    """Phase 1 for self-analysis: Extract quotes from YOUR messages.

    Args:
        conversation_blocks: List of conversation blocks (from multiple contacts)
        model: Pre-loaded MLX model
        tokenizer: Pre-loaded tokenizer
        progress_callback: Optional callback for progress updates
        metadata: Optional aggregated metadata
        max_tokens: Maximum tokens to generate

    Returns:
        Dict containing quotes, topics, and insights about your style
    """
    if progress_callback:
        progress_callback("extracting_quotes")

    # Format conversations with contact names visible
    conversations_xml = format_self_conversation_blocks_xml(conversation_blocks)
    print(
        f"Self Phase 1: Formatted {len(conversation_blocks)} blocks from multiple contacts",
        file=sys.stderr,
    )

    # Build prompts
    system_prompt = build_self_quote_extraction_system_prompt()
    user_prompt = build_self_quote_extraction_user_prompt(conversations_xml, metadata)

    # Apply chat template
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    print(
        f"Self Phase 1: Applied chat template, prompt length: {len(prompt)} characters",
        file=sys.stderr,
    )

    # Generate
    print("Self Phase 1: Extracting your quotes and insights...", file=sys.stderr)
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )

    # Extract response content
    output = response.strip()
    if prompt in output:
        output = output[len(prompt) :].strip()

    output = clean_llm_response(output)

    # Parse JSON
    print(f"Self Phase 1: Raw output length: {len(output)} characters", file=sys.stderr)

    json_match = re.search(r"\{[\s\S]*\}", output)
    if not json_match:
        print("Self Phase 1: WARNING - No JSON found in output, using fallback", file=sys.stderr)
        return {
            "quotes": [],
            "topics": [],
            "insights": ["Unable to extract insights from your messages"],
        }

    json_str = json_match.group(0)

    try:
        result = json.loads(json_str)
        quotes_count = len(result.get("quotes", []))
        topics_count = len(result.get("topics", []))
        insights_count = len(result.get("insights", []))
        print(
            f"Self Phase 1: Extracted {quotes_count} quotes, {topics_count} topics, {insights_count} insights",
            file=sys.stderr,
        )
        return result
    except json.JSONDecodeError as e:
        print(f"Self Phase 1: JSON parse error: {e}", file=sys.stderr)
        return {
            "quotes": [],
            "topics": [],
            "insights": ["Unable to parse extracted data"],
        }


def analyze_self_personality(
    curated_data: dict,
    conversation_blocks: list[dict],
    model: Any,
    tokenizer: Any,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens: int = 2500,
) -> str:
    """Phase 2 for self-analysis: Generate personality analysis about YOU.

    Args:
        curated_data: Dict from Phase 1 containing your quotes, topics, insights
        conversation_blocks: Smaller sample of conversation blocks for context
        model: Pre-loaded MLX model
        tokenizer: Pre-loaded tokenizer
        progress_callback: Optional callback for progress updates
        metadata: Optional aggregated metadata
        max_tokens: Maximum tokens to generate

    Returns:
        Markdown-formatted self-personality analysis
    """
    if progress_callback:
        progress_callback("analyzing_personality")

    # Format conversations with contact names visible
    conversations_xml = format_self_conversation_blocks_xml(conversation_blocks)
    print(f"Self Phase 2: Formatted {len(conversation_blocks)} blocks for context", file=sys.stderr)

    # Build prompts
    system_prompt = build_self_personality_system_prompt()
    user_prompt = build_self_personality_user_prompt(curated_data, conversations_xml, metadata)

    # Apply chat template
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    print(
        f"Self Phase 2: Applied chat template, prompt length: {len(prompt)} characters",
        file=sys.stderr,
    )

    # Generate
    print("Self Phase 2: Generating your personality analysis...", file=sys.stderr)
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    )
    print("Self Phase 2: Analysis complete", file=sys.stderr)

    # Extract response content
    description = response.strip()
    if prompt in description:
        description = description[len(prompt) :].strip()

    description = clean_llm_response(description, strip_preamble=True)
    return description


def analyze_self_two_phase(
    phase1_blocks: list[dict],
    phase2_blocks: list[dict],
    model_name: str = HF_DEFAULT_BASE_MODEL,
    progress_callback: Callable[[str], None] | None = None,
    metadata: dict | None = None,
    max_tokens_phase1: int = 1200,
    max_tokens_phase2: int = 2500,
) -> tuple[str, dict]:
    """Run two-phase self-analysis for the "You" persona.

    This analyzes YOUR communication patterns across multiple contacts,
    using second-person language and highlighting style variation.

    Args:
        phase1_blocks: Larger sample of conversation blocks (from multiple contacts)
        phase2_blocks: Smaller sample for context
        model_name: HuggingFace model ID to use
        progress_callback: Optional callback for progress updates
        metadata: Optional aggregated metadata about your messaging
        max_tokens_phase1: Max tokens for Phase 1 (quote extraction)
        max_tokens_phase2: Max tokens for Phase 2 (personality analysis)

    Returns:
        Tuple of (markdown_analysis, curated_data_dict)
    """
    try:
        # Load model once
        if progress_callback:
            progress_callback("loading_model")

        print("Loading model for self-analysis...", file=sys.stderr)
        model, tokenizer = load(model_name, tokenizer_config={"trust_remote_code": True})  # type: ignore[misc]
        print(f"Model loaded: {model_name}", file=sys.stderr)

        # Phase 1: Extract your quotes
        curated_data = extract_self_quotes(
            conversation_blocks=phase1_blocks,
            model=model,
            tokenizer=tokenizer,
            progress_callback=progress_callback,
            metadata=metadata,
            max_tokens=max_tokens_phase1,
        )

        # Phase 2: Generate self-analysis
        analysis = analyze_self_personality(
            curated_data=curated_data,
            conversation_blocks=phase2_blocks,
            model=model,
            tokenizer=tokenizer,
            progress_callback=progress_callback,
            metadata=metadata,
            max_tokens=max_tokens_phase2,
        )

        return analysis, curated_data

    except Exception as e:
        print(f"Error during self-analysis: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise e

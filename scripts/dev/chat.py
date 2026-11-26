#!/usr/bin/env python3
"""Simple chat script to test trained LoRA adapters."""

import argparse
import json
from pathlib import Path

from mlx_lm import generate, load
from mlx_lm.tuner.utils import load_adapters


def build_system_prompt(metadata_path: Path) -> str:
    """
    Build a system prompt from the persona metadata.

    Reads from chat_metadata.json which contains:
    - system_prompt: Pre-generated advanced prompt with stats and LLM analysis
    - persona_stats: Programmatic statistics about messaging patterns
    - llm_analysis: LLM-detected personality insights

    Falls back to a simple prompt if metadata is missing.
    """
    if not metadata_path.exists():
        return "You are a helpful assistant."

    with open(metadata_path) as f:
        metadata = json.load(f)

    # Use the pre-generated system prompt from the export phase
    # This includes both programmatic stats and LLM personality analysis
    if "system_prompt" in metadata and metadata["system_prompt"]:
        return metadata["system_prompt"]

    # Fallback: build a basic prompt if system_prompt is missing
    contact_name = metadata.get("contact_name", "Unknown")
    system_prompt = f"""You are {contact_name}. You are texting back to your friend.

Respond naturally as {contact_name} would in a text conversation. Keep responses concise and casual, like a real text message. Match the texting style, tone, and personality that {contact_name} typically uses.

Important: Respond ONLY as {contact_name}. Do not break character or mention that you are an AI."""

    return system_prompt


def main():
    parser = argparse.ArgumentParser(description="Chat with trained persona")
    parser.add_argument(
        "--model",
        type=str,
        default="mlx-community/Qwen3-4B-8bit",
        help="Base model",
    )
    parser.add_argument(
        "--adapter-path",
        type=str,
        required=True,
        help="Path to trained adapter directory",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        help="Single prompt to generate from",
    )
    parser.add_argument(
        "--system-prompt",
        type=str,
        help="Custom system prompt (overrides default)",
    )

    args = parser.parse_args()

    print("Loading model and adapter...")
    model, tokenizer = load(args.model, tokenizer_config={"trust_remote_code": True})

    # Add special tokens (must match training)
    special_tokens = {"additional_special_tokens": ["<MSG_BREAK>"]}
    tokenizer.add_special_tokens(special_tokens)

    # Load the LoRA adapter
    load_adapters(model, args.adapter_path)

    # Build system prompt
    adapter_path = Path(args.adapter_path)
    chat_metadata_path = adapter_path / "chat_metadata.json"

    if args.system_prompt:
        system_prompt = args.system_prompt
    else:
        system_prompt = build_system_prompt(chat_metadata_path)

    print("Model and adapter loaded!")
    print()
    print("System Prompt:")
    print("-" * 60)
    print(system_prompt)
    print("-" * 60)
    print()

    if args.prompt:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": args.prompt},
        ]
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        print(f"You: {args.prompt}")
        response = generate(
            model, tokenizer, prompt=prompt, max_tokens=150, verbose=False
        )
        print(f"Assistant: {response}")
    else:
        # Interactive chat mode
        print("Chat with your persona (type 'exit' to quit)")
        print("-" * 60)

        conversation_history = []

        while True:
            user_input = input("\nYou: ").strip()

            if user_input.lower() in ["exit", "quit", "q"]:
                print("Goodbye!")
                break

            if not user_input:
                continue

            # Add user message to history
            conversation_history.append({"role": "user", "content": user_input})

            # Build full message list with system prompt and history
            messages = [
                {"role": "system", "content": system_prompt}
            ] + conversation_history

            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )

            # Generate response
            response = generate(
                model, tokenizer, prompt=prompt, max_tokens=150, verbose=False
            )
            print(f"Assistant: {response}")

            # Add assistant response to history
            conversation_history.append({"role": "assistant", "content": response})


if __name__ == "__main__":
    main()

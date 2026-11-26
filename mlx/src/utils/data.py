from pathlib import Path
from typing import Any

import ujson as json  # https://dev.to/dollardhingra/benchmarking-python-json-serializers-json-vs-ujson-vs-orjson-1o16


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as handle:
        for line_num, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue

            try:
                example = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"warning: failed to parse line {line_num}: {exc}")
                continue

            if "messages" not in example:
                print(f"warning: line {line_num} missing 'messages' key, skipping")
                continue

            examples.append(example)

    return examples


def get_data_stats(examples: list[dict[str, Any]]) -> dict[str, Any]:
    if not examples:
        return {"total_examples": 0}

    total_messages = sum(len(ex["messages"]) for ex in examples)
    avg_messages = total_messages / len(examples)

    user_messages = 0
    assistant_messages = 0
    for example in examples:
        for message in example["messages"]:
            role = message.get("role")
            if role == "user":
                user_messages += 1
            elif role == "assistant":
                assistant_messages += 1

    return {
        "total_examples": len(examples),
        "total_messages": total_messages,
        "avg_messages_per_example": round(avg_messages, 2),
        "user_messages": user_messages,
        "assistant_messages": assistant_messages,
    }

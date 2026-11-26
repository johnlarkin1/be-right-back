"""IPC utilities for Rust <-> Python subprocess communication."""

import ujson as json


def send_response(response: dict) -> None:
    """Send a JSON response to stdout for Rust to parse."""
    print(json.dumps(response), flush=True)


async def send_response_async(writer, response: dict) -> None:
    """Send a JSON response to an asyncio StreamWriter.

    Used by the socket-mode daemon to send responses to connected clients.
    """
    data = json.dumps(response) + "\n"
    writer.write(data.encode())
    await writer.drain()

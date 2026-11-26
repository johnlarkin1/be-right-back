"""Spot automated verification-code texts ("Your code is 123456").

Banks, apps and sign-in flows send thousands of these. They carry no
conversation, and in Insights they form a topic of their own. Ingestion drops
them before chunking.

A message counts as a code text when it is short, holds a 4-8 digit code,
and uses a phrase that automated senders use ("verification", "passcode",
"don't share", or a text that starts "Your ... code is"). A friend's "the
door code is 4821" has the code but none of those phrases, so it stays.
"""

import re

# Longest code text seen in practice is ~250 chars (bank texts with a warning).
MAX_CODE_TEXT_CHARS = 320

# 4-8 digits, or two groups of 3 ("123-456", "123 456"), or a prefix ("G-123456").
_CODE_RE = re.compile(r"(?<![\d$.,])(?:[A-Z]{1,3}-)?(?:\d{4,8}|\d{3}[- ]\d{3})(?![\d%])")

_PHRASE_RE = re.compile(
    r"verification|verify|passcode|pass code|one[- ]time|\botp\b|\b2fa\b|two[- ]factor|"
    r"security code|login code|log[- ]in code|sign[- ]in code|"
    r"authentication code|auth code|"
    r"(?:do not|don'?t|never) share|valid for \d+|expires? in \d+|"
    r"^your (?:[\w.&'-]+ ){0,3}code(?: is|:)",
    re.IGNORECASE,
)


def is_verification_code(text: str) -> bool:
    """True when `text` looks like an automated verification-code message."""
    if len(text) > MAX_CODE_TEXT_CHARS:
        return False
    normalized = text.replace("’", "'")
    return bool(_CODE_RE.search(normalized) and _PHRASE_RE.search(normalized))

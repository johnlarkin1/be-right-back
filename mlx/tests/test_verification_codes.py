"""Ingestion drops automated verification-code texts and keeps real messages."""

import pytest

from data.loaders import clean_message_text
from utils.verification_codes import is_verification_code


@pytest.mark.parametrize(
    "text",
    [
        "Your DraftKings verification code is: 851530",
        "PNC will NEVER call or text you for this code. DON'T share it. Your passcode is 484860.",
        "123-456 is your Resy account verification code. This is not a booking confirmation.",
        "G-482913 is your Google verification code.",
        "Your 2FA code is: 482913. This verification code is valid for 10 minutes.",
        "Your Uber code: 4821",
        "482913 is your Partiful verification code",
        "Use 739201 as your one-time password. Do not share it with anyone.",
    ],
)
def test_codes_are_detected(text):
    assert is_verification_code(text)


@pytest.mark.parametrize(
    "text",
    [
        "Building door code is 48213 and then I'll leave my apt unlocked",
        "The code to the garage is 4821. Suds birthday.",
        "Are you coming back to my room? My code is 48213",
        "what is the garage code again? 4821?",
        "Can you verify the dinner reservation for 7?",  # no code
        "I owe you $1500 for rent, verification pending",  # money, not a code
        "My flight confirmation is 482913, landing at 5",
        "Your call. I'll be there by 2030 either way",
    ],
)
def test_real_messages_are_kept(text):
    assert not is_verification_code(text)


def test_long_messages_are_never_codes():
    text = "Your verification code is 482913. " + "x" * 400
    assert not is_verification_code(text)


def test_ingestion_drops_code_texts():
    assert clean_message_text("Your DraftKings verification code is: 851530") is None
    assert clean_message_text("gate code is 4821") == "gate code is 4821"

"""The streamtyped byte parser reads message text without Foundation."""

import pytest

from utils.attributed_body import extract_streamtyped_text, is_streamtyped

_HEADER = (
    b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00"
    b"\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+"
)
_TRAILER = b"\x86\x84\x02iI\x01\x0b\x92\x84\x84\x84\x0cNSDictionary"


def blob(text: str) -> bytes:
    raw = text.encode()
    n = len(raw)
    if n < 0x80:
        length = bytes([n])
    elif n <= 0xFFFF:
        length = b"\x81" + n.to_bytes(2, "little")
    else:
        length = b"\x82" + n.to_bytes(4, "little")
    return _HEADER + length + raw + _TRAILER


@pytest.mark.parametrize("text", ["hey 👋", "x" * 300, "y" * 70_000, "NSString is a class"])
def test_reads_text_for_every_length_encoding(text):
    assert extract_streamtyped_text(blob(text)) == text


def test_keyed_archives_are_left_to_foundation():
    assert extract_streamtyped_text(b"bplist00\x01\x02NSString") is None


def test_truncated_blob_falls_back():
    assert extract_streamtyped_text(blob("hello world")[:-30]) is None


def test_unexpected_header_falls_back():
    b = bytearray(blob("hello"))
    b[b.find(b"NSString") + 10] = 0x85
    assert extract_streamtyped_text(bytes(b)) is None


def test_invalid_utf8_falls_back():
    b = bytearray(blob("ab"))
    b[len(_HEADER) + 2] = 0xFF
    assert extract_streamtyped_text(bytes(b)) is None


def test_tag_starts_at_byte_two():
    assert is_streamtyped(b"\x04\x0bstreamtyped\x81")
    assert not is_streamtyped(b"bplist00")

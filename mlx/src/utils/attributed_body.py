"""
> [!WARNING]
> This file was AI generated and should be re-audited. I've reviewed it, but...
> it's a bit convoluted with the sensitivity to PyObjC.

Decode NSAttributedString from iMessage attributedBody field.

The attributedBody field contains a serialized NSAttributedString.
This can be in two formats:
- NSKeyedArchive format (modern, starts with "bplist00")
- NSArchiver format (legacy, starts with "streamtyped")

This module useqs PyObjC (Foundation framework) to decode these blobs,
mirroring the Rust implementation in crates/messages-db/src/utils/attributed_body.rs.
"""

import re
import sys

if sys.platform == "darwin":
    try:
        import Foundation  # type: ignore
    except ImportError:
        Foundation = None  # type: ignore
else:
    Foundation = None  # type: ignore

try:
    import objc as _objc  # type: ignore
except ImportError:
    _objc = None

# PyObjC is available on macOS Python installations. Attempt to load the key
# classes immediately so missing dependencies surface during import.
if sys.platform == "darwin" and Foundation is not None:
    _Foundation = Foundation
    _NSKeyedUnarchiver = Foundation.NSKeyedUnarchiver
    _NSUnarchiver = Foundation.NSUnarchiver
    _NSAttributedString = Foundation.NSAttributedString
    _NSMutableAttributedString = Foundation.NSMutableAttributedString
    _NSData = Foundation.NSData
    _foundation_available = True
else:
    _Foundation = None
    _NSKeyedUnarchiver = None
    _NSUnarchiver = None
    _NSAttributedString = None
    _NSMutableAttributedString = None
    _NSData = None
    _foundation_available = False


def _ensure_foundation() -> bool:
    """Return whether Foundation classes are available."""
    return _foundation_available


def decode_attributed_body(data: bytes) -> str | None:
    """Decode an attributedBody byte array to plain text.

    This function uses the macOS Foundation framework to deserialize
    NSAttributedString data and extract the plain text content.

    Args:
        data: Raw bytes from the attributedBody column (not hex-encoded)

    Returns:
        The plain text string, or None if decoding fails
    """
    if not data:
        return None

    # Fast path: read the text bytes straight out of a streamtyped archive.
    fast = extract_streamtyped_text(data)
    if fast:
        return _append_blob_urls(fast, data)

    if not _ensure_foundation():
        # Not on macOS or PyObjC not available
        return None

    # Decode the plain text. `.string()` (used by every path below) drops rich
    # attributes, so a rich-link-only message (Apple Maps pin, Resy, OpenTable)
    # may decode to an empty string even though a URL is present in the blob.
    # The keyed unarchivers always fail on a streamtyped blob, so skip them.
    if is_streamtyped(data):
        text = _try_nsunarchiver(data) or ""
    else:
        text = (
            _try_keyed_unarchiver_secure(data)
            or _try_keyed_unarchiver_legacy(data)
            or _try_nsunarchiver(data)
            or ""
        )

    # Recover any URLs stored as plain byte runs (rich-link attributes) so the
    # link stays searchable and visible even when the visible text is empty.
    combined = _append_blob_urls(text, data)
    return combined or None


_STREAMTYPED = b"streamtyped"
_NSSTRING = b"NSString"
_STRING_HEADER_TAIL = b"\x84\x01+"


def is_streamtyped(data: bytes) -> bool:
    """NSArchiver blobs start with b"\\x04\\x0bstreamtyped", so the tag starts at byte 2."""
    return data[2 : 2 + len(_STREAMTYPED)] == _STREAMTYPED


def extract_streamtyped_text(data: bytes) -> str | None:
    """Read the NSString text straight out of a streamtyped NSAttributedString.

    Mirrors `crates/messages-db/src/utils/typedstream.rs`. Layout after the first
    NSString marker: 1 version byte, 1 class-reference byte, 84 01 '+', a length,
    then UTF-8 bytes. A length byte below 0x80 is the length; 0x81 means a u16 LE
    follows, and 0x82 a u32 LE. Any other layout returns None, and the caller
    falls back to Foundation. This takes ~1 µs; NSUnarchiver takes ~140 µs.
    """
    if not is_streamtyped(data):
        return None
    marker = data.find(_NSSTRING)
    if marker < 0:
        return None
    p = marker + len(_NSSTRING) + 2
    if data[p : p + 3] != _STRING_HEADER_TAIL:
        return None
    p += 3
    if p >= len(data):
        return None
    tag = data[p]
    if tag == 0x81:
        size, p = 2, p + 1
    elif tag == 0x82:
        size, p = 4, p + 1
    elif tag < 0x80:
        size = 0
    else:
        return None
    if size:
        raw_len = data[p : p + size]
        if len(raw_len) != size:
            return None
        length = int.from_bytes(raw_len, "little")
        p += size
    else:
        length, p = tag, p + 1
    raw = data[p : p + length]
    if len(raw) != length:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _try_keyed_unarchiver_secure(data: bytes) -> str | None:
    """Try modern secure NSKeyedUnarchiver API with allowed classes."""
    try:
        ns_data = _NSData.dataWithBytes_length_(data, len(data))

        # Build set of allowed classes for the object graph
        # NSAttributedString archives contain many nested classes
        allowed_classes = set()

        # Required Foundation classes
        for cls_name in [
            "NSAttributedString",
            "NSMutableAttributedString",
            "NSString",
            "NSMutableString",
            "NSNumber",
            "NSDictionary",
            "NSMutableDictionary",
            "NSArray",
            "NSMutableArray",
            "NSURL",
            "NSData",
            "NSValue",
        ]:
            cls = _get_class(cls_name)
            if cls:
                allowed_classes.add(cls)

        # Optional AppKit/UI classes (may not exist in all contexts)
        for cls_name in [
            "NSParagraphStyle",
            "NSMutableParagraphStyle",
            "NSTextAttachment",
            "NSColor",
            "NSFont",
            "NSShadow",
            "NSFontDescriptor",
        ]:
            cls = _get_class(cls_name)
            if cls:
                allowed_classes.add(cls)

        # Use unarchivedObjectOfClasses:fromData:error:
        obj, error = _NSKeyedUnarchiver.unarchivedObjectOfClasses_fromData_error_(
            allowed_classes, ns_data, None
        )

        if obj is not None:
            return _extract_string(obj)

        return None
    except Exception:
        return None


def _try_keyed_unarchiver_legacy(data: bytes) -> str | None:
    """Try legacy NSKeyedUnarchiver API (less secure, more permissive)."""
    try:
        ns_data = _NSData.dataWithBytes_length_(data, len(data))

        # Legacy API: unarchiveObjectWithData:
        # This is deprecated but works for older archives
        obj = _NSKeyedUnarchiver.unarchiveObjectWithData_(ns_data)

        if obj is not None:
            return _extract_string(obj)

        return None
    except Exception:
        return None


def _try_nsunarchiver(data: bytes) -> str | None:
    """Try old NSUnarchiver API for streamtyped format."""
    try:
        ns_data = _NSData.dataWithBytes_length_(data, len(data))

        # NSUnarchiver for old NSArchiver format
        obj = _NSUnarchiver.unarchiveObjectWithData_(ns_data)

        if obj is not None:
            return _extract_string(obj)

        return None
    except Exception:
        return None


def _get_class(name: str):
    """Get an Objective-C class by name, or None if not available."""
    if _objc is None:
        return None
    try:
        return _objc.lookUpClass(name)
    except Exception:
        return None


# Matches http(s) URLs stored as plain byte runs in the archive. Stops at
# whitespace, control bytes, quotes, and common archive delimiters.
_URL_RE = re.compile(rb"https?://[^\s\x00-\x1f\"'<>)\]}]+")


def _append_blob_urls(text: str, data: bytes) -> str:
    """Append http(s) URLs found in the raw blob that aren't already in ``text``.

    Rich links (Apple Maps pins, Resy, OpenTable) live in NSAttributedString
    attributes that ``.string()`` discards, but the URL itself is stored as a
    plain byte run in the archive. Surfacing it keeps the link searchable and
    visible in chunks. Returns ``text`` unchanged when no new URLs are found.
    """
    found: list[str] = []
    for match in _URL_RE.finditer(data):
        url = match.group(0).decode("utf-8", "ignore").rstrip(".,;")
        if url and url not in text and url not in found:
            found.append(url)
    if not found:
        return text
    suffix = " ".join(found)
    return f"{text} {suffix}".strip() if text else suffix


def _extract_string(obj) -> str | None:
    """Extract plain text string from NSAttributedString object."""
    if obj is None:
        return None

    # Check if it's an NSAttributedString (or subclass)
    if hasattr(obj, "string"):
        try:
            # NSAttributedString.string returns the plain text NSString
            ns_string = obj.string()
            if ns_string:
                # Convert to Python string
                return str(ns_string)
        except Exception:
            pass

    return None


# Module-level test
if __name__ == "__main__":
    print(f"Platform: {sys.platform}")
    print(f"Foundation available: {_ensure_foundation()}")

    if _foundation_available:
        print("PyObjC Foundation classes loaded successfully")

        # Test with empty data
        result = decode_attributed_body(b"")
        print(f"Empty bytes result: {result}")

        # Test with garbage data
        result = decode_attributed_body(b"\xff\xfe\xfd\xfc")
        print(f"Garbage bytes result: {result}")
    else:
        print("PyObjC not available (not on macOS or not installed)")

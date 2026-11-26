//! Byte-level fast path for `streamtyped` attributedBody blobs.
//!
//! iMessage stores most message text as an NSArchiver ("typedstream") archive of
//! an NSAttributedString. The plain text sits right after the first NSString
//! class marker:
//!
//! ```text
//! 04 0B "streamtyped" ... "NSString" 01 <class ref> 84 01 '+' <length> <UTF-8 bytes>
//! ```
//!
//! `<length>` is one byte below 0x80, or 0x81 plus a u16 LE, or 0x82 plus a u32 LE.
//!
//! Reading those bytes takes about a microsecond. `NSUnarchiver` takes about
//! 140 µs per blob, and ingestion decodes 1.5M blobs per pass. Any blob this
//! parser does not recognise returns `None`, and the caller falls back to Foundation.

const STREAMTYPED: &[u8] = b"streamtyped";
const NSSTRING: &[u8] = b"NSString";
/// The three bytes that end the NSString class header: `84 01 '+'`.
const STRING_HEADER_TAIL: &[u8] = &[0x84, 0x01, b'+'];

/// True when the blob is an NSArchiver archive. The tag starts at byte 2,
/// after the `04 0B` stream header.
pub fn is_streamtyped(bytes: &[u8]) -> bool {
    bytes.get(2..2 + STREAMTYPED.len()) == Some(STREAMTYPED)
}

/// Extract the plain text of a `streamtyped` NSAttributedString.
///
/// Returns `None` for any other layout, a truncated blob, or invalid UTF-8.
pub fn extract_text(bytes: &[u8]) -> Option<String> {
    if !is_streamtyped(bytes) {
        return None;
    }
    let marker = find(bytes, NSSTRING)?;
    // "NSString", then 1 version byte and 1 class-reference byte, then the tail.
    let tail_at = marker + NSSTRING.len() + 2;
    if bytes.get(tail_at..tail_at + STRING_HEADER_TAIL.len())? != STRING_HEADER_TAIL {
        return None;
    }
    let mut p = tail_at + STRING_HEADER_TAIL.len();

    let len = match *bytes.get(p)? {
        0x81 => {
            let raw = bytes.get(p + 1..p + 3)?;
            p += 3;
            u16::from_le_bytes([raw[0], raw[1]]) as usize
        }
        0x82 => {
            let raw = bytes.get(p + 1..p + 5)?;
            p += 5;
            u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize
        }
        n if n < 0x80 => {
            p += 1;
            n as usize
        }
        _ => return None,
    };

    let text = bytes.get(p..p.checked_add(len)?)?;
    std::str::from_utf8(text).ok().map(str::to_owned)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The header bytes iMessage writes before the text, up to the length.
    fn blob(text: &str) -> Vec<u8> {
        let mut b = b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\
                      \x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+"
            .to_vec();
        let n = text.len();
        if n < 0x80 {
            b.push(n as u8);
        } else if n <= u16::MAX as usize {
            b.push(0x81);
            b.extend_from_slice(&(n as u16).to_le_bytes());
        } else {
            b.push(0x82);
            b.extend_from_slice(&(n as u32).to_le_bytes());
        }
        b.extend_from_slice(text.as_bytes());
        b.extend_from_slice(b"\x86\x84\x02iI\x01\x0b\x92\x84\x84\x84\x0cNSDictionary");
        b
    }

    #[test]
    fn short_text() {
        assert_eq!(extract_text(&blob("hey 👋")).as_deref(), Some("hey 👋"));
    }

    #[test]
    fn two_byte_length() {
        let long = "x".repeat(300);
        assert_eq!(extract_text(&blob(&long)), Some(long));
    }

    #[test]
    fn four_byte_length() {
        let huge = "y".repeat(70_000);
        assert_eq!(extract_text(&blob(&huge)), Some(huge));
    }

    #[test]
    fn text_containing_the_marker_is_kept_whole() {
        let text = "NSString is a class";
        assert_eq!(extract_text(&blob(text)).as_deref(), Some(text));
    }

    #[test]
    fn keyed_archives_are_not_parsed() {
        assert_eq!(extract_text(b"bplist00\x01\x02NSString"), None);
    }

    #[test]
    fn truncated_blob_falls_back() {
        let mut b = blob("hello world");
        b.truncate(b.len() - 30);
        assert_eq!(extract_text(&b), None);
    }

    #[test]
    fn unexpected_header_falls_back() {
        let mut b = blob("hello");
        let at = find(&b, NSSTRING).unwrap() + NSSTRING.len() + 2;
        b[at] = 0x85;
        assert_eq!(extract_text(&b), None);
    }

    #[test]
    fn invalid_utf8_falls_back() {
        let mut b = blob("ab");
        let at = b.len() - 1 - b"\x86\x84\x02iI\x01\x0b\x92\x84\x84\x84\x0cNSDictionary".len();
        b[at] = 0xff;
        assert_eq!(extract_text(&b), None);
    }

    #[test]
    fn detects_streamtyped_at_offset_two() {
        assert!(is_streamtyped(b"\x04\x0bstreamtyped\x81"));
        assert!(!is_streamtyped(b"bplist00"));
        assert!(!is_streamtyped(b""));
    }
}

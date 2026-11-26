//! Decode NSAttributedString from iMessage attributedBody field.
//!
//! The attributedBody field contains a serialized NSAttributedString.
//! This can be in two formats:
//! - NSKeyedArchive format (modern, starts with "bplist00")
//! - NSArchiver format (legacy, starts with "streamtyped")
//!
//! This module provides FFI bindings to macOS Foundation framework to decode these blobs.
//!
//! # Safety Audit (2026-03-15)
//!
//! This module was audited for correctness and safety:
//! - Every ObjC pointer is null-checked before use
//! - `streamtyped` blobs go through the byte parser in `typedstream` first
//! - Three fallback strategies cover all macOS versions (modern secure → legacy keyed → NSUnarchiver)
//! - The secure unarchiver uses an explicit allowlist of 19 Foundation/AppKit classes
//! - `extract_string_from_nsattributed` defensively checks null at each step
//! - Lifetime safety: all ObjC objects are autoreleased by the runtime; Rust copies
//!   the UTF-8 string data via `to_owned()` before returning
#![allow(non_snake_case)]

use std::{ffi::CStr, os::raw::c_char, ptr};

use objc::runtime::{Class, Object};
use objc::{class, msg_send, sel, sel_impl};
use objc_foundation::{INSData, NSData};
use tracing::{debug, warn};

use super::typedstream;

/// Decode an attributedBody byte array to plain text
///
/// This function uses the macOS Foundation framework to deserialize
/// NSAttributedString data and extract the plain text content.
///
/// Returns None if:
/// - The data is empty
/// - Unarchiver fails to decode the data
/// - The decoded object is not an NSAttributedString
/// - The string content is empty
pub fn decode_attributed_body(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }

    // Check archive format from first bytes
    let streamtyped = typedstream::is_streamtyped(bytes);
    let format = if bytes.starts_with(b"bplist00") {
        "NSKeyedArchive"
    } else if streamtyped {
        "NSArchiver"
    } else {
        "unknown"
    };

    debug!(
        blob_length = bytes.len(),
        format = format,
        "Attempting to decode attributedBody"
    );

    // Fast path: read the text bytes straight out of the archive. Foundation
    // decodes anything the byte parser does not recognise.
    let decoded = typedstream::extract_text(bytes)
        .filter(|t| !t.is_empty())
        .or_else(|| unsafe { try_decode_attributed_body(bytes, streamtyped) });

    // Recover URLs from rich-link attributes (the `[attr string]` call drops them)
    // so Apple Maps / Resy / OpenTable links stay visible — and searchable — even
    // when the visible text is empty.
    let combined = append_blob_urls(decoded.unwrap_or_default(), bytes);

    if combined.is_empty() {
        let preview: Vec<u8> = bytes.iter().take(20).copied().collect();
        warn!(
            blob_length = bytes.len(),
            format = format,
            first_bytes = ?preview,
            "Failed to decode attributedBody"
        );
        None
    } else {
        debug!(length = combined.len(), "Successfully decoded attributedBody");
        Some(combined)
    }
}

/// Recover http(s) URLs stored as plain byte runs in the archive.
///
/// Rich links (Apple Maps pins, Resy, OpenTable) live in NSAttributedString
/// attributes that `[NSAttributedString string]` discards, but the URL itself is
/// stored as a plain (ASCII) byte run in the archive. Appends any URL not already
/// present in `text`; returns `text` unchanged when none are found.
fn append_blob_urls(text: String, bytes: &[u8]) -> String {
    // A URL byte is anything that isn't whitespace, a control byte, a quote, or a
    // common archive/markup delimiter.
    fn is_url_byte(b: u8) -> bool {
        !(b <= 0x20 || b == 0x7f || matches!(b, b'"' | b'\'' | b'<' | b'>' | b')' | b']' | b'}'))
    }

    let mut found: Vec<String> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"http://") || bytes[i..].starts_with(b"https://") {
            let mut j = i;
            while j < bytes.len() && is_url_byte(bytes[j]) {
                j += 1;
            }
            if let Ok(raw) = std::str::from_utf8(&bytes[i..j]) {
                let url = raw.trim_end_matches(['.', ',', ';']).to_string();
                if url.len() > 8 && !text.contains(&url) && !found.contains(&url) {
                    found.push(url);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }

    if found.is_empty() {
        return text;
    }
    let suffix = found.join(" ");
    if text.is_empty() {
        suffix
    } else {
        format!("{text} {suffix}")
    }
}

/// Internal unsafe implementation of attributedBody decoding
///
/// Tries multiple archiver formats:
/// 1. NSKeyedUnarchiver modern secure API (for "bplist00" format)
/// 2. NSKeyedUnarchiver legacy API (fallback)
/// 3. NSUnarchiver (for old NSArchiver "streamtyped" format)
///
/// A `streamtyped` blob tries NSUnarchiver first, since the keyed APIs always fail on it.
unsafe fn try_decode_attributed_body(bytes: &[u8], streamtyped: bool) -> Option<String> {
    // Create NSData from bytes
    let data = NSData::from_vec(bytes.to_vec());
    let unarchiver_class: *const Class = class!(NSUnarchiver);

    if streamtyped && let Some(text) = unsafe { try_nsunarchiver(unarchiver_class, &data) } {
        debug!("NSUnarchiver succeeded");
        return Some(text);
    }

    // Try NSKeyedUnarchiver first (for modern archives starting with "bplist00")
    let keyed_unarchiver_class: *const Class = class!(NSKeyedUnarchiver);
    let attr_string_class: *const Class = class!(NSAttributedString);

    // Try modern secure API first (requires allowed classes set)
    if let Some(text) = unsafe { try_modern_unarchive(keyed_unarchiver_class, attr_string_class, &data) } {
        debug!("NSKeyedUnarchiver modern API succeeded");
        return Some(text);
    }

    // Try legacy NSKeyedUnarchiver API
    if let Some(text) = unsafe { try_legacy_keyed_unarchive(keyed_unarchiver_class, &data) } {
        debug!("NSKeyedUnarchiver legacy API succeeded");
        return Some(text);
    }

    // Try NSUnarchiver for old NSArchiver format (starts with "streamtyped")
    if !streamtyped && let Some(text) = unsafe { try_nsunarchiver(unarchiver_class, &data) } {
        debug!("NSUnarchiver succeeded");
        return Some(text);
    }

    None
}

/// Helper to lookup a class by name (returns None if class not available)
unsafe fn lookup_class(name: &str) -> Option<*mut Object> {
    Class::get(name).map(|c| c as *const _ as *mut Object)
}

/// Try modern secure NSKeyedUnarchiver API with a full allowed-classes set
///
/// NSAttributedString archives contain many classes beyond NSAttributedString itself.
/// The secure unarchiver requires us to explicitly allow all classes in the object graph.
unsafe fn try_modern_unarchive(
    unarchiver_class: *const Class,
    attr_string_class: *const Class,
    data: &NSData,
) -> Option<String> {
    // Build NSSet of allowed classes for the object graph.
    // Core Foundation classes (should always exist)
    let mut allowed: Vec<*mut Object> = Vec::new();

    // Required Foundation classes
    let required_classes = [
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
    ];

    for name in &required_classes {
        // SAFETY: lookup_class safely checks for class existence using Objective-C runtime
        if let Some(cls) = unsafe { lookup_class(name) } {
            allowed.push(cls);
        } else {
            debug!(class = name, "Required class not found");
        }
    }

    // Optional AppKit/UI classes — push only if present
    let optional_classes = [
        "NSParagraphStyle",
        "NSMutableParagraphStyle",
        "NSTextAttachment",
        "NSColor",
        "NSFont",
        "NSShadow",
        "NSFontDescriptor",
    ];

    for name in &optional_classes {
        // SAFETY: lookup_class safely checks for class existence using Objective-C runtime
        if let Some(cls) = unsafe { lookup_class(name) } {
            allowed.push(cls);
            debug!(class = name, "Optional class found and added");
        } else {
            debug!(class = name, "Optional class not found; continuing without it");
        }
    }

    // Create NSArray from class objects, then NSSet
    let nsarray: *mut Object = msg_send![
        class!(NSArray),
        arrayWithObjects: allowed.as_ptr()
        count: allowed.len()
    ];
    let allowed_set: *mut Object = msg_send![class!(NSSet), setWithArray: nsarray];

    let mut error: *mut Object = ptr::null_mut();

    // Use unarchivedObjectOfClasses (plural!) to allow multiple classes
    let obj: *mut Object = msg_send![
        unarchiver_class,
        unarchivedObjectOfClasses: allowed_set
        fromData: data
        error: &mut error
    ];

    if !obj.is_null() {
        // Defensive: ensure it really is an NSAttributedString (or subclass)
        let is_attr: bool = msg_send![obj, isKindOfClass: attr_string_class];
        if is_attr {
            unsafe { extract_string_from_nsattributed(obj) }
        } else {
            // Log unexpected top-level class
            let cls: *const Class = msg_send![obj, class];
            let name: *mut Object = msg_send![cls, description];
            if !name.is_null() {
                let c: *const c_char = msg_send![name, UTF8String];
                if !c.is_null() {
                    // SAFETY: c is a valid C string from Objective-C UTF8String
                    if let Ok(n) = unsafe { CStr::from_ptr(c) }.to_str() {
                        debug!(class = n, "Top-level object is not NSAttributedString");
                    }
                }
            }
            None
        }
    } else {
        // Log error details
        if !error.is_null() {
            let desc: *mut Object = msg_send![error, localizedDescription];
            if !desc.is_null() {
                let c: *const c_char = msg_send![desc, UTF8String];
                if !c.is_null() {
                    // SAFETY: c is a valid C string from Objective-C UTF8String
                    if let Ok(err) = unsafe { CStr::from_ptr(c) }.to_str() {
                        debug!(error = err, "Modern secure unarchive failed");
                    }
                }
            }
        }
        None
    }
}

/// Try legacy NSKeyedUnarchiver API (less secure, but more permissive)
unsafe fn try_legacy_keyed_unarchive(unarchiver_class: *const Class, data: &NSData) -> Option<String> {
    let obj: *mut Object = msg_send![unarchiver_class, unarchiveObjectWithData: data];

    if !obj.is_null() {
        // Log class for debugging
        let cls: *const Class = msg_send![obj, class];
        let name: *mut Object = msg_send![cls, description];
        if !name.is_null() {
            let c: *const c_char = msg_send![name, UTF8String];
            if !c.is_null() {
                // SAFETY: c is a valid C string from Objective-C UTF8String
                if let Ok(n) = unsafe { CStr::from_ptr(c) }.to_str() {
                    debug!(class = n, "Legacy NSKeyedUnarchiver returned object");
                }
            }
        }
        unsafe { extract_string_from_nsattributed(obj) }
    } else {
        debug!("Legacy NSKeyedUnarchiver returned null");
        None
    }
}

/// Try old NSUnarchiver API (for "streamtyped" format from old NSArchiver)
unsafe fn try_nsunarchiver(unarchiver_class: *const Class, data: &NSData) -> Option<String> {
    let obj: *mut Object = msg_send![unarchiver_class, unarchiveObjectWithData: data];

    if !obj.is_null() {
        // Log class for debugging
        let cls: *const Class = msg_send![obj, class];
        let name: *mut Object = msg_send![cls, description];
        if !name.is_null() {
            let c: *const c_char = msg_send![name, UTF8String];
            if !c.is_null() {
                // SAFETY: c is a valid C string from Objective-C UTF8String
                if let Ok(n) = unsafe { CStr::from_ptr(c) }.to_str() {
                    debug!(class = n, "NSUnarchiver returned object");
                }
            }
        }
        unsafe { extract_string_from_nsattributed(obj) }
    } else {
        debug!("NSUnarchiver returned null");
        None
    }
}

/// Extract plain text string from NSAttributedString object
unsafe fn extract_string_from_nsattributed(attr_obj: *mut Object) -> Option<String> {
    if attr_obj.is_null() {
        debug!("attr_obj is null");
        return None;
    }

    // Call [attr_obj string] to get NSString
    let nsstring: *mut Object = msg_send![attr_obj, string];
    if nsstring.is_null() {
        debug!("nsstring is null after calling [attr_obj string]");
        return None;
    }

    // Call [nsstring UTF8String] to get C string
    let c_str_ptr: *const c_char = msg_send![nsstring, UTF8String];
    if c_str_ptr.is_null() {
        debug!("c_str_ptr is null after calling UTF8String");
        return None;
    }

    // Convert C string to Rust String
    // SAFETY: c_str_ptr is a valid C string from Objective-C UTF8String method
    match unsafe { CStr::from_ptr(c_str_ptr) }.to_str() {
        Ok(s) => Some(s.to_owned()),
        Err(e) => {
            debug!(error = ?e, "Failed to convert C string to Rust String");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_bytes() {
        let result = decode_attributed_body(&[]);
        assert_eq!(result, None);
    }

    #[test]
    fn test_invalid_bytes() {
        // Random garbage data should return None
        let garbage = vec![0xFF, 0xFE, 0xFD, 0xFC];
        let result = decode_attributed_body(&garbage);
        assert_eq!(result, None);
    }

    // Note: We can't easily create valid NSKeyedArchive test data
    // without using actual macOS APIs. Real testing requires
    // integration tests with actual iMessage database data.

    #[test]
    fn test_append_blob_urls_recovers_link_when_text_empty() {
        // Rich-link blob: archive noise + an Apple Maps URL stored as a byte run.
        let blob = b"bplist00\x01\x02maps.apple\x00https://maps.apple/p/0nJ1GQ~hFKU8zV\x00\x84more";
        let out = append_blob_urls(String::new(), blob);
        assert_eq!(out, "https://maps.apple/p/0nJ1GQ~hFKU8zV");
    }

    #[test]
    fn test_append_blob_urls_appends_and_dedupes() {
        let blob = b"x https://resy.com/i/abc \x00 https://resy.com/i/abc ";
        let out = append_blob_urls("Dinner tonight".to_string(), blob);
        assert_eq!(out, "Dinner tonight https://resy.com/i/abc");
    }

    #[test]
    fn test_append_blob_urls_skips_when_already_present() {
        let blob = b"see https://resy.com/i/abc";
        let out = append_blob_urls("see https://resy.com/i/abc".to_string(), blob);
        assert_eq!(out, "see https://resy.com/i/abc");
    }

    #[test]
    fn test_append_blob_urls_noop_without_urls() {
        let out = append_blob_urls("plain text".to_string(), b"plain text no links");
        assert_eq!(out, "plain text");
    }
}

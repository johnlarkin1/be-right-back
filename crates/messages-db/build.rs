/// Build script for ingest crate
///
/// Links the macOS Foundation and AppKit frameworks, which are required for
/// decoding NSAttributedString data from the iMessage database.
fn main() {
    // Only link frameworks on macOS
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=Foundation");
        // AppKit is needed for NSParagraphStyle, NSFont, NSColor, NSTextAttachment, etc.
        // These classes appear in iMessage attributedBody archives.
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}

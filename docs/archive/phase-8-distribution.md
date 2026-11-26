# Phase 8: Distribution

**Timeline:** Week 8+
**Status:** 🔴 ~35-40% Complete (January 2025)
**Dependencies:** Phase 7 (app must be stable and tested)
**Priority:** Medium

---

## Overview

Package and distribute the application for end users. This involves code signing, notarization, creating installers, and preparing documentation.

### Goals

1. Set up Apple Developer account and certificates
2. Code sign the application
3. Notarize with Apple
4. Create DMG installer
5. Write installation and usage documentation
6. Prepare for first public beta release

---

## Distribution Checklist

### Task 1: Apple Developer Setup

**Requirements:**
- Apple Developer account ($99/year)
- Developer ID certificate for distribution
- App-specific password for notarization

**Steps:**

1. **Enroll in Apple Developer Program:**
   - Visit developer.apple.com
   - Enroll as individual or organization
   - Pay $99 annual fee

2. **Create certificates:**
   - Open Xcode
   - Preferences → Accounts → Manage Certificates
   - Create "Developer ID Application" certificate
   - Export certificate and private key

3. **Create app-specific password:**
   - Visit appleid.apple.com
   - Security → App-Specific Passwords
   - Generate password for notarization

**Acceptance criteria:**
- [ ] Developer account active (NOT STARTED)
- [ ] Certificates created and installed (NOT STARTED)
- [ ] Credentials stored securely (NOT STARTED)

---

### Task 2: Code Signing

**Tauri configuration:**

```json
// tauri.conf.json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "entitlements": "entitlements.macos.plist",
      "exceptionDomain": null
    }
  }
}
```

**Entitlements:**

```xml
<!-- src-tauri/entitlements.macos.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- File access for Messages database -->
  <key>com.apple.security.files.user-selected.read-only</key>
  <true/>

  <!-- Network for llama-server (localhost only) -->
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>

  <!-- Hardened runtime -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
```

**Build signed app:**

```bash
cd apps/desktop
npm run tauri build -- --target universal-apple-darwin
```

**Verify signature:**

```bash
codesign -dv --verbose=4 target/release/bundle/macos/Be\ Right\ Back.app
spctl -a -v target/release/bundle/macos/Be\ Right\ Back.app
```

**Acceptance criteria:**
- [ ] App is signed with Developer ID (NOT STARTED - no signingIdentity in config)
- [ ] Signature verified successfully (BLOCKED)
- [ ] Hardened runtime enabled (BLOCKED)

**Implementation notes:**
- ❌ No `signingIdentity` in tauri.conf.json
- ❌ No `entitlements.macos.plist` file exists

---

### Task 3: Notarization

**Why notarize?**
- macOS Gatekeeper requires notarization for unsigned apps
- Users won't see scary warnings when opening app
- Required for distribution outside Mac App Store

**Notarization process:**

```bash
# Create archive
ditto -c -k --keepParent \
  "target/release/bundle/macos/Be Right Back.app" \
  "Be-Right-Back.zip"

# Submit for notarization
xcrun notarytool submit Be-Right-Back.zip \
  --apple-id "your-email@example.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password" \
  --wait

# Staple notarization ticket
xcrun stapler staple "target/release/bundle/macos/Be Right Back.app"
```

**Check notarization status:**

```bash
xcrun notarytool log <submission-id> \
  --apple-id "your-email@example.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password"
```

**Common issues:**
- Unsigned binaries (llama-server, Python)
- Missing entitlements
- Invalid bundle structure

**Solution:** Sign all binaries before bundling:

```bash
# Sign llama-server
codesign --force --sign "Developer ID Application" \
  --timestamp --options runtime \
  path/to/llama-server
```

**Acceptance criteria:**
- [ ] App successfully notarized (BLOCKED - no credentials)
- [ ] Notarization ticket stapled (BLOCKED)
- [ ] App opens without warnings on fresh Mac (BLOCKED)

---

### Task 4: DMG Creation

**Create distributable DMG:**

```bash
# Use create-dmg tool
npm install -g create-dmg

create-dmg \
  --volname "Be Right Back" \
  --window-pos 200 120 \
  --window-size 800 400 \
  --icon-size 100 \
  --icon "Be Right Back.app" 200 190 \
  --hide-extension "Be Right Back.app" \
  --app-drop-link 600 185 \
  "Be-Right-Back-1.0.0.dmg" \
  "target/release/bundle/macos/Be Right Back.app"
```

**DMG contents:**
- Be Right Back.app
- Symlink to /Applications folder
- README or Quick Start guide (optional)

**Acceptance criteria:**
- [x] DMG created successfully (tauri.conf.json has DMG target)
- [ ] Drag-to-install works (UNTESTED)
- [ ] DMG background looks professional (NOT CONFIGURED)

**Implementation notes:**
- ✅ `tauri.conf.json` specifies `["dmg", "app"]` bundle targets
- ❌ No custom create-dmg configuration
- ❌ No DMG branding/background

---

### Task 5: Documentation

**User documentation:**

1. **README.md:**
   - What the app does
   - System requirements
   - Installation instructions
   - Quick start guide
   - FAQ
   - Troubleshooting
   - License

2. **Installation guide:**
   - Download DMG
   - Drag to Applications
   - Grant Full Disk Access
   - Create first persona

3. **FAQ:**
   - How do I grant Full Disk Access?
   - Why can't the app access my Messages?
   - How long does training take?
   - Can I delete personas?
   - Is my data private?

**Developer documentation:**
- Architecture overview (already in docs/)
- Build instructions
- Development setup
- Contributing guidelines
- API documentation (rustdoc)

**Files to create:**
- `README.md` (root)
- `docs/INSTALLATION.md`
- `docs/FAQ.md`
- `docs/TROUBLESHOOTING.md`

**Acceptance criteria:**
- [x] Clear installation instructions (website CLAUDE.md documents this)
- [ ] Common questions answered (FAQ.md NOT CREATED)
- [ ] Troubleshooting guide available (NOT CREATED)

**Implementation notes:**
- ✅ Website framework complete (Next.js on Vercel)
- ✅ "How It's Built" documentation (8 pages each for simple/technical tracks)
- ✅ Website CLAUDE.md documents download page requirements
- ❌ No standalone installation guide
- ❌ No FAQ.md or troubleshooting.md

---

### Task 6: Beta Testing

**Beta program:**

1. **Internal testing:**
   - Test on team's machines
   - Verify installation process
   - Check for critical bugs

2. **External beta:**
   - Recruit 10-20 beta testers
   - Distribute via TestFlight or direct download
   - Collect feedback via Google Forms or GitHub Issues

3. **Feedback loop:**
   - Prioritize bug reports
   - Fix critical issues
   - Iterate on UX improvements

**Beta metrics to track:**
- Installation success rate
- Crashes or errors
- Time to create first persona
- Chat session length
- Feature usage

**Acceptance criteria:**
- [ ] Beta program launched (NOT STARTED)
- [ ] 10+ testers onboarded (NOT STARTED)
- [ ] Feedback collected and triaged (NOT STARTED)

---

### Task 7: Release Preparation

**Pre-release checklist:**

- [ ] App version bumped in Cargo.toml and tauri.conf.json
- [ ] CHANGELOG.md updated
- [ ] README.md finalized
- [ ] All critical bugs fixed
- [ ] Performance targets met
- [ ] Documentation complete
- [ ] Signed and notarized build ready
- [ ] DMG created
- [ ] Website updated with download link

**Release assets:**
- `Be-Right-Back-1.0.0.dmg`
- `Be-Right-Back-1.0.0.tar.gz` (source)
- `checksums.txt` (SHA256 hashes)

**Release notes template:**

```markdown
# Be Right Back v1.0.0

**Release Date:** YYYY-MM-DD

## What's New
- 🎉 Initial public release
- 💬 Create AI personas from iMessage conversations
- 🤖 Local LoRA fine-tuning with MLX-LM
- 🔍 RAG-powered contextual memory
- 🖥️ Native macOS app with Tauri

## System Requirements
- macOS 12.0 (Monterey) or later
- Apple Silicon Mac (M1/M2/M3)
- 8GB RAM (16GB recommended)
- 10GB free disk space

## Installation
1. Download `Be-Right-Back-1.0.0.dmg`
2. Open DMG and drag app to Applications
3. Grant Full Disk Access in System Settings
4. Launch and create your first persona!

## Known Issues
- Training may take 15-90 minutes on M1 Macs
- VSS index rebuilds on startup (DuckDB limitation)

## Feedback
Report issues: https://github.com/yourname/be-right-back/issues
```

**Acceptance criteria:**
- [ ] Release checklist complete
- [ ] Release assets prepared
- [ ] Release notes written

---

## Distribution Channels

**Option 1: Direct Distribution (recommended initially)**
- Host DMG on website
- Provide download link
- No App Store approval needed
- Full control over updates

**Option 2: Mac App Store**
- Pros: Built-in distribution, automatic updates
- Cons: Sandbox restrictions, Full Disk Access difficult
- Verdict: **Not feasible** (can't access Messages database from sandbox)

**Option 3: Homebrew Cask**
- After stable release, submit to Homebrew
- Easy installation: `brew install --cask be-right-back`

---

## Update Mechanism

**Manual updates (v1.0):**
- Check GitHub releases manually
- Download new DMG
- Replace app

**Future: Auto-update (v1.1+):**
- Use Tauri's updater feature
- Check for updates on launch
- Download and install in background
- Prompt user to restart

**Implementation:**

```rust
// Future: Tauri updater
use tauri::updater;

#[tauri::command]
async fn check_for_updates() -> Result<UpdateInfo, String> {
    let update = tauri::updater::builder().check().await?;
    // ...
}
```

---

## Website Updates

**Download page:**
- Clear CTA: "Download for macOS"
- System requirements
- Screenshots/video
- Installation instructions

**Content:**
```markdown
# Download Be Right Back

**Latest version:** 1.0.0
**Released:** YYYY-MM-DD

[Download for macOS (Apple Silicon)](https://example.com/Be-Right-Back-1.0.0.dmg)

### System Requirements
- macOS 12.0 or later
- Apple Silicon (M1/M2/M3)
- 8GB RAM minimum
- 10GB free disk space

### What's Included
- Be Right Back.app
- User guide (README)
- Quick start tutorial

### Installation
1. Download the DMG file above
2. Open it and drag Be Right Back to Applications
3. Follow the setup wizard
```

---

## Success Criteria

Phase 8 is complete when:

1. ❌ App is signed and notarized (BLOCKED - no Apple Developer account)
2. 🟡 DMG installer works on fresh Macs (bundle config ready, untested)
3. 🟡 Documentation is comprehensive and clear (website ready, standalone docs missing)
4. ❌ Beta testing completed with positive feedback (NOT STARTED)
5. ❌ First public release is live (BLOCKED)
6. ❌ Users can download, install, and use the app without issues (BLOCKED)

**Phase 8 is ~35-40% complete.**

---

## Remaining Work (~60-65%)

### Critical (to complete Phase 8)

1. **Apple Developer Setup**
   - Create Apple Developer account ($99/year)
   - Generate Developer ID certificates
   - Create app-specific password for notarization

2. **Code Signing & Notarization**
   - Create `entitlements.macos.plist` with Full Disk Access
   - Add `signingIdentity` to tauri.conf.json
   - Write notarization script
   - Test on fresh Mac

3. **Documentation**
   - Create INSTALLATION.md
   - Create FAQ.md
   - Create TROUBLESHOOTING.md
   - Implement download page on website

4. **Beta Testing**
   - Set up GitHub Releases
   - Recruit beta testers
   - Create feedback mechanism

### Implementation Notes

**What's ready:**
- ✅ Bundle scripts for Python/MLX bundling
- ✅ tauri.conf.json with DMG target
- ✅ Makefile `prepare-bundle` target
- ✅ Website deployed on Vercel
- ✅ "How It's Built" documentation

**What's blocking:**
- ❌ No Apple Developer credentials
- ❌ No entitlements file
- ❌ No notarization workflow

**Outcome:** Be Right Back is publicly available and ready for users!

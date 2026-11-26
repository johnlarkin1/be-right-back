#!/usr/bin/env bash
#
# release.sh -- Build, sign, notarize, and archive a Be Right Back release.
#
# This script handles the internal release flow: version bump, bundle prep,
# code signing, notarization, push, and a GitHub release on the internal repo
# that keeps the signed DMG. Nothing here reaches the public repo -- run
# publish-release.sh for that, when the version is ready to ship.
#
# Usage: ./scripts/release/release.sh
#        make release
#
# Reads the version from the VERSION file at the repo root.
#
# Required env vars for notarization:
#   APPLE_API_KEY       -- App Store Connect API key ID
#   APPLE_API_ISSUER    -- App Store Connect API issuer UUID
#   APPLE_API_KEY_PATH  -- Path to the .p8 key file
#
# Required env vars for the internal GitHub release:
#   GITHUB_TOKEN or GITHUB_CC_PAT
#
# Optional env vars:
#   APPLE_SIGNING_IDENTITY -- Developer ID identity (auto-detected if unset)
#   INTERNAL_REPO -- internal GitHub repo (default: johnlarkin1/be-right-back-internal)
#   GH_REPO -- public repo, checked to refuse a rebuild of a published version
#              (default: johnlarkin1/be-right-back)
#
# Rebuilding the same version is expected before the first public release. The
# tag, the commit, and the archived DMG all move to the newest build.

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Read version from VERSION file
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

VERSION_FILE="$REPO_ROOT/VERSION"
[[ -f "$VERSION_FILE" ]] || die "VERSION file not found at $VERSION_FILE"
VERSION=$(tr -d '[:space:]' < "$VERSION_FILE")
[[ -z "$VERSION" ]] && die "VERSION file is empty"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid version format: '$VERSION' (expected X.Y.Z)"

INTERNAL_REPO="${INTERNAL_REPO:-johnlarkin1/be-right-back-internal}"
# The mirror of publish-release.sh's guard. Without it an INTERNAL_REPO override
# turns this script -- the one whose whole point is that nothing reaches the
# public repo -- into a publisher.
echo "$INTERNAL_REPO" | grep -qi 'be-right-back-internal' \
    || die "INTERNAL_REPO is '$INTERNAL_REPO', which is not the internal repo. release.sh never publishes."
# Read only here. This script never publishes to it, it only refuses to rebuild
# a version that already went out.
GH_REPO="${GH_REPO:-johnlarkin1/be-right-back}"

info "Releasing version $VERSION (from VERSION file)"

TAURI_DIR="apps/desktop/src-tauri"
DESKTOP_DIR="apps/desktop"
TAURI_CONF="$TAURI_DIR/tauri.conf.json"
TAURI_CARGO="$TAURI_DIR/Cargo.toml"
DESKTOP_PKG="$DESKTOP_DIR/package.json"
ENTITLEMENTS="$TAURI_DIR/Entitlements.plist"
ENTITLEMENTS_EMBEDDED="$TAURI_DIR/Entitlements-embedded.plist"

# ---------------------------------------------------------------------------
# Step 1: Validate environment
# ---------------------------------------------------------------------------
info "Validating environment..."

# Required tools
for tool in gh xcrun codesign hdiutil jq npm cargo; do
    command -v "$tool" >/dev/null 2>&1 || die "Required tool not found: $tool"
done

# GitHub token, for the internal release at the end. An explicit token wins if
# one is set; otherwise gh uses the credentials `gh auth` already stored. The
# repo read below is what decides whether that credential actually works.
GH_TOKEN="${GITHUB_CC_PAT:-${GITHUB_TOKEN:-}}"
[[ -n "$GH_TOKEN" ]] && export GITHUB_TOKEN="$GH_TOKEN"

# Both repos have to be readable before anything irreversible runs. Without this
# the published-version check below cannot tell "no release" from "no access",
# and the internal release at the end fails after the build and the notarization.
for repo in "$INTERNAL_REPO" "$GH_REPO"; do
    gh repo view "$repo" --json name >/dev/null 2>&1 \
        || die "gh cannot read $repo. Fix or unset GITHUB_CC_PAT/GITHUB_TOKEN (unset falls back to 'gh auth' credentials)."
done

# The commit and the tag land on the checked-out branch, but the push names
# main. On any other branch the tag sits on a commit that main never receives.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "main" ]] || die "Repo is on branch '$CURRENT_BRANCH', expected 'main'"

# A push that is not a fast-forward fails at step 12, after the build and the
# notarization have already run. Catch it here, before the expensive part.
git fetch --quiet origin main || die "git fetch origin main failed"
git merge-base --is-ancestor origin/main HEAD \
    || die "Local main is behind origin/main. Pull before releasing."

# A rebuild of a version that is already public would move a tag that people
# have downloaded against. Internal tags move freely; published ones do not.
if gh release view "v$VERSION" --repo "$GH_REPO" &>/dev/null; then
    die "v$VERSION is already published on $GH_REPO. Bump the VERSION file."
fi

# Notarization env vars
[[ -z "${APPLE_API_KEY:-}" ]]      && die "APPLE_API_KEY is not set"
[[ -z "${APPLE_API_ISSUER:-}" ]]   && die "APPLE_API_ISSUER is not set"
[[ -z "${APPLE_API_KEY_PATH:-}" ]] && die "APPLE_API_KEY_PATH is not set"
[[ -f "$APPLE_API_KEY_PATH" ]]     || die "APPLE_API_KEY_PATH file not found: $APPLE_API_KEY_PATH"

# Signing identity (auto-detect if not set)
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    # `|| true`: without it a keychain holding no Developer ID makes grep exit 1, and
    # pipefail kills the script here -- before the die below can say why.
    APPLE_SIGNING_IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | awk -F'"' '{print $2}' || true)
    [[ -z "$APPLE_SIGNING_IDENTITY" ]] && die "No 'Developer ID Application' identity found in keychain"
    info "Auto-detected signing identity: $APPLE_SIGNING_IDENTITY"
fi
export APPLE_SIGNING_IDENTITY

# Verify identity is valid
security find-identity -v -p codesigning | grep -q "$APPLE_SIGNING_IDENTITY" \
    || die "Signing identity not found in keychain: $APPLE_SIGNING_IDENTITY"

# Verify entitlements exist
[[ -f "$ENTITLEMENTS" ]]          || die "Entitlements.plist not found at $ENTITLEMENTS"
[[ -f "$ENTITLEMENTS_EMBEDDED" ]] || die "Entitlements-embedded.plist not found at $ENTITLEMENTS_EMBEDDED"

ok "Environment validated"

# ---------------------------------------------------------------------------
# Step 2: Bump version
# ---------------------------------------------------------------------------
info "Bumping version to $VERSION..."

# tauri.conf.json
jq --arg v "$VERSION" '.version = $v' "$TAURI_CONF" > "$TAURI_CONF.tmp" && mv "$TAURI_CONF.tmp" "$TAURI_CONF"

# package.json
jq --arg v "$VERSION" '.version = $v' "$DESKTOP_PKG" > "$DESKTOP_PKG.tmp" && mv "$DESKTOP_PKG.tmp" "$DESKTOP_PKG"

# Cargo.toml (sed for the version line in [package] section -- only the first match)
sed -i '' "0,/^version = \".*\"/s//version = \"$VERSION\"/" "$TAURI_CARGO"

# Update Cargo.lock
cargo check -p be-right-back-desktop --quiet 2>/dev/null || true

ok "Version bumped to $VERSION"

# ---------------------------------------------------------------------------
# Step 3: Prepare bundle (download Python, uv, copy MLX)
# ---------------------------------------------------------------------------
info "Preparing bundled resources..."
make prepare-bundle
ok "Bundle resources ready"

# ---------------------------------------------------------------------------
# Step 4: Sign embedded binaries
# ---------------------------------------------------------------------------
RESOURCES_DIR="$TAURI_DIR/resources/binaries"

sign_embedded() {
    local path="$1"
    codesign --force --options runtime \
        --sign "$APPLE_SIGNING_IDENTITY" \
        --entitlements "$ENTITLEMENTS_EMBEDDED" \
        --timestamp \
        "$path"
}

if [[ -d "$RESOURCES_DIR" ]]; then
    info "Signing embedded binaries in $RESOURCES_DIR..."

    # Sign .dylib and .so files first (inner-to-outer order)
    find "$RESOURCES_DIR" -type f \( -name "*.dylib" -o -name "*.so" \) | while read -r lib; do
        info "  Signing library: $(basename "$lib")"
        sign_embedded "$lib"
    done

    # Sign executables (python, uv)
    find "$RESOURCES_DIR" -type f -perm +111 | while read -r bin; do
        # Skip already-signed libraries
        [[ "$bin" == *.dylib || "$bin" == *.so ]] && continue
        # Only sign Mach-O binaries
        file "$bin" | grep -q "Mach-O" || continue
        info "  Signing binary: $(basename "$bin")"
        sign_embedded "$bin"
    done

    ok "Embedded binaries signed"
else
    warn "No resources/binaries directory found -- skipping embedded signing"
fi

# ---------------------------------------------------------------------------
# Step 5: Build the app
# ---------------------------------------------------------------------------
# Clear the renamed DMGs from any previous run first. Tauri emits
# "Be Right Back_<version>_aarch64.dmg" (from productName), which step 8 renames to
# BeRightBack.<date>.<version>.dmg -- so on a second run the directory would hold both,
# and step 8 picks by mtime. Picking a leftover would notarize and publish the *previous*
# build, and every signature check would still pass because it is signed. The bare
# BeRightBack.dmg glob clears images left by builds that predate the dated naming.
rm -f "$REPO_ROOT"/target/release/bundle/dmg/BeRightBack.dmg \
      "$REPO_ROOT"/target/release/bundle/dmg/BeRightBack.*.dmg

info "Building app with Tauri..."
cd "$DESKTOP_DIR"
npm run tauri build
cd "$REPO_ROOT"
ok "Tauri build complete"

# ---------------------------------------------------------------------------
# Step 6: Locate the bundle and verify every Mach-O is signed
# ---------------------------------------------------------------------------
# The Cargo workspace shares one target dir at the repo root, so Tauri writes bundles to
# <repo>/target/release/bundle -- NOT under apps/desktop/src-tauri/.
BUNDLE_DIR="$REPO_ROOT/target/release/bundle"

# `|| true`: a missing macos/ dir makes find exit 1, and pipefail would kill the script at
# the assignment rather than at the die below.
APP_BUNDLE=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name "*.app" 2>/dev/null | head -1 || true)
[[ -z "$APP_BUNDLE" ]] && die "No .app bundle found in $BUNDLE_DIR/macos/"

# This step deliberately only VERIFIES -- it does not re-sign. Everything is already signed by
# this point: step 4 signs the embedded binaries before they are copied into the bundle, and
# Tauri signs the main executable and seals the outer bundle during the build. Re-signing here
# would also invalidate the DMG Tauri builds from this app in the same step, leaving a stale
# copy inside the image we ship.
info "Verifying every Mach-O in $APP_BUNDLE is signed..."

UNSIGNED_LIST=$(find "$APP_BUNDLE" -type f -print0 | while IFS= read -r -d '' f; do
    file "$f" | grep -q "Mach-O" || continue
    codesign --verify "$f" >/dev/null 2>&1 || echo "${f#"$APP_BUNDLE"/}"
done)

if [[ -n "$UNSIGNED_LIST" ]]; then
    echo "$UNSIGNED_LIST" | while read -r u; do warn "  unsigned: $u"; done
    die "Unsigned Mach-O binaries found in the bundle -- check step 4 and 'make prepare-bundle'"
fi
ok "All Mach-O binaries signed"

# ---------------------------------------------------------------------------
# Step 7: Verify code signature
# ---------------------------------------------------------------------------
info "Verifying code signature..."
codesign --verify --deep --strict "$APP_BUNDLE" || die "codesign verification failed"

# Assert the entitlements that actually matter at runtime survived signing: the app needs
# network access, and the embedded Python must keep library validation disabled (it loads
# unsigned .so files from the user's pip-installed venv).
MAIN_EXEC_ENTS=$(codesign -d --entitlements - "$APP_BUNDLE/Contents/MacOS/be-right-back" 2>&1)
grep -q "com.apple.security.network.client" <<<"$MAIN_EXEC_ENTS" \
    || die "main executable lost com.apple.security.network.client"

EMBEDDED_PYTHON="$APP_BUNDLE/Contents/Resources/resources/binaries/python/bin/python3"
if [[ -f "$EMBEDDED_PYTHON" ]]; then
    codesign -d --entitlements - "$EMBEDDED_PYTHON" 2>&1 \
        | grep -q "com.apple.security.cs.disable-library-validation" \
        || die "embedded python lost com.apple.security.cs.disable-library-validation"
else
    die "embedded python not found at $EMBEDDED_PYTHON -- did prepare-bundle run?"
fi

spctl --assess --type execute "$APP_BUNDLE" 2>&1 || warn "spctl assessment warning (expected until notarization is stapled)"
ok "Code signature verified"

# ---------------------------------------------------------------------------
# Step 8: Create DMG
# ---------------------------------------------------------------------------
# Use the DMG Tauri already produced rather than rebuilding one with hdiutil. Tauri's DMG has
# the /Applications symlink and volume icon that make drag-to-install obvious; a bare
# `hdiutil create -srcfolder <app>` image has neither, which nudges users into running the app
# straight off the read-only mount.
DMG_DIR="$BUNDLE_DIR/dmg"
# Newest first, so even if a stale image survives the step 5 cleanup the one this run
# just produced still wins.
# `|| true` so an empty or missing dir reaches the die below instead of dying at the
# assignment under pipefail, with no message.
TAURI_DMG=$(find "$DMG_DIR" -maxdepth 1 -name "*.dmg" -exec stat -f '%m %N' {} + 2>/dev/null |
    sort -rn | head -1 | cut -d' ' -f2- || true)
[[ -z "$TAURI_DMG" ]] && die "No .dmg found in $DMG_DIR/ -- check the 'dmg' bundle target in tauri.conf.json"

# Rename to carry the build date and the version. The name is what ties an image on disk to
# a version: publish-release.sh matches on it, so it cannot ship a stale build under a new
# tag. Tauri already signed this image and a rename does not disturb the signature, so just
# re-verify rather than re-signing.
DMG_PATH="$DMG_DIR/BeRightBack.$(date +%Y%m%d).$VERSION.dmg"
[[ "$TAURI_DMG" != "$DMG_PATH" ]] && mv -f "$TAURI_DMG" "$DMG_PATH"

codesign --verify --strict "$DMG_PATH" || die "DMG signature verification failed"
ok "DMG ready: $DMG_PATH"

# ---------------------------------------------------------------------------
# Step 9: Notarize
# ---------------------------------------------------------------------------
info "Submitting for notarization (this may take a few minutes)..."
NOTARIZE_OUTPUT=$(xcrun notarytool submit "$DMG_PATH" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait 2>&1) || true

echo "$NOTARIZE_OUTPUT"

# Extract submission ID for log fetching. `|| true`: a notarytool failure that prints no
# UUID makes grep exit 1, and pipefail would kill the script right here -- skipping every
# diagnostic branch below, which is exactly when they are needed.
SUBMISSION_ID=$(echo "$NOTARIZE_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)

if echo "$NOTARIZE_OUTPUT" | grep -qi "status: Accepted"; then
    ok "Notarization accepted"
elif echo "$NOTARIZE_OUTPUT" | grep -qi "status: Invalid"; then
    warn "Notarization rejected -- fetching log..."
    if [[ -n "$SUBMISSION_ID" ]]; then
        xcrun notarytool log "$SUBMISSION_ID" \
            --key "$APPLE_API_KEY_PATH" \
            --key-id "$APPLE_API_KEY" \
            --issuer "$APPLE_API_ISSUER" || true
    fi
    die "Notarization failed"
else
    warn "Notarization status unclear -- check output above"
    if [[ -n "$SUBMISSION_ID" ]]; then
        xcrun notarytool log "$SUBMISSION_ID" \
            --key "$APPLE_API_KEY_PATH" \
            --key-id "$APPLE_API_KEY" \
            --issuer "$APPLE_API_ISSUER" || true
    fi
fi

# ---------------------------------------------------------------------------
# Step 10: Staple
# ---------------------------------------------------------------------------
info "Stapling notarization ticket..."
xcrun stapler staple "$DMG_PATH" || die "Stapling failed"
ok "Notarization ticket stapled"

# ---------------------------------------------------------------------------
# Step 11: Commit & tag
# ---------------------------------------------------------------------------
info "Committing version bump and creating tag..."
git add "$VERSION_FILE" "$TAURI_CONF" "$TAURI_CARGO" "$DESKTOP_PKG" Cargo.lock

# A rebuild of the same version stages nothing, because the version files
# already hold it. Without this branch the commit fails and takes the script
# down after the build and the notarization.
if git diff --cached --quiet; then
    info "Version files already at v$VERSION, nothing to commit"
else
    git commit -m "release: v$VERSION"
fi

# -f, so a rebuild of the same version moves the tag to the current commit.
git tag -f -a "v$VERSION" -m "Release v$VERSION"
ok "Tagged v$VERSION"

# ---------------------------------------------------------------------------
# Step 12: Push to origin
# ---------------------------------------------------------------------------
info "Pushing to origin..."
git push origin main
git push -f origin "v$VERSION"
ok "Pushed commit and tag to origin"

# ---------------------------------------------------------------------------
# Step 13: Internal GitHub release (archive of the signed DMG)
# ---------------------------------------------------------------------------
CHECKSUM=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')

INTERNAL_NOTES="## Be Right Back v$VERSION (internal build)

Signed and notarized. This release is the internal archive of the build.
It is public only after \`make publish-release\` runs.

\`\`\`
SHA-256: $CHECKSUM  $(basename "$DMG_PATH")
\`\`\`"

# A rebuild of the same version replaces the archived DMG in place, rather than
# deleting the release and creating a new one. A failed create would otherwise
# leave the tag with no archive at all.
if gh release view "v$VERSION" --repo "$INTERNAL_REPO" &>/dev/null; then
    info "Updating internal GitHub release on $INTERNAL_REPO..."
    gh release edit "v$VERSION" --repo "$INTERNAL_REPO" --title "v$VERSION" --notes "$INTERNAL_NOTES"
    gh release upload "v$VERSION" --repo "$INTERNAL_REPO" --clobber "$DMG_PATH"
    ok "Internal release updated on $INTERNAL_REPO"
else
    info "Creating internal GitHub release on $INTERNAL_REPO..."
    gh release create "v$VERSION" \
        --repo "$INTERNAL_REPO" \
        --title "v$VERSION" \
        --notes "$INTERNAL_NOTES" \
        "$DMG_PATH"
    ok "Internal release created on $INTERNAL_REPO"
fi

# ---------------------------------------------------------------------------
# Step 14: Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Release v$VERSION signed and archived!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  DMG:       $DMG_PATH"
echo "  SHA-256:   $CHECKSUM"
echo ""
echo "  Internal:  https://github.com/$INTERNAL_REPO/releases/tag/v$VERSION"
echo ""
echo -e "  ${YELLOW}Nothing is public yet. To ship: make publish-release${NC}"
echo ""

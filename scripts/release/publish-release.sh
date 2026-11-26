#!/usr/bin/env bash
#
# publish-release.sh -- Sync to public repo and create a GitHub release.
#
# Run this AFTER release.sh has signed, notarized, and pushed to the internal
# repo. This script:
#   1. Validates that a notarized DMG exists
#   2. Syncs code to the public repo (via sync-to-public.sh)
#   3. Commits + tags in the public repo
#   4. Creates a GitHub release on the public repo with the DMG attached
#
# Usage: ./scripts/release/publish-release.sh
#        make publish-release
#
# Required env vars:
#   GITHUB_TOKEN or GITHUB_CC_PAT -- for gh release create
#
# Optional env vars:
#   GH_REPO -- target GitHub repo (default: johnlarkin1/be-right-back)

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
# Configuration
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

GH_REPO="${GH_REPO:-johnlarkin1/be-right-back}"
# Same env var and default as sync-to-public.sh. One name for one directory, so
# an override cannot point the sync and the tag at two different checkouts.
PUBLIC_REPO_DIR="${BRB_SYNC_DEST:-$HOME/Documents/coding/be-right-back/code/be-right-back-pub}"

VERSION_FILE="$REPO_ROOT/VERSION"
[[ -f "$VERSION_FILE" ]] || die "VERSION file not found at $VERSION_FILE"
VERSION=$(tr -d '[:space:]' < "$VERSION_FILE")
[[ -z "$VERSION" ]] && die "VERSION file is empty"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid version format: '$VERSION' (expected X.Y.Z)"

# The Cargo workspace shares one target dir at the repo root, so Tauri writes
# bundles to <repo>/target/release/bundle -- same path release.sh staples.
DMG_DIR="$REPO_ROOT/target/release/bundle/dmg"

info "Publishing v$VERSION to $GH_REPO"

# ---------------------------------------------------------------------------
# Step 1: Guard against publishing to internal repo
# ---------------------------------------------------------------------------
if echo "$GH_REPO" | grep -qi 'be-right-back-internal'; then
    die "Refusing to publish release to internal repo. Set GH_REPO to the public repo."
fi

# ---------------------------------------------------------------------------
# Step 2: Validate environment
# ---------------------------------------------------------------------------
info "Validating environment..."

command -v gh >/dev/null 2>&1 || die "Required tool not found: gh"

# GitHub token
GH_TOKEN="${GITHUB_CC_PAT:-${GITHUB_TOKEN:-}}"
[[ -z "$GH_TOKEN" ]] && die "Set GITHUB_TOKEN or GITHUB_CC_PAT for GitHub releases"
export GITHUB_TOKEN="$GH_TOKEN"

command -v xcrun >/dev/null 2>&1 || die "Required tool not found: xcrun"
command -v shasum >/dev/null 2>&1 || die "Required tool not found: shasum"

# The DMG has to be one release.sh built for THIS version. Matching on the name is
# what makes that checkable: the filename carries the version, so a build left over
# from an earlier version cannot be picked up and shipped under this tag. Newest
# first, so a same-version rebuild on a later date wins.
DMG_PATH=$(find "$DMG_DIR" -maxdepth 1 -name "BeRightBack.*.$VERSION.dmg" \
    -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)
[[ -n "$DMG_PATH" ]] || die "No DMG for v$VERSION in $DMG_DIR. Run 'make release' first."
xcrun stapler validate "$DMG_PATH" 2>/dev/null || die "DMG is not notarized. Run 'make release' first."
info "Publishing $(basename "$DMG_PATH")"

# Public repo directory must exist
[[ -d "$PUBLIC_REPO_DIR/.git" ]] || die "Public repo not found at $PUBLIC_REPO_DIR"

# GH_REPO gates only the `gh release` calls. The wipe, the commit, and the push
# below all go to this checkout, so it has to be the same repo -- otherwise both
# internal-repo guards pass while the sync overwrites some other repo entirely.
# Suffix match, not substring: be-right-back-internal contains be-right-back.
PUBLIC_ORIGIN=$(git -C "$PUBLIC_REPO_DIR" remote get-url origin 2>/dev/null) \
    || die "Public repo at $PUBLIC_REPO_DIR has no 'origin' remote"
[[ "${PUBLIC_ORIGIN%.git}" == *"$GH_REPO" ]] \
    || die "Public checkout at $PUBLIC_REPO_DIR points at '$PUBLIC_ORIGIN', not $GH_REPO"

# Checked here rather than next to the commit: sync-to-public.sh wipes the
# destination working tree, so a later branch check leaves a clobbered checkout.
PUBLIC_BRANCH=$(git -C "$PUBLIC_REPO_DIR" rev-parse --abbrev-ref HEAD)
[[ "$PUBLIC_BRANCH" == "main" ]] || die "Public repo is on branch '$PUBLIC_BRANCH', expected 'main'"

ok "Environment validated"

# ---------------------------------------------------------------------------
# Step 3: Sync code to public repo
# ---------------------------------------------------------------------------
info "Syncing code to public repo..."
bash "$REPO_ROOT/scripts/sync-to-public.sh"
ok "Code synced to public repo"

# ---------------------------------------------------------------------------
# Step 4: Commit + tag in public repo
# ---------------------------------------------------------------------------
info "Committing and tagging in public repo..."
cd "$PUBLIC_REPO_DIR"

# Branch and origin were both checked in step 2, before the sync wiped anything.

git add -A
if git diff --cached --quiet; then
    warn "No changes to commit in public repo (already up to date)"
else
    git commit -m "release: v$VERSION"
fi

git push origin main
PUBLIC_SHA=$(git rev-parse HEAD)
ok "Public repo committed and pushed"

# The tag is created in step 5, not here. GitHub makes the tag and the release in
# one call, so a failure there cannot leave a public tag with no release behind.

# Return to repo root for DMG path resolution
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Step 5: Create GitHub release
# ---------------------------------------------------------------------------
CHECKSUM=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
DMG_NAME=$(basename "$DMG_PATH")

# GitHub resolves /releases/latest/download/<name> by exact asset name, so the dated
# DMG on its own would 404 the link the website hardcodes. Upload a copy under the
# fixed name as well. Byte-identical, so the stapled ticket and checksum carry over.
STABLE_DIR=$(mktemp -d)
trap 'rm -rf "$STABLE_DIR"' EXIT
STABLE_DMG="$STABLE_DIR/BeRightBack.dmg"
cp "$DMG_PATH" "$STABLE_DMG"

RELEASE_NOTES="## Be Right Back v$VERSION

### Download

- [BeRightBack.dmg](https://github.com/$GH_REPO/releases/latest/download/BeRightBack.dmg) -- stable link, always the newest release
- \`$DMG_NAME\` -- this build, by date and version

Both assets are the same image.

### Checksums

\`\`\`
SHA-256: $CHECKSUM
\`\`\`

### Requirements

- macOS 12.0+ (Monterey or later)
- Apple Silicon (M1/M2/M3/M4)
- 8GB+ RAM"

if gh release view "v$VERSION" --repo "$GH_REPO" &>/dev/null; then
    warn "Release v$VERSION already exists on $GH_REPO -- updating it"
    # Only here does the tag move, and the release already exists, so there is no
    # point at which the tag is published without one.
    git -C "$PUBLIC_REPO_DIR" tag -f "v$VERSION" -m "Release v$VERSION"
    git -C "$PUBLIC_REPO_DIR" push -f origin "v$VERSION"
    gh release edit "v$VERSION" --repo "$GH_REPO" --title "v$VERSION" --notes "$RELEASE_NOTES"
    gh release upload "v$VERSION" --repo "$GH_REPO" --clobber "$DMG_PATH" "$STABLE_DMG"
    ok "Release updated on $GH_REPO"
else
    info "Creating GitHub release on $GH_REPO..."
    # --target creates the tag server side, together with the release.
    gh release create "v$VERSION" \
        --repo "$GH_REPO" \
        --target "$PUBLIC_SHA" \
        --title "v$VERSION" \
        --notes "$RELEASE_NOTES" \
        "$DMG_PATH" "$STABLE_DMG"
    ok "Release created on $GH_REPO"
fi

# ---------------------------------------------------------------------------
# Step 6: Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Release v$VERSION published!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  DMG:       $DMG_PATH"
echo "  SHA-256:   $CHECKSUM"
echo ""
echo "  Release:   https://github.com/$GH_REPO/releases/tag/v$VERSION"
echo ""
echo "  Stable download URL:"
echo "  https://github.com/$GH_REPO/releases/latest/download/BeRightBack.dmg"
echo ""

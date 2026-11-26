#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# sync-to-public.sh
#
# Copies the committed tree of this repo (HEAD) to the public repo checkout.
# Every tracked file goes, so the public repo holds the full source. Before it
# copies anything, a privacy check refuses trees that hold real phone numbers
# or known private paths.
#
# Usage:
#   bash scripts/sync-to-public.sh            # Execute sync
#   bash scripts/sync-to-public.sh --dry-run  # Preview only
# ──────────────────────────────────────────────────────────────────────────────

START_TIME=$(date +%s)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Paths
# SRC defaults to the repo this script lives in, so the sync always publishes the
# working tree you ran it from. Override either path via env var if needed.
SRC="${BRB_SYNC_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"
DEST="${BRB_SYNC_DEST:-$HOME/Documents/coding/be-right-back/code/be-right-back-pub}"

# Flags
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
fi

# Helpers
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[DRY]${NC}  $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }

run() {
    if $DRY_RUN; then
        warn "$*"
    else
        eval "$@"
    fi
}

# ── Step 1: Validate ─────────────────────────────────────────────────────────

info "Validating environment..."

if [[ ! -d "$SRC/.git" ]]; then
    error "Source is not a git repo: $SRC"
    exit 1
fi

if [[ ! -d "$DEST/.git" ]]; then
    error "Destination is not a git repo: $DEST"
    error "Set BRB_SYNC_DEST to the public repo checkout if it lives elsewhere."
    exit 1
fi

# Never publish source without its license. This is a hard stop, not a warning:
# the public repo is the only place these terms reach anyone downstream.
if [[ ! -f "$SRC/LICENSE" ]]; then
    error "No LICENSE at $SRC/LICENSE — refusing to publish unlicensed source."
    exit 1
fi

# Safety: make sure we're not running from inside the destination repo
CURRENT_DIR="$(pwd)"
if [[ "$CURRENT_DIR" == "$DEST"* ]]; then
    error "Cannot run from inside the destination repo: $CURRENT_DIR"
    exit 1
fi

info "Source:      $SRC"
info "Destination: $DEST"
if $DRY_RUN; then
    warn "DRY RUN MODE — no changes will be made"
fi
echo ""


# Only committed files are published. Uncommitted edits would not reach the
# public repo, so a dirty tree is almost always a mistake.
if [[ -n "$(git -C "$SRC" status --porcelain)" ]]; then
    error "Source has uncommitted changes. Commit or stash them first."
    exit 1
fi

# ── Step 2: Privacy check ────────────────────────────────────────────────────
#
# The public repo must never hold real messages, contact names, or phone
# numbers (see AGENTS.md). Test data uses 555 numbers. Any other North American
# number in a tracked text file stops the sync.

info "Checking the tree for private data..."
PRIVATE_PATHS=("docs/archive/casper-improvements" "persona-sprint" "claude" "brb-data")
for path in "${PRIVATE_PATHS[@]}"; do
    if git -C "$SRC" ls-files --error-unmatch "$path" >/dev/null 2>&1 \
        || [[ -n "$(git -C "$SRC" ls-files "$path")" ]]; then
        error "Private path is tracked: $path"
        exit 1
    fi
done
PHONE_HITS=$(git -C "$SRC" grep -nIE '\+1[2-9][0-9]{2}[0-9]{7}' -- . ':!*.lock' ':!package-lock.json' \
    | grep -vE '\+1[0-9]{3}555[0-9]{4}' || true)
if [[ -n "$PHONE_HITS" ]]; then
    error "Tracked files hold phone numbers that are not 555 test numbers:"
    echo "$PHONE_HITS" | cut -d: -f1,2 >&2
    exit 1
fi
success "No private paths or real phone numbers"
echo ""

# ── Step 3: Replace the destination tree (preserve .git) ─────────────────────

info "Replacing destination tree with HEAD ($(git -C "$SRC" rev-parse --short HEAD))..."
if ! $DRY_RUN; then
    find "$DEST" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
    git -C "$SRC" archive --format=tar HEAD | tar -x -C "$DEST"
fi
success "Destination holds every tracked file"
echo ""

# Used by the corpus step below: rsync does not honour .gitignore.
PUBLIC_DIR_EXCLUDES="--exclude '.venv/' --exclude 'build/' --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude '.ruff_cache/' --exclude '.mypy_cache/' --exclude '*.egg-info/' --exclude '*.pyc'"

# ── Step 4: Publish the corpus as a standalone dataset repo ─────────────────
#
# The same corpus goes to two places because it is two things.
#
# In the app mirror (Step 3) it is *source*: the generator that produces the
# demo and eval data, sitting next to the crate whose SQL it verifies against.
#
# Here it is a *dataset*: a citable eval set with its own audience, its own
# license, and its own release cadence. An eval set buried in an application
# repo is not one anybody finds or cites, which is the entire point of
# publishing it -- no public benchmark covers multi-contact, person-scoped
# retrieval over group-and-DM message logs, so this is the only artifact that
# measures the axis the product is differentiated on.
#
# The built databases ship, not just the recipe. Regenerating needs uv and
# imessage-data-foundry, which is a wall for anyone who only wants the data.
# That is safe to do because `make synthetic-build` pins the anchor: the build
# is byte-reproducible from world/, so the shipped artifact and the recipe
# cannot silently disagree. (Before the anchor was pinned it defaulted to
# "today" and this would have been a lie.)
#
# verify.py ships too, despite reading the app's SQL out of crates/messages-db
# at runtime. Dropping it is not an option — cli.py imports it unconditionally,
# so a copy without it will not even import — and it is not the right call
# either: messages-db ships in the app mirror, so `verify --repo-root <app mirror>`
# genuinely works, and without a checkout it fails with a clear VerificationError
# naming the file it wanted.

CORPUS_DEST="${BRB_SYNC_CORPUS_DEST:-$HOME/Documents/coding/be-right-back/code/be-right-back-corpus}"
CORPUS_BUILD="$SRC/synthetic/build"

info "Publishing standalone corpus dataset..."
if [[ ! -d "$CORPUS_DEST/.git" ]]; then
    warn "  $CORPUS_DEST is not a git repo — skipping corpus publish"
    warn "  (create it first: gh repo create be-right-back-corpus --public)"
elif [[ ! -f "$CORPUS_BUILD/build-manifest.json" ]]; then
    error "  $CORPUS_BUILD has no build — run 'make synthetic-build' before syncing"
    exit 1
else
    # Show what is about to be published. A corpus rebuilt on a different anchor
    # renumbers every ROWID and invalidates every gold key downstream, so the
    # anchor is the one field worth reading before pushing.
    info "  publishing corpus built at anchor $(grep -o '"anchor": *"[^"]*"' "$CORPUS_BUILD/build-manifest.json" | cut -d'"' -f4)"

    # Replace only the paths this script owns. The corpus repo keeps its own
    # LICENSE, CITATION.cff, .github/ and release notes, which a full wipe of
    # the destination (as Step 3 does for the app mirror) would destroy.
    for owned in world generator data README.md; do
        run "rm -rf '$CORPUS_DEST/$owned'"
    done

    # The authored manifest: the source of truth for every message in the corpus.
    run "mkdir -p '$CORPUS_DEST/world' && rsync -a '$SRC/synthetic/world/' '$CORPUS_DEST/world/'"

    # The generator, so the artifact is reproducible rather than trust-me data.
    run "mkdir -p '$CORPUS_DEST/generator'"
    run "rsync -a $PUBLIC_DIR_EXCLUDES '$SRC/synthetic/src/' '$CORPUS_DEST/generator/src/'"
    run "cp '$SRC/synthetic/pyproject.toml' '$CORPUS_DEST/generator/pyproject.toml'"

    # The built corpus and the gold set — what most consumers actually want.
    run "mkdir -p '$CORPUS_DEST/data'"
    for artifact in chat_snapshot.db addressbook_snapshot.db gold.resolved.jsonl build-manifest.json; do
        run "cp '$CORPUS_BUILD/$artifact' '$CORPUS_DEST/data/$artifact'"
    done

    # The dataset's front page lives next to the data it describes.
    run "cp '$SRC/synthetic/README_CORPUS.md' '$CORPUS_DEST/README.md'"

    success "  $CORPUS_DEST"
fi
echo ""


# ── Step 5: Summary ──────────────────────────────────────────────────────────

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Sync complete!${NC} (${ELAPSED}s)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  cd $DEST"
echo "  git status"
echo "  git add -A && git commit -m 'Sync from private repo'"
if [[ -d "$CORPUS_DEST/.git" ]]; then
    echo ""
    echo "  cd $CORPUS_DEST"
    echo "  git status"
    echo "  git add -A && git commit -m 'Sync corpus from private repo'"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

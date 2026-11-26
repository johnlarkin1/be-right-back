#!/bin/bash

# Copy MLX scripts from repo root to Tauri resources
# This allows development at repo root while bundling into the app

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources/mlx"
SOURCE_DIR="$SCRIPT_DIR/../../../../mlx"

echo "copying MLX scripts to resources..."

if [ ! -d "$SOURCE_DIR" ]; then
    echo "source directory not found: $SOURCE_DIR"
    exit 1
fi

mkdir -p "$RESOURCES_DIR"
echo "copying python src/ directory..."
rsync -a --delete "$SOURCE_DIR/src/" "$RESOURCES_DIR/src/"


echo "copying pyproject.toml..."
cp "$SOURCE_DIR/pyproject.toml" "$RESOURCES_DIR/"

# Hard requirement, not best-effort. Without the lock, first-run setup falls back to an
# unpinned resolve and every user gets whatever PyPI served that day -- the exact problem
# `uv sync --frozen` exists to prevent. A bundle missing it is a broken bundle, so fail here
# at build time rather than shipping it and finding out on someone else's machine.
if [ ! -f "$SOURCE_DIR/uv.lock" ]; then
    echo "error: $SOURCE_DIR/uv.lock is missing -- refusing to build an unpinned bundle" >&2
    exit 1
fi
echo "copying uv.lock..."
cp "$SOURCE_DIR/uv.lock" "$RESOURCES_DIR/"

if [ -f "$SOURCE_DIR/README.md" ]; then
    echo "copying README.md..."
    cp "$SOURCE_DIR/README.md" "$RESOURCES_DIR/"
fi

echo "MLX scripts copied successfully"
echo "   source: $SOURCE_DIR"
echo "   destination: $RESOURCES_DIR"
echo "   files copied:"
ls -lh "$RESOURCES_DIR" | tail -n +2

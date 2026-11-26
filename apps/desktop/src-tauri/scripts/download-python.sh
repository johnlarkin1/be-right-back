#!/bin/bash

# Download standalone Python for macOS arm64
# Uses python-build-standalone by astral-sh (formerly indygreg)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources/binaries"
PYTHON_DIR="$RESOURCES_DIR/python"

# Python version to download
# NOTE: Keep in sync with `requires-python` in mlx/pyproject.toml
PYTHON_VERSION="3.13.9"
RELEASE_DATE="20251031"
PYTHON_ARCHIVE="cpython-${PYTHON_VERSION}+${RELEASE_DATE}-aarch64-apple-darwin-install_only.tar.gz"
DOWNLOAD_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_DATE}/${PYTHON_ARCHIVE}"

echo "downloading standalone python ${PYTHON_VERSION}..."

# Skip if already downloaded
if [ -f "$PYTHON_DIR/bin/python3" ]; then
    echo "python already downloaded"
    echo "   location: $PYTHON_DIR"
    echo "   version: $($PYTHON_DIR/bin/python3 --version)"
    exit 0
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "downloading from github..."
echo "   url: $DOWNLOAD_URL"
curl -L --progress-bar "$DOWNLOAD_URL" -o "$TEMP_DIR/python.tar.gz"

echo "extracting archive..."
mkdir -p "$PYTHON_DIR"
tar -xzf "$TEMP_DIR/python.tar.gz" -C "$PYTHON_DIR" --strip-components=1

if [ -f "$PYTHON_DIR/bin/python3" ]; then
    echo "python downloaded successfully"
    echo "   location: $PYTHON_DIR"
    echo "   version: $($PYTHON_DIR/bin/python3 --version)"
else
    echo "failed to extract python"
    exit 1
fi

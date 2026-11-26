#!/bin/bash

# Download uv package installer for macOS arm64
# https://github.com/astral-sh/uv

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../resources/binaries"
UV_PATH="$RESOURCES_DIR/uv"

# uv version to download
UV_VERSION="0.9.10"
DOWNLOAD_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz"

echo "downloading uv ${UV_VERSION}..."

# Skip if already downloaded
if [ -f "$UV_PATH" ]; then
    echo "uv already downloaded"
    echo "   location: $UV_PATH"
    echo "   version: $($UV_PATH --version)"
    exit 0
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "downloading from github..."
echo "   url: $DOWNLOAD_URL"
curl -L --progress-bar "$DOWNLOAD_URL" -o "$TEMP_DIR/uv.tar.gz"

echo "extracting archive..."
tar -xzf "$TEMP_DIR/uv.tar.gz" -C "$TEMP_DIR"

echo "installing binary..."
mkdir -p "$RESOURCES_DIR"
mv "$TEMP_DIR/uv-aarch64-apple-darwin/uv" "$UV_PATH"
chmod +x "$UV_PATH"

if [ -f "$UV_PATH" ]; then
    echo "uv downloaded successfully"
    echo "   location: $UV_PATH"
    echo "   version: $($UV_PATH --version)"
else
    echo "failed to extract uv"
    exit 1
fi

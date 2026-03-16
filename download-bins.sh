#!/bin/bash
# download-bins.sh — Download pre-built acestep.cpp binaries from a GitHub release.
#
# Downloads ace-lm, ace-synth, ace-understand, neural-codec and their shared
# libraries into the bin/ directory.  Always replaces existing files so the
# script can be used both for first-time installation and to update binaries.
#
# Usage: ./download-bins.sh [options]
#   --version TAG   Release tag to download  (default: $BINARY_VERSION or v0.0.2)
#   --bin DIR       Target directory         (default: $ACESTEP_BIN_DIR or ./bin)
#
# Environment variables (override defaults):
#   BINARY_VERSION   acestep.cpp release tag, e.g. v0.0.2
#   ACESTEP_BIN_DIR  path to the bin/ directory
#
# Supported platforms / archives (audiohacking/acestep.cpp releases):
#   macOS  arm64   → acestep-macos-arm64-metal.tar.gz
#   Linux  x86_64  → acestep-linux-x64.tar.gz
#
# Windows: use download-bins.bat

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${ACESTEP_BIN_DIR:-$SCRIPT_DIR/bin}"
VERSION="${BINARY_VERSION:-v0.0.2}"
REPO="audiohacking/acestep.cpp"

# ── Parse arguments ───────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --bin)     BIN_DIR="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; echo "Usage: $0 [--version TAG] [--bin DIR]" >&2; exit 1 ;;
    esac
done

# ── Detect platform and map to archive name ───────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin)
        if [ "$ARCH" = "arm64" ]; then
            ARCHIVE="acestep-macos-arm64-metal.tar.gz"
        else
            echo "Error: Unsupported macOS architecture: $ARCH" >&2
            echo "Only Apple Silicon (arm64) is supported by pre-built releases." >&2
            exit 1
        fi
        ;;
    Linux)
        if [ "$ARCH" = "x86_64" ]; then
            ARCHIVE="acestep-linux-x64.tar.gz"
        else
            echo "Error: Unsupported Linux architecture: $ARCH" >&2
            echo "Only x86_64 is supported by pre-built releases." >&2
            exit 1
        fi
        ;;
    *)
        echo "Error: Unsupported platform: $OS" >&2
        echo "Use download-bins.bat on Windows." >&2
        exit 1
        ;;
esac

URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE}"

echo "=========================================="
echo "  Downloading acestep.cpp binaries"
echo "=========================================="
echo ""
echo "  Version : $VERSION"
echo "  Platform: $OS / $ARCH"
echo "  Archive : $ARCHIVE"
echo "  Dest    : $BIN_DIR"
echo ""

mkdir -p "$BIN_DIR"
TMP_ARCHIVE="$(mktemp -t download-bins-XXXXXX).tar.gz"
trap 'rm -f "$TMP_ARCHIVE"' EXIT

# ── Download ──────────────────────────────────────────────────────────────────
echo "Downloading: $URL"
if command -v curl &>/dev/null; then
    curl -fSL --retry 3 --progress-bar "$URL" -o "$TMP_ARCHIVE"
elif command -v wget &>/dev/null; then
    wget -q --show-progress --tries=3 "$URL" -O "$TMP_ARCHIVE"
else
    echo "Error: curl or wget is required to download binaries." >&2
    exit 1
fi
echo ""

# ── Extract ───────────────────────────────────────────────────────────────────
echo "Extracting to $BIN_DIR/ ..."
tar -xzf "$TMP_ARCHIVE" -C "$BIN_DIR/"
echo ""

# ── Fix permissions ───────────────────────────────────────────────────────────
for name in ace-lm ace-synth ace-understand neural-codec; do
    bin_path="$BIN_DIR/$name"
    if [ -f "$bin_path" ]; then
        chmod +x "$bin_path"
        echo "✅  $name"
    fi
done

# ── Linux: create versioned soname symlinks ────────────────────────────────────
# The archive ships libggml.so / libggml-base.so (unversioned) but ELFs link
# against the versioned sonames libggml.so.0 / libggml-base.so.0.
if [ "$OS" = "Linux" ]; then
    echo ""
    echo "Creating soname symlinks (Linux) ..."
    for pair in "libggml.so:libggml.so.0" "libggml-base.so:libggml-base.so.0"; do
        real="${pair%%:*}"
        soname="${pair##*:}"
        real_path="$BIN_DIR/$real"
        if [ -f "$real_path" ]; then
            (cd "$BIN_DIR" && ln -svf "$real" "$soname")
        fi
    done
fi

echo ""
echo "=========================================="
echo "  Binaries ready in $BIN_DIR/"
echo "=========================================="
echo ""
echo "  bin/ contents:"
ls -lh "$BIN_DIR/" | awk 'NR>1 {print "    " $0}'
echo ""

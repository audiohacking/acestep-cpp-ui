#!/bin/bash
# Build acestep.cpp with hardware-accelerated GPU support.
# Automatically detects CUDA (NVIDIA), ROCm/HIP (AMD), Vulkan, and Metal (macOS).
# Called automatically by start.sh on first launch — or run manually to rebuild.
#
# Usage: ./build.sh [options]
#   --src DIR      acestep.cpp source directory (default: ./acestep.cpp)
#   --bin DIR      directory to install binaries into (default: ./bin)
#   --cuda         force CUDA build
#   --rocm         force ROCm/HIP build
#   --vulkan       force Vulkan build
#   --cpu          CPU-only build (disable GPU auto-detection)
#   --repo URL     override the git repository to clone (env: ACESTEP_CPP_REPO)
#   --branch NAME  checkout a specific branch/tag after cloning (env: ACESTEP_CPP_BRANCH)

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="${ACESTEP_CPP_SRC:-$DIR/acestep.cpp}"
BIN_DIR="${ACESTEP_BIN_DIR:-$DIR/bin}"
BUILD_DIR="$SRC_DIR/build"
REPO="${ACESTEP_CPP_REPO:-https://github.com/audiohacking/acestep.cpp.git}"
BRANCH="${ACESTEP_CPP_BRANCH:-}"
FORCE_FLAGS=""
CPU_ONLY=0

# ── Parse arguments ───────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --src)    SRC_DIR="$2"; BUILD_DIR="$SRC_DIR/build"; shift ;;
        --bin)    BIN_DIR="$2"; shift ;;
        --repo)   REPO="$2"; shift ;;
        --branch) BRANCH="$2"; shift ;;
        --cuda)   FORCE_FLAGS="-DGGML_CUDA=ON" ;;
        --rocm)   FORCE_FLAGS="-DGGML_HIP=ON" ;;
        --vulkan) FORCE_FLAGS="-DGGML_VULKAN=ON" ;;
        --cpu)    CPU_ONLY=1 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

echo "========================================"
echo "  Building acestep.cpp"
echo "========================================"
echo ""

# ── Check required tools ──────────────────────────────────────────────────────
missing=""
command -v cmake &>/dev/null || missing="$missing cmake"
command -v git   &>/dev/null || missing="$missing git"
if [ -n "$missing" ]; then
    echo "Error: the following required tools are missing:$missing"
    echo ""
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "  Install with: brew install$missing"
    else
        echo "  Install with: sudo apt-get install$missing  (Debian/Ubuntu)"
        echo "           OR:  sudo dnf install$missing      (Fedora/RHEL)"
    fi
    exit 1
fi

# ── Clone or update acestep.cpp ───────────────────────────────────────────────
if [ ! -d "$SRC_DIR/.git" ]; then
    if [ -n "$BRANCH" ]; then
        echo "Cloning acestep.cpp from $REPO (branch: $BRANCH) ..."
        git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC_DIR"
    else
        echo "Cloning acestep.cpp from $REPO ..."
        git clone --depth 1 "$REPO" "$SRC_DIR"
    fi
    echo ""
else
    echo "acestep.cpp source found at $SRC_DIR"
fi

echo "Initializing submodules..."
cd "$SRC_DIR"
git submodule update --init --recursive --depth 1
cd "$DIR"
echo ""

# ── Detect hardware and set cmake flags ───────────────────────────────────────
if [ "$CPU_ONLY" -eq 1 ]; then
    CMAKE_FLAGS=""
    echo "CPU-only build requested — skipping GPU detection"
elif [ -n "$FORCE_FLAGS" ]; then
    CMAKE_FLAGS="$FORCE_FLAGS"
    echo "Using forced cmake flags: $CMAKE_FLAGS"
elif [[ "$(uname)" == "Darwin" ]]; then
    CMAKE_FLAGS=""
    echo "Platform: macOS — Metal + Accelerate BLAS auto-detected by cmake"
else
    CMAKE_FLAGS=""

    # CUDA (NVIDIA)
    if command -v nvcc &>/dev/null || [ -d /usr/local/cuda ] || [ -d /usr/cuda ]; then
        CMAKE_FLAGS="$CMAKE_FLAGS -DGGML_CUDA=ON"
        echo "Detected: CUDA (NVIDIA GPU)"
    fi

    # ROCm/HIP (AMD)
    if command -v hipcc &>/dev/null || [ -d /opt/rocm ]; then
        CMAKE_FLAGS="$CMAKE_FLAGS -DGGML_HIP=ON"
        echo "Detected: ROCm/HIP (AMD GPU)"
    fi

    # Vulkan
    if pkg-config --exists vulkan 2>/dev/null || command -v vulkaninfo &>/dev/null; then
        CMAKE_FLAGS="$CMAKE_FLAGS -DGGML_VULKAN=ON"
        echo "Detected: Vulkan GPU"
    fi

    # OpenBLAS (CPU math acceleration — can coexist with GPU backends)
    if pkg-config --exists openblas 2>/dev/null; then
        CMAKE_FLAGS="$CMAKE_FLAGS -DGGML_BLAS=ON"
        echo "Detected: OpenBLAS"
    fi

    [ -z "$CMAKE_FLAGS" ] && echo "No GPU accelerator detected — CPU-only build"
fi

echo ""
echo "cmake flags: ${CMAKE_FLAGS:-<none>}"
echo ""

# ── Configure ─────────────────────────────────────────────────────────────────
# shellcheck disable=SC2086
cmake -S "$SRC_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    $CMAKE_FLAGS

# ── Build ─────────────────────────────────────────────────────────────────────
cmake --build "$BUILD_DIR" --parallel

# ── Copy binaries to bin/ ─────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
copied=0
for name in ace-lm ace-synth ace-understand neural-codec; do
    found=$(find "$BUILD_DIR" -name "$name" -type f 2>/dev/null | head -1)
    if [ -n "$found" ]; then
        cp "$found" "$BIN_DIR/$name"
        chmod +x "$BIN_DIR/$name"
        echo "✅ $name → $BIN_DIR/$name"
        copied=$((copied + 1))
    else
        echo "⚠️  $name not found in build output — binary may have a different name"
    fi
done

echo ""
if [ "$copied" -gt 0 ]; then
    echo "Build complete! $copied binaries installed to $BIN_DIR/"
else
    echo "Error: build completed but no binaries were found in $BUILD_DIR/."
    echo "Check the cmake output above for errors."
    exit 1
fi

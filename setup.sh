#!/bin/bash
# ACE-Step UI Setup Script (acestep-cpp edition)
set -e

echo "=================================="
echo "  ACE-Step UI Setup"
echo "=================================="
echo ""

# ── Check for Node.js ────────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo "Error: Node.js >= 20 is required."
  echo "Install from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js >= 20 required (found $(node -v))."
  exit 1
fi

echo "Node.js $(node -v) ✓"

# ── Check for curl / wget ────────────────────────────────────────────────────
if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
  echo "Warning: curl or wget required to download models."
  echo "  sudo apt install curl  OR  brew install curl"
fi

# ── Build acestep.cpp if binaries are not present ────────────────────────────
ACESTEP_BIN_DIR="${ACESTEP_BIN_DIR:-bin}"
if [ -x "$ACESTEP_BIN_DIR/ace-lm" ] && [ -x "$ACESTEP_BIN_DIR/ace-synth" ]; then
  echo "acestep.cpp binaries: $ACESTEP_BIN_DIR/ ✓"
elif [ -n "${ACESTEP_BIN:-}" ] && [ -x "$ACESTEP_BIN" ]; then
  echo "acestep-generate: $ACESTEP_BIN ✓"
else
  echo ""
  echo "No acestep.cpp binaries found in $ACESTEP_BIN_DIR/."
  echo ""
  echo "Choose how to obtain them:"
  echo "  1) Download pre-built binaries (recommended — fast, no compiler required)"
  echo "  2) Build from source          (requires cmake + git; supports any GPU)"
  echo "  3) Skip                       (set ACESTEP_BIN_DIR manually and re-run)"
  echo ""
  printf "Enter choice [1/2/3, default=1]: "
  read -r BIN_CHOICE < /dev/tty || BIN_CHOICE="1"
  BIN_CHOICE="${BIN_CHOICE:-1}"

  case "$BIN_CHOICE" in
    1)
      echo ""
      echo "Downloading pre-built binaries..."
      bash download-bins.sh || {
        echo ""
        echo "  Download failed. Try building from source instead:"
        echo "    bash build.sh"
        echo "  Or download manually from https://github.com/audiohacking/acestep.cpp/releases"
        echo ""
      }
      ;;
    2)
      echo ""
      echo "Building acestep.cpp for your hardware (detects GPU automatically)..."
      echo "  Repo:   ${ACESTEP_CPP_REPO:-https://github.com/audiohacking/acestep.cpp.git}"
      [ -n "${ACESTEP_CPP_BRANCH:-}" ] && echo "  Branch: $ACESTEP_CPP_BRANCH"
      echo ""
      bash build.sh || {
        echo ""
        echo "  Automatic build failed. You can build manually:"
        echo "    git clone https://github.com/audiohacking/acestep.cpp"
        echo "    cmake -S acestep.cpp -B acestep.cpp/build -DCMAKE_BUILD_TYPE=Release"
        echo "    cmake --build acestep.cpp/build --parallel"
        echo "  Then set ACESTEP_BIN_DIR=$(pwd)/bin in .env"
        echo ""
        echo "  Or download pre-built binaries: bash download-bins.sh"
        echo ""
      }
      ;;
    *)
      echo ""
      echo "Skipping binary setup."
      echo "  Run './download-bins.sh' or './build.sh' when ready."
      echo ""
      ;;
  esac
fi

# ── Download GGUF models ─────────────────────────────────────────────────────
MODELS_DIR_INIT="${MODELS_DIR:-models}"
if [ -d "$MODELS_DIR_INIT" ] && ls "$MODELS_DIR_INIT"/*.gguf &>/dev/null 2>&1; then
  echo "Models already present in $MODELS_DIR_INIT/ ✓"
else
  echo ""
  echo "Downloading default GGUF models (Q8_0 essentials)..."
  echo "  VAE + Text Encoder + LM-4B + DiT-Turbo (~8 GB)"
  echo ""
  echo "  Tip: press Ctrl-C to skip and run ./models.sh manually later,"
  echo "       or download from the Models tab in the UI after starting."
  echo ""
  bash models.sh || echo "  Model download skipped — run ./models.sh when ready."
fi

# ── Create .env ───────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "  ✓ .env created (binaries and models are auto-detected — no edits needed)"
else
  echo ".env already exists ✓"
fi

# ── Install dependencies ──────────────────────────────────────────────────────
echo ""
echo "Installing frontend dependencies..."
npm install

echo ""
echo "Installing server dependencies..."
cd server && npm install && cd ..

echo ""
echo "Building better-sqlite3 for your platform..."
(cd server && npm rebuild better-sqlite3) || {
  echo "Warning: Could not rebuild better-sqlite3 from source."
  echo "  If the app fails to start, install build tools and run:"
  echo "    cd server && npm rebuild better-sqlite3"
}

# ── Create runtime dirs ───────────────────────────────────────────────────────
mkdir -p data public/audio logs

echo ""
echo "=================================="
echo "  Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "  1. Run ./start-all.sh"
echo "  2. Open http://localhost:3001"
echo "  3. Use the Models tab to download/manage GGUF files"
echo "     (or run ./models.sh to download them now)"
echo ""
echo "Tip: binaries and models are auto-detected — no .env edits needed"
echo "     unless you want to override default paths."
echo ""

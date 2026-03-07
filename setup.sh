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

# ── Check for acestep.cpp binary ─────────────────────────────────────────────
if [ -n "${ACESTEP_BIN:-}" ] && [ -x "$ACESTEP_BIN" ]; then
  echo "acestep-generate: $ACESTEP_BIN ✓"
else
  echo ""
  echo "Note: ACESTEP_BIN is not set."
  echo "  Build acestep.cpp and set ACESTEP_BIN before generating music:"
  echo ""
  echo "    git clone https://github.com/audiohacking/acestep.cpp"
  echo "    cmake -S acestep.cpp -B acestep.cpp/build -DCMAKE_BUILD_TYPE=Release"
  echo "    cmake --build acestep.cpp/build --parallel"
  echo "    export ACESTEP_BIN=\$(pwd)/acestep.cpp/build/bin/acestep-generate"
  echo ""
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
  echo "  ✓ .env created — edit it to set ACESTEP_BIN and ACESTEP_MODEL"
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

# ── Create runtime dirs ───────────────────────────────────────────────────────
mkdir -p data public/audio logs

echo ""
echo "=================================="
echo "  Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo "  1. Edit .env — set ACESTEP_BIN and ACESTEP_MODEL"
echo "  2. Run ./start-all.sh"
echo "  3. Open http://localhost:3001"
echo "  4. Use the Models tab to download/manage GGUF files"
echo ""

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

# ── Check for these.cpp binary ───────────────────────────────────────────────
if [ -n "$ACESTEP_BIN" ] && [ -x "$ACESTEP_BIN" ]; then
  echo "acestep-generate: $ACESTEP_BIN ✓"
elif [ -n "$ACESTEP_BIN" ]; then
  echo "Warning: ACESTEP_BIN=$ACESTEP_BIN is not executable."
else
  echo ""
  echo "Note: ACESTEP_BIN is not set."
  echo "  Build acestep.cpp and set ACESTEP_BIN before generating music:"
  echo ""
  echo "    git clone https://github.com/ServeurpersoCom/acestep.cpp"
  echo "    cmake -S acestep.cpp -B acestep.cpp/build -DCMAKE_BUILD_TYPE=Release"
  echo "    cmake --build acestep.cpp/build --parallel"
  echo "    export ACESTEP_BIN=\$(pwd)/acestep.cpp/build/bin/acestep-generate"
  echo ""
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
echo "Edit .env and set:"
echo "  ACESTEP_BIN   = /path/to/acestep-generate"
echo "  ACESTEP_MODEL = /path/to/model.gguf"
echo ""
echo "Then start with:"
echo "  ./start-all.sh"
echo "  # or individually:"
echo "  cd server && npm run dev   # API server (port 3001)"
echo "  npm run dev                # UI (port 5173)"
echo ""

#!/bin/bash
# ACE-Step UI Setup Script (acestep-cpp edition)
set -e

echo "=================================="
echo "  ACE-Step UI Setup"
echo "=================================="

# -----------------------------------------------------------------------
# Check for acestep.cpp build
# -----------------------------------------------------------------------
ACESTEP_CPP_DIR="${ACESTEP_CPP_DIR:-../acestep.cpp}"
ACESTEP_BIN_DEFAULT="$ACESTEP_CPP_DIR/build/bin/acestep-generate"

if [ ! -d "$ACESTEP_CPP_DIR" ]; then
  echo ""
  echo "Warning: acestep.cpp not found at $ACESTEP_CPP_DIR"
  echo ""
  echo "Please build it first:"
  echo "  git clone https://github.com/ServeurpersoCom/acestep.cpp ../acestep.cpp"
  echo "  cd ../acestep.cpp"
  echo "  cmake -B build -DCMAKE_BUILD_TYPE=Release"
  echo "  cmake --build build -j\$(nproc)"
  echo "  cd ../acestep-cpp-ui"
  echo ""
  echo "Then run ./setup.sh again."
  echo ""
  # Continue anyway so UI dependencies get installed
fi

# -----------------------------------------------------------------------
# Build the C++ generation server
# -----------------------------------------------------------------------
echo ""
echo "Building C++ generation server..."
if [ -d "backend" ]; then
  cd backend
  set -o pipefail
  cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DACESTEP_CPP_DIR="$(cd "$ACESTEP_CPP_DIR" 2>/dev/null && pwd || echo "$ACESTEP_CPP_DIR")" \
    -S .
  cmake --build build --parallel
  cd ..
  echo "C++ server built: backend/build/acestep-server"
else
  echo "Warning: backend/ directory not found, skipping C++ server build"
fi

# -----------------------------------------------------------------------
# Create .env file
# -----------------------------------------------------------------------
if [ ! -f ".env" ]; then
  echo ""
  echo "Creating .env file..."
  cp .env.example .env
  echo "Created .env from .env.example"
  echo ""
  echo "IMPORTANT: Edit .env and set:"
  echo "  ACESTEP_BIN   = path to your acestep-generate binary"
  echo "  ACESTEP_MODEL = path to your GGUF model file"
  echo ""
fi

# -----------------------------------------------------------------------
# Install Node.js dependencies
# -----------------------------------------------------------------------
echo ""
echo "Installing frontend dependencies..."
npm install

echo ""
echo "Installing server dependencies..."
cd server && npm install && cd ..

echo ""
echo "=================================="
echo "  Setup Complete!"
echo "=================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Start the C++ generation server:"
echo "       ACESTEP_BIN=/path/to/acestep-generate \\"
echo "       ACESTEP_MODEL=/path/to/model.gguf \\"
echo "       ./backend/build/acestep-server"
echo ""
echo "  2. In a second terminal — start the Node.js backend:"
echo "       cd server && npm run dev"
echo ""
echo "  3. In a third terminal — start the frontend:"
echo "       npm run dev"
echo ""
echo "Then open http://localhost:5173"
echo ""

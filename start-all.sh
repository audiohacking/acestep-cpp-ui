#!/bin/bash
# ACE-Step UI — build frontend and start the unified server
# The Node.js server serves both the API and the compiled React UI.
set -e

echo "=================================="
echo "  ACE-Step UI"
echo "=================================="
echo ""

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ]; then
  echo "Error: dependencies not installed. Run ./setup.sh first."
  exit 1
fi

if [ -f ".env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

# ── Binary auto-detection hint ────────────────────────────────────────────────
BIN_DIR="${ACESTEP_BIN_DIR:-bin}"
if [ -x "$BIN_DIR/ace-lm" ] && [ -x "$BIN_DIR/ace-synth" ]; then
  echo "acestep.cpp binaries: $BIN_DIR/ ✓"
elif [ -n "${ACE_LM_BIN:-}" ] && [ -x "${ACE_LM_BIN}" ]; then
  echo "ace-lm: $ACE_LM_BIN ✓"
elif [ -n "${ACESTEP_BIN:-}" ] && [ -x "${ACESTEP_BIN}" ]; then
  # Legacy single-binary mode — still accepted
  echo "acestep-generate: $ACESTEP_BIN ✓"
else
  echo "Note: No acestep.cpp binaries found in $BIN_DIR/."
  echo "  Run ./build.sh to build them, or set ACESTEP_BIN_DIR in .env."
  echo "  The UI will still start; music generation needs the binaries."
  echo ""
fi

mkdir -p data public/audio logs

# ── Build frontend ────────────────────────────────────────────────────────────
echo "Building frontend..."
npm run build > logs/build.log 2>&1 && echo "  Frontend built ✓" || {
  echo "Error: frontend build failed. Check logs/build.log"
  tail -20 logs/build.log
  exit 1
}

# ── Optional: get LAN IP for convenience ─────────────────────────────────────
LOCAL_IP=""
if command -v ip &>/dev/null; then
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)
elif command -v ifconfig &>/dev/null; then
  LOCAL_IP=$(ifconfig | awk '/inet / && !/127.0.0.1/{print $2}' | head -1)
fi

# ── Start unified server ──────────────────────────────────────────────────────
echo "Starting server..."
cd server
npm run dev > ../logs/server.log 2>&1 &
SERVER_PID=$!
cd ..
echo "  PID: $SERVER_PID"

sleep 3
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "Error: server failed to start. Check logs/server.log"
  tail -20 logs/server.log
  exit 1
fi

echo "$SERVER_PID" > logs/server.pid

echo ""
echo "=================================="
echo "  ACE-Step UI running!"
echo "=================================="
echo ""
echo "  UI + API : http://localhost:${PORT:-3001}"
if [ -n "$LOCAL_IP" ]; then
  echo "  LAN      : http://$LOCAL_IP:${PORT:-3001}"
fi
echo ""
echo "  Logs: ./logs/server.log"
echo "  Stop: kill \$(cat logs/server.pid)"
echo "=================================="
echo ""

# Open browser
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:${PORT:-3001}" &>/dev/null &
elif command -v open &>/dev/null; then
  open "http://localhost:${PORT:-3001}" &>/dev/null &
fi

trap 'echo ""; echo "Stopping..."; kill $SERVER_PID 2>/dev/null; echo "Stopped."; exit 0' INT TERM
wait

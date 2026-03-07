#!/bin/bash
# ACE-Step UI — start everything
# The Node.js server spawns `acestep-generate` directly; no separate C++ server needed.
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

if [ -z "$ACESTEP_BIN" ] && [ -z "$ACESTEP_API_URL" ]; then
  echo "Warning: neither ACESTEP_BIN nor ACESTEP_API_URL is set."
  echo "  Set ACESTEP_BIN=/path/to/acestep-generate in .env to enable music generation."
  echo ""
fi

if [ -n "$ACESTEP_BIN" ] && [ ! -x "$ACESTEP_BIN" ]; then
  echo "Warning: ACESTEP_BIN=$ACESTEP_BIN does not exist or is not executable."
  echo ""
fi

mkdir -p logs data public/audio

# ── Optional: get LAN IP for convenience ─────────────────────────────────────
LOCAL_IP=""
if command -v ip &>/dev/null; then
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)
elif command -v ifconfig &>/dev/null; then
  LOCAL_IP=$(ifconfig | awk '/inet / && !/127.0.0.1/{print $2}' | head -1)
fi

# ── 1. Node.js API server ─────────────────────────────────────────────────────
echo "[1/2] Starting Node.js API server..."
cd server
npm run dev > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..
echo "      PID: $BACKEND_PID"

sleep 3
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "Error: API server failed to start. Check logs/backend.log"
  tail -20 logs/backend.log
  exit 1
fi

# ── 2. Vite frontend (development) ───────────────────────────────────────────
echo "[2/2] Starting Vite frontend..."
npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "      PID: $FRONTEND_PID"

sleep 2
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "Error: Frontend failed to start. Check logs/frontend.log"
  kill $BACKEND_PID 2>/dev/null
  exit 1
fi

echo "$BACKEND_PID"  > logs/backend.pid
echo "$FRONTEND_PID" > logs/frontend.pid

echo ""
echo "=================================="
echo "  All services running!"
echo "=================================="
echo ""
echo "  API server : http://localhost:${PORT:-3001}"
echo "  UI (dev)   : http://localhost:5173"
if [ -n "$LOCAL_IP" ]; then
  echo "  LAN access : http://$LOCAL_IP:5173"
fi
echo ""
echo "  Logs: ./logs/"
echo "  Stop: kill \$(cat logs/backend.pid) \$(cat logs/frontend.pid)"
echo "=================================="
echo ""

# Open browser
if command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:5173 &>/dev/null &
elif command -v open &>/dev/null; then
  open http://localhost:5173 &>/dev/null &
fi

trap 'echo ""; echo "Stopping..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo "Stopped."; exit 0' INT TERM
wait

#!/bin/bash
# ACE-Step UI Complete Startup Script (acestep-cpp edition)
set -e

echo "=================================="
echo "  ACE-Step UI Startup"
echo "=================================="
echo ""

# -----------------------------------------------------------------------
# Check Node.js dependencies
# -----------------------------------------------------------------------
if [ ! -d "node_modules" ]; then
  echo "Error: UI dependencies not installed. Run ./setup.sh first."
  exit 1
fi
if [ ! -d "server/node_modules" ]; then
  echo "Error: Server dependencies not installed. Run ./setup.sh first."
  exit 1
fi

# -----------------------------------------------------------------------
# Locate the C++ generation server binary
# -----------------------------------------------------------------------
ACESTEP_SERVER="${ACESTEP_SERVER:-./backend/build/acestep-server}"
ACESTEP_BIN="${ACESTEP_BIN:-}"
ACESTEP_MODEL="${ACESTEP_MODEL:-}"
AUDIO_DIR="${AUDIO_DIR:-./server/public/audio}"
CPP_PORT="${CPP_PORT:-7860}"

if [ ! -x "$ACESTEP_SERVER" ]; then
  echo "Error: C++ server binary not found at $ACESTEP_SERVER"
  echo ""
  echo "Please build it first:"
  echo "  cd backend"
  echo "  cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j\$(nproc)"
  exit 1
fi

if [ -z "$ACESTEP_BIN" ]; then
  echo "Error: ACESTEP_BIN not set. Point it to your acestep-generate binary."
  echo "  export ACESTEP_BIN=/path/to/acestep-generate"
  exit 1
fi

if [ -z "$ACESTEP_MODEL" ]; then
  echo "Error: ACESTEP_MODEL not set. Point it to your GGUF model file."
  echo "  export ACESTEP_MODEL=/path/to/model.gguf"
  exit 1
fi

# -----------------------------------------------------------------------
# Get local IP for LAN access
# -----------------------------------------------------------------------
if command -v ip &> /dev/null; then
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || echo "")
elif command -v ifconfig &> /dev/null; then
  LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n1)
fi

mkdir -p logs

# -----------------------------------------------------------------------
# 1. Start the C++ generation server
# -----------------------------------------------------------------------
echo "[1/3] Starting acestep-cpp generation server..."
ACESTEP_BIN="$ACESTEP_BIN" \
ACESTEP_MODEL="$ACESTEP_MODEL" \
AUDIO_DIR="$AUDIO_DIR" \
SERVER_PORT="$CPP_PORT" \
  "$ACESTEP_SERVER" > logs/cpp-server.log 2>&1 &
CPP_PID=$!
echo "      PID: $CPP_PID"

echo "      Waiting for C++ server to start..."
sleep 3
if ! kill -0 $CPP_PID 2>/dev/null; then
  echo "Error: C++ server failed to start. Check logs/cpp-server.log"
  tail -20 logs/cpp-server.log
  exit 1
fi

# -----------------------------------------------------------------------
# 2. Start the Node.js backend
# -----------------------------------------------------------------------
echo "[2/3] Starting Node.js backend..."
cd server
ACESTEP_API_URL="http://localhost:$CPP_PORT" \
  npm run dev > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..
echo "      PID: $BACKEND_PID"

sleep 3
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "Error: Backend failed to start. Check logs/backend.log"
  kill $CPP_PID 2>/dev/null
  exit 1
fi

# -----------------------------------------------------------------------
# 3. Start the Vite frontend
# -----------------------------------------------------------------------
echo "[3/3] Starting frontend..."
npm run dev > logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "      PID: $FRONTEND_PID"

sleep 2
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "Error: Frontend failed to start. Check logs/frontend.log"
  kill $CPP_PID $BACKEND_PID 2>/dev/null
  exit 1
fi

echo ""
echo "=================================="
echo "  All Services Running!"
echo "=================================="
echo ""
echo "  C++ Generation : http://localhost:$CPP_PORT"
echo "  Backend API    : http://localhost:3001"
echo "  Frontend       : http://localhost:5173"
echo ""
if [ -n "$LOCAL_IP" ]; then
  echo "  LAN Access     : http://$LOCAL_IP:5173"
  echo ""
fi
echo "  Logs: ./logs/"
echo "=================================="

echo "$CPP_PID"      > logs/cpp-server.pid
echo "$BACKEND_PID"  > logs/backend.pid
echo "$FRONTEND_PID" > logs/frontend.pid

sleep 3

# Open browser
if command -v xdg-open &> /dev/null; then
  xdg-open http://localhost:5173 &
elif command -v open &> /dev/null; then
  open http://localhost:5173 &
fi

echo ""
echo "To stop all services, run: ./stop-all.sh"
echo ""

trap 'echo; echo "Services still running. Use ./stop-all.sh to stop them."; exit 0' INT
wait

#!/bin/bash
# ACE-Step UI — stop the server

echo "Stopping ACE-Step UI..."

# Current single-server PID file
if [ -f logs/server.pid ]; then
    SERVER_PID=$(cat logs/server.pid)
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Stopping server (PID: $SERVER_PID)..."
        kill "$SERVER_PID"
    fi
    rm logs/server.pid
fi

# Legacy PID files (kept for users upgrading from the two-process setup)
if [ -f logs/backend.pid ]; then
    BACKEND_PID=$(cat logs/backend.pid)
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "Stopping backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID"
    fi
    rm logs/backend.pid
fi

if [ -f logs/frontend.pid ]; then
    FRONTEND_PID=$(cat logs/frontend.pid)
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo "Stopping frontend (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID"
    fi
    rm logs/frontend.pid
fi

echo "Stopped."

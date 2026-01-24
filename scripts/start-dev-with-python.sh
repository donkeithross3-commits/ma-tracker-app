#!/bin/bash
# Simple dev startup script: Python service + Next.js
# For full stack with Cloudflare tunnel, use: npm run dev-full

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_SERVICE_DIR="$PROJECT_ROOT/python-service"

echo "=========================================="
echo "🚀 Starting Development Environment"
echo "=========================================="
echo ""

# Check if Python service is already running
if lsof -i:8000 &> /dev/null; then
    echo "⚠️  Port 8000 already in use - Python service may already be running"
    echo "   Continuing with Next.js only..."
    echo ""
else
    # Start Python service in background
    echo "Starting Python strategy analyzer..."
    cd "$PYTHON_SERVICE_DIR"
    
    # Check if venv exists
    if [ ! -d ".venv" ]; then
        echo "❌ Python virtual environment not found"
        echo "   Please run: cd python-service && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
        exit 1
    fi
    
    # Start with venv Python
    .venv/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /dev/null 2>&1 &
    PYTHON_PID=$!
    echo "✅ Python service started (PID: $PYTHON_PID)"
    
    # Wait for service to be ready
    echo "   Waiting for service to be ready..."
    for i in {1..10}; do
        if curl -s http://localhost:8000/health > /dev/null 2>&1; then
            echo "✅ Python service ready at http://localhost:8000"
            break
        fi
        if [ $i -eq 10 ]; then
            echo "❌ Python service failed to start"
            kill $PYTHON_PID 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done
    echo ""
fi

# Check IB TWS (warning only)
if nc -z 127.0.0.1 7497 2>/dev/null; then
    echo "✅ IB TWS detected on port 7497"
else
    echo "⚠️  IB TWS not detected (option scanner will be limited)"
fi

echo ""
echo "=========================================="
echo "Starting Next.js dev server..."
echo "=========================================="
echo ""

# Trap Ctrl+C to clean up Python service
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    if [ ! -z "$PYTHON_PID" ]; then
        kill $PYTHON_PID 2>/dev/null || true
        echo "✅ Python service stopped"
    fi
    exit 0
}

trap cleanup INT TERM

# Start Next.js in foreground
cd "$PROJECT_ROOT"
npm run dev:next-only

# If npm exits, clean up
cleanup


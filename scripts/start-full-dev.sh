#!/bin/bash
# Unified development environment startup script
# Starts Python service, Cloudflare tunnel, and Next.js dev server

set -e

PROJECT_ROOT="/Users/donaldross/dev/ma-tracker-app"
PYTHON_SERVICE_DIR="$PROJECT_ROOT/python-service"
CLOUDFLARED_DIR="$PROJECT_ROOT/.cloudflared"
LOG_DIR="$PROJECT_ROOT/.logs"

# Create log directory
mkdir -p "$LOG_DIR"

echo "=========================================="
echo "🚀 Starting Full Development Environment"
echo "=========================================="
echo ""
echo "Project: M&A Tracker App"
echo "Root: $PROJECT_ROOT"
echo ""

# ============================================================================
# Step 1: Clean up existing processes
# ============================================================================
echo "Step 1/4: Cleaning up existing processes..."
echo "-------------------------------------------"
"$PROJECT_ROOT/scripts/kill-dev-processes.sh"

# ============================================================================
# Step 2: Check prerequisites
# ============================================================================
echo "Step 2/4: Checking prerequisites..."
echo "-------------------------------------------"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 not found"
    exit 1
fi
echo "✅ Python $(python3 --version | cut -d' ' -f2)"

# Check Node
if ! command -v node &> /dev/null; then
    echo "❌ node not found"
    exit 1
fi
echo "✅ Node $(node --version)"

# Check cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared not found"
    echo "   Install with: brew install cloudflared"
    exit 1
fi
echo "✅ cloudflared $(cloudflared --version | head -1)"

# Check for port conflicts
echo ""
echo "Checking for port conflicts..."
if lsof -i:3000 &> /dev/null; then
    echo "❌ Port 3000 is already in use"
    echo "   Run: lsof -i:3000 to see what's using it"
    exit 1
fi
echo "✅ Port 3000 available"

if lsof -i:8000 &> /dev/null; then
    echo "❌ Port 8000 is already in use"
    echo "   Run: lsof -i:8000 to see what's using it"
    exit 1
fi
echo "✅ Port 8000 available"

# Check IB TWS (warning only, not fatal)
echo ""
echo "Checking IB TWS connection..."
if nc -z 127.0.0.1 7497 2>/dev/null; then
    echo "✅ IB TWS is running on port 7497"
else
    echo "⚠️  WARNING: IB TWS not detected on port 7497"
    echo "   Options scanner will not work without IB TWS"
fi

echo ""

# ============================================================================
# Step 3: Start background services
# ============================================================================
echo "Step 3/4: Starting background services..."
echo "-------------------------------------------"

# Start Python service
echo "Starting Python FastAPI service..."
cd "$PYTHON_SERVICE_DIR"
python3 start_server.py > "$LOG_DIR/python-service.log" 2>&1 &
PYTHON_PID=$!
echo "✅ Python service started (PID: $PYTHON_PID)"
echo "   Log: $LOG_DIR/python-service.log"
echo "   API: http://localhost:8000"
echo "   Docs: http://localhost:8000/docs"

# Wait for Python service to be ready
echo ""
echo "Waiting for Python service to be ready..."
for i in {1..10}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo "✅ Python service is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ Python service failed to start"
        echo "   Check logs: tail -f $LOG_DIR/python-service.log"
        kill $PYTHON_PID 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Start Cloudflare tunnel
echo ""
echo "Starting Cloudflare tunnel..."
cd "$PROJECT_ROOT"

# Check if named tunnel is configured
if [ -f "$CLOUDFLARED_DIR/config.yml" ]; then
    echo "Using Named Tunnel (stable URL)..."
    cloudflared tunnel --config "$CLOUDFLARED_DIR/config.yml" run > "$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    TUNNEL_MODE="named"
    TUNNEL_URL="https://krj-dev.dr3-dashboard.com"
else
    echo "⚠️  Named tunnel not configured, using Quick Tunnel..."
    echo "   For stable URL, run: ./scripts/setup-named-tunnel.sh"
    cloudflared tunnel --url http://localhost:3000 > "$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    TUNNEL_MODE="quick"
    TUNNEL_URL="(extracting...)"
fi

echo "✅ Cloudflare tunnel started (PID: $TUNNEL_PID)"
echo "   Log: $LOG_DIR/tunnel.log"

# Wait for tunnel to establish
echo ""
echo "Waiting for tunnel to establish..."
sleep 3

# Extract URL for quick tunnel
if [ "$TUNNEL_MODE" = "quick" ]; then
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1)
    if [ -z "$TUNNEL_URL" ]; then
        TUNNEL_URL="(check log for URL)"
    fi
fi

echo "✅ Tunnel is ready"
echo "   Public URL: $TUNNEL_URL"
echo "   KRJ Page: $TUNNEL_URL/krj"
echo "   Options: $TUNNEL_URL/ma-options"

echo ""

# ============================================================================
# Step 4: Start Next.js (foreground)
# ============================================================================
echo "Step 4/4: Starting Next.js dev server..."
echo "-------------------------------------------"
echo ""
echo "=========================================="
echo "✅ Background Services Running"
echo "=========================================="
echo ""
echo "Python API:     http://localhost:8000"
echo "Public URL:     $TUNNEL_URL"
echo ""
echo "Logs:"
echo "  Python:  tail -f $LOG_DIR/python-service.log"
echo "  Tunnel:  tail -f $LOG_DIR/tunnel.log"
echo ""
echo "=========================================="
echo "Starting Next.js (foreground)..."
echo "=========================================="
echo ""

# Trap Ctrl+C to clean up background processes
cleanup() {
    echo ""
    echo ""
    echo "=========================================="
    echo "🛑 Shutting Down Development Environment"
    echo "=========================================="
    echo ""
    echo "Stopping background services..."
    kill $PYTHON_PID 2>/dev/null || true
    kill $TUNNEL_PID 2>/dev/null || true
    echo "✅ Services stopped"
    echo ""
    exit 0
}

trap cleanup INT TERM

# Start Next.js in foreground
cd "$PROJECT_ROOT"
npm run dev

# If npm run dev exits, clean up
cleanup


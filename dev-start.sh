#!/bin/bash

# M&A Intelligence Tracker - Unified Development Startup Script
# Leverages existing start_server.py and development standards
# Created: 2025-11-09

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PYTHON_SERVICE_DIR="$SCRIPT_DIR/python-service"
LOGS_DIR="$SCRIPT_DIR/logs"

echo -e "${BLUE}=========================================="
echo "M&A Intelligence Tracker"
echo "Development Environment Startup"
echo -e "==========================================${NC}"
echo ""

# Create logs directory if it doesn't exist
mkdir -p "$LOGS_DIR"

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -i :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to kill processes on a port
kill_port() {
    local port=$1
    local service_name=$2

    if check_port "$port"; then
        echo -e "${YELLOW}⚠️  Port $port is already in use by $service_name${NC}"
        echo -n "   Stopping existing process... "
        lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
        sleep 2
        echo -e "${GREEN}✓${NC}"
    fi
}

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local max_wait=30
    local waited=0

    echo -n "   Waiting for $service_name to be ready... "
    while [ $waited -lt $max_wait ]; do
        if curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -q "200"; then
            echo -e "${GREEN}✓${NC}"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    echo -e "${RED}✗ (timeout after ${max_wait}s)${NC}"
    return 1
}

# Check for required environment files
echo -e "${BLUE}[1/5] Checking environment files...${NC}"

if [ ! -f "$PYTHON_SERVICE_DIR/.env" ]; then
    echo -e "${RED}✗ ERROR: python-service/.env file not found!${NC}"
    echo "   Create it with DATABASE_URL and ANTHROPIC_API_KEY"
    exit 1
fi

if [ ! -f "$SCRIPT_DIR/.env.local" ]; then
    echo -e "${YELLOW}⚠️  WARNING: .env.local file not found (frontend env)${NC}"
    echo "   Frontend will use default configuration"
fi

echo -e "${GREEN}✓ Environment files verified${NC}"
echo ""

# Stop existing services
echo -e "${BLUE}[2/5] Stopping any existing services...${NC}"
kill_port 8000 "Python Backend"
kill_port 3000 "Next.js Frontend"
echo ""

# Start Python backend
echo -e "${BLUE}[3/5] Starting Python Backend (FastAPI)...${NC}"
cd "$PYTHON_SERVICE_DIR"

# Use existing start_server.py which handles env loading and validation
echo "   Using start_server.py (handles env validation)"
/Users/donaldross/opt/anaconda3/bin/python3 start_server.py > "$LOGS_DIR/python-backend.log" 2>&1 &
PYTHON_PID=$!
echo -e "   ${GREEN}✓ Started${NC} (PID: $PYTHON_PID, Log: logs/python-backend.log)"

# Wait for Python backend to be ready
if ! wait_for_service "http://localhost:8000/health" "Python Backend"; then
    echo -e "${RED}✗ Python Backend failed to start. Check logs/python-backend.log${NC}"
    tail -20 "$LOGS_DIR/python-backend.log"
    exit 1
fi
echo ""

# Start Next.js frontend
echo -e "${BLUE}[4/5] Starting Next.js Frontend...${NC}"
cd "$SCRIPT_DIR"

# Load nvm and start Next.js
echo "   Loading nvm and starting npm run dev"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

npm run dev > "$LOGS_DIR/nextjs-frontend.log" 2>&1 &
NEXTJS_PID=$!
echo -e "   ${GREEN}✓ Started${NC} (PID: $NEXTJS_PID, Log: logs/nextjs-frontend.log)"

# Wait for Next.js frontend to be ready
if ! wait_for_service "http://localhost:3000" "Next.js Frontend"; then
    echo -e "${RED}✗ Next.js Frontend failed to start. Check logs/nextjs-frontend.log${NC}"
    tail -20 "$LOGS_DIR/nextjs-frontend.log"
    exit 1
fi
echo ""

# Service status summary
echo -e "${BLUE}[5/5] Service Status Summary...${NC}"
echo ""
echo -e "${GREEN}✓ All services started successfully!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📊 Active Services${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  🐍 ${BLUE}Python Backend (FastAPI)${NC}"
echo "     URL: http://localhost:8000"
echo "     Health: http://localhost:8000/health"
echo "     API Docs: http://localhost:8000/docs"
echo "     PID: $PYTHON_PID"
echo "     Log: logs/python-backend.log"
echo ""
echo -e "  ⚛️  ${BLUE}Next.js Frontend${NC}"
echo "     URL: http://localhost:3000"
echo "     PID: $NEXTJS_PID"
echo "     Log: logs/nextjs-frontend.log"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}📝 Development Commands${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  View logs:"
echo "    Backend:  tail -f logs/python-backend.log"
echo "    Frontend: tail -f logs/nextjs-frontend.log"
echo ""
echo "  Test endpoints:"
echo "    curl http://localhost:8000/health | python3 -m json.tool"
echo "    curl http://localhost:8000/edgar/monitoring/status"
echo ""
echo "  Stop services:"
echo "    ./dev-stop.sh"
echo ""
echo "  Start monitors (via API):"
echo "    curl -X POST http://localhost:8000/edgar/monitoring/start"
echo "    curl -X POST http://localhost:8000/edgar/research-worker/start"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${YELLOW}💡 Development Tips${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  • Use .claude-session to track progress"
echo "  • Update TESTING_FINDINGS.md with discoveries"
echo "  • Use /init, /feature, /bug-fix slash commands"
echo "  • Check python-service/TESTING_PLAN.md for testing roadmap"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}Ready for development! 🚀${NC}"
echo ""

# Save PIDs for stop script
echo "$PYTHON_PID" > "$LOGS_DIR/python.pid"
echo "$NEXTJS_PID" > "$LOGS_DIR/nextjs.pid"

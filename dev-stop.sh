#!/bin/bash

# M&A Intelligence Tracker - Stop Development Services
# Companion script to dev-start.sh

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOGS_DIR="$SCRIPT_DIR/logs"

echo -e "${BLUE}=========================================="
echo "M&A Intelligence Tracker"
echo "Stopping Development Services"
echo -e "==========================================${NC}"
echo ""

# Function to kill process by PID file
kill_by_pidfile() {
    local pidfile=$1
    local service_name=$2

    if [ -f "$pidfile" ]; then
        local pid=$(cat "$pidfile")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -n "Stopping $service_name (PID: $pid)... "
            kill "$pid" 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
        else
            echo -e "${YELLOW}⚠️  $service_name process (PID: $pid) not running${NC}"
        fi
        rm "$pidfile"
    else
        echo -e "${YELLOW}⚠️  No PID file found for $service_name${NC}"
    fi
}

# Kill services by PID files
if [ -d "$LOGS_DIR" ]; then
    kill_by_pidfile "$LOGS_DIR/python.pid" "Python Backend"
    kill_by_pidfile "$LOGS_DIR/nextjs.pid" "Next.js Frontend"
fi

# Also kill by port (backup method)
echo ""
echo "Ensuring ports are clear..."

# Kill anything on port 8000 (Python)
if lsof -ti :8000 >/dev/null 2>&1; then
    echo -n "Killing processes on port 8000... "
    lsof -ti :8000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

# Kill anything on port 3000 (Next.js)
if lsof -ti :3000 >/dev/null 2>&1; then
    echo -n "Killing processes on port 3000... "
    lsof -ti :3000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
fi

# Kill by process name (backup method)
echo ""
echo "Ensuring all related processes are stopped..."

if pgrep -f "start_server.py" > /dev/null 2>&1; then
    echo -n "Killing start_server.py processes... "
    pkill -f "start_server.py" && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
    sleep 1
fi

if pgrep -f "npm run dev" > /dev/null 2>&1; then
    echo -n "Killing npm run dev processes... "
    pkill -f "npm run dev" && echo -e "${GREEN}✓${NC}" || echo -e "${RED}✗${NC}"
    sleep 1
fi

echo ""
echo -e "${GREEN}✓ All services stopped${NC}"
echo ""
echo "To restart: ./dev-start.sh"
echo ""

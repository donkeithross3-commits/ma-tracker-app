#!/bin/bash
# Kill all development processes safely
# This script is idempotent and only kills processes related to this project

set +e  # Don't exit on error - we want to try killing all processes

echo "=========================================="
echo "🛑 Stopping Development Processes"
echo "=========================================="
echo ""

KILLED_ANY=false

# Function to kill process by port
kill_by_port() {
    local PORT=$1
    local SERVICE_NAME=$2
    
    PIDS=$(lsof -t -i:$PORT 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Killing $SERVICE_NAME on port $PORT (PIDs: $PIDS)..."
        echo "$PIDS" | xargs kill -9 2>/dev/null
        KILLED_ANY=true
        sleep 1
    fi
}

# Function to kill process by name pattern
kill_by_pattern() {
    local PATTERN=$1
    local SERVICE_NAME=$2
    
    PIDS=$(pgrep -f "$PATTERN" 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Killing $SERVICE_NAME (PIDs: $PIDS)..."
        echo "$PIDS" | xargs kill -9 2>/dev/null
        KILLED_ANY=true
        sleep 1
    fi
}

# 1. Kill Next.js dev server (port 3000)
kill_by_port 3000 "Next.js dev server"

# 2. Kill Python FastAPI service (port 8000)
kill_by_port 8000 "Python FastAPI service"

# 3. Kill Cloudflare tunnel processes
# Be specific to avoid killing unrelated cloudflared processes
CLOUDFLARED_PIDS=$(ps aux | grep cloudflared | grep -E "(tunnel|localhost:3000)" | grep -v grep | awk '{print $2}')
if [ -n "$CLOUDFLARED_PIDS" ]; then
    echo "Killing Cloudflare tunnel (PIDs: $CLOUDFLARED_PIDS)..."
    echo "$CLOUDFLARED_PIDS" | xargs kill -9 2>/dev/null
    KILLED_ANY=true
    sleep 1
fi

# 4. Kill any Python processes running start_server.py
kill_by_pattern "python.*start_server.py" "Python service (by script name)"

# 5. Kill any stray node processes for this project
# Only kill if they're in our project directory
PROJECT_ROOT="/Users/donaldross/dev/ma-tracker-app"
NODE_PIDS=$(ps aux | grep node | grep "$PROJECT_ROOT" | grep -v grep | awk '{print $2}')
if [ -n "$NODE_PIDS" ]; then
    echo "Killing Node processes for this project (PIDs: $NODE_PIDS)..."
    echo "$NODE_PIDS" | xargs kill -9 2>/dev/null
    KILLED_ANY=true
    sleep 1
fi

echo ""
if [ "$KILLED_ANY" = true ]; then
    echo "✅ Development processes stopped"
else
    echo "✅ No development processes were running"
fi
echo ""


#!/usr/bin/env bash
# Source-of-truth copy of the host deploy entry point.
# Sync this file to /home/don/apps/scripts/deploy.sh on the droplet when it changes.
#
# Usage:
#   DR3_AGENT=<name> bash ~/apps/scripts/deploy.sh <target>
# Targets:
#   web, python-service, portfolio, agent-only, ib-gateway, trading-agent
set -euo pipefail

LOCK_FILE="/tmp/dr3-deploy.lock"
LOG_FILE="$HOME/apps/logs/deploy.log"
MIN_FREE_MB=1500
HEALTH_TIMEOUT=90

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] [${DR3_AGENT:-manual}] $*" | tee -a "$LOG_FILE"; }

die() { log "ABORT: $*"; exit 1; }

check_memory() {
    local free_mb
    free_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo)
    if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
        die "Only ${free_mb}MB available (need ${MIN_FREE_MB}MB). Is another build running?"
    fi
    log "Memory check passed: ${free_mb}MB available"
}

wait_healthy() {
    local container="$1" elapsed=0
    log "Waiting for $container to become healthy..."
    while [ $elapsed -lt $HEALTH_TIMEOUT ]; do
        local status
        status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "missing")
        if [ "$status" = "healthy" ]; then
            log "$container is healthy (${elapsed}s)"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    log "WARNING: $container not healthy after ${HEALTH_TIMEOUT}s (status: $status)"
    return 1
}

TARGET="${1:-}"
[ -z "$TARGET" ] && die "Usage: deploy.sh <web|python-service|portfolio|agent-only|ib-gateway|trading-agent>"

START_TIME=$(date +%s)

# Pre-flight
check_memory

# Acquire exclusive lock (fd 200)
exec 200>"$LOCK_FILE"
if ! flock -w 10 200; then
    HOLDER=$(cat "$LOCK_FILE" 2>/dev/null || echo "unknown")
    die "Deploy lock held by another process: $HOLDER"
fi
echo "PID=$$ TARGET=$TARGET AGENT=${DR3_AGENT:-manual} TIME=$(date -u -Iseconds)" >&200

log "=== DEPLOY START: target=$TARGET ==="

# Git pull (shared step)
cd ~/apps/ma-tracker-app
log "Pulling latest from origin/main..."
git pull origin main

case "$TARGET" in
    web)
        cd ~/apps
        log "Building web container (--no-cache)..."
        docker compose build --no-cache web
        log "Recreating web container..."
        docker compose up -d --force-recreate web
        wait_healthy "ma-tracker-app-web"
        ;;
    python-service)
        log "Restarting FastAPI via systemd..."
        systemctl --user restart dr3-fastapi
        elapsed=0
        while [ $elapsed -lt 20 ]; do
            if systemctl --user is-active --quiet dr3-fastapi && lsof -i :8000 > /dev/null 2>&1; then
                log "Python service running on :8000 (systemd managed)"
                break
            fi
            sleep 1
            elapsed=$((elapsed + 1))
        done
        if [ $elapsed -ge 20 ]; then
            systemctl --user status dr3-fastapi --no-pager || true
            die "Python service failed to start on :8000"
        fi
        ;;
    portfolio)
        cd ~/apps
        log "Building portfolio container..."
        docker compose build python-portfolio
        log "Recreating portfolio container..."
        docker compose up -d --force-recreate python-portfolio
        wait_healthy "python-portfolio"
        ;;
    agent-only)
        log "Agent-only deploy (git pull, no rebuild)..."
        # Git pull already happened above — that's all we need.
        # The volume mount picks up new agent files immediately.
        log "Agent bundle updated via volume mount — zero downtime"
        ;;
    ib-gateway)
        cd ~/apps
        if [ ! -f ./ib-gateway.env ]; then
            die "Missing ~/apps/ib-gateway.env — copy ops/ib-gateway/.env.template and fill in credentials"
        fi
        log "Pulling latest IB Gateway image..."
        docker compose pull ib-gateway
        log "Recreating IB Gateway container..."
        docker compose up -d --force-recreate ib-gateway
        # IB Gateway has 120s start_period — use longer timeout
        HEALTH_TIMEOUT=180 wait_healthy "ib-gateway"
        ;;
    trading-agent)
        log "Restarting trading agent via systemd..."
        sudo systemctl restart dr3-trading-agent
        sleep 3
        if pgrep -f 'ib_data_agent.py' > /dev/null 2>&1; then
            log "Trading agent running (systemd managed, Nice=-10)"
        else
            log "WARNING: Trading agent process not found after restart"
            sudo systemctl status dr3-trading-agent --no-pager || true
        fi
        ;;
    *)
        die "Unknown target: $TARGET. Use: web, python-service, portfolio, agent-only, ib-gateway, trading-agent"
        ;;
esac

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
log "=== DEPLOY COMPLETE: target=$TARGET duration=${DURATION}s ==="

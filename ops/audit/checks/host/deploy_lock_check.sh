#!/usr/bin/env bash
# Check: host/deploy_lock_check
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/deploy_lock_check"

# 1. Verify deploy.sh exists and is executable
DEPLOY_SCRIPT="$HOME/apps/scripts/deploy.sh"
if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
    json_finding "deploy_script_missing" "$SEV_ALERT" \
        "deploy.sh not found at $DEPLOY_SCRIPT — deploy coordination is not active"
elif [[ ! -x "$DEPLOY_SCRIPT" ]]; then
    json_finding "deploy_script_not_executable" "$SEV_WARN" \
        "deploy.sh exists but is not executable: $DEPLOY_SCRIPT"
fi

# 2. Check for stale deploy lock
LOCK_FILE="/tmp/dr3-deploy.lock"
if [[ -f "$LOCK_FILE" ]]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo "0") ))
    # Check if the process that holds the lock is still running
    LOCK_PID=$(grep -oP 'PID=\K[0-9]+' "$LOCK_FILE" 2>/dev/null || echo "")
    if [[ -n "$LOCK_PID" ]] && ! kill -0 "$LOCK_PID" 2>/dev/null; then
        json_finding "stale_deploy_lock" "$SEV_WARN" \
            "Deploy lock exists but PID $LOCK_PID is not running (lock age: ${LOCK_AGE}s). Lock may be stale."
    elif [[ "$LOCK_AGE" -gt 900 ]]; then
        json_finding "long_running_deploy" "$SEV_WARN" \
            "Deploy lock has been held for ${LOCK_AGE}s (>15min). Deploy may be stuck."
    fi
fi

# 3. Check deploy log for recent ABORTs
DEPLOY_LOG="$HOME/apps/logs/deploy.log"
if [[ -f "$DEPLOY_LOG" ]]; then
    YESTERDAY=$(date -u -d '24 hours ago' '+%Y-%m-%d' 2>/dev/null || date -u -v-1d '+%Y-%m-%d' 2>/dev/null || echo "")
    if [[ -n "$YESTERDAY" ]]; then
        ABORT_COUNT=$(grep -c "ABORT" "$DEPLOY_LOG" 2>/dev/null || echo "0")
        RECENT_ABORTS=$(tail -50 "$DEPLOY_LOG" | grep "ABORT" | tail -5 || true)
        if [[ "$ABORT_COUNT" -gt 0 && -n "$RECENT_ABORTS" ]]; then
            json_finding "deploy_aborts_detected" "$SEV_WARN" \
                "Found $ABORT_COUNT ABORT entries in deploy log. Recent: $(echo "$RECENT_ABORTS" | head -3 | tr '\n' ' ')"
        fi
    fi
    # Save last 20 lines to artifacts
    tail -20 "$DEPLOY_LOG" > "${CHECK_ARTIFACT_DIR}/deploy_log_tail.txt" 2>/dev/null || true
else
    log_info "No deploy log found yet (no deploys recorded via deploy.sh)"
fi

# 4. Verify hygiene script exists
HYGIENE_SCRIPT="$HOME/apps/scripts/server_hygiene.sh"
if [[ ! -f "$HYGIENE_SCRIPT" ]]; then
    json_finding "hygiene_script_missing" "$SEV_WARN" \
        "server_hygiene.sh not found at $HYGIENE_SCRIPT"
elif [[ ! -x "$HYGIENE_SCRIPT" ]]; then
    json_finding "hygiene_script_not_executable" "$SEV_WARN" \
        "server_hygiene.sh exists but is not executable"
fi

finalize_check

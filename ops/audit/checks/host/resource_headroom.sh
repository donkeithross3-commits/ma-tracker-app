#!/usr/bin/env bash
# Check: host/resource_headroom
# Cadence: daily
# Severity ceiling: alert
# Purpose: Verify the server has sufficient resources to safely run a Docker build
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/resource_headroom"

# 1. Available RAM check
AVAIL_MB=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
if [[ "$AVAIL_MB" -lt 1000 ]]; then
    json_finding "ram_critical" "$SEV_ALERT" \
        "Available RAM: ${AVAIL_MB}MB — below 1000MB, Docker builds WILL fail or OOM"
elif [[ "$AVAIL_MB" -lt 2000 ]]; then
    json_finding "ram_low" "$SEV_WARN" \
        "Available RAM: ${AVAIL_MB}MB — below 2000MB, Docker builds may be tight"
else
    log_info "Available RAM: ${AVAIL_MB}MB — sufficient for builds"
fi

# 2. Disk usage check
DISK_PCT=$(df / --output=pcent 2>/dev/null | tail -1 | tr -d ' %')
if [[ -n "$DISK_PCT" ]] && [[ "$DISK_PCT" =~ ^[0-9]+$ ]]; then
    if [[ "$DISK_PCT" -gt 90 ]]; then
        json_finding "disk_critical" "$SEV_ALERT" \
            "Root disk at ${DISK_PCT}% — Docker builds will fail, immediate cleanup needed"
    elif [[ "$DISK_PCT" -gt 80 ]]; then
        json_finding "disk_high" "$SEV_WARN" \
            "Root disk at ${DISK_PCT}% — approaching danger zone for Docker builds"
    fi
fi

# 3. Swap usage check
SWAP_TOTAL=$(awk '/SwapTotal/{print $2}' /proc/meminfo 2>/dev/null || echo "0")
SWAP_FREE=$(awk '/SwapFree/{print $2}' /proc/meminfo 2>/dev/null || echo "0")
if [[ "$SWAP_TOTAL" -gt 0 ]]; then
    SWAP_USED=$((SWAP_TOTAL - SWAP_FREE))
    SWAP_PCT=$((SWAP_USED * 100 / SWAP_TOTAL))
    if [[ "$SWAP_PCT" -gt 75 ]]; then
        json_finding "swap_critical" "$SEV_ALERT" \
            "Swap at ${SWAP_PCT}% — system under severe memory pressure"
    elif [[ "$SWAP_PCT" -gt 50 ]]; then
        json_finding "swap_high" "$SEV_WARN" \
            "Swap at ${SWAP_PCT}% — RAM pressure detected, builds may be slow"
    fi
else
    json_finding "no_swap" "$SEV_WARN" \
        "No swap configured — OOM kills possible during Docker builds"
fi

# 4. Docker build cache size
if command -v docker &>/dev/null; then
    BUILD_CACHE_LINE=$(docker system df 2>/dev/null | grep "Build Cache" || true)
    if [[ -n "$BUILD_CACHE_LINE" ]]; then
        # Parse the SIZE column (3rd field), handling both GB and MB
        CACHE_SIZE=$(echo "$BUILD_CACHE_LINE" | awk '{print $4}')
        CACHE_UNIT=$(echo "$CACHE_SIZE" | grep -oP '[A-Za-z]+$' || echo "")
        CACHE_NUM=$(echo "$CACHE_SIZE" | grep -oP '^[0-9.]+' || echo "0")

        if [[ "$CACHE_UNIT" == "GB" ]]; then
            CACHE_GB_INT=$(echo "$CACHE_NUM" | cut -d. -f1)
            if [[ "$CACHE_GB_INT" -gt 2 ]]; then
                json_finding "build_cache_large" "$SEV_WARN" \
                    "Docker build cache is ${CACHE_SIZE} — consider 'docker builder prune -f'"
            fi
        fi
        echo "$BUILD_CACHE_LINE" > "${CHECK_ARTIFACT_DIR}/docker_build_cache.txt"
    fi
fi

# 5. Running container count
EXPECTED_CONTAINERS=3
RUNNING_COUNT=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
if [[ "$RUNNING_COUNT" -ne "$EXPECTED_CONTAINERS" ]]; then
    RUNNING_NAMES=$(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ', ' || echo "unknown")
    json_finding "container_count_mismatch" "$SEV_WARN" \
        "Expected $EXPECTED_CONTAINERS running containers, found $RUNNING_COUNT: $RUNNING_NAMES"
fi

# Save resource snapshot to artifacts
{
    echo "Available RAM: ${AVAIL_MB}MB"
    echo "Disk: ${DISK_PCT}%"
    echo "Swap total: ${SWAP_TOTAL}kB, free: ${SWAP_FREE}kB"
    echo "Running containers: ${RUNNING_COUNT}"
    echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${CHECK_ARTIFACT_DIR}/resource_headroom.txt"

finalize_check

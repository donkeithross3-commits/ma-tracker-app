#!/usr/bin/env bash
# IB Gateway + Trading Agent health check
# Used by daily audit pipeline and manual monitoring
# Exit 0 if all healthy, non-zero if any check fails
set -euo pipefail

ERRORS=0

echo "=== IB Gateway + Trading Agent Health Check ==="
echo "Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Check 1: IB Gateway container running
echo -n "IB Gateway container: "
if docker inspect --format='{{.State.Status}}' ib-gateway 2>/dev/null | grep -q "running"; then
    echo "RUNNING"
else
    echo "NOT RUNNING"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: IB Gateway health status
echo -n "IB Gateway health: "
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' ib-gateway 2>/dev/null || echo "unknown")
if [ "$HEALTH" = "healthy" ]; then
    echo "HEALTHY"
else
    echo "$HEALTH"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: API port responding (paper)
echo -n "Paper API port (4002): "
if nc -z 127.0.0.1 4002 2>/dev/null; then
    echo "OPEN"
else
    echo "CLOSED"
    # Not an error if only using live mode
fi

# Check 4: API port responding (live)
echo -n "Live API port (4001): "
if nc -z 127.0.0.1 4001 2>/dev/null; then
    echo "OPEN"
else
    echo "CLOSED"
    # Not an error if only using paper mode
fi

# Check 5: At least one API port must be open
if ! nc -z 127.0.0.1 4001 2>/dev/null && ! nc -z 127.0.0.1 4002 2>/dev/null; then
    echo "ERROR: No IB API port responding"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: Trading agent systemd service
echo -n "Trading agent service: "
if systemctl is-active --quiet dr3-trading-agent 2>/dev/null; then
    echo "ACTIVE"
else
    echo "INACTIVE"
    ERRORS=$((ERRORS + 1))
fi

# Check 7: FastAPI service
echo -n "FastAPI service: "
if systemctl is-active --quiet dr3-fastapi 2>/dev/null; then
    echo "ACTIVE"
else
    echo "INACTIVE"
    ERRORS=$((ERRORS + 1))
fi

# Check 8: IB Gateway memory usage
echo -n "IB Gateway memory: "
MEM=$(docker stats --no-stream --format '{{.MemUsage}}' ib-gateway 2>/dev/null || echo "unknown")
echo "$MEM"

echo ""
if [ $ERRORS -eq 0 ]; then
    echo "STATUS: ALL CHECKS PASSED"
    exit 0
else
    echo "STATUS: $ERRORS CHECK(S) FAILED"
    exit 1
fi

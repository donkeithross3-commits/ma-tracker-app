#!/usr/bin/env bash
# ops/audit/bin/run_infra_audit.sh — Infrastructure adequacy & hygiene audit
# Runs a focused subset of checks: resource headroom, deploy coordination,
# disk pressure, container health, and Docker state.
#
# Usage:
#   bash ops/audit/bin/run_infra_audit.sh          # Full infra audit
#   bash ops/audit/bin/run_infra_audit.sh --quick   # Skip image scans
#
# This can run standalone (ad-hoc) or as part of the daily audit pipeline.
# Designed to answer: "Can this server safely handle a deploy right now?"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

QUICK=false
[[ "${1:-}" == "--quick" ]] && QUICK=true

echo "================================================================"
echo "  DR3 Infrastructure Audit"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "================================================================"
echo ""

# Set up artifacts directory
ARTIFACTS_DIR=$(ensure_artifacts_dir "infra-$(date -u +%Y%m%d-%H%M%S)")
export ARTIFACTS_DIR

MAX_EXIT=0
RESULTS=()

run_check() {
    local script="$1"
    local name
    name=$(basename "$script" .sh)

    if [[ ! -x "$script" ]]; then
        echo "  [SKIP] $name — not executable"
        return
    fi

    local rc=0
    bash "$script" 2>&1 || rc=$?

    local label="PASS"
    if (( rc >= 30 )); then label="CRITICAL"
    elif (( rc >= 20 )); then label="ALERT"
    elif (( rc >= 10 )); then label="WARN"
    fi

    RESULTS+=("$(printf "%-8s %s" "[$label]" "$name")")

    if (( rc > MAX_EXIT )); then
        MAX_EXIT=$rc
    fi
}

# === Resource Checks ===
echo "--- Resource Adequacy ---"
run_check "${SCRIPT_DIR}/../checks/host/resource_headroom.sh"
run_check "${SCRIPT_DIR}/../checks/host/disk_pressure.sh"

# === Deploy Coordination ===
echo "--- Deploy Coordination ---"
run_check "${SCRIPT_DIR}/../checks/host/deploy_lock_check.sh"

# === Docker State ===
echo "--- Docker State ---"
run_check "${SCRIPT_DIR}/../checks/docker/resource_limits.sh"
run_check "${SCRIPT_DIR}/../checks/docker/running_as_root.sh"
run_check "${SCRIPT_DIR}/../checks/docker/exposed_ports.sh"
run_check "${SCRIPT_DIR}/../checks/docker/compose_drift.sh"

if [[ "$QUICK" == "false" ]]; then
    run_check "${SCRIPT_DIR}/../checks/docker/image_scan.sh"
fi

# === Container Health ===
echo "--- Container Health ---"
run_check "${SCRIPT_DIR}/../checks/regression/container_health.sh"
run_check "${SCRIPT_DIR}/../checks/regression/resource_usage.sh"
run_check "${SCRIPT_DIR}/../checks/regression/http_smoke.sh"

# === Host State ===
echo "--- Host State ---"
run_check "${SCRIPT_DIR}/../checks/host/patch_status.sh"

echo ""
echo "================================================================"
echo "  Infrastructure Audit Results"
echo "================================================================"

for r in "${RESULTS[@]}"; do
    echo "  $r"
done

echo ""
echo "--- Quick Stats ---"
echo "  RAM available:  $(awk '/MemAvailable/{printf "%d MB", $2/1024}' /proc/meminfo)"
echo "  Swap used:      $(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{printf "%d MB / %d MB", (t-f)/1024, t/1024}' /proc/meminfo)"
echo "  Disk:           $(df / --output=pcent | tail -1 | tr -d ' ')  used"
echo "  Containers:     $(docker ps -q 2>/dev/null | wc -l | tr -d ' ') running"
echo "  Build cache:    $(docker system df 2>/dev/null | awk '/Build Cache/{print $4}' || echo 'unknown')"
echo "  Deploy lock:    $([ -f /tmp/dr3-deploy.lock ] && echo 'HELD' || echo 'free')"
echo "  Last deploy:    $(tail -1 ~/apps/logs/deploy.log 2>/dev/null | head -c 120 || echo 'none')"
echo ""

OVERALL="PASS"
if (( MAX_EXIT >= 30 )); then OVERALL="CRITICAL"
elif (( MAX_EXIT >= 20 )); then OVERALL="ALERT"
elif (( MAX_EXIT >= 10 )); then OVERALL="WARN"
fi
echo "  Overall: $OVERALL"
echo "  Artifacts: $ARTIFACTS_DIR"
echo "================================================================"

exit $MAX_EXIT

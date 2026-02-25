#!/usr/bin/env bash
# Check: host/disk_pressure
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/disk_pressure"

# Read thresholds from config, with defaults
warn_threshold=$(read_config "thresholds.disk_warn_pct" 2>/dev/null || echo "85")
alert_threshold=$(read_config "thresholds.disk_alert_pct" 2>/dev/null || echo "95")

# Validate thresholds are numeric
[[ "$warn_threshold" =~ ^[0-9]+$ ]] || warn_threshold=85
[[ "$alert_threshold" =~ ^[0-9]+$ ]] || alert_threshold=95

# Get disk usage — skip pseudo/snap filesystems
disk_usage=$(df -h 2>/dev/null | grep -vE '^(tmpfs|devtmpfs|Filesystem|overlay$|shm$)' | grep -vE '/snap/' || true)
if [[ -z "$disk_usage" ]]; then
    json_finding "df_failed" "$SEV_WARN" "Could not read disk usage via df -h"
    finalize_check
fi

# Get inode usage
inode_usage=$(df -i 2>/dev/null | grep -vE '^(tmpfs|devtmpfs|Filesystem|overlay$|shm$)' | grep -vE '/snap/' || true)

# Save raw output to artifacts
echo "$disk_usage" > "${CHECK_ARTIFACT_DIR}/disk_usage.txt"
echo "$inode_usage" > "${CHECK_ARTIFACT_DIR}/inode_usage.txt"

# Parse disk usage (skip header if present)
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Extract fields: Filesystem Size Used Avail Use% Mounted
    fs=$(echo "$line" | awk '{print $1}')
    use_pct=$(echo "$line" | awk '{print $5}' | tr -d '%')
    mount=$(echo "$line" | awk '{print $6}')

    # Skip if we can't parse the percentage
    [[ "$use_pct" =~ ^[0-9]+$ ]] || continue

    if [[ "$use_pct" -ge "$alert_threshold" ]]; then
        json_finding "disk_alert_${mount//\//_}" "$SEV_ALERT" \
            "Disk usage CRITICAL: ${mount} (${fs}) at ${use_pct}% (threshold: ${alert_threshold}%)"
    elif [[ "$use_pct" -ge "$warn_threshold" ]]; then
        json_finding "disk_warn_${mount//\//_}" "$SEV_WARN" \
            "Disk usage HIGH: ${mount} (${fs}) at ${use_pct}% (threshold: ${warn_threshold}%)"
    fi
done <<< "$disk_usage"

# Parse inode usage
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    iuse_pct=$(echo "$line" | awk '{print $5}' | tr -d '%')
    mount=$(echo "$line" | awk '{print $6}')

    [[ "$iuse_pct" =~ ^[0-9]+$ ]] || continue

    if [[ "$iuse_pct" -ge "$alert_threshold" ]]; then
        json_finding "inode_alert_${mount//\//_}" "$SEV_ALERT" \
            "Inode usage CRITICAL: ${mount} at ${iuse_pct}% (threshold: ${alert_threshold}%)"
    elif [[ "$iuse_pct" -ge "$warn_threshold" ]]; then
        json_finding "inode_warn_${mount//\//_}" "$SEV_WARN" \
            "Inode usage HIGH: ${mount} at ${iuse_pct}% (threshold: ${warn_threshold}%)"
    fi
done <<< "$inode_usage"

# Specifically check /var (Docker storage lives here)
var_usage=$(df -h /var 2>/dev/null | tail -1 || true)
if [[ -n "$var_usage" ]]; then
    var_pct=$(echo "$var_usage" | awk '{print $5}' | tr -d '%')
    if [[ "$var_pct" =~ ^[0-9]+$ ]] && [[ "$var_pct" -ge "$warn_threshold" ]]; then
        json_finding "var_partition_pressure" "$SEV_WARN" \
            "/var partition at ${var_pct}% — Docker images, containers, and volumes may be consuming space. Consider 'docker system prune'."
    fi
fi

# Docker-specific storage check
if command -v docker &>/dev/null; then
    docker_info=$(docker system df 2>/dev/null || true)
    if [[ -n "$docker_info" ]]; then
        echo "$docker_info" > "${CHECK_ARTIFACT_DIR}/docker_disk_usage.txt"
        log_info "Docker disk usage saved to artifacts"
    fi
fi

finalize_check

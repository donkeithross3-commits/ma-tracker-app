#!/usr/bin/env bash
# Check: docker/dangerous_config
# Cadence: daily
# Severity ceiling: fail-closed
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/dangerous_config"

if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check
fi

# Get list of containers allowed to run as root (from config)
allowed_root_raw=$(read_config "containers_allowed_root" 2>/dev/null || echo "")
# Parse YAML list into space-separated string
allowed_root=""
if [[ -n "$allowed_root_raw" ]]; then
    allowed_root=$(echo "$allowed_root_raw" | tr -d '[]"' | tr ',' ' ' | tr -s ' ')
fi

is_allowed_root() {
    local container_name="$1"
    for allowed in $allowed_root; do
        if [[ "$container_name" == "$allowed" ]]; then
            return 0
        fi
    done
    return 1
}

# Get all running container IDs
container_ids=$(docker ps -q 2>/dev/null || true)
if [[ -z "$container_ids" ]]; then
    json_finding "no_running_containers" "$SEV_INFO" "No running Docker containers found"
    finalize_check
fi

while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue

    # Get container info
    inspect=$(docker inspect "$cid" 2>/dev/null || true)
    if [[ -z "$inspect" ]]; then
        json_finding "inspect_failed_${cid}" "$SEV_WARN" "Could not inspect container ${cid}"
        continue
    fi

    name=$(echo "$inspect" | jq -r '.[0].Name' | sed 's/^\///')
    safe_name=$(echo "$name" | tr '/:.' '_')

    # Save inspect output
    echo "$inspect" > "${CHECK_ARTIFACT_DIR}/inspect_${safe_name}.json"

    # Check: Privileged mode
    privileged=$(echo "$inspect" | jq -r '.[0].HostConfig.Privileged' 2>/dev/null || echo "false")
    if [[ "$privileged" == "true" ]]; then
        json_finding "privileged_${safe_name}" "$SEV_ALERT" \
            "Container '${name}' is running in PRIVILEGED mode. Full host access."
    fi

    # Check: Host network mode
    network_mode=$(echo "$inspect" | jq -r '.[0].HostConfig.NetworkMode' 2>/dev/null || echo "")
    if [[ "$network_mode" == "host" ]]; then
        json_finding "host_network_${safe_name}" "$SEV_ALERT" \
            "Container '${name}' is using HOST network mode. No network isolation."
    fi

    # Check: docker.sock mount — CRITICAL (fail-closed)
    sock_mount=$(echo "$inspect" | jq -r '.[0].Mounts[]? | select(.Source == "/var/run/docker.sock") | .Source' 2>/dev/null || true)
    if [[ -n "$sock_mount" ]]; then
        json_finding "docker_sock_${safe_name}" "$SEV_CRITICAL" \
            "Container '${name}' has /var/run/docker.sock mounted. Container escape vector — FAIL-CLOSED."
    fi

    # Check: Extra capabilities (non-default)
    # Default Docker caps: CHOWN, DAC_OVERRIDE, FOWNER, FSETID, KILL, SETGID, SETUID, SETPCAP,
    #   NET_BIND_SERVICE, NET_RAW, SYS_CHROOT, MKNOD, AUDIT_WRITE, SETFCAP
    DEFAULT_CAPS="CHOWN DAC_OVERRIDE FOWNER FSETID KILL SETGID SETUID SETPCAP NET_BIND_SERVICE NET_RAW SYS_CHROOT MKNOD AUDIT_WRITE SETFCAP"
    cap_add=$(echo "$inspect" | jq -r '.[0].HostConfig.CapAdd[]?' 2>/dev/null || true)
    if [[ -n "$cap_add" ]]; then
        extra_caps=""
        while IFS= read -r cap; do
            if ! echo "$DEFAULT_CAPS" | grep -qw "$cap"; then
                extra_caps+="${cap} "
            fi
        done <<< "$cap_add"
        if [[ -n "$extra_caps" ]]; then
            json_finding "extra_caps_${safe_name}" "$SEV_WARN" \
                "Container '${name}' has extra capabilities: ${extra_caps}"
        fi
    fi

    # Check: No seccomp profile
    seccomp=$(echo "$inspect" | jq -r '.[0].HostConfig.SecurityOpt[]?' 2>/dev/null | grep seccomp || true)
    seccomp_profile=$(echo "$inspect" | jq -r '.[0].HostConfig.SecurityOpt // []' 2>/dev/null || echo "[]")
    # If SecurityOpt is empty or doesn't mention seccomp, default profile is used (which is fine)
    # Only flag if seccomp is explicitly disabled
    if echo "$seccomp_profile" | grep -q "seccomp=unconfined" 2>/dev/null; then
        json_finding "no_seccomp_${safe_name}" "$SEV_INFO" \
            "Container '${name}' has seccomp explicitly disabled (unconfined)"
    fi

done <<< "$container_ids"

finalize_check

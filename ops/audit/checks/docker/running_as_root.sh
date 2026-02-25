#!/usr/bin/env bash
# Check: docker/running_as_root
# Cadence: daily
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/running_as_root"

if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check
fi

# Read containers allowed to run as root from config
allowed_root_raw=$(read_config "containers_allowed_root" 2>/dev/null || echo "")
allowed_root=""
if [[ -n "$allowed_root_raw" ]]; then
    allowed_root=$(echo "$allowed_root_raw" | tr -d '[]"' | tr ',' ' ' | tr -s ' ')
fi

is_allowed_root() {
    local name="$1"
    for allowed in $allowed_root; do
        if [[ "$name" == "$allowed" ]]; then
            return 0
        fi
    done
    return 1
}

# Get all running containers
container_ids=$(docker ps -q 2>/dev/null || true)
if [[ -z "$container_ids" ]]; then
    json_finding "no_running_containers" "$SEV_INFO" "No running Docker containers found"
    finalize_check
fi

root_count=0
checked=0
skipped=0

while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's/^\///')
    safe_name=$(echo "$name" | tr '/:.' '_')

    # Try to get UID inside container (with timeout)
    uid=$(with_timeout 10 docker exec "$cid" id -u 2>/dev/null || echo "unknown")

    if [[ "$uid" == "unknown" ]]; then
        skipped=$((skipped + 1))
        log_info "Container '${name}': could not determine UID (exec failed or timed out)"
        continue
    fi

    checked=$((checked + 1))

    if [[ "$uid" == "0" ]]; then
        root_count=$((root_count + 1))
        if is_allowed_root "$name"; then
            json_finding "root_allowed_${safe_name}" "$SEV_INFO" \
                "Container '${name}' runs as root (UID=0) — allowed by containers_allowed_root config"
        else
            json_finding "running_as_root_${safe_name}" "$SEV_WARN" \
                "Container '${name}' runs as root (UID=0). Consider using a non-root user."
        fi
    else
        log_info "Container '${name}' runs as UID=${uid} [OK]"
    fi
done <<< "$container_ids"

log_info "Checked ${checked} container(s), ${root_count} running as root, ${skipped} skipped"

finalize_check

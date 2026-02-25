#!/usr/bin/env bash
# Check: docker/resource_limits
# Cadence: daily
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/resource_limits"

if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check
fi

# Read always_running containers from config
always_running_raw=$(read_config "expected_containers.always_running" 2>/dev/null || echo "")
always_running=""
if [[ -n "$always_running_raw" ]]; then
    always_running=$(echo "$always_running_raw" | tr -d '[]"' | tr ',' ' ' | tr -s ' ')
fi

# If no config, check all running containers
if [[ -z "$always_running" ]]; then
    log_info "No expected_containers.always_running in config — checking all running containers"
    always_running=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
fi

if [[ -z "$always_running" ]]; then
    json_finding "no_containers" "$SEV_INFO" "No containers to check for resource limits"
    finalize_check
fi

for container in $always_running; do
    [[ -z "$container" ]] && continue
    safe_name=$(echo "$container" | tr '/:.' '_')

    # Check if container exists/is running
    inspect=$(docker inspect "$container" 2>/dev/null || true)
    if [[ -z "$inspect" ]]; then
        json_finding "container_not_found_${safe_name}" "$SEV_WARN" \
            "Expected always-running container '${container}' not found"
        continue
    fi

    state=$(echo "$inspect" | jq -r '.[0].State.Status' 2>/dev/null || echo "unknown")
    if [[ "$state" != "running" ]]; then
        json_finding "container_not_running_${safe_name}" "$SEV_WARN" \
            "Expected always-running container '${container}' is '${state}' (expected: running)"
        continue
    fi

    # Check memory limit
    mem_limit=$(echo "$inspect" | jq -r '.[0].HostConfig.Memory' 2>/dev/null || echo "0")
    if [[ "${mem_limit:-0}" -eq 0 ]]; then
        json_finding "no_mem_limit_${safe_name}" "$SEV_WARN" \
            "Container '${container}' has no memory limit set. Unbounded memory could cause OOM on host."
    else
        mem_mb=$((mem_limit / 1024 / 1024))
        log_info "Container '${container}' memory limit: ${mem_mb}MB"
    fi

    # Check CPU limit
    nano_cpus=$(echo "$inspect" | jq -r '.[0].HostConfig.NanoCpus' 2>/dev/null || echo "0")
    cpu_quota=$(echo "$inspect" | jq -r '.[0].HostConfig.CpuQuota' 2>/dev/null || echo "0")
    if [[ "${nano_cpus:-0}" -eq 0 ]] && [[ "${cpu_quota:-0}" -eq 0 ]]; then
        json_finding "no_cpu_limit_${safe_name}" "$SEV_INFO" \
            "Container '${container}' has no CPU limit set."
    else
        if [[ "${nano_cpus:-0}" -gt 0 ]]; then
            cpu_cores=$(echo "scale=2; ${nano_cpus} / 1000000000" | bc 2>/dev/null || echo "${nano_cpus} nanocpus")
            log_info "Container '${container}' CPU limit: ${cpu_cores} cores"
        fi
    fi
done

finalize_check

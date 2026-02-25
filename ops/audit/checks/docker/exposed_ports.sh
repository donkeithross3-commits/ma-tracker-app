#!/usr/bin/env bash
# Check: docker/exposed_ports
# Cadence: daily
# Severity ceiling: fail-closed
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/exposed_ports"

if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check; exit $?
fi

# Read allowed public ports from config
# read_config returns JSON like: [{"port": 443, "process": "caddy", ...}, ...]
allowed_public_raw=$(read_config "allowed_ports.public" 2>/dev/null || echo "")
allowed_public_ports=""
if [[ -n "$allowed_public_raw" ]]; then
    # Extract just the port numbers from the JSON objects
    if command -v jq &>/dev/null; then
        allowed_public_ports=$(echo "$allowed_public_raw" | jq -r '.[].port' 2>/dev/null | tr '\n' ' ' || true)
    else
        allowed_public_ports=$(echo "$allowed_public_raw" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    print(' '.join(str(p['port']) for p in data if 'port' in p))
except: pass
" 2>/dev/null || true)
    fi
fi

is_allowed_public() {
    local port="$1"
    # Always allow 80 and 443 if no config specified
    if [[ -z "$allowed_public_ports" ]]; then
        [[ "$port" == "80" || "$port" == "443" ]] && return 0
        return 1
    fi
    for allowed in $allowed_public_ports; do
        if [[ "$port" == "$allowed" ]]; then
            return 0
        fi
    done
    return 1
}

# Get container port mappings
container_ids=$(docker ps -q 2>/dev/null || true)
if [[ -z "$container_ids" ]]; then
    json_finding "no_running_containers" "$SEV_INFO" "No running Docker containers found"
    finalize_check; exit $?
fi

# Collect all port mappings from containers
all_mappings=""
while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's/^\///')
    ports=$(docker port "$cid" 2>/dev/null || true)
    if [[ -n "$ports" ]]; then
        while IFS= read -r mapping; do
            all_mappings+="${name}|${mapping}"$'\n'
        done <<< "$ports"
    fi
done <<< "$container_ids"

# Also check host-level listeners via ss
host_listeners=""
if command -v ss &>/dev/null; then
    host_listeners=$(ss -tlnp 2>/dev/null || true)
    echo "$host_listeners" > "${CHECK_ARTIFACT_DIR}/ss_listeners.txt"
fi

# Parse container port mappings
if [[ -n "$all_mappings" ]]; then
    echo "$all_mappings" > "${CHECK_ARTIFACT_DIR}/docker_port_mappings.txt"

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        container_name=$(echo "$line" | cut -d'|' -f1)
        mapping=$(echo "$line" | cut -d'|' -f2-)

        # Format: "container_port/proto -> host_ip:host_port"
        # Handles both IPv4 (0.0.0.0:3000) and IPv6 ([::]:3000 or :::3000)
        host_binding=$(echo "$mapping" | grep -oE '->.*' | sed 's/^-> *//' || true)
        if [[ -z "$host_binding" ]]; then continue; fi

        host_port=$(echo "$host_binding" | rev | cut -d: -f1 | rev)
        host_ip=$(echo "$host_binding" | sed "s/:${host_port}$//")

        if [[ "$host_ip" == "0.0.0.0" ]] || [[ "$host_ip" == "::" ]] || [[ "$host_ip" == "[::0]" ]] || [[ "$host_ip" == "[::]" ]]; then
            # Public binding — check allowlist
            if ! is_allowed_public "$host_port"; then
                json_finding "unauthorized_public_port_${container_name}_${host_port}" "$SEV_CRITICAL" \
                    "Container '${container_name}' exposes port ${host_port} on 0.0.0.0 — NOT in allowed public ports list. FAIL-CLOSED."
            else
                log_info "Container '${container_name}' port ${host_port} on 0.0.0.0 [ALLOWED]"
            fi
        elif [[ "$host_ip" == "127.0.0.1" ]]; then
            # Localhost binding — lower severity
            log_info "Container '${container_name}' port ${host_port} on 127.0.0.1 [localhost only]"
        fi
    done <<< "$all_mappings"
fi

# Cross-check with ss output for any non-Docker public listeners
if [[ -n "$host_listeners" ]]; then
    while IFS= read -r line; do
        # Skip header
        echo "$line" | grep -q "^State" && continue
        [[ -z "$line" ]] && continue

        listen_addr=$(echo "$line" | awk '{print $4}')
        # Check for 0.0.0.0:port or *:port or :::port
        if echo "$listen_addr" | grep -qE '^(\*|0\.0\.0\.0|::):'; then
            port=$(echo "$listen_addr" | rev | cut -d: -f1 | rev)
            process=$(echo "$line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' || echo "unknown")
            [[ -z "$process" ]] && process="unknown"
            if ! is_allowed_public "$port"; then
                json_finding "unexpected_host_listener_${port}" "$SEV_WARN" \
                    "Unexpected public listener on port ${port} (process: ${process})"
            fi
        fi
    done <<< "$host_listeners"
fi

finalize_check

#!/usr/bin/env bash
# Check: network/port_scan
# Cadence: daily
# Severity ceiling: fail-closed
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "network/port_scan"

BASELINE_FILE="${AUDIT_ROOT}/baselines/ports_baseline.json"

# Get all listening TCP ports
if ! command -v ss &>/dev/null; then
    # Fallback to netstat
    if command -v netstat &>/dev/null; then
        raw_listeners=$(netstat -tlnp 2>/dev/null || netstat -tln 2>/dev/null || true)
    else
        json_finding "no_socket_tool" "$SEV_WARN" "Neither ss nor netstat available"
        finalize_check
    fi
else
    raw_listeners=$(ss -tlnp 2>/dev/null || true)
fi

if [[ -z "$raw_listeners" ]]; then
    json_finding "no_listener_data" "$SEV_WARN" "Could not retrieve listening ports"
    finalize_check
fi

echo "$raw_listeners" > "${CHECK_ARTIFACT_DIR}/raw_listeners.txt"

# Parse ss output into JSON array
# ss output format: State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
current_ports="["
first=true
while IFS= read -r line; do
    # Skip header
    echo "$line" | grep -qE '^(State|Netid)' && continue
    [[ -z "$line" ]] && continue

    local_addr=$(echo "$line" | awk '{print $4}')
    # Handle IPv6 brackets and extract address/port
    if [[ "$local_addr" == *"]:"* ]]; then
        addr=$(echo "$local_addr" | grep -oE '\[.*\]' | tr -d '[]')
        port=$(echo "$local_addr" | rev | cut -d: -f1 | rev)
    else
        port=$(echo "$local_addr" | rev | cut -d: -f1 | rev)
        addr=$(echo "$local_addr" | rev | cut -d: -f2- | rev)
    fi

    # Extract process name (avoid grep -P which is not available on macOS)
    process=$(echo "$line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' 2>/dev/null || echo "unknown")
    [[ -z "$process" ]] && process="unknown"

    [[ "$port" =~ ^[0-9]+$ ]] || continue

    if [[ "$first" == "true" ]]; then
        first=false
    else
        current_ports+=","
    fi
    current_ports+="{\"proto\":\"tcp\",\"addr\":\"${addr}\",\"port\":${port},\"process\":\"${process}\"}"
done <<< "$raw_listeners"
current_ports+="]"

# Save current scan
echo "$current_ports" | jq '.' > "${CHECK_ARTIFACT_DIR}/current_ports.json" 2>/dev/null || \
    echo "$current_ports" > "${CHECK_ARTIFACT_DIR}/current_ports.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
    echo "$current_ports" | jq '.' > "$BASELINE_FILE" 2>/dev/null || \
        echo "$current_ports" > "$BASELINE_FILE"
    listener_count=$(echo "$current_ports" | jq 'length' 2>/dev/null || echo "?")
    json_finding "baseline_created" "$SEV_INFO" \
        "No ports baseline found. Created initial baseline with ${listener_count} listener(s)."
else
    # Compare against baseline
    baseline_ports=$(cat "$BASELINE_FILE")

    # Find new listeners (in current but not in baseline)
    new_public=$(echo "$current_ports" | jq -r '.[] | select(.addr == "0.0.0.0" or .addr == "::" or .addr == "*") | "\(.addr):\(.port) (\(.process))"' 2>/dev/null || true)
    baseline_public=$(echo "$baseline_ports" | jq -r '.[] | select(.addr == "0.0.0.0" or .addr == "::" or .addr == "*") | "\(.addr):\(.port) (\(.process))"' 2>/dev/null || true)

    new_local=$(echo "$current_ports" | jq -r '.[] | select(.addr == "127.0.0.1" or .addr == "::1") | "\(.addr):\(.port) (\(.process))"' 2>/dev/null || true)
    baseline_local=$(echo "$baseline_ports" | jq -r '.[] | select(.addr == "127.0.0.1" or .addr == "::1") | "\(.addr):\(.port) (\(.process))"' 2>/dev/null || true)

    # New public listeners — CRITICAL
    new_public_only=$(comm -23 <(echo "$new_public" | sort) <(echo "$baseline_public" | sort) 2>/dev/null || true)
    if [[ -n "$new_public_only" ]]; then
        while IFS= read -r entry; do
            [[ -z "$entry" ]] && continue
            json_finding "new_public_listener" "$SEV_CRITICAL" \
                "New public listener detected: ${entry} — FAIL-CLOSED. Not in baseline."
        done <<< "$new_public_only"
    fi

    # New localhost listeners — WARN
    new_local_only=$(comm -23 <(echo "$new_local" | sort) <(echo "$baseline_local" | sort) 2>/dev/null || true)
    if [[ -n "$new_local_only" ]]; then
        while IFS= read -r entry; do
            [[ -z "$entry" ]] && continue
            json_finding "new_local_listener" "$SEV_WARN" \
                "New localhost listener detected: ${entry}"
        done <<< "$new_local_only"
    fi

    # Removed listeners — INFO
    removed_public=$(comm -13 <(echo "$new_public" | sort) <(echo "$baseline_public" | sort) 2>/dev/null || true)
    if [[ -n "$removed_public" ]]; then
        while IFS= read -r entry; do
            [[ -z "$entry" ]] && continue
            json_finding "removed_listener" "$SEV_INFO" \
                "Listener removed since baseline: ${entry}"
        done <<< "$removed_public"
    fi

    if [[ -z "$new_public_only" && -z "$new_local_only" && -z "$removed_public" ]]; then
        log_info "Port scan matches baseline [OK]"
    fi
fi

finalize_check

#!/usr/bin/env bash
# Check: host/firewall_snapshot
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/firewall_snapshot"

BASELINE_FILE="${AUDIT_ROOT}/baselines/firewall_baseline.json"

# Get current firewall rules — try ufw first, then iptables
fw_output=""
fw_source=""

if command -v ufw &>/dev/null; then
    # Try with sudo -n (non-interactive, no password prompt) first, then without
    fw_output=$(sudo -n ufw status verbose 2>/dev/null || ufw status verbose 2>/dev/null || true)
    fw_source="ufw"
fi

if [[ -z "$fw_output" || "$fw_output" == *"inactive"* ]] && command -v iptables-save &>/dev/null; then
    fw_output=$(sudo -n iptables-save 2>/dev/null || iptables-save 2>/dev/null || true)
    fw_source="iptables"
fi

# If direct commands failed, try reading UFW config files (often world-readable)
if [[ -z "$fw_output" || "$fw_output" == *"inactive"* ]]; then
    if [[ -f /etc/ufw/user.rules ]]; then
        fw_output=$(cat /etc/ufw/user.rules 2>/dev/null || true)
        fw_source="ufw-rules-file"
    fi
fi

# Last resort: check if ufw service is at least active
if [[ -z "$fw_output" ]]; then
    if command -v systemctl &>/dev/null; then
        ufw_active=$(systemctl is-active ufw 2>/dev/null || true)
        if [[ "$ufw_active" == "active" ]]; then
            fw_output="ufw-service-active (rules unreadable without root)"
            fw_source="ufw-systemd"
            json_finding "firewall_active_unreadable" "$SEV_INFO" \
                "UFW firewall is active (systemd confirms) but rules are unreadable without root. Use 'sudo ufw status' to inspect."
            # Save what we know and finalize — don't flag as missing
            echo "$fw_output" > "${CHECK_ARTIFACT_DIR}/firewall_current.txt"
            finalize_check
        fi
    fi
fi

if [[ -z "$fw_output" ]]; then
    json_finding "no_firewall_detected" "$SEV_ALERT" \
        "Cannot read firewall rules — neither ufw nor iptables-save returned data"
    finalize_check
fi

# Hash the current output for comparison
if command -v sha256sum &>/dev/null; then
    current_hash=$(echo "$fw_output" | sha256sum | awk '{print $1}')
elif command -v shasum &>/dev/null; then
    current_hash=$(echo "$fw_output" | shasum -a 256 | awk '{print $1}')
else
    current_hash="hash_unavailable"
fi

# Build current state
current_state=$(cat <<ENDJSON
{
  "source": "${fw_source}",
  "hash": "${current_hash}",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
ENDJSON
)

# Save current snapshot to artifact dir
echo "$fw_output" > "${CHECK_ARTIFACT_DIR}/firewall_current.txt"
echo "$current_state" > "${CHECK_ARTIFACT_DIR}/firewall_state.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
    echo "$current_state" > "$BASELINE_FILE"
    # Also save the raw rules alongside the baseline
    echo "$fw_output" > "${AUDIT_ROOT}/baselines/firewall_rules_raw.txt"
    json_finding "baseline_created" "$SEV_INFO" \
        "No firewall baseline found. Created initial baseline (source: ${fw_source}, hash: ${current_hash:0:16}...)."
else
    baseline_hash=$(jq -r '.hash' "$BASELINE_FILE" 2>/dev/null || true)

    if [[ "$current_hash" != "$baseline_hash" ]]; then
        # Generate diff if we have the raw baseline
        if [[ -f "${AUDIT_ROOT}/baselines/firewall_rules_raw.txt" ]]; then
            diff_output=$(diff "${AUDIT_ROOT}/baselines/firewall_rules_raw.txt" \
                "${CHECK_ARTIFACT_DIR}/firewall_current.txt" 2>/dev/null || true)
            echo "$diff_output" > "${CHECK_ARTIFACT_DIR}/firewall_diff.txt"
        fi
        json_finding "firewall_rules_changed" "$SEV_ALERT" \
            "Firewall rules have changed since baseline (source: ${fw_source}). Baseline hash: ${baseline_hash:0:16}..., Current hash: ${current_hash:0:16}..."
    else
        log_info "Firewall rules match baseline (source: ${fw_source}) [OK]"
    fi
fi

finalize_check

#!/usr/bin/env bash
# Check: host/patch_status
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/patch_status"

# Check if unattended-upgrades is active
if command -v systemctl &>/dev/null; then
    ua_status=$(systemctl is-active unattended-upgrades 2>/dev/null || true)
    if [[ "$ua_status" != "active" ]]; then
        json_finding "unattended_upgrades_inactive" "$SEV_ALERT" \
            "unattended-upgrades service is '${ua_status}' (expected: active). Automatic security patching is disabled."
    else
        log_info "unattended-upgrades is active [OK]"
    fi
else
    json_finding "systemctl_not_found" "$SEV_WARN" \
        "systemctl not available — cannot verify unattended-upgrades status"
fi

# Count pending security updates
if command -v apt &>/dev/null; then
    pending_all=$(apt list --upgradable 2>/dev/null | grep -v "^Listing" || true)
    pending_security=$(echo "$pending_all" | grep -i security || true)
    sec_count=0
    if [[ -n "$pending_security" ]]; then
        sec_count=$(echo "$pending_security" | wc -l | tr -d ' ')
    fi
    total_count=0
    if [[ -n "$pending_all" ]]; then
        total_count=$(echo "$pending_all" | wc -l | tr -d ' ')
    fi

    if [[ "$sec_count" -gt 10 ]]; then
        json_finding "many_security_updates" "$SEV_ALERT" \
            "${sec_count} pending security updates (${total_count} total). Immediate patching recommended."
    elif [[ "$sec_count" -gt 0 ]]; then
        json_finding "pending_security_updates" "$SEV_WARN" \
            "${sec_count} pending security updates (${total_count} total)."
    else
        log_info "No pending security updates (${total_count} total pending)"
    fi
else
    json_finding "apt_not_found" "$SEV_INFO" \
        "apt not available — skipping pending update check (non-Debian system?)"
fi

finalize_check

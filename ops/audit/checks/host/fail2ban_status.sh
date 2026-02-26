#!/usr/bin/env bash
# Check: host/fail2ban_status
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/fail2ban_status"

# Check if fail2ban is installed
if ! command -v fail2ban-client &>/dev/null; then
    json_finding "fail2ban_not_installed" "$SEV_ALERT" \
        "fail2ban is not installed. SSH brute-force protection is absent."
    finalize_check
fi

# Check service status
if command -v systemctl &>/dev/null; then
    f2b_status=$(systemctl is-active fail2ban 2>/dev/null || true)
else
    # Fallback: check if process is running
    if pgrep -x fail2ban-server &>/dev/null; then
        f2b_status="active"
    else
        f2b_status="inactive"
    fi
fi

if [[ "$f2b_status" != "active" ]]; then
    json_finding "fail2ban_not_running" "$SEV_ALERT" \
        "fail2ban service is '${f2b_status}' (expected: active). SSH brute-force protection is down."
    finalize_check
fi

log_info "fail2ban is active [OK]"

# Get jail list and ban counts (needs root — try sudo -n first)
jail_output=$(sudo -n fail2ban-client status 2>/dev/null || fail2ban-client status 2>/dev/null || true)
if [[ -z "$jail_output" ]]; then
    json_finding "fail2ban_status_unreadable" "$SEV_INFO" \
        "fail2ban is active but jail details unreadable without root. Use 'sudo fail2ban-client status' to inspect."
    finalize_check
fi

# Extract jail names
jails=$(echo "$jail_output" | grep "Jail list:" | sed 's/.*Jail list:\s*//' | tr ',' '\n' | tr -d ' ' || true)

total_banned=0
total_currently_banned=0
jail_details=""

for jail in $jails; do
    if [[ -z "$jail" ]]; then continue; fi
    jail_status=$(sudo -n fail2ban-client status "$jail" 2>/dev/null || fail2ban-client status "$jail" 2>/dev/null || true)

    currently_banned=$(echo "$jail_status" | grep "Currently banned:" | awk '{print $NF}' || echo "0")
    total_banned_jail=$(echo "$jail_status" | grep "Total banned:" | awk '{print $NF}' || echo "0")

    total_currently_banned=$((total_currently_banned + ${currently_banned:-0}))
    total_banned=$((total_banned + ${total_banned_jail:-0}))

    jail_details+="jail=${jail} currently_banned=${currently_banned:-0} total_banned=${total_banned_jail:-0}; "
done

# Save details to artifact dir (use python for safe JSON construction)
python3 -c "
import json, sys
data = {
    'service_status': sys.argv[1],
    'jails': sys.argv[2],
    'total_currently_banned': int(sys.argv[3]),
    'total_banned_all_time': int(sys.argv[4]),
    'details': sys.argv[5]
}
with open(sys.argv[6], 'w') as f:
    json.dump(data, f, indent=2)
" "$f2b_status" "$(echo "$jails" | tr '\n' ',' | sed 's/,$//')" \
  "$total_currently_banned" "$total_banned" "$jail_details" \
  "${CHECK_ARTIFACT_DIR}/fail2ban_summary.json"

json_finding "fail2ban_summary" "$SEV_INFO" \
    "fail2ban active. Jails: $(echo "$jails" | tr '\n' ',' | sed 's/,$//'), currently banned: ${total_currently_banned}, total banned: ${total_banned}. ${jail_details}"

finalize_check

#!/usr/bin/env bash
# Check: host/auth_log_summary
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/auth_log_summary"

auth_log=""

# Try journalctl first (systemd), then /var/log/auth.log
if command -v journalctl &>/dev/null; then
    auth_log=$(journalctl -u ssh --since "24 hours ago" --no-pager 2>/dev/null || true)
    # Some systems use sshd instead of ssh
    if [[ -z "$auth_log" ]]; then
        auth_log=$(journalctl -u sshd --since "24 hours ago" --no-pager 2>/dev/null || true)
    fi
fi

if [[ -z "$auth_log" ]] && [[ -r /var/log/auth.log ]]; then
    # Get entries from last 24h — use date-based filtering
    yesterday=$(date -d "24 hours ago" "+%b %e" 2>/dev/null || date -v-24H "+%b %e" 2>/dev/null || true)
    today=$(date "+%b %e" 2>/dev/null || true)
    if [[ -n "$yesterday" && -n "$today" ]]; then
        auth_log=$(grep -E "^(${yesterday}|${today})" /var/log/auth.log 2>/dev/null || true)
    else
        # Fallback: just use last 10000 lines
        auth_log=$(tail -10000 /var/log/auth.log 2>/dev/null || true)
    fi
fi

if [[ -z "$auth_log" ]]; then
    json_finding "auth_logs_unavailable" "$SEV_WARN" \
        "Cannot read SSH auth logs via journalctl or /var/log/auth.log"
    finalize_check
fi

# Count failed password attempts (grep -c returns 1 on no match; use || true to prevent set -e exit)
failed_password=$(echo "$auth_log" | grep -c "Failed password" || true)
[[ -z "$failed_password" ]] && failed_password=0

# Count failed publickey attempts
failed_key=$(echo "$auth_log" | grep -c "Failed publickey" || true)
[[ -z "$failed_key" ]] && failed_key=0

# Count successful logins
accepted=$(echo "$auth_log" | grep -c "Accepted" || true)
[[ -z "$accepted" ]] && accepted=0

# Identify top source IPs for failures
failed_lines=$(echo "$auth_log" | grep "Failed" || true)
top_ips=""
if [[ -n "$failed_lines" ]]; then
    top_ips=$(echo "$failed_lines" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | \
        sort | uniq -c | sort -rn | head -10 || true)
fi

# Save summary to artifact dir (use python for safe JSON construction)
python3 -c "
import json, sys
top_ips_raw = sys.argv[5]
ip_list = []
for line in top_ips_raw.strip().split('\n'):
    parts = line.split()
    if len(parts) >= 2:
        ip_list.append({'ip': parts[1], 'count': int(parts[0])})
data = {
    'period': 'last_24h',
    'failed_password_attempts': int(sys.argv[1]),
    'failed_key_attempts': int(sys.argv[2]),
    'accepted_logins': int(sys.argv[3]),
    'top_failure_ips': ip_list
}
with open(sys.argv[4], 'w') as f:
    json.dump(data, f, indent=2)
" "$failed_password" "$failed_key" "$accepted" \
  "${CHECK_ARTIFACT_DIR}/auth_summary.json" "$top_ips"

# Check for high-volume brute force from single IP not being banned
failed_ssh_threshold=$(read_config "thresholds.failed_ssh_alert" 2>/dev/null || echo "100")
[[ "$failed_ssh_threshold" =~ ^[0-9]+$ ]] || failed_ssh_threshold=100

if [[ -n "$top_ips" ]]; then
    worst_ip_count=$(echo "$top_ips" | head -1 | awk '{print $1}' || echo "0")
    worst_ip_addr=$(echo "$top_ips" | head -1 | awk '{print $2}' || echo "unknown")

    if [[ "${worst_ip_count:-0}" -gt "$failed_ssh_threshold" ]]; then
        # Check if fail2ban is handling it
        f2b_running="no"
        if command -v fail2ban-client &>/dev/null; then
            if systemctl is-active fail2ban &>/dev/null 2>&1 || pgrep -x fail2ban-server &>/dev/null; then
                # Check if the IP is actually banned
                banned=$(fail2ban-client status sshd 2>/dev/null | grep "$worst_ip_addr" || true)
                if [[ -n "$banned" ]]; then
                    f2b_running="yes_and_banned"
                else
                    f2b_running="yes_but_not_banned"
                fi
            fi
        fi

        if [[ "$f2b_running" == "yes_but_not_banned" || "$f2b_running" == "no" ]]; then
            json_finding "brute_force_unbanned" "$SEV_ALERT" \
                "IP ${worst_ip_addr} has ${worst_ip_count} failed attempts in 24h and is NOT banned by fail2ban"
        else
            json_finding "brute_force_banned" "$SEV_INFO" \
                "IP ${worst_ip_addr} has ${worst_ip_count} failed attempts in 24h but IS banned by fail2ban"
        fi
    fi
fi

json_finding "auth_log_summary" "$SEV_INFO" \
    "24h SSH summary: ${failed_password} failed password, ${failed_key} failed key, ${accepted} accepted. Top offender: $(echo "$top_ips" | head -1 | awk '{printf "%s (%s attempts)", $2, $1}' || echo 'none')"

finalize_check

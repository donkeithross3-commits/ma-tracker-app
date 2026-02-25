#!/usr/bin/env bash
# Check: host/ssh_hardening
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/ssh_hardening"

# Expected settings and their required values
# Bash 3.2 compat: use parallel arrays instead of associative array
SETTINGS_KEYS=( PermitRootLogin PasswordAuthentication PubkeyAuthentication X11Forwarding PermitEmptyPasswords )
SETTINGS_VALS=( no              no                     yes                  no             no                  )
MAX_AUTH_TRIES=5

# Try sshd -T first (canonical runtime config), fall back to config file
SSHD_CONFIG=""
if command -v sshd &>/dev/null; then
    SSHD_CONFIG=$(sshd -T 2>/dev/null || true)
fi

if [[ -z "$SSHD_CONFIG" ]] && [[ -f /etc/ssh/sshd_config ]]; then
    SSHD_CONFIG=$(cat /etc/ssh/sshd_config 2>/dev/null || true)
fi

if [[ -z "$SSHD_CONFIG" ]]; then
    json_finding "sshd_config_not_readable" "$SEV_ALERT" "Cannot read sshd configuration via sshd -T or /etc/ssh/sshd_config"
    finalize_check
fi

# Check each expected setting
for i in "${!SETTINGS_KEYS[@]}"; do
    setting="${SETTINGS_KEYS[$i]}"
    expected="${SETTINGS_VALS[$i]}"
    # sshd -T outputs lowercase; config file may be mixed case — normalize
    actual=$(echo "$SSHD_CONFIG" | grep -i "^${setting}" | tail -1 | awk '{print tolower($2)}' || true)

    if [[ -z "$actual" ]]; then
        json_finding "${setting}_not_set" "$SEV_ALERT" "${setting} is not explicitly set (expected: ${expected})"
    elif [[ "$actual" != "$expected" ]]; then
        json_finding "${setting}_misconfigured" "$SEV_ALERT" "${setting} is '${actual}' (expected: ${expected})"
    else
        log_info "${setting} = ${actual} [OK]"
    fi
done

# Check MaxAuthTries separately (numeric comparison)
max_auth=$(echo "$SSHD_CONFIG" | grep -i "^MaxAuthTries" | tail -1 | awk '{print $2}' || true)
if [[ -z "$max_auth" ]]; then
    json_finding "maxauthtries_not_set" "$SEV_ALERT" "MaxAuthTries is not explicitly set (expected: <= ${MAX_AUTH_TRIES})"
elif [[ "$max_auth" -gt "$MAX_AUTH_TRIES" ]]; then
    json_finding "maxauthtries_too_high" "$SEV_ALERT" "MaxAuthTries is ${max_auth} (expected: <= ${MAX_AUTH_TRIES})"
else
    log_info "MaxAuthTries = ${max_auth} [OK]"
fi

finalize_check

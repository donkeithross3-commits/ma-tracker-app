#!/usr/bin/env bash
# Check: host/user_drift
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "host/user_drift"

if ! command -v jq &>/dev/null; then
    json_finding "jq_not_installed" "$SEV_WARN" "jq is required for user_drift check but is not installed"
    finalize_check
fi

BASELINE_FILE="${AUDIT_ROOT}/baselines/users_baseline.json"

# Gather current users: root (uid 0) + human users (uid >= 1000)
current_users=$(getent passwd 2>/dev/null | awk -F: '$3 >= 1000 || $3 == 0 {print $1":"$3":"$6":"$7}' | sort || true)
if [[ -z "$current_users" ]]; then
    json_finding "cannot_read_passwd" "$SEV_ALERT" "Failed to read user database via getent passwd"
    finalize_check
fi

# Gather current sudoers
current_sudoers=""
for f in /etc/sudoers /etc/sudoers.d/*; do
    if [[ -r "$f" ]] 2>/dev/null; then
        current_sudoers+=$(grep -v '^#' "$f" 2>/dev/null | grep -v '^$' | grep -v '^Defaults' || true)
        current_sudoers+=$'\n'
    fi
done
current_sudoers=$(echo "$current_sudoers" | sort -u | sed '/^$/d')

# Build current state JSON
current_state=$(cat <<ENDJSON
{
  "users": $(echo "$current_users" | jq -R -s 'split("\n") | map(select(. != ""))'),
  "sudoers": $(echo "$current_sudoers" | jq -R -s 'split("\n") | map(select(. != ""))')
}
ENDJSON
)

# Save current snapshot to artifact dir
echo "$current_state" > "${CHECK_ARTIFACT_DIR}/current_users.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
    # No baseline — generate one
    echo "$current_state" > "$BASELINE_FILE"
    json_finding "baseline_created" "$SEV_INFO" \
        "No users baseline found. Created initial baseline with $(echo "$current_users" | wc -l | tr -d ' ') users."
    log_info "Baseline written to ${BASELINE_FILE}"
else
    # Compare against baseline
    baseline_users=$(jq -r '.users[]' "$BASELINE_FILE" 2>/dev/null | sort || true)
    baseline_sudoers=$(jq -r '.sudoers[]' "$BASELINE_FILE" 2>/dev/null | sort || true)

    # Find new users
    new_users=$(comm -23 <(echo "$current_users") <(echo "$baseline_users") || true)
    # Find removed users
    removed_users=$(comm -13 <(echo "$current_users") <(echo "$baseline_users") || true)
    # Find sudoers changes
    new_sudoers=$(comm -23 <(echo "$current_sudoers") <(echo "$baseline_sudoers") || true)
    removed_sudoers=$(comm -13 <(echo "$current_sudoers") <(echo "$baseline_sudoers") || true)

    if [[ -n "$new_users" ]]; then
        json_finding "new_users_detected" "$SEV_ALERT" \
            "New user(s) detected since baseline: $(echo "$new_users" | tr '\n' ', ')"
    fi

    if [[ -n "$removed_users" ]]; then
        json_finding "removed_users_detected" "$SEV_ALERT" \
            "User(s) removed since baseline: $(echo "$removed_users" | tr '\n' ', ')"
    fi

    if [[ -n "$new_sudoers" ]]; then
        json_finding "sudoers_additions" "$SEV_ALERT" \
            "New sudoers entries: $(echo "$new_sudoers" | tr '\n' ', ')"
    fi

    if [[ -n "$removed_sudoers" ]]; then
        json_finding "sudoers_removals" "$SEV_ALERT" \
            "Removed sudoers entries: $(echo "$removed_sudoers" | tr '\n' ', ')"
    fi

    if [[ -z "$new_users" && -z "$removed_users" && -z "$new_sudoers" && -z "$removed_sudoers" ]]; then
        log_info "Users and sudoers match baseline [OK]"
    fi
fi

finalize_check

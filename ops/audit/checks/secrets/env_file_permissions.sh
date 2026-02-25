#!/usr/bin/env bash
# Check: secrets/env_file_permissions
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "secrets/env_file_permissions"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# Detect OS for stat command differences
get_file_perms() {
    local file="$1"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        stat -f '%Lp' "$file" 2>/dev/null
    else
        stat -c '%a' "$file" 2>/dev/null
    fi
}

get_file_owner() {
    local file="$1"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        stat -f '%Su' "$file" 2>/dev/null
    else
        stat -c '%U' "$file" 2>/dev/null
    fi
}

current_user=$(whoami)

# Find all .env files
env_files=()
while IFS= read -r f; do
    env_files+=("$f")
done < <(find "$REPO_ROOT" -name '.env*' \
    -not -path '*/node_modules/*' \
    -not -path '*/.git/*' \
    -not -path '*/venv/*' \
    -not -path '*/.venv/*' \
    2>/dev/null || true)

if [[ ${#env_files[@]} -eq 0 ]]; then
    log_info "No .env files found"
    finalize_check
fi

bad_perms=0
wrong_owner=0

for env_file in "${env_files[@]}"; do
    rel_path="${env_file#"$REPO_ROOT"/}"
    perms=$(get_file_perms "$env_file") || continue
    owner=$(get_file_owner "$env_file") || continue

    log_info "Checking $rel_path: perms=$perms owner=$owner"

    # Check permissions
    if [[ "$perms" != "600" ]]; then
        # Check if world-readable (others can read)
        # Octal: last digit includes read (4)
        other_perms=$((perms % 10))
        group_perms=$(( (perms / 10) % 10 ))

        if (( other_perms >= 4 )); then
            json_finding "World-readable env file: $rel_path" "$SEV_ALERT" \
                "File $rel_path has permissions $perms — world-readable (o+r). Should be 600. Fix: chmod 600 $env_file"
            bad_perms=$((bad_perms + 1))
        elif (( group_perms >= 4 )); then
            json_finding "Group-readable env file: $rel_path" "$SEV_WARN" \
                "File $rel_path has permissions $perms — group-readable. Consider restricting to 600."
            bad_perms=$((bad_perms + 1))
        else
            json_finding "Non-standard env file permissions: $rel_path" "$SEV_INFO" \
                "File $rel_path has permissions $perms — expected 600 but not group/world-readable."
        fi
    fi

    # Check ownership
    if [[ "$owner" != "$current_user" ]]; then
        json_finding "Wrong ownership on env file: $rel_path" "$SEV_WARN" \
            "File $rel_path owned by '$owner' but running as '$current_user'."
        wrong_owner=$((wrong_owner + 1))
    fi
done

if [[ $bad_perms -eq 0 && $wrong_owner -eq 0 ]]; then
    log_info "All ${#env_files[@]} .env files have correct permissions (600) and ownership"
fi

finalize_check

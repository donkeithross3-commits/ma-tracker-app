#!/usr/bin/env bash
# Check: secrets/env_file_inventory
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "secrets/env_file_inventory"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

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
    log_info "No .env files found in repository"
    finalize_check
fi

inventory=""
not_gitignored=0

for env_file in "${env_files[@]}"; do
    rel_path="${env_file#"$REPO_ROOT"/}"

    # Extract key names only (NEVER values)
    key_names=""
    if [[ -f "$env_file" ]]; then
        key_names=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$env_file" 2>/dev/null | cut -d= -f1 | sort | tr '\n' ', ' || true)
        key_names="${key_names%,}"  # trim trailing comma
    fi

    key_count=$(echo "$key_names" | tr ',' '\n' | grep -c '.' || true)

    # Check if file is covered by .gitignore
    is_ignored=false
    if (cd "$REPO_ROOT" && git check-ignore -q "$rel_path" 2>/dev/null); then
        is_ignored=true
    fi

    # Build inventory line
    ignore_status="gitignored"
    if ! $is_ignored; then
        ignore_status="NOT GITIGNORED"
        # Skip .example files — those are expected to be tracked
        if [[ "$rel_path" == *.example ]]; then
            ignore_status="example (tracked OK)"
        else
            json_finding "Env file not gitignored: $rel_path" "$SEV_ALERT" \
                "File $rel_path is not covered by .gitignore. This file may contain secrets and should not be committed. Keys: $key_names"
            not_gitignored=$((not_gitignored + 1))
        fi
    fi

    inventory="${inventory}${rel_path} [${ignore_status}] (${key_count} keys): ${key_names}\n"
done

# Save inventory to artifact dir (keys only, never values)
printf '%b' "$inventory" > "${CHECK_ARTIFACT_DIR}/env_inventory.txt" || true

log_info "Env file inventory (${#env_files[@]} files):"
printf '%b' "$inventory" | while IFS= read -r line; do
    [[ -n "$line" ]] && log_info "  $line"
done

if [[ $not_gitignored -eq 0 ]]; then
    log_info "All non-example .env files are properly gitignored"
fi

finalize_check

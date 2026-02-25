#!/usr/bin/env bash
# Check: app/lockfile_drift
# Cadence: daily
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/lockfile_drift"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# Collect all lockfiles to check
lockfiles=()

# JS lockfiles
[[ -f "$REPO_ROOT/package-lock.json" ]] && lockfiles+=("package-lock.json")
[[ -f "$REPO_ROOT/pnpm-lock.yaml" ]] && lockfiles+=("pnpm-lock.yaml")

# Python requirements files
while IFS= read -r f; do
    rel="${f#"$REPO_ROOT"/}"
    lockfiles+=("$rel")
done < <(find "$REPO_ROOT" -name 'requirements*.txt' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/venv/*' -not -path '*/.venv/*' 2>/dev/null)

if [[ ${#lockfiles[@]} -eq 0 ]]; then
    log_info "No lockfiles found to check for drift"
    finalize_check
fi

drift_found=false

for lockfile in "${lockfiles[@]}"; do
    full_path="$REPO_ROOT/$lockfile"
    if [[ ! -f "$full_path" ]]; then
        continue
    fi

    # Check if file is tracked by git
    if ! (cd "$REPO_ROOT" && git ls-files --error-unmatch "$lockfile" &>/dev/null); then
        log_info "$lockfile is not tracked by git — skipping drift check"
        continue
    fi

    # Get diff against HEAD
    diff_output=""
    diff_output=$(cd "$REPO_ROOT" && git diff HEAD -- "$lockfile" 2>/dev/null) || true

    if [[ -n "$diff_output" ]]; then
        drift_found=true
        # Count changed lines
        added=$(echo "$diff_output" | grep -c '^+[^+]' || true)
        removed=$(echo "$diff_output" | grep -c '^-[^-]' || true)
        total_changed=$((added + removed))

        json_finding "Lockfile drift: $lockfile" "$SEV_WARN" \
            "$lockfile modified on disk but not committed. Changed lines: +$added -$removed ($total_changed total). Someone may have run install on the host without committing."

        # Save diff to artifact dir
        echo "$diff_output" > "${CHECK_ARTIFACT_DIR}/${lockfile//\//_}_drift.diff" || true

        log_warn "$lockfile: drift detected (+$added -$removed)"
    else
        log_info "$lockfile: clean (matches HEAD)"
    fi
done

if ! $drift_found; then
    log_info "No lockfile drift detected — all lockfiles match git HEAD"
fi

finalize_check

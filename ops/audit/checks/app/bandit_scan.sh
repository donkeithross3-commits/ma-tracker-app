#!/usr/bin/env bash
# Check: app/bandit_scan
# Cadence: weekly
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/bandit_scan"

# Weekly only — skip if not weekly run day
if ! is_weekly_run; then
    log_info "Skipping bandit_scan — not a weekly run day"
    json_finding "skipped_not_weekly" "$SEV_INFO" "Skipped — not a weekly run day"
    finalize_check
fi

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PYTHON_APP_DIR="$REPO_ROOT/python-service/app"
BASELINE_FILE="${AUDIT_ROOT}/baselines/bandit_baseline.json"

if [[ ! -d "$PYTHON_APP_DIR" ]]; then
    json_finding "Python app directory not found" "$SEV_WARN" \
        "Expected $PYTHON_APP_DIR but directory does not exist."
    finalize_check
fi

# Check if bandit is installed
if ! command -v bandit &>/dev/null; then
    json_finding "bandit not installed" "$SEV_WARN" \
        "bandit is required for Python SAST scanning. Run install_deps.sh to install."
    finalize_check
fi

# Run bandit
log_info "Running bandit scan on $PYTHON_APP_DIR"
scan_output=""
scan_output=$(with_timeout 300 bandit -r "$PYTHON_APP_DIR" -f json -q 2>/dev/null) || true

if [[ -z "$scan_output" ]]; then
    # bandit returns empty on no findings or errors
    scan_output='{"results": [], "errors": []}'
fi

# Save full output to artifact dir
echo "$scan_output" > "${CHECK_ARTIFACT_DIR}/bandit_full.json" || true

# Get current results
current_results=$(echo "$scan_output" | jq -c '.results // []' 2>/dev/null) || current_results="[]"
current_count=$(echo "$current_results" | jq 'length' 2>/dev/null) || current_count=0

if [[ ! -f "$BASELINE_FILE" ]]; then
    # No baseline exists — create one
    log_info "No bandit baseline found — creating initial baseline with $current_count findings"
    mkdir -p "$(dirname "$BASELINE_FILE")"
    echo "$scan_output" > "$BASELINE_FILE"
    json_finding "Bandit baseline created" "$SEV_INFO" \
        "Created initial bandit baseline with $current_count findings. Future scans will compare against this baseline."
    finalize_check
fi

# Baseline exists — compare for NEW findings
log_info "Comparing against baseline"
baseline_results=$(jq -c '.results // []' "$BASELINE_FILE" 2>/dev/null) || baseline_results="[]"

# Build a fingerprint set from baseline: filename + line + test_id
baseline_fingerprints=$(echo "$baseline_results" | jq -r '.[] | "\(.filename):\(.line_number):\(.test_id)"' 2>/dev/null | sort -u) || baseline_fingerprints=""

new_high=0
new_medium=0
new_low=0
new_findings=""

while IFS= read -r finding; do
    [[ -z "$finding" ]] && continue

    fname=$(echo "$finding" | jq -r '.filename' 2>/dev/null) || continue
    lineno=$(echo "$finding" | jq -r '.line_number' 2>/dev/null) || continue
    test_id=$(echo "$finding" | jq -r '.test_id' 2>/dev/null) || continue
    severity=$(echo "$finding" | jq -r '.issue_severity' 2>/dev/null) || continue
    confidence=$(echo "$finding" | jq -r '.issue_confidence' 2>/dev/null) || continue
    issue_text=$(echo "$finding" | jq -r '.issue_text' 2>/dev/null | head -c 200) || continue

    fingerprint="${fname}:${lineno}:${test_id}"

    # Check if this is new (not in baseline)
    if echo "$baseline_fingerprints" | grep -qxF "$fingerprint"; then
        continue
    fi

    new_findings="${new_findings}${new_findings:+, }${test_id} in ${fname}:${lineno}"

    sev_lower=$(echo "$severity" | tr '[:upper:]' '[:lower:]')
    case "$sev_lower" in
        high)   new_high=$((new_high + 1)) ;;
        medium) new_medium=$((new_medium + 1)) ;;
        *)      new_low=$((new_low + 1)) ;;
    esac
done < <(echo "$current_results" | jq -c '.[]' 2>/dev/null)

total_new=$((new_high + new_medium + new_low))

if [[ $new_high -gt 0 ]]; then
    json_finding "New high-severity bandit findings" "$SEV_WARN" \
        "Found $new_high new high-severity SAST findings since baseline. Details: ${new_findings:0:500}"
fi

if [[ $new_medium -gt 0 ]]; then
    json_finding "New medium-severity bandit findings" "$SEV_INFO" \
        "Found $new_medium new medium-severity SAST findings since baseline."
fi

if [[ $new_low -gt 0 ]]; then
    json_finding "New low-severity bandit findings" "$SEV_INFO" \
        "Found $new_low new low-severity SAST findings since baseline."
fi

if [[ $total_new -eq 0 ]]; then
    log_info "No new bandit findings compared to baseline (baseline has $(echo "$baseline_results" | jq 'length') findings)"
fi

finalize_check

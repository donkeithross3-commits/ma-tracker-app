#!/usr/bin/env bash
# Check: secrets/gitleaks_scan
# Cadence: daily (incremental)
# Severity ceiling: fail-closed (critical)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "secrets/gitleaks_scan"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
BASELINE_FILE="${AUDIT_ROOT}/baselines/gitleaks_baseline.json"

# Check if gitleaks is installed
if ! command -v gitleaks &>/dev/null; then
    json_finding "gitleaks not installed" "$SEV_WARN" \
        "gitleaks is required for secret scanning. Run install_deps.sh to install."
    finalize_check
fi

scan_output=""
scan_exit=0

if [[ -f "$BASELINE_FILE" ]]; then
    # Incremental scan against baseline
    log_info "Running incremental gitleaks scan (baseline exists)"
    scan_output=$(with_timeout 300 gitleaks detect \
        --source "$REPO_ROOT" \
        --baseline-path "$BASELINE_FILE" \
        --format json \
        --no-banner 2>/dev/null) || scan_exit=$?
else
    # Full scan — no baseline yet
    log_info "Running full gitleaks scan (no baseline)"
    scan_output=$(with_timeout 300 gitleaks detect \
        --source "$REPO_ROOT" \
        --format json \
        --no-banner 2>/dev/null) || scan_exit=$?

    # Save output as baseline if we got results
    if [[ -n "$scan_output" && "$scan_output" != "null" && "$scan_output" != "[]" ]]; then
        mkdir -p "$(dirname "$BASELINE_FILE")"
        echo "$scan_output" > "$BASELINE_FILE"
        log_info "Saved gitleaks baseline"
    elif [[ $scan_exit -eq 0 ]]; then
        # Clean scan, create empty baseline
        mkdir -p "$(dirname "$BASELINE_FILE")"
        echo "[]" > "$BASELINE_FILE"
        log_info "Clean scan — saved empty baseline"
    fi

    json_finding "Gitleaks baseline created" "$SEV_INFO" \
        "Initial gitleaks baseline created. Future scans will report only new findings."

    # For initial scan, still check for leaks and report them
    if [[ -z "$scan_output" || "$scan_output" == "null" || "$scan_output" == "[]" ]]; then
        log_info "No secrets detected in full scan"
        finalize_check
    fi
fi

# Save scan output to artifact dir AFTER redacting secret values
if [[ -n "$scan_output" && "$scan_output" != "null" ]]; then
    # Redact the "Secret" field from gitleaks JSON output before saving
    redacted_output=$(echo "$scan_output" | jq '
        if type == "array" then
            [.[] | .Secret = "***REDACTED***"]
        else
            .Secret = "***REDACTED***"
        end
    ' 2>/dev/null) || redacted_output="$scan_output"
    echo "$redacted_output" > "${CHECK_ARTIFACT_DIR}/gitleaks_scan.json" || true
fi

# Parse findings
if [[ -z "$scan_output" || "$scan_output" == "null" || "$scan_output" == "[]" ]]; then
    log_info "No new secrets detected"
    finalize_check
fi

# Count and report new leaks
leak_count=$(echo "$scan_output" | jq 'if type == "array" then length else 1 end' 2>/dev/null) || leak_count=0

if [[ $leak_count -gt 0 ]]; then
    # Build detail string WITHOUT the actual secret values
    leak_details=""
    while IFS= read -r leak; do
        [[ -z "$leak" ]] && continue
        file=$(echo "$leak" | jq -r '.File // "unknown"' 2>/dev/null) || continue
        line=$(echo "$leak" | jq -r '.StartLine // "?"' 2>/dev/null) || true
        rule=$(echo "$leak" | jq -r '.RuleID // "unknown"' 2>/dev/null) || true
        # NEVER include the actual secret value
        leak_details="${leak_details}${leak_details:+; }${rule} in ${file}:${line}"
    done < <(echo "$scan_output" | jq -c '.[]' 2>/dev/null || echo "$scan_output" | jq -c '.' 2>/dev/null)

    # This is CRITICAL — fail-closed
    json_finding "NEW SECRET LEAK DETECTED" "$SEV_CRITICAL" \
        "Gitleaks found $leak_count new secret(s) in the repository. ${leak_details:0:500}. IMMEDIATE ACTION REQUIRED: rotate affected credentials and remove from history."

    log_error "CRITICAL: $leak_count new secret leak(s) detected!"
fi

finalize_check

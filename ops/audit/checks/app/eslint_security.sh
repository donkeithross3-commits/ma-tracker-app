#!/usr/bin/env bash
# Check: app/eslint_security
# Cadence: weekly
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/eslint_security"

# Weekly only — skip if not weekly run day
if ! is_weekly_run; then
    log_info "Skipping eslint_security — not a weekly run day"
    json_finding "skipped_not_weekly" "$SEV_INFO" "Skipped — not a weekly run day"
    finalize_check
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
APP_DIR="$REPO_ROOT/app"

if [[ ! -d "$APP_DIR" ]]; then
    json_finding "App directory not found" "$SEV_INFO" \
        "Expected $APP_DIR but directory does not exist. Skipping eslint security scan."
    finalize_check
fi

# Check if npx/eslint is available
if ! command -v npx &>/dev/null; then
    json_finding "npx not available" "$SEV_INFO" \
        "npx is not installed — cannot run eslint security scan. This is best-effort."
    finalize_check
fi

# Check eslint availability
if ! (cd "$REPO_ROOT" && npx eslint --version &>/dev/null); then
    json_finding "eslint not available" "$SEV_INFO" \
        "eslint is not installed or not configured in the project. Skipping security scan."
    finalize_check
fi

log_info "Running eslint security scan on $APP_DIR"

# Run eslint with security rules — best effort
eslint_output=""
eslint_output=$(cd "$REPO_ROOT" && with_timeout 180 npx eslint \
    --plugin security \
    --rule '{"security/detect-object-injection": "warn", "security/detect-non-literal-regexp": "warn", "security/detect-eval-with-expression": "error"}' \
    "$APP_DIR" --format json 2>/dev/null) || true

if [[ -z "$eslint_output" ]]; then
    json_finding "eslint security scan returned no output" "$SEV_INFO" \
        "eslint returned no output — security plugin may not be installed. This is best-effort."
    finalize_check
fi

# Save output to artifact dir
echo "$eslint_output" > "${CHECK_ARTIFACT_DIR}/eslint_security.json" || true

# Parse results
# eslint JSON format: array of {filePath, messages: [{severity, ruleId, message, line}], errorCount, warningCount}
total_errors=0
total_warnings=0

total_errors=$(echo "$eslint_output" | jq '[.[].errorCount] | add // 0' 2>/dev/null) || total_errors=0
total_warnings=$(echo "$eslint_output" | jq '[.[].warningCount] | add // 0' 2>/dev/null) || total_warnings=0

# Filter for security-specific findings
security_errors=0
security_warnings=0

security_errors=$(echo "$eslint_output" | jq '[.[] | .messages[] | select(.ruleId != null and (.ruleId | startswith("security/"))) | select(.severity == 2)] | length' 2>/dev/null) || security_errors=0
security_warnings=$(echo "$eslint_output" | jq '[.[] | .messages[] | select(.ruleId != null and (.ruleId | startswith("security/"))) | select(.severity == 1)] | length' 2>/dev/null) || security_warnings=0

log_info "eslint security: errors=$security_errors warnings=$security_warnings (total eslint: errors=$total_errors warnings=$total_warnings)"

if [[ $security_errors -gt 0 ]]; then
    # Get details of error-level security findings
    details=$(echo "$eslint_output" | jq -r '[.[] | {file: .filePath, msgs: [.messages[] | select(.ruleId != null and (.ruleId | startswith("security/")) and .severity == 2)]} | select(.msgs | length > 0) | .file + ": " + (.msgs | map(.ruleId + " line " + (.line | tostring)) | join(", "))] | join("; ")' 2>/dev/null | head -c 500) || details=""
    json_finding "eslint security errors" "$SEV_WARN" \
        "Found $security_errors error-level security findings. $details"
fi

if [[ $security_warnings -gt 0 ]]; then
    json_finding "eslint security warnings" "$SEV_INFO" \
        "Found $security_warnings warning-level security findings."
fi

if [[ $((security_errors + security_warnings)) -eq 0 ]]; then
    log_info "No eslint security findings"
fi

finalize_check

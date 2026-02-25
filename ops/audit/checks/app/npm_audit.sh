#!/usr/bin/env bash
# Check: app/npm_audit
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/npm_audit"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

# Determine package manager
use_pnpm=false
if [[ -f "$REPO_ROOT/pnpm-lock.yaml" ]]; then
    use_pnpm=true
    pkg_mgr="pnpm"
    lockfile="pnpm-lock.yaml"
elif [[ -f "$REPO_ROOT/package-lock.json" ]]; then
    pkg_mgr="npm"
    lockfile="package-lock.json"
else
    json_finding "No JS lockfile found" "$SEV_WARN" "Neither package-lock.json nor pnpm-lock.yaml found in $REPO_ROOT"
    finalize_check
fi

# Check if package manager is available
if $use_pnpm; then
    if ! command -v pnpm &>/dev/null; then
        json_finding "pnpm not installed" "$SEV_WARN" "pnpm is required for dependency auditing but is not installed."
        finalize_check
    fi
else
    if ! command -v npm &>/dev/null; then
        json_finding "npm not installed" "$SEV_WARN" "npm is required for dependency auditing but is not installed."
        finalize_check
    fi
fi

log_info "Using $pkg_mgr (lockfile: $lockfile)"

# Run audit
audit_output=""
if $use_pnpm; then
    audit_output=$(cd "$REPO_ROOT" && with_timeout 120 pnpm audit --json 2>/dev/null) || true
else
    audit_output=$(cd "$REPO_ROOT" && with_timeout 120 npm audit --omit=dev --json 2>/dev/null) || true
fi

if [[ -z "$audit_output" ]]; then
    json_finding "Audit returned no output" "$SEV_WARN" "$pkg_mgr audit returned no output or timed out"
    finalize_check
fi

# Save output to artifact dir
echo "$audit_output" > "${CHECK_ARTIFACT_DIR}/npm_audit_raw.json" || true

# Parse vulnerabilities by severity
# npm audit --json format: { "vulnerabilities": { "<pkg>": { "severity": "...", ... } } }
# Also has "metadata.vulnerabilities" with counts
critical=0
high=0
moderate=0
low=0

# Try npm audit JSON format first (npm v7+)
if echo "$audit_output" | jq -e '.metadata.vulnerabilities' &>/dev/null; then
    critical=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.critical // 0')
    high=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.high // 0')
    moderate=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.moderate // 0')
    low=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.low // 0')
# Try pnpm audit format
elif echo "$audit_output" | jq -e '.metadata' &>/dev/null; then
    critical=$(echo "$audit_output" | jq -r '.metadata.critical // 0' 2>/dev/null) || critical=0
    high=$(echo "$audit_output" | jq -r '.metadata.high // 0' 2>/dev/null) || high=0
    moderate=$(echo "$audit_output" | jq -r '.metadata.moderate // 0' 2>/dev/null) || moderate=0
    low=$(echo "$audit_output" | jq -r '.metadata.low // 0' 2>/dev/null) || low=0
# Fallback: count from vulnerabilities object
elif echo "$audit_output" | jq -e '.vulnerabilities' &>/dev/null; then
    critical=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "critical")] | length')
    high=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "high")] | length')
    moderate=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "moderate")] | length')
    low=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "low")] | length')
# pnpm audit may use advisories format
elif echo "$audit_output" | jq -e '.advisories' &>/dev/null; then
    critical=$(echo "$audit_output" | jq '[.advisories[] | select(.severity == "critical")] | length')
    high=$(echo "$audit_output" | jq '[.advisories[] | select(.severity == "high")] | length')
    moderate=$(echo "$audit_output" | jq '[.advisories[] | select(.severity == "moderate")] | length')
    low=$(echo "$audit_output" | jq '[.advisories[] | select(.severity == "low")] | length')
else
    log_warn "Could not parse $pkg_mgr audit output format"
    json_finding "Unparseable audit output" "$SEV_WARN" "Could not parse $pkg_mgr audit JSON output — manual review needed. Output saved to artifacts."
    finalize_check
fi

total=$((critical + high + moderate + low))
log_info "$pkg_mgr audit: critical=$critical high=$high moderate=$moderate low=$low (total=$total)"

# Emit findings
if [[ $critical -gt 0 ]]; then
    json_finding "Critical JS dependency vulnerabilities" "$SEV_ALERT" \
        "Found $critical critical severity vulnerabilities in $pkg_mgr dependencies."
fi

if [[ $high -gt 0 ]]; then
    json_finding "High JS dependency vulnerabilities" "$SEV_WARN" \
        "Found $high high severity vulnerabilities in $pkg_mgr dependencies."
fi

if [[ $((moderate + low)) -gt 0 ]]; then
    json_finding "Moderate/Low JS dependency vulnerabilities" "$SEV_INFO" \
        "Found $moderate moderate and $low low severity vulnerabilities in $pkg_mgr dependencies."
fi

if [[ $total -eq 0 ]]; then
    log_info "All JS dependencies clean — no vulnerabilities found"
fi

finalize_check

#!/usr/bin/env bash
# Check: docker/image_scan
# Cadence: weekly
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/image_scan"

TRIVY_TIMEOUT=180
TRIVYIGNORE="${AUDIT_ROOT}/config/.trivyignore"

# Check if trivy is installed
if ! command -v trivy &>/dev/null; then
    json_finding "trivy_not_installed" "$SEV_WARN" \
        "trivy is not installed. Run install_deps.sh to install vulnerability scanner."
    finalize_check
fi

# Check if docker is available
if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check
fi

# List locally-built images — filter out official upstream images
# Convention: locally-built images are typically named without a registry prefix
# or use a custom prefix. We skip images like 'postgres', 'redis', 'nginx' etc.
UPSTREAM_PATTERN="^(postgres|redis|nginx|node|python|alpine|ubuntu|debian|traefik|certbot|cloudflare|mongo|mysql|mariadb|rabbitmq|memcached|elasticsearch|grafana|prometheus|caddy):"

all_images=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -v '<none>' || true)
if [[ -z "$all_images" ]]; then
    json_finding "no_images_found" "$SEV_INFO" "No Docker images found on this host"
    finalize_check
fi

local_images=$(echo "$all_images" | grep -vE "$UPSTREAM_PATTERN" || true)
if [[ -z "$local_images" ]]; then
    json_finding "no_local_images" "$SEV_INFO" \
        "No locally-built images found ($(echo "$all_images" | wc -l | tr -d ' ') upstream images skipped)"
    finalize_check
fi

log_info "Scanning $(echo "$local_images" | wc -l | tr -d ' ') local image(s)"

# Build trivy args
trivy_args=(image --severity HIGH,CRITICAL --format json --quiet)
if [[ -f "$TRIVYIGNORE" ]]; then
    trivy_args+=(--ignorefile "$TRIVYIGNORE")
    log_info "Using .trivyignore from ${TRIVYIGNORE}"
fi

total_critical=0
total_high=0
scanned=0
scan_failures=0

while IFS= read -r image; do
    [[ -z "$image" ]] && continue
    log_info "Scanning ${image}..."

    scan_output=""
    if scan_output=$(with_timeout "$TRIVY_TIMEOUT" trivy "${trivy_args[@]}" "$image" 2>/dev/null); then
        # Save full output (redacted)
        safe_name=$(echo "$image" | tr '/:' '_')
        echo "$scan_output" | redact > "${CHECK_ARTIFACT_DIR}/trivy_${safe_name}.json"

        # Count vulnerabilities
        critical_count=$(echo "$scan_output" | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' 2>/dev/null || echo "0")
        high_count=$(echo "$scan_output" | jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH")] | length' 2>/dev/null || echo "0")

        total_critical=$((total_critical + ${critical_count:-0}))
        total_high=$((total_high + ${high_count:-0}))

        if [[ "${critical_count:-0}" -gt 0 ]]; then
            # Extract top critical CVEs for detail
            top_cves=$(echo "$scan_output" | jq -r '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL") | .VulnerabilityID] | .[0:5] | join(", ")' 2>/dev/null || echo "unknown")
            json_finding "critical_vulns_${safe_name}" "$SEV_ALERT" \
                "Image ${image}: ${critical_count} CRITICAL vulnerabilities found. Top CVEs: ${top_cves}"
        fi

        if [[ "${high_count:-0}" -gt 0 ]]; then
            json_finding "high_vulns_${safe_name}" "$SEV_WARN" \
                "Image ${image}: ${high_count} HIGH vulnerabilities found"
        fi

        scanned=$((scanned + 1))
    else
        scan_failures=$((scan_failures + 1))
        json_finding "scan_failed_${safe_name}" "$SEV_WARN" \
            "Failed to scan image ${image} (timeout=${TRIVY_TIMEOUT}s or trivy error)"
    fi
done <<< "$local_images"

# Summary
json_finding "image_scan_summary" "$SEV_INFO" \
    "Scanned ${scanned} image(s), ${scan_failures} failure(s). Total: ${total_critical} CRITICAL, ${total_high} HIGH vulnerabilities."

finalize_check

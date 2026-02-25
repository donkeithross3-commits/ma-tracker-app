#!/usr/bin/env bash
# Check: network/tls_headers
# Cadence: weekly
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "network/tls_headers"

# Read external URL from config (falls back to production domain)
external_url=$(read_config "external_url" 2>/dev/null || echo "")
[[ -z "$external_url" ]] && external_url="https://dr3-dashboard.com"

log_info "Checking headers for ${external_url}"

# Fetch headers
headers=$(with_timeout 30 curl -sI "$external_url" 2>/dev/null || true)

if [[ -z "$headers" ]]; then
    json_finding "url_unreachable" "$SEV_WARN" \
        "Could not reach ${external_url} — connection failed or timed out"
    finalize_check
fi

# Save headers to artifacts
echo "$headers" > "${CHECK_ARTIFACT_DIR}/response_headers.txt"

# Normalize headers to lowercase for comparison
headers_lower=$(echo "$headers" | tr '[:upper:]' '[:lower:]')

# Check Strict-Transport-Security
if echo "$headers_lower" | grep -q "strict-transport-security"; then
    hsts_value=$(echo "$headers" | grep -i "strict-transport-security" | head -1 | cut -d: -f2- | tr -d '\r' | xargs)
    log_info "HSTS present: ${hsts_value}"
    # Check for recommended max-age (at least 6 months = 15768000)
    max_age=$(echo "$hsts_value" | grep -oE 'max-age=[0-9]+' | cut -d= -f2 || echo "0")
    if [[ "${max_age:-0}" -lt 15768000 ]]; then
        json_finding "hsts_short_maxage" "$SEV_INFO" \
            "HSTS max-age is ${max_age}s (recommended: >= 15768000 / 6 months)"
    fi
else
    json_finding "missing_hsts" "$SEV_WARN" \
        "Missing Strict-Transport-Security header on ${external_url}. HSTS not enforced."
fi

# Check X-Content-Type-Options
if echo "$headers_lower" | grep -q "x-content-type-options"; then
    log_info "X-Content-Type-Options present"
else
    json_finding "missing_content_type_options" "$SEV_INFO" \
        "Missing X-Content-Type-Options header on ${external_url}. (Note: Cloudflare may add this.)"
fi

# Check X-Frame-Options
if echo "$headers_lower" | grep -q "x-frame-options"; then
    xfo_value=$(echo "$headers" | grep -i "x-frame-options" | head -1 | cut -d: -f2- | tr -d '\r' | xargs)
    log_info "X-Frame-Options present: ${xfo_value}"
else
    json_finding "missing_xframe_options" "$SEV_INFO" \
        "Missing X-Frame-Options header on ${external_url}. Consider DENY or SAMEORIGIN."
fi

# Bonus: Check for server version disclosure
server_header=$(echo "$headers" | grep -i "^server:" | head -1 | cut -d: -f2- | tr -d '\r' | xargs || true)
if [[ -n "$server_header" ]] && echo "$server_header" | grep -qE '[0-9]+\.[0-9]+'; then
    json_finding "server_version_disclosed" "$SEV_INFO" \
        "Server header discloses version: '${server_header}'. Consider hiding version info."
fi

finalize_check

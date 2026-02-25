#!/usr/bin/env bash
# Check: network/cloudflare_bypass
# Cadence: weekly
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "network/cloudflare_bypass"

# Detect public IP
public_ip=""
for ip_service in "ifconfig.me" "icanhazip.com" "api.ipify.org"; do
    public_ip=$(with_timeout 10 curl -s "$ip_service" 2>/dev/null || true)
    if [[ -n "$public_ip" ]] && [[ "$public_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        break
    fi
    public_ip=""
done

if [[ -z "$public_ip" ]]; then
    json_finding "cannot_determine_ip" "$SEV_INFO" \
        "Could not determine public IP — skipping Cloudflare bypass check"
    finalize_check
fi

log_info "Detected public IP: ${public_ip}"

# Try direct HTTPS connection to the public IP (bypassing Cloudflare DNS)
# Use -k to accept self-signed certs, --connect-timeout for fast fail
direct_response=$(with_timeout 15 curl -sk -o /dev/null -w "%{http_code}|%{ssl_verify_result}" \
    "https://${public_ip}/" \
    -H "Host: direct-ip-test" 2>/dev/null || echo "000|failed")

http_code=$(echo "$direct_response" | cut -d'|' -f1)
ssl_result=$(echo "$direct_response" | cut -d'|' -f2)

# Also try HTTP
direct_http=$(with_timeout 10 curl -s -o /dev/null -w "%{http_code}" \
    "http://${public_ip}/" \
    -H "Host: direct-ip-test" 2>/dev/null || echo "000")

# Save results to artifacts
cat > "${CHECK_ARTIFACT_DIR}/bypass_test.json" <<ENDJSON
{
  "public_ip": "${public_ip}",
  "https_status": "${http_code}",
  "https_ssl_verify": "${ssl_result}",
  "http_status": "${direct_http}",
  "tested_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
ENDJSON

if [[ "$http_code" == "000" ]] && [[ "$direct_http" == "000" ]]; then
    # Connection refused or timed out — this is GOOD
    log_info "Direct connection to ${public_ip} refused/timed out — Cloudflare proxy working correctly"
    json_finding "bypass_blocked" "$SEV_INFO" \
        "Direct IP connection refused (HTTPS: ${http_code}, HTTP: ${direct_http}). Cloudflare proxy is correctly blocking direct access."
else
    # Something responded — check if it's Cloudflare's own response or the origin server
    # Cloudflare often returns its own error pages even on direct IP
    if [[ "$http_code" =~ ^(403|521|522|523|524|530)$ ]]; then
        log_info "Direct HTTPS got ${http_code} — likely Cloudflare error page (acceptable)"
        json_finding "cloudflare_error_page" "$SEV_INFO" \
            "Direct IP connection got HTTP ${http_code} — likely a Cloudflare error page, not origin bypass."
    else
        # Got a real response — the origin is directly accessible
        if [[ "$http_code" != "000" ]] && [[ "$http_code" != "0" ]]; then
            json_finding "cloudflare_bypass_https" "$SEV_ALERT" \
                "HTTPS direct to ${public_ip} returned HTTP ${http_code}. Origin server is accessible without Cloudflare! Configure firewall to block non-Cloudflare traffic."
        fi
        if [[ "$direct_http" != "000" ]] && [[ "$direct_http" != "0" ]]; then
            json_finding "cloudflare_bypass_http" "$SEV_ALERT" \
                "HTTP direct to ${public_ip} returned HTTP ${direct_http}. Origin server is accessible without Cloudflare on HTTP!"
        fi
    fi
fi

finalize_check

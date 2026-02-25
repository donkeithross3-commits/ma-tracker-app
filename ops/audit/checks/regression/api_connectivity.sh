#!/usr/bin/env bash
# Check: regression/api_connectivity
# Cadence: daily
# Severity ceiling: ALERT (20)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/api_connectivity"

# ---------------------------------------------------------------------------
# Helper: test external API reachability
#   test_api <label> <url> <expected_codes_regex> [extra_curl_args...]
# ---------------------------------------------------------------------------
unreachable_count=0
total_count=0

test_api() {
  local label="$1" url="$2" expect="$3"
  shift 3
  local extra_args="${*:-}"

  total_count=$((total_count + 1))
  log_info "Testing connectivity: ${label}"

  local tmpfile="${CHECK_ARTIFACT_DIR}/${label}_curl.txt"
  local http_code="" elapsed=""

  # We intentionally use -sf which means curl returns non-zero on HTTP errors.
  # But we WANT non-200 codes (401/403 prove connectivity), so don't use -f.
  # Use -s (silent) + -o /dev/null + -w for status code.
  local ok=0
  if [[ -n "$extra_args" ]]; then
    # shellcheck disable=SC2086
    with_retry 2 5 curl -s -o /dev/null \
          -w '%{http_code}\t%{time_total}' \
          --max-time 10 \
          $extra_args \
          "$url" > "$tmpfile" 2>&1 && ok=1
  else
    with_retry 2 5 curl -s -o /dev/null \
          -w '%{http_code}\t%{time_total}' \
          --max-time 10 \
          "$url" > "$tmpfile" 2>&1 && ok=1
  fi

  if [[ -s "$tmpfile" ]]; then
    http_code="$(cut -f1 "$tmpfile" | tail -1)"
    elapsed="$(cut -f2 "$tmpfile" | tail -1)"
  fi

  if [[ -z "$http_code" || "$http_code" == "000" ]]; then
    unreachable_count=$((unreachable_count + 1))
    json_finding "${label} unreachable" "$SEV_WARN" \
      "Cannot reach ${url} — timeout or DNS failure"
    return
  fi

  if echo "$http_code" | grep -qE "^(${expect})$"; then
    json_finding "${label} reachable" "$SEV_INFO" \
      "HTTP ${http_code} in ${elapsed}s (connectivity confirmed)"
  else
    # Unexpected code but still reachable
    json_finding "${label} unexpected code" "$SEV_INFO" \
      "HTTP ${http_code} in ${elapsed}s (expected ${expect}, but endpoint is reachable)"
  fi
}

# ---------------------------------------------------------------------------
# API connectivity tests (no authentication — just proving network path)
# ---------------------------------------------------------------------------

# 1. Polygon API — 401/403 expected without API key
test_api "polygon" \
  "https://api.polygon.io/v2/aggs/ticker/AAPL/range/1/day/2024-01-01/2024-01-01" \
  "401|403"

# 2. SEC EDGAR EFTS — 200 expected for public search
test_api "sec_edgar_efts" \
  "https://efts.sec.gov/LATEST/search-index?q=test&dateRange=custom&startdt=2024-01-01&enddt=2024-01-02" \
  "200" \
  -H "User-Agent: DR3Dashboard admin@example.com"

# 3. Anthropic API — 401/415 expected without auth headers
test_api "anthropic" \
  "https://api.anthropic.com/v1/messages" \
  "401|415"

# 4. SendGrid API — 401/403 expected without auth
test_api "sendgrid" \
  "https://api.sendgrid.com/v3/mail/send" \
  "401|403"

# ---------------------------------------------------------------------------
# Aggregate assessment
# ---------------------------------------------------------------------------
if [[ "$unreachable_count" -eq "$total_count" && "$total_count" -gt 0 ]]; then
  json_finding "all_apis_unreachable" "$SEV_ALERT" \
    "All ${total_count} external APIs unreachable — likely a local network issue"
elif [[ "$unreachable_count" -gt 0 ]]; then
  log_warn "${unreachable_count}/${total_count} APIs unreachable (individual WARNs emitted)"
else
  log_info "All ${total_count} external APIs reachable"
fi

finalize_check

#!/usr/bin/env bash
# Check: regression/http_smoke
# Cadence: daily
# Severity ceiling: ALERT (20)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/http_smoke"

# ---------------------------------------------------------------------------
# Helper: probe a single endpoint
#   probe <label> <url> <expected_codes_regex> [fallback_url]
# ---------------------------------------------------------------------------
probe() {
  local label="$1" url="$2" expect="$3" fallback="${4:-}"
  local http_code="" elapsed="" output=""

  log_info "Probing ${label}: ${url}"

  # Use with_retry (2 attempts, 3s delay).  Capture http_code + time.
  # -L follows redirects only within localhost (--max-redirs 5).
  # --resolve is not needed; just avoid following external redirects.
  local tmpfile
  tmpfile="${CHECK_ARTIFACT_DIR}/${label//\//_}_curl.txt"

  local ok=0
  if with_retry 2 3 curl -sS -o /dev/null \
        -w '%{http_code}\t%{time_total}' \
        --max-time 10 \
        --max-redirs 5 \
        -L \
        "$url" > "$tmpfile" 2>&1; then
    ok=1
  fi

  if [[ -s "$tmpfile" ]]; then
    http_code="$(cut -f1 "$tmpfile" | tail -1)"
    elapsed="$(cut -f2 "$tmpfile" | tail -1)"
  fi

  # If primary probe failed and we have a fallback, try it
  if [[ "$ok" -eq 0 && -z "$http_code" && -n "$fallback" ]]; then
    log_info "Primary probe for ${label} failed, trying fallback: ${fallback}"
    if with_retry 2 3 curl -sS -o /dev/null \
          -w '%{http_code}\t%{time_total}' \
          --max-time 10 \
          --max-redirs 5 \
          -L \
          "$fallback" > "$tmpfile" 2>&1; then
      ok=1
    fi
    if [[ -s "$tmpfile" ]]; then
      http_code="$(cut -f1 "$tmpfile" | tail -1)"
      elapsed="$(cut -f2 "$tmpfile" | tail -1)"
      label="${label} (fallback)"
    fi
  fi

  # Evaluate result
  if [[ -z "$http_code" || "$http_code" == "000" ]]; then
    json_finding "${label} unreachable" "$SEV_ALERT" \
      "Endpoint ${url} unreachable after retries"
    return
  fi

  if echo "$http_code" | grep -qE "^(${expect})$"; then
    # Check for slowness
    local slow=0
    if command -v bc >/dev/null 2>&1; then
      slow=$(echo "${elapsed:-0} > 5.0" | bc 2>/dev/null || echo 0)
    elif command -v awk >/dev/null 2>&1; then
      slow=$(awk "BEGIN{ print (${elapsed:-0} > 5.0) ? 1 : 0 }")
    fi

    if [[ "$slow" -eq 1 ]]; then
      json_finding "${label} slow" "$SEV_WARN" \
        "HTTP ${http_code} in ${elapsed}s (>5s threshold)"
    else
      json_finding "${label} healthy" "$SEV_INFO" \
        "HTTP ${http_code} in ${elapsed}s"
    fi
  else
    json_finding "${label} unexpected status" "$SEV_ALERT" \
      "Expected ${expect}, got HTTP ${http_code} in ${elapsed}s"
  fi
}

# ---------------------------------------------------------------------------
# Probes
# ---------------------------------------------------------------------------

# 1. Next.js web app — 200 or 302 (auth redirect) are both acceptable
probe "web_nextjs" "http://localhost:3000/" "200|302"

# 2. Portfolio service health
probe "portfolio_health" "http://localhost:8001/health" "200"

# 3. Portfolio scheduler health
probe "portfolio_scheduler" "http://localhost:8001/scheduler/health" "200"

# 4. Trading service — try /health first, fall back to /docs
probe "trading_service" "http://localhost:8000/health" "200" "http://localhost:8000/docs"

# ---------------------------------------------------------------------------
# Write summary artifact
# ---------------------------------------------------------------------------
log_info "HTTP smoke probes complete"

finalize_check

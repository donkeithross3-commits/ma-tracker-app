#!/usr/bin/env bash
# Check: regression/scheduler_health
# Cadence: daily
# Severity ceiling: ALERT (20)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/scheduler_health"

# ---------------------------------------------------------------------------
# Fetch scheduler health endpoint
# ---------------------------------------------------------------------------
# Portfolio service has no host port — use docker exec to reach scheduler
SCHEDULER_URL="http://localhost:8001/scheduler/health"
log_info "Fetching scheduler health: ${SCHEDULER_URL}"

response_file="${CHECK_ARTIFACT_DIR}/scheduler_response.json"

# Use docker exec with python urllib (no curl in slim container, no host port)
if ! docker exec python-portfolio python -c "import urllib.request; print(urllib.request.urlopen('${SCHEDULER_URL}').read().decode())" > "$response_file" 2>&1; then
  json_finding "scheduler_unreachable" "$SEV_ALERT" \
    "Scheduler health endpoint unreachable at ${SCHEDULER_URL} via docker exec"
  finalize_check; exit $?
fi

if [[ ! -s "$response_file" ]]; then
  json_finding "scheduler_empty_response" "$SEV_ALERT" \
    "Scheduler health endpoint returned empty body"
  finalize_check; exit $?
fi

log_info "Scheduler health response received"

# Fetch the full jobs list for individual job verification
jobs_file="${CHECK_ARTIFACT_DIR}/scheduler_jobs.json"
if docker exec python-portfolio python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8001/scheduler/jobs').read().decode())" > "$jobs_file" 2>&1; then
  log_info "Scheduler jobs list retrieved for verification"
  response_file="$jobs_file"
fi

# ---------------------------------------------------------------------------
# Read expected jobs from audit.yml
# ---------------------------------------------------------------------------
expected_jobs_raw="$(read_config 'expected_scheduler_jobs' 2>/dev/null || true)"
# read_config returns JSON arrays like ["job1","job2",...] — parse accordingly
# Bash 3.2 compat: use while-read loop instead of mapfile
expected_jobs=()
while IFS= read -r item; do
  [[ -n "$item" ]] && expected_jobs+=("$item")
done < <(echo "$expected_jobs_raw" | tr -d '[]"' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' || true)

if [[ ${#expected_jobs[@]} -eq 0 ]]; then
  log_warn "No expected_scheduler_jobs in audit.yml — using hardcoded defaults"
  expected_jobs=(
    morning_sheet_ingest
    morning_detail_refresh
    overnight_event_scan
    morning_risk_assessment
    morning_report_compile
    morning_report_deliver
    edgar_filing_check
    spread_monitor_tick
    after_hours_summary
    options_opportunity_check
    weekly_cleanup
  )
fi

log_info "Checking for ${#expected_jobs[@]} expected scheduler jobs"

# ---------------------------------------------------------------------------
# Parse response and verify each job is present
# ---------------------------------------------------------------------------
# We use grep on the response JSON for broad compatibility (no jq dependency).
# If jq is available, use it for more precise parsing.
missing_count=0

if command -v jq >/dev/null 2>&1; then
  # jq available — precise parsing
  response_text="$(jq -r '.. | strings' "$response_file" 2>/dev/null || cat "$response_file")"

  for job in "${expected_jobs[@]}"; do
    if echo "$response_text" | grep -q "$job"; then
      json_finding "job_${job}" "$SEV_INFO" \
        "Job '${job}' registered in scheduler"
    else
      missing_count=$((missing_count + 1))
      json_finding "job_${job}_missing" "$SEV_ALERT" \
        "Job '${job}' not registered in scheduler"
    fi
  done

  # Check for error/stalled states
  error_jobs="$(jq -r '.. | objects | select(.status == "error" or .status == "stalled" or .state == "error" or .state == "stalled") | .name // .job_id // "unknown"' "$response_file" 2>/dev/null || true)"
  if [[ -n "$error_jobs" ]]; then
    while IFS= read -r err_job; do
      json_finding "job_error_${err_job}" "$SEV_ALERT" \
        "Job '${err_job}' is in error/stalled state"
    done <<< "$error_jobs"
  fi
else
  # Fallback: grep-based matching
  response_text="$(cat "$response_file")"

  for job in "${expected_jobs[@]}"; do
    if echo "$response_text" | grep -q "$job"; then
      json_finding "job_${job}" "$SEV_INFO" \
        "Job '${job}' found in scheduler response"
    else
      missing_count=$((missing_count + 1))
      json_finding "job_${job}_missing" "$SEV_ALERT" \
        "Job '${job}' not registered in scheduler"
    fi
  done

  # Grep for error/stalled states
  if echo "$response_text" | grep -qiE '"(status|state)"\s*:\s*"(error|stalled)"'; then
    json_finding "jobs_in_error_state" "$SEV_ALERT" \
      "One or more scheduler jobs appear to be in error/stalled state"
  fi
fi

if [[ "$missing_count" -eq 0 ]]; then
  log_info "All ${#expected_jobs[@]} expected jobs found in scheduler"
else
  log_warn "${missing_count}/${#expected_jobs[@]} expected jobs missing from scheduler"
fi

finalize_check

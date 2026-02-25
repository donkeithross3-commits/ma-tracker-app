#!/usr/bin/env bash
# Check: regression/container_health
# Cadence: daily
# Severity ceiling: ALERT (20)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/container_health"

# ---------------------------------------------------------------------------
# Pre-flight: docker must be available
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  json_finding "docker_not_found" "$SEV_ALERT" \
    "docker command not found in PATH"
  finalize_check
fi

# ---------------------------------------------------------------------------
# Read expected containers from audit.yml
# ---------------------------------------------------------------------------
always_running_raw="$(read_config 'expected_containers.always_running' || true)"
on_demand_raw="$(read_config 'expected_containers.on_demand' || true)"

# read_config returns JSON arrays like ["web","python-portfolio","postgres"]
# Parse with jq if available, otherwise strip JSON syntax
# Bash 3.2 compat: use while-read loop instead of mapfile
always_running=()
while IFS= read -r item; do
  [[ -n "$item" ]] && always_running+=("$item")
done < <(echo "$always_running_raw" | tr -d '[]"' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' || true)

on_demand=()
while IFS= read -r item; do
  [[ -n "$item" ]] && on_demand+=("$item")
done < <(echo "$on_demand_raw" | tr -d '[]"' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' || true)

restart_threshold="$(read_config 'thresholds.container_restart_alert' 2>/dev/null || echo "3")"
[[ "$restart_threshold" =~ ^[0-9]+$ ]] || restart_threshold=3

if [[ ${#always_running[@]} -eq 0 ]]; then
  log_warn "No always_running containers found in audit.yml — using defaults"
  always_running=("web" "python-portfolio" "postgres" "caddy")
fi

# ---------------------------------------------------------------------------
# Inspect always-running containers
# ---------------------------------------------------------------------------
summary_file="${CHECK_ARTIFACT_DIR}/container_summary.json"
echo "[" > "$summary_file"
first=true

for cname in "${always_running[@]}"; do
  log_info "Inspecting always_running container: ${cname}"

  status="$(docker inspect --format '{{.State.Status}}' "$cname" 2>/dev/null || echo "not_found")"
  restart_count="$(docker inspect --format '{{.RestartCount}}' "$cname" 2>/dev/null || echo "0")"
  started_at="$(docker inspect --format '{{.State.StartedAt}}' "$cname" 2>/dev/null || echo "")"
  health_status="$(docker inspect --format '{{.State.Health.Status}}' "$cname" 2>/dev/null || echo "n/a")"

  # Calculate uptime if we have a started_at timestamp
  uptime_str="unknown"
  if [[ -n "$started_at" && "$started_at" != "0001-01-01T00:00:00Z" ]]; then
    if command -v date >/dev/null 2>&1; then
      # macOS and GNU date differ; try both
      start_epoch="$(date -jf '%Y-%m-%dT%H:%M:%S' "${started_at%%.*}" '+%s' 2>/dev/null \
                    || date -d "$started_at" '+%s' 2>/dev/null \
                    || echo "")"
      if [[ -n "$start_epoch" ]]; then
        now_epoch="$(date '+%s')"
        diff_secs=$((now_epoch - start_epoch))
        diff_hours=$((diff_secs / 3600))
        diff_days=$((diff_hours / 24))
        remaining_hours=$((diff_hours % 24))
        uptime_str="${diff_days}d ${remaining_hours}h"
      fi
    fi
  fi

  # Write JSON artifact entry
  if [[ "$first" == "true" ]]; then
    first=false
  else
    echo "," >> "$summary_file"
  fi
  cat >> "$summary_file" <<ENTRY
  {"container": "${cname}", "type": "always_running", "status": "${status}", "restart_count": ${restart_count}, "uptime": "${uptime_str}", "health": "${health_status}"}
ENTRY

  # Evaluate
  if [[ "$status" == "not_found" ]]; then
    json_finding "${cname} missing" "$SEV_ALERT" \
      "Always-running container '${cname}' not found"
    continue
  fi

  if [[ "$status" != "running" ]]; then
    json_finding "${cname} not running" "$SEV_ALERT" \
      "Container '${cname}' status: ${status} (expected: running)"
    continue
  fi

  if [[ "$restart_count" -gt "$restart_threshold" ]]; then
    json_finding "${cname} excessive restarts" "$SEV_ALERT" \
      "Container '${cname}' has restarted ${restart_count} times (threshold: ${restart_threshold})"
  fi

  if [[ "$health_status" == "unhealthy" ]]; then
    json_finding "${cname} unhealthy" "$SEV_ALERT" \
      "Container '${cname}' Docker health check reports: unhealthy"
  fi

  json_finding "${cname} running" "$SEV_INFO" \
    "Status: ${status}, uptime: ${uptime_str}, restarts: ${restart_count}, health: ${health_status}"
done

# ---------------------------------------------------------------------------
# Inspect on-demand containers (INFO only)
# ---------------------------------------------------------------------------
for cname in "${on_demand[@]}"; do
  log_info "Inspecting on_demand container: ${cname}"

  status="$(docker inspect --format '{{.State.Status}}' "$cname" 2>/dev/null || echo "not_found")"

  if [[ "$first" == "true" ]]; then
    first=false
  else
    echo "," >> "$summary_file"
  fi
  cat >> "$summary_file" <<ENTRY
  {"container": "${cname}", "type": "on_demand", "status": "${status}"}
ENTRY

  json_finding "${cname} on-demand" "$SEV_INFO" \
    "On-demand container '${cname}' status: ${status}"
done

echo "]" >> "$summary_file"

log_info "Container health inspection complete"

finalize_check

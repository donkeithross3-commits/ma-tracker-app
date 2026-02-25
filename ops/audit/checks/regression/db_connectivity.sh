#!/usr/bin/env bash
# Check: regression/db_connectivity
# Cadence: daily
# Severity ceiling: ALERT (20)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/db_connectivity"

# ---------------------------------------------------------------------------
# Pre-flight: docker must be available
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  json_finding "docker_not_found" "$SEV_ALERT" \
    "docker command not found in PATH — cannot reach postgres via docker exec"
  finalize_check
fi

# ---------------------------------------------------------------------------
# Determine database name from audit.yml or use default
# ---------------------------------------------------------------------------
db_name="$(read_config 'database.name' 2>/dev/null || echo "ma_tracker")"
pg_container="$(read_config 'database.container' 2>/dev/null || echo "postgres")"

log_info "Testing DB connectivity: container=${pg_container}, database=${db_name}"

# ---------------------------------------------------------------------------
# Basic connectivity test via docker exec (no credentials needed)
# Use SET TRANSACTION READ ONLY as a safety belt
# ---------------------------------------------------------------------------
connectivity_ok=false

select1_output="$(docker exec "$pg_container" \
  psql -U postgres -d "$db_name" -t -A \
  -c "BEGIN TRANSACTION READ ONLY; SELECT 1; COMMIT;" 2>&1)" || true

if echo "$select1_output" | grep -q "^1$"; then
  connectivity_ok=true
  json_finding "db_connectivity" "$SEV_INFO" \
    "PostgreSQL connection via docker exec successful (SELECT 1 = OK)"
else
  json_finding "db_connectivity_failed" "$SEV_ALERT" \
    "Cannot connect to PostgreSQL: ${select1_output}"
  finalize_check
fi

# ---------------------------------------------------------------------------
# Connection count vs max_connections
# ---------------------------------------------------------------------------
artifact_file="${CHECK_ARTIFACT_DIR}/db_stats.json"
echo "{" > "$artifact_file"

conn_count="$(docker exec "$pg_container" \
  psql -U postgres -d "$db_name" -t -A \
  -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "")"

max_conns="$(docker exec "$pg_container" \
  psql -U postgres -d "$db_name" -t -A \
  -c "SHOW max_connections;" 2>/dev/null || echo "")"

if [[ -n "$conn_count" && -n "$max_conns" ]]; then
  echo "  \"active_connections\": ${conn_count}," >> "$artifact_file"
  echo "  \"max_connections\": ${max_conns}," >> "$artifact_file"

  # Check if >80% of max
  threshold_exceeded=0
  if command -v awk >/dev/null 2>&1; then
    threshold_exceeded=$(awk "BEGIN{ print (${conn_count} > ${max_conns} * 0.80) ? 1 : 0 }")
  fi

  if [[ "$threshold_exceeded" -eq 1 ]]; then
    json_finding "connection_pool_high" "$SEV_WARN" \
      "Active connections ${conn_count}/${max_conns} (>80% threshold)"
  else
    json_finding "connection_pool" "$SEV_INFO" \
      "Active connections: ${conn_count}/${max_conns}"
  fi
else
  log_warn "Could not retrieve connection stats"
fi

# ---------------------------------------------------------------------------
# Database size
# ---------------------------------------------------------------------------
db_size="$(docker exec "$pg_container" \
  psql -U postgres -d "$db_name" -t -A \
  -c "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null || echo "")"

if [[ -n "$db_size" ]]; then
  echo "  \"database_size\": \"${db_size}\"" >> "$artifact_file"
  json_finding "database_size" "$SEV_INFO" \
    "Database size: ${db_size}"
else
  log_warn "Could not retrieve database size"
fi

echo "}" >> "$artifact_file"

log_info "Database connectivity check complete"

finalize_check

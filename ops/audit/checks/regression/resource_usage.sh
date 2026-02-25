#!/usr/bin/env bash
# Check: regression/resource_usage
# Cadence: daily
# Severity ceiling: WARN (10)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "regression/resource_usage"

# ---------------------------------------------------------------------------
# Read thresholds from audit.yml
# ---------------------------------------------------------------------------
memory_warn_pct="$(read_config 'thresholds.memory_warn_pct' 2>/dev/null || echo "80")"
log_info "Memory warning threshold: ${memory_warn_pct}%"

# ---------------------------------------------------------------------------
# Container resource usage
# ---------------------------------------------------------------------------
artifact_file="${CHECK_ARTIFACT_DIR}/resource_snapshot.json"
echo "{" > "$artifact_file"
echo "  \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"," >> "$artifact_file"

if ! command -v docker >/dev/null 2>&1; then
  json_finding "docker_not_found" "$SEV_WARN" \
    "docker command not found in PATH — cannot collect container stats"
else
  stats_file="${CHECK_ARTIFACT_DIR}/docker_stats_raw.txt"
  if docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}' > "$stats_file" 2>/dev/null; then

    echo "  \"containers\": [" >> "$artifact_file"
    first=true

    while IFS=$'\t' read -r name cpu_pct mem_usage mem_pct net_io block_io; do
      # Strip trailing % from mem_pct for numeric comparison
      mem_num="${mem_pct//%/}"

      if [[ "$first" == "true" ]]; then
        first=false
      else
        echo "," >> "$artifact_file"
      fi
      cat >> "$artifact_file" <<ENTRY
    {"name": "${name}", "cpu": "${cpu_pct}", "mem_usage": "${mem_usage}", "mem_pct": "${mem_pct}", "net_io": "${net_io}", "block_io": "${block_io}"}
ENTRY

      # Check memory threshold
      threshold_exceeded=0
      if command -v awk >/dev/null 2>&1 && [[ -n "$mem_num" ]]; then
        threshold_exceeded=$(awk "BEGIN{ print (${mem_num} > ${memory_warn_pct}) ? 1 : 0 }" 2>/dev/null || echo 0)
      fi

      if [[ "$threshold_exceeded" -eq 1 ]]; then
        json_finding "${name} high memory" "$SEV_WARN" \
          "Container '${name}' memory at ${mem_pct} (threshold: ${memory_warn_pct}%), usage: ${mem_usage}"
      else
        json_finding "${name} resources" "$SEV_INFO" \
          "CPU: ${cpu_pct}, Mem: ${mem_pct} (${mem_usage}), Net: ${net_io}, Block: ${block_io}"
      fi
    done < "$stats_file"

    echo "  ]," >> "$artifact_file"
  else
    log_warn "docker stats failed — Docker may not be running"
    json_finding "docker_stats_failed" "$SEV_WARN" \
      "Could not collect docker stats — Docker daemon may not be running"
    echo "  \"containers\": []," >> "$artifact_file"
  fi
fi

# ---------------------------------------------------------------------------
# Host-level resources
# ---------------------------------------------------------------------------
echo "  \"host\": {" >> "$artifact_file"

# System memory — `free` on Linux, `vm_stat` on macOS
if command -v free >/dev/null 2>&1; then
  # Linux
  mem_info="$(free -m 2>/dev/null | awk '/^Mem:/ {printf "{\"total_mb\": %d, \"used_mb\": %d, \"available_mb\": %d}", $2, $3, $7}')"
  echo "    \"memory\": ${mem_info}," >> "$artifact_file"
  json_finding "host_memory" "$SEV_INFO" \
    "Host memory: ${mem_info}"
elif command -v vm_stat >/dev/null 2>&1; then
  # macOS — approximate from vm_stat
  page_size=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
  total_mem_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  total_mem_mb=$((total_mem_bytes / 1024 / 1024))

  free_pages=$(vm_stat 2>/dev/null | awk '/Pages free/ {gsub(/\./,"",$3); print $3}' || echo 0)
  free_mb=$(( (free_pages * page_size) / 1024 / 1024 ))

  echo "    \"memory\": {\"total_mb\": ${total_mem_mb}, \"free_mb\": ${free_mb}}," >> "$artifact_file"
  json_finding "host_memory" "$SEV_INFO" \
    "Host memory: total=${total_mem_mb}MB, free=${free_mb}MB"
else
  echo "    \"memory\": \"unavailable\"," >> "$artifact_file"
fi

# Load average + CPU core count
load_avg=""
if command -v uptime >/dev/null 2>&1; then
  load_avg="$(uptime 2>/dev/null)"
fi

cpu_cores=1
if command -v nproc >/dev/null 2>&1; then
  cpu_cores="$(nproc 2>/dev/null || echo 1)"
elif command -v sysctl >/dev/null 2>&1; then
  cpu_cores="$(sysctl -n hw.ncpu 2>/dev/null || echo 1)"
fi

echo "    \"cpu_cores\": ${cpu_cores}," >> "$artifact_file"

if [[ -n "$load_avg" ]]; then
  # Extract 1-minute load average
  load_1m="$(echo "$load_avg" | awk -F'load average[s]?: ' '{print $2}' | cut -d',' -f1 | tr -d ' ')"
  if [[ -z "$load_1m" ]]; then
    # macOS format: "load averages: X.XX Y.YY Z.ZZ"
    load_1m="$(echo "$load_avg" | awk -F'load averages: ' '{print $2}' | awk '{print $1}' | tr -d ' ')"
  fi

  echo "    \"load_1m\": \"${load_1m}\"," >> "$artifact_file"
  echo "    \"uptime_raw\": \"$(echo "$load_avg" | sed 's/"/\\"/g')\"" >> "$artifact_file"

  # Check if load > 2x CPU cores
  if [[ -n "$load_1m" ]] && command -v awk >/dev/null 2>&1; then
    high_load=$(awk "BEGIN{ print (${load_1m} > ${cpu_cores} * 2) ? 1 : 0 }" 2>/dev/null || echo 0)
    if [[ "$high_load" -eq 1 ]]; then
      json_finding "host_high_load" "$SEV_WARN" \
        "Load average ${load_1m} exceeds 2x CPU cores (${cpu_cores} cores, threshold: $((cpu_cores * 2)))"
    else
      json_finding "host_load" "$SEV_INFO" \
        "Load average: ${load_1m}, CPU cores: ${cpu_cores}"
    fi
  fi
else
  echo "    \"load\": \"unavailable\"" >> "$artifact_file"
fi

echo "  }" >> "$artifact_file"
echo "}" >> "$artifact_file"

log_info "Resource usage check complete"

finalize_check

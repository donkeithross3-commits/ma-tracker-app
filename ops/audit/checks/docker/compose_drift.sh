#!/usr/bin/env bash
# Check: docker/compose_drift
# Cadence: daily
# Severity ceiling: warn
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "docker/compose_drift"

BASELINE_FILE="${AUDIT_ROOT}/baselines/compose_baseline.json"

# Check if docker compose is available
if ! command -v docker &>/dev/null; then
    json_finding "docker_not_available" "$SEV_WARN" "docker command not found"
    finalize_check
fi

# Try to get the composed config from known app locations
# On the droplet it may be ~/apps/, locally it may be the repo root
compose_config=""
compose_dir=""

# Candidate directories to check for docker-compose
CANDIDATE_DIRS=(
    "${HOME}/apps"
    "${AUDIT_ROOT}/../.."
    "${HOME}/dev/ma-tracker-app"
    "$(pwd)"
)

for dir in "${CANDIDATE_DIRS[@]}"; do
    if [[ -f "${dir}/docker-compose.yml" ]] || [[ -f "${dir}/docker-compose.yaml" ]] || [[ -f "${dir}/compose.yml" ]] || [[ -f "${dir}/compose.yaml" ]]; then
        compose_config=$(cd "$dir" && docker compose config 2>/dev/null || true)
        if [[ -n "$compose_config" ]]; then
            compose_dir="$dir"
            break
        fi
    fi
done

if [[ -z "$compose_config" ]]; then
    json_finding "compose_config_not_found" "$SEV_WARN" \
        "Could not read docker compose config from any known directory: ${CANDIDATE_DIRS[*]}"
    finalize_check
fi

log_info "Read compose config from ${compose_dir}"

# Hash the current config
if command -v sha256sum &>/dev/null; then
    current_hash=$(echo "$compose_config" | sha256sum | awk '{print $1}')
elif command -v shasum &>/dev/null; then
    current_hash=$(echo "$compose_config" | shasum -a 256 | awk '{print $1}')
else
    current_hash="hash_unavailable"
fi

current_state=$(cat <<ENDJSON
{
  "source_dir": "${compose_dir}",
  "hash": "${current_hash}",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
ENDJSON
)

# Save current config to artifacts
echo "$compose_config" > "${CHECK_ARTIFACT_DIR}/compose_current.yml"
echo "$current_state" > "${CHECK_ARTIFACT_DIR}/compose_state.json"

if [[ ! -f "$BASELINE_FILE" ]]; then
    echo "$current_state" > "$BASELINE_FILE"
    echo "$compose_config" > "${AUDIT_ROOT}/baselines/compose_raw.yml"
    json_finding "baseline_created" "$SEV_INFO" \
        "No compose baseline found. Created initial baseline from ${compose_dir} (hash: ${current_hash:0:16}...)."
else
    baseline_hash=$(jq -r '.hash' "$BASELINE_FILE" 2>/dev/null || true)

    if [[ "$current_hash" != "$baseline_hash" ]]; then
        # Generate diff if we have the raw baseline
        diff_output=""
        if [[ -f "${AUDIT_ROOT}/baselines/compose_raw.yml" ]]; then
            diff_output=$(diff "${AUDIT_ROOT}/baselines/compose_raw.yml" \
                "${CHECK_ARTIFACT_DIR}/compose_current.yml" 2>/dev/null || true)
            echo "$diff_output" > "${CHECK_ARTIFACT_DIR}/compose_diff.txt"
        fi
        json_finding "compose_config_drifted" "$SEV_WARN" \
            "Docker Compose config has changed since baseline (source: ${compose_dir}). Review diff in artifacts."
    else
        log_info "Compose config matches baseline [OK]"
    fi
fi

finalize_check

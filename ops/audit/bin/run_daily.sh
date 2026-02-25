#!/usr/bin/env bash
# ops/audit master entrypoint — run all audit checks
# Usage: ./run_daily.sh [--capture-baselines] [--check=<id>] [--quick] [--verbose] [--force-weekly]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

# ============================================================
# Argument parsing
# ============================================================

OPT_CAPTURE_BASELINES=false
OPT_SPECIFIC_CHECK=""
OPT_QUICK=false
OPT_VERBOSE=false
OPT_FORCE_WEEKLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --capture-baselines) OPT_CAPTURE_BASELINES=true; shift ;;
        --check=*)           OPT_SPECIFIC_CHECK="${1#--check=}"; shift ;;
        --quick)             OPT_QUICK=true; shift ;;
        --verbose)           OPT_VERBOSE=true; shift ;;
        --force-weekly)      OPT_FORCE_WEEKLY=true; shift ;;
        -h|--help)
            echo "Usage: $0 [--capture-baselines] [--check=<id>] [--quick] [--verbose] [--force-weekly]"
            echo ""
            echo "  --capture-baselines  Capture current system state as baselines and exit"
            echo "  --check=<id>         Run only a specific check (e.g., host/disk_usage)"
            echo "  --quick              Run only fail-closed (critical) checks"
            echo "  --verbose            Enable verbose output"
            echo "  --force-weekly       Run weekly-only checks even if not scheduled"
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

# ============================================================
# Capture baselines mode
# ============================================================

if $OPT_CAPTURE_BASELINES; then
    log_info "Capturing baselines..."
    bash "${SCRIPT_DIR}/capture_baselines.sh"
    exit $?
fi

# ============================================================
# Setup
# ============================================================

RUN_START=$(date +%s)
RUN_DATE=$(date +%Y-%m-%d)
RUN_ID=$(date +%Y%m%d-%H%M%S)
OVERALL_MAX_SEVERITY=$SEV_INFO

# Create artifacts directory (handles existing dirs with -N suffix)
ARTIFACTS_DIR="$(ensure_artifacts_dir "$RUN_DATE")"
export ARTIFACTS_DIR
log_info "Audit run ${RUN_ID} starting — artifacts: ${ARTIFACTS_DIR}"

# Read config
CHECK_TIMEOUT=$(read_config "schedule.check_timeout_seconds")
CHECK_TIMEOUT="${CHECK_TIMEOUT:-120}"

WEEKLY_CHECKS_RAW=$(read_config "weekly_only_checks")
# Parse weekly-only check list
WEEKLY_ONLY_CHECKS=()
if [[ -n "$WEEKLY_CHECKS_RAW" && "$WEEKLY_CHECKS_RAW" != "null" ]]; then
    while IFS= read -r line; do
        # Strip JSON array formatting
        line="$(echo "$line" | sed 's/[]"[,]//g' | xargs)"
        [[ -n "$line" ]] && WEEKLY_ONLY_CHECKS+=("$line")
    done <<< "$WEEKLY_CHECKS_RAW"
fi

# Determine if weekly checks should run
RUN_WEEKLY=false
if $OPT_FORCE_WEEKLY || is_weekly_run; then
    RUN_WEEKLY=true
    log_info "Weekly checks enabled"
fi

# ============================================================
# Discover and run checks
# ============================================================

CATEGORIES=("host" "docker" "app" "secrets" "network" "regression")
# Bash 3.2 compat: use a temp file instead of associative array
_CAT_RESULTS_FILE="$(mktemp)"
trap 'rm -f "$_CAT_RESULTS_FILE"' EXIT
ALL_RESULT_FILES=()

is_weekly_only_check() {
    local check_id="$1"
    for wc in "${WEEKLY_ONLY_CHECKS[@]:-}"; do
        [[ "$check_id" == "$wc" ]] && return 0
    done
    return 1
}

run_single_check() {
    local check_script="$1"
    local check_id="$2"
    local timeout_secs="$3"

    if $OPT_VERBOSE; then
        log_info "Running: ${check_id} (timeout: ${timeout_secs}s)"
    fi

    local rc=0
    with_timeout "$timeout_secs" bash "$check_script" 2>&1 | while IFS= read -r line; do
        if $OPT_VERBOSE; then echo "  [${check_id}] $line" >&2; fi
    done || rc=$?

    # Timeout returns 124
    if (( rc == 124 )); then
        log_error "Check ${check_id} timed out after ${timeout_secs}s"
        # Create a timeout result
        local category="${check_id%%/*}"
        local check_name="${check_id##*/}"
        python3 -c "
import json, sys, os
check_id = sys.argv[1]
timeout_secs = int(sys.argv[2])
out_path = sys.argv[3]
result = {
    'check_id': check_id,
    'findings': [{'title': f'Check timed out after {timeout_secs}s', 'severity': 20, 'severity_label': 'alert', 'detail': 'Timeout exceeded', 'check_id': check_id}],
    'max_severity': 20,
    'max_severity_label': 'alert',
    'duration_seconds': timeout_secs,
    'timed_out': True
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w') as f:
    json.dump(result, f, indent=2)
" "$check_id" "$timeout_secs" "${ARTIFACTS_DIR}/${category}/${check_name}_result.json"
        rc=20
    fi

    return $rc
}

for category in "${CATEGORIES[@]}"; do
    check_dir="${AUDIT_ROOT}/checks/${category}"
    [[ -d "$check_dir" ]] || continue

    total=0; pass=0; warn=0; alert=0; critical=0
    pids=()
    pid_to_check=()

    # Find executable check scripts
    while IFS= read -r check_script; do
        [[ -z "$check_script" ]] && continue

        check_name="$(basename "$check_script" .sh)"
        check_id="${category}/${check_name}"

        # --check filter
        if [[ -n "$OPT_SPECIFIC_CHECK" && "$check_id" != "$OPT_SPECIFIC_CHECK" ]]; then
            continue
        fi

        # Quick mode: skip weekly-only checks entirely
        if $OPT_QUICK && is_weekly_only_check "$check_id"; then
            log_info "Skipping non-critical check (quick mode): ${check_id}"
            continue
        fi

        # Skip weekly-only checks unless weekly run
        if ! $RUN_WEEKLY && is_weekly_only_check "$check_id"; then
            log_info "Skipping weekly-only check: ${check_id}"
            continue
        fi

        (( total++ )) || true

        # Run check in background for parallelism within category
        (
            export ARTIFACTS_DIR
            run_single_check "$check_script" "$check_id" "$CHECK_TIMEOUT"
        ) &
        pids+=($!)
        pid_to_check+=("$check_id")

    done < <(find "$check_dir" -maxdepth 1 -name '*.sh' -type f 2>/dev/null | sort)

    # Wait for all checks in this category
    for i in "${!pids[@]}"; do
        local_rc=0
        wait "${pids[$i]}" || local_rc=$?

        if (( local_rc >= SEV_CRITICAL )); then
            (( critical++ )) || true
        elif (( local_rc >= SEV_ALERT )); then
            (( alert++ )) || true
        elif (( local_rc >= SEV_WARN )); then
            (( warn++ )) || true
        else
            (( pass++ )) || true
        fi

        if (( local_rc > OVERALL_MAX_SEVERITY )); then
            OVERALL_MAX_SEVERITY=$local_rc
        fi
    done

    echo "${category}=${total}:${pass}:${warn}:${alert}:${critical}" >> "$_CAT_RESULTS_FILE"

    # Collect result files
    while IFS= read -r rf; do
        ALL_RESULT_FILES+=("$rf")
    done < <(find "${ARTIFACTS_DIR}/${category}" -name '*_result.json' 2>/dev/null)

done

# ============================================================
# Build summary.json
# ============================================================

RUN_END=$(date +%s)
RUN_DURATION=$(( RUN_END - RUN_START ))

python3 -c "
import json, sys, os, glob

artifacts_dir = sys.argv[1]
run_date = sys.argv[2]
run_id = sys.argv[3]
duration = int(sys.argv[4])
max_sev = int(sys.argv[5])

# Map severity int to label
def sev_label(s):
    if s >= 30: return 'critical'
    if s >= 20: return 'alert'
    if s >= 10: return 'warn'
    return 'info'

# Collect all findings from result files
all_findings = []
result_files = glob.glob(os.path.join(artifacts_dir, '*', '*_result.json'))
for rf in sorted(result_files):
    with open(rf) as f:
        data = json.load(f)
    all_findings.extend(data.get('findings', []))

# Parse category results from env-passed data
categories = {}
cat_data = sys.argv[6] if len(sys.argv) > 6 else ''
for line in cat_data.strip().split('\n'):
    if not line.strip():
        continue
    parts = line.split('=', 1)
    if len(parts) != 2:
        continue
    cat_name = parts[0]
    nums = parts[1].split(':')
    if len(nums) == 5:
        categories[cat_name] = {
            'total': int(nums[0]),
            'pass': int(nums[1]),
            'warn': int(nums[2]),
            'alert': int(nums[3]),
            'critical': int(nums[4])
        }

summary = {
    'date': run_date,
    'run_id': run_id,
    'duration_seconds': duration,
    'max_severity': sev_label(max_sev),
    'exit_code': max_sev,
    'categories': categories,
    'findings': all_findings,
    'deltas': {}
}

out_path = os.path.join(artifacts_dir, 'summary.json')
with open(out_path, 'w') as f:
    json.dump(summary, f, indent=2)
print(out_path)
" "$ARTIFACTS_DIR" "$RUN_DATE" "$RUN_ID" "$RUN_DURATION" "$OVERALL_MAX_SEVERITY" \
  "$(cat "$_CAT_RESULTS_FILE")"

log_info "Summary written to ${ARTIFACTS_DIR}/summary.json"

# ============================================================
# Render report
# ============================================================

REPORT_SCRIPT="${AUDIT_ROOT}/report/render.sh"
if [[ -x "$REPORT_SCRIPT" ]]; then
    log_info "Rendering report..."
    bash "$REPORT_SCRIPT" "$ARTIFACTS_DIR" || log_warn "Report rendering failed"
else
    log_warn "Report renderer not found or not executable: ${REPORT_SCRIPT}"
fi

# ============================================================
# Send alerts
# ============================================================

ALERT_SCRIPT="${AUDIT_ROOT}/report/alert.sh"
if [[ -x "$ALERT_SCRIPT" ]]; then
    log_info "Evaluating alerts..."
    bash "$ALERT_SCRIPT" "$ARTIFACTS_DIR" || log_warn "Alert dispatch failed"
else
    log_warn "Alert script not found or not executable: ${ALERT_SCRIPT}"
fi

# ============================================================
# Prune old artifacts
# ============================================================

RETENTION_DAYS=$(read_config "schedule.retention_days")
RETENTION_DAYS="${RETENTION_DAYS:-30}"

log_info "Pruning artifacts older than ${RETENTION_DAYS} days..."
find "${AUDIT_ROOT}/artifacts" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true

# ============================================================
# Done
# ============================================================

log_info "Audit run ${RUN_ID} complete: $(severity_label $OVERALL_MAX_SEVERITY) (${RUN_DURATION}s)"
exit "$OVERALL_MAX_SEVERITY"

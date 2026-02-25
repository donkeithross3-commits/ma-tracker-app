#!/usr/bin/env bash
# ops/audit shared library
# Sourced by all check scripts and run_daily.sh

set -euo pipefail

# === Severity Constants ===
SEV_INFO=0
SEV_WARN=10
SEV_ALERT=20
SEV_CRITICAL=30

# === Globals (set by init_check or run_daily.sh) ===
AUDIT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-}"
CHECK_ID=""
CHECK_ARTIFACT_DIR=""
CHECK_START_TIME=""
CHECK_FINDINGS="[]"
MAX_SEVERITY=$SEV_INFO

# === Cached redaction patterns (loaded once) ===
_REDACTION_PATTERNS=""

# ============================================================
# Logging
# ============================================================

_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log_info()  { echo "[$(_ts)] [INFO]  $*" >&2; }
log_warn()  { echo "[$(_ts)] [WARN]  $*" >&2; }
log_error() { echo "[$(_ts)] [ERROR] $*" >&2; }

# ============================================================
# Severity helpers
# ============================================================

severity_label() {
    local sev="${1:?severity_int required}"
    if   (( sev >= SEV_CRITICAL )); then echo "critical"
    elif (( sev >= SEV_ALERT ));    then echo "alert"
    elif (( sev >= SEV_WARN ));     then echo "warn"
    else                                 echo "info"
    fi
}

severity_from_label() {
    local label="${1:?label required}"
    case "$label" in
        info)     echo "$SEV_INFO" ;;
        warn)     echo "$SEV_WARN" ;;
        alert)    echo "$SEV_ALERT" ;;
        critical) echo "$SEV_CRITICAL" ;;
        *)        log_error "Unknown severity label: $label"; echo "$SEV_INFO" ;;
    esac
}

# ============================================================
# Config reading
# ============================================================

read_config() {
    local dotpath="${1:?dotpath required}"
    python3 -c "
import yaml, functools, operator, sys
with open(sys.argv[1]) as f:
    cfg = yaml.safe_load(f)
keys = sys.argv[2].split('.')
try:
    val = functools.reduce(operator.getitem, keys, cfg)
    if isinstance(val, (list, dict)):
        import json; print(json.dumps(val))
    else:
        print(val)
except (KeyError, TypeError):
    pass
" "${AUDIT_ROOT}/config/audit.yml" "$dotpath"
}

read_baseline() {
    local basename="${1:?basename required}"
    local path="${AUDIT_ROOT}/baselines/${basename}"
    if [[ -f "$path" ]]; then
        cat "$path"
    else
        log_warn "Baseline not found: $path"
        echo ""
    fi
}

# ============================================================
# Artifacts directory management
# ============================================================

ensure_artifacts_dir() {
    local date_str="${1:?date_str required}"
    local base="${AUDIT_ROOT}/artifacts/${date_str}"
    local dir="$base"
    local n=1

    # If directory exists, append -N suffix
    while [[ -d "$dir" ]]; do
        dir="${base}-${n}"
        (( n++ )) || true
    done

    mkdir -p "$dir"/{host,docker,app,secrets,network,regression}
    ARTIFACTS_DIR="$dir"
    echo "$dir"
}

# ============================================================
# Check lifecycle
# ============================================================

init_check() {
    local check_id="${1:?check_id required}"
    CHECK_ID="$check_id"
    CHECK_FINDINGS="[]"
    MAX_SEVERITY=$SEV_INFO
    CHECK_START_TIME=$(date +%s)

    # Determine category from check_id (e.g., "host/disk_usage" → "host")
    local category="${check_id%%/*}"
    CHECK_ARTIFACT_DIR="${ARTIFACTS_DIR}/${category}"
    mkdir -p "$CHECK_ARTIFACT_DIR"

    log_info "Starting check: ${CHECK_ID}"
}

json_finding() {
    local title="${1:?title required}"
    local severity_int="${2:?severity_int required}"
    local detail="${3:-}"

    # Update max severity
    if (( severity_int > MAX_SEVERITY )); then
        MAX_SEVERITY=$severity_int
    fi

    # Redact detail before storing
    if [[ -n "$detail" ]]; then
        detail="$(echo "$detail" | redact)"
    fi

    # Append finding to JSON array
    CHECK_FINDINGS="$(python3 -c "
import json, sys
findings = json.loads(sys.argv[1])
findings.append({
    'title': sys.argv[2],
    'severity': int(sys.argv[3]),
    'severity_label': sys.argv[4],
    'detail': sys.argv[5],
    'check_id': sys.argv[6]
})
print(json.dumps(findings))
" "$CHECK_FINDINGS" "$title" "$severity_int" "$(severity_label "$severity_int")" "$detail" "$CHECK_ID")"
}

finalize_check() {
    local end_time
    end_time=$(date +%s)
    local duration=$(( end_time - CHECK_START_TIME ))

    # Determine output filename from check_id
    local check_name="${CHECK_ID##*/}"
    local result_file="${CHECK_ARTIFACT_DIR}/${check_name}_result.json"

    python3 -c "
import json, sys
result = {
    'check_id': sys.argv[1],
    'findings': json.loads(sys.argv[2]),
    'max_severity': int(sys.argv[3]),
    'max_severity_label': sys.argv[4],
    'duration_seconds': int(sys.argv[5]),
    'timestamp': sys.argv[6]
}
with open(sys.argv[7], 'w') as f:
    json.dump(result, f, indent=2)
" "$CHECK_ID" "$CHECK_FINDINGS" "$MAX_SEVERITY" "$(severity_label "$MAX_SEVERITY")" \
  "$duration" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$result_file"

    log_info "Check ${CHECK_ID} complete: $(severity_label "$MAX_SEVERITY") (${duration}s) → ${result_file}"
    return "$MAX_SEVERITY"
}

# ============================================================
# Redaction
# ============================================================

redact() {
    # Reads stdin, applies redaction patterns, writes to stdout
    local redaction_file="${AUDIT_ROOT}/config/redaction.yml"

    if [[ ! -f "$redaction_file" ]]; then
        cat  # no redaction config, pass through
        return
    fi

    python3 -c "
import sys, re, yaml

with open(sys.argv[1]) as f:
    config = yaml.safe_load(f)

patterns = []
for p in (config or {}).get('patterns', []):
    try:
        patterns.append((re.compile(p['pattern']), p['label'], p.get('context_required', False)))
    except re.error:
        pass

ctx_words = re.compile(r'(?i)(key|token|secret|password|credential)')
for line in sys.stdin:
    for regex, label, ctx_req in patterns:
        if ctx_req:
            if ctx_words.search(line):
                line = regex.sub(label, line)
        else:
            line = regex.sub(label, line)
    sys.stdout.write(line)
" "$redaction_file"
}

# ============================================================
# Schedule helpers
# ============================================================

is_weekly_run() {
    local scan_day
    scan_day="$(read_config 'schedule.weekly_scan_day')"
    scan_day="${scan_day:-0}"
    local today_dow
    today_dow="$(date +%w)"  # 0=Sunday
    [[ "$today_dow" == "$scan_day" ]]
}

# ============================================================
# Execution helpers
# ============================================================

with_timeout() {
    local seconds="${1:?seconds required}"
    shift
    if command -v timeout &>/dev/null; then
        timeout "$seconds" "$@"
    elif command -v gtimeout &>/dev/null; then
        gtimeout "$seconds" "$@"
    else
        # Fallback: use perl or just run without timeout
        local pid
        "$@" &
        pid=$!
        (
            sleep "$seconds"
            kill -TERM "$pid" 2>/dev/null
        ) &
        local watcher=$!
        local rc=0
        wait "$pid" 2>/dev/null || rc=$?
        kill "$watcher" 2>/dev/null
        wait "$watcher" 2>/dev/null || true
        if (( rc == 143 )); then
            return 124  # match GNU timeout convention
        fi
        return $rc
    fi
}

with_retry() {
    local attempts="${1:?attempts required}"
    local delay="${2:?delay required}"
    shift 2
    local n=0
    while (( n < attempts )); do
        if "$@"; then
            return 0
        fi
        (( n++ )) || true
        if (( n < attempts )); then
            log_warn "Retry $n/$attempts in ${delay}s: $*"
            sleep "$delay"
        fi
    done
    log_error "All $attempts attempts failed: $*"
    return 1
}

# ============================================================
# JSON helpers
# ============================================================

diff_json() {
    local file1="${1:?file1 required}"
    local file2="${2:?file2 required}"

    python3 -c "
import json, sys

def flatten(obj, prefix=''):
    items = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            items.update(flatten(v, f'{prefix}.{k}' if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            items.update(flatten(v, f'{prefix}[{i}]'))
    else:
        items[prefix] = obj
    return items

with open(sys.argv[1]) as f:
    a = flatten(json.load(f))
with open(sys.argv[2]) as f:
    b = flatten(json.load(f))

added   = {k: b[k] for k in set(b) - set(a)}
removed = {k: a[k] for k in set(a) - set(b)}
changed = {k: {'old': a[k], 'new': b[k]} for k in set(a) & set(b) if a[k] != b[k]}

result = {'added': added, 'removed': removed, 'changed': changed}
print(json.dumps(result, indent=2, default=str))
" "$file1" "$file2"
}

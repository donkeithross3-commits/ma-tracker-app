#!/usr/bin/env bash
# Check: app/pip_audit
# Cadence: daily
# Severity ceiling: alert
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/pip_audit"

# Collect all requirements files from ma-tracker-app and py_proj
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
# py_proj location: check common paths (droplet ~/apps, dev machine)
PY_PROJ=""
for candidate in "${HOME}/apps/py_proj" "${REPO_ROOT}/../py_proj" "${HOME}/dev/py_proj"; do
    if [[ -d "$candidate" ]]; then
        PY_PROJ="$(cd "$candidate" && pwd)"
        break
    fi
done

req_files=()
while IFS= read -r f; do
    req_files+=("$f")
done < <(find "$REPO_ROOT/python-service" "$REPO_ROOT" -maxdepth 1 -name 'requirements*.txt' 2>/dev/null)

# Also check py_proj
if [[ -n "$PY_PROJ" && -d "$PY_PROJ" ]]; then
    while IFS= read -r f; do
        req_files+=("$f")
    done < <(find "$PY_PROJ" -maxdepth 1 -name 'requirements*.txt' 2>/dev/null)
fi

# Deduplicate (Bash 3.2 compat: use while-read loop instead of mapfile)
deduped=()
while IFS= read -r item; do
    [[ -n "$item" ]] && deduped+=("$item")
done < <(printf '%s\n' "${req_files[@]}" | sort -u)
req_files=("${deduped[@]+"${deduped[@]}"}")

if [[ ${#req_files[@]} -eq 0 ]]; then
    json_finding "No requirements files found" "$SEV_WARN" "Could not locate any requirements*.txt files to audit"
    finalize_check
fi

# Check if pip-audit is installed
if ! command -v pip-audit &>/dev/null; then
    json_finding "pip-audit not installed" "$SEV_WARN" "pip-audit is required for dependency auditing. Run install_deps.sh to install."
    finalize_check
fi

# Load suppressions from audit.yml if available
suppressed_cves=()
if suppression_list="$(read_config 'suppressions.pip_audit' 2>/dev/null)"; then
    while IFS= read -r cve; do
        [[ -n "$cve" ]] && suppressed_cves+=("$cve")
    done <<< "$suppression_list"
fi

total_vulns=0
total_critical=0
total_high=0
total_moderate=0
total_low=0

for req_file in "${req_files[@]}"; do
    rel_path="${req_file#"$REPO_ROOT"/}"
    [[ "$req_file" == "$REPO_ROOT/$rel_path" ]] || rel_path="$req_file"

    log_info "Auditing: $rel_path"

    audit_output=""
    audit_output=$(with_timeout 120 pip-audit -r "$req_file" --format json 2>/dev/null) || true

    if [[ -z "$audit_output" ]]; then
        json_finding "pip-audit failed for $rel_path" "$SEV_WARN" "pip-audit returned no output or timed out for $rel_path"
        continue
    fi

    # Save raw output to artifact dir (redacted)
    echo "$audit_output" | redact > "${CHECK_ARTIFACT_DIR}/${rel_path//\//_}_audit.json" || true

    # Parse vulnerabilities from JSON
    # pip-audit JSON format: {"dependencies": [...], "vulnerabilities": [...]}
    # or array of {name, version, vulns: [{id, fix_versions, description}]}
    vuln_count=0
    crit_count=0
    high_count=0
    mod_count=0
    low_count=0

    # Extract vulnerability entries
    while IFS= read -r vuln_line; do
        [[ -z "$vuln_line" ]] && continue

        vuln_id=$(echo "$vuln_line" | jq -r '.id // .aliases[0] // "unknown"' 2>/dev/null) || continue
        vuln_name=$(echo "$vuln_line" | jq -r '.name // "unknown"' 2>/dev/null) || true
        vuln_desc=$(echo "$vuln_line" | jq -r '.description // ""' 2>/dev/null | head -c 200) || true

        # Check if suppressed
        is_suppressed=false
        for scve in "${suppressed_cves[@]+"${suppressed_cves[@]}"}"; do
            if [[ "$vuln_id" == "$scve" ]]; then
                is_suppressed=true
                break
            fi
        done
        if $is_suppressed; then
            log_info "Suppressed: $vuln_id"
            continue
        fi

        vuln_count=$((vuln_count + 1))

        # Determine severity from the fix_versions and description heuristics
        # pip-audit doesn't always include severity directly; we infer from aliases
        severity_label="unknown"
        if echo "$vuln_line" | jq -e '.fix_versions | length > 0' &>/dev/null; then
            # Has a fix available — check description for severity hints
            desc_lower=$(echo "$vuln_desc" | tr '[:upper:]' '[:lower:]')
            if echo "$desc_lower" | grep -qE 'critical|remote code execution|rce'; then
                severity_label="critical"
                crit_count=$((crit_count + 1))
            elif echo "$desc_lower" | grep -qE 'high|denial.of.service|arbitrary'; then
                severity_label="high"
                high_count=$((high_count + 1))
            elif echo "$desc_lower" | grep -qE 'moderate|medium'; then
                severity_label="moderate"
                mod_count=$((mod_count + 1))
            else
                severity_label="low"
                low_count=$((low_count + 1))
            fi
        else
            # No fix available — treat as moderate by default
            severity_label="moderate"
            mod_count=$((mod_count + 1))
        fi
    done < <(echo "$audit_output" | jq -c '.dependencies[]? | select(.vulns | length > 0) | .vulns[]? + {name: .name}' 2>/dev/null || echo "$audit_output" | jq -c '.[]? | select(.vulns | length > 0) | .vulns[]? + {name: .name}' 2>/dev/null || true)

    total_vulns=$((total_vulns + vuln_count))
    total_critical=$((total_critical + crit_count))
    total_high=$((total_high + high_count))
    total_moderate=$((total_moderate + mod_count))
    total_low=$((total_low + low_count))

    if [[ $vuln_count -gt 0 ]]; then
        log_warn "$rel_path: $vuln_count vulnerabilities (critical=$crit_count high=$high_count moderate=$mod_count low=$low_count)"
    else
        log_info "$rel_path: no vulnerabilities found"
    fi
done

# Emit findings based on severity
if [[ $total_critical -gt 0 || $total_high -gt 0 ]]; then
    json_finding "Critical/High CVEs in Python dependencies" "$SEV_ALERT" \
        "Found $total_critical critical and $total_high high severity vulnerabilities across ${#req_files[@]} requirements files. Total: $total_vulns vulns."
fi

if [[ $total_moderate -gt 0 ]]; then
    json_finding "Moderate CVEs in Python dependencies" "$SEV_WARN" \
        "Found $total_moderate moderate severity vulnerabilities across Python dependencies."
fi

if [[ $total_low -gt 0 ]]; then
    json_finding "Low CVEs in Python dependencies" "$SEV_INFO" \
        "Found $total_low low severity vulnerabilities across Python dependencies."
fi

if [[ $total_vulns -eq 0 ]]; then
    log_info "All Python dependencies clean — no vulnerabilities found"
fi

finalize_check

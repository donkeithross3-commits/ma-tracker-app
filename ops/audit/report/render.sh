#!/usr/bin/env bash
# Render audit report from summary.json → report.md
# Usage: ./render.sh <artifacts_dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

ARTIFACTS_DIR="${1:?Usage: render.sh <artifacts_dir>}"
SUMMARY_FILE="${ARTIFACTS_DIR}/summary.json"
TEMPLATE="${AUDIT_ROOT}/report/templates/report.md.tmpl"
OUTPUT="${ARTIFACTS_DIR}/report.md"

if [[ ! -f "$SUMMARY_FILE" ]]; then
    echo "ERROR: summary.json not found at ${SUMMARY_FILE}" >&2
    exit 1
fi

if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: template not found at ${TEMPLATE}" >&2
    exit 1
fi

python3 -c "
import json, sys, os
from datetime import datetime

artifacts_dir = sys.argv[1]
summary_file = sys.argv[2]
template_file = sys.argv[3]
output_file = sys.argv[4]

with open(summary_file) as f:
    summary = json.load(f)

with open(template_file) as f:
    template = f.read()

# === Status badge ===
sev = summary['max_severity']
status_map = {
    'info': 'PASS',
    'warn': 'WARN',
    'alert': 'ALERT',
    'critical': 'CRITICAL'
}
status = status_map.get(sev, sev.upper())

# === Duration ===
dur = summary.get('duration_seconds', 0)
if dur >= 60:
    duration_str = f'{dur // 60}m {dur % 60}s'
else:
    duration_str = f'{dur}s'

# === Summary table ===
categories = summary.get('categories', {})
table_lines = []
table_lines.append('| Category | Total | Pass | Warn | Alert | Critical |')
table_lines.append('|----------|-------|------|------|-------|----------|')
for cat_name in sorted(categories.keys()):
    c = categories[cat_name]
    table_lines.append(
        f\"| {cat_name:<8} | {c.get('total',0):>5} | {c.get('pass',0):>4} | {c.get('warn',0):>4} | {c.get('alert',0):>5} | {c.get('critical',0):>8} |\"
    )
# Totals row
totals = {k: sum(c.get(k, 0) for c in categories.values()) for k in ['total', 'pass', 'warn', 'alert', 'critical']}
table_lines.append(
    f\"| **Total** | **{totals['total']}** | **{totals['pass']}** | **{totals['warn']}** | **{totals['alert']}** | **{totals['critical']}** |\"
)
summary_table = '\n'.join(table_lines)

# === Findings (WARN and above) ===
findings = summary.get('findings', [])
notable = [f for f in findings if f.get('severity', 0) >= 10]
if notable:
    findings_lines = []
    # Sort by severity descending
    notable.sort(key=lambda x: x.get('severity', 0), reverse=True)
    for f in notable:
        sev_label = f.get('severity_label', 'info').upper()
        title = f.get('title', 'Unknown')
        check = f.get('check_id', '')
        detail = f.get('detail', '')
        findings_lines.append(f'### [{sev_label}] {title}')
        findings_lines.append(f'**Check:** {check}')
        if detail:
            cb = chr(96) * 3  # triple backtick, avoids bash interpretation
            findings_lines.append(f'{cb}\n{detail}\n{cb}')
        findings_lines.append('')
    findings_section = '\n'.join(findings_lines)
else:
    findings_section = '_No findings at WARN level or above._'

# === Deltas ===
deltas = summary.get('deltas', {})
if deltas:
    delta_lines = []
    for key, val in deltas.items():
        delta_lines.append(f'- **{key}**: {json.dumps(val)}')
    deltas_section = '\n'.join(delta_lines)
else:
    deltas_section = '_No deltas computed (first run or no previous data)._'

# === Render ===
report = template
report = report.replace('{{DATE}}', summary.get('date', 'unknown'))
report = report.replace('{{RUN_ID}}', summary.get('run_id', 'unknown'))
report = report.replace('{{STATUS}}', status)
report = report.replace('{{DURATION}}', duration_str)
report = report.replace('{{EXIT_CODE}}', str(summary.get('exit_code', 0)))
report = report.replace('{{SUMMARY_TABLE}}', summary_table)
report = report.replace('{{FINDINGS}}', findings_section)
report = report.replace('{{DELTAS}}', deltas_section)

with open(output_file, 'w') as f:
    f.write(report)

print(f'Report written to {output_file}')
" "$ARTIFACTS_DIR" "$SUMMARY_FILE" "$TEMPLATE" "$OUTPUT"

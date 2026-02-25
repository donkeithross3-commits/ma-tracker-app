#!/usr/bin/env bash
# Send audit alerts based on severity level
# Usage: ./alert.sh <artifacts_dir>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${AUDIT_ROOT}/bin/lib.sh"

ARTIFACTS_DIR="${1:?Usage: alert.sh <artifacts_dir>}"
SUMMARY_FILE="${ARTIFACTS_DIR}/summary.json"

if [[ ! -f "$SUMMARY_FILE" ]]; then
    log_error "summary.json not found at ${SUMMARY_FILE}"
    exit 1
fi

# Read alert config
SENDGRID_ENV_VAR=$(read_config "alert.sendgrid_env_var")
SENDGRID_ENV_VAR="${SENDGRID_ENV_VAR:-SENDGRID_API_KEY}"
FROM_EMAIL=$(read_config "alert.from_email")
FROM_EMAIL="${FROM_EMAIL:-audit@dr3-dashboard.com}"

# Check if API key is available
API_KEY="${!SENDGRID_ENV_VAR:-}"

# Parse summary into separate variables using temp files to handle multi-line output
_alert_tmp="$(mktemp -d)"
trap 'rm -rf "$_alert_tmp"' EXIT

python3 -c "
import json, sys, os

with open(sys.argv[1]) as f:
    summary = json.load(f)

tmp_dir = sys.argv[2]
sev = summary.get('max_severity', 'info')
exit_code = summary.get('exit_code', 0)
run_date = summary.get('date', 'unknown')
findings = summary.get('findings', [])

# Filter to WARN+ findings for email body
notable = [f for f in findings if f.get('severity', 0) >= 10]
notable.sort(key=lambda x: x.get('severity', 0), reverse=True)

finding_lines = []
for f in notable[:20]:  # Cap at 20 findings in email
    sl = f.get('severity_label', 'info').upper()
    title = f.get('title', 'Unknown')
    finding_lines.append(f'  [{sl}] {title}')

finding_text = chr(10).join(finding_lines) if finding_lines else '  (none)'

with open(os.path.join(tmp_dir, 'severity'), 'w') as f: f.write(sev)
with open(os.path.join(tmp_dir, 'exit_code'), 'w') as f: f.write(str(exit_code))
with open(os.path.join(tmp_dir, 'run_date'), 'w') as f: f.write(run_date)
with open(os.path.join(tmp_dir, 'finding_text'), 'w') as f: f.write(finding_text)
" "$SUMMARY_FILE" "$_alert_tmp"

SEVERITY="$(cat "$_alert_tmp/severity")"
EXIT_CODE="$(cat "$_alert_tmp/exit_code")"
RUN_DATE="$(cat "$_alert_tmp/run_date")"
FINDING_TEXT="$(cat "$_alert_tmp/finding_text")"

# Determine alert level
case "$SEVERITY" in
    info)
        log_info "Severity: info — no alert needed"
        exit 0
        ;;
    warn)
        SUBJECT="[DR3 Audit] Daily Digest — ${RUN_DATE}"
        URGENCY="digest"
        ;;
    alert)
        SUBJECT="[DR3 Audit] ALERT — ${RUN_DATE}"
        URGENCY="immediate"
        ;;
    critical)
        SUBJECT="[DR3 Audit] CRITICAL — ${RUN_DATE}"
        URGENCY="urgent"
        ;;
    *)
        log_warn "Unknown severity: ${SEVERITY}"
        exit 0
        ;;
esac

log_info "Alert level: ${URGENCY} (${SEVERITY})"

# Read recipients
RECIPIENTS_JSON=$(read_config "alert.recipients.email")
if [[ -z "$RECIPIENTS_JSON" || "$RECIPIENTS_JSON" == "[]" || "$RECIPIENTS_JSON" == "null" ]]; then
    log_warn "No email recipients configured in audit.yml — skipping email"
    log_info "Alert summary: ${SUBJECT}"
    log_info "Findings:"
    echo "$FINDING_TEXT" >&2
    exit 0
fi

if [[ -z "$API_KEY" ]]; then
    log_warn "SendGrid API key not found in \$${SENDGRID_ENV_VAR} — skipping email"
    log_info "Would have sent: ${SUBJECT}"
    log_info "Findings:"
    echo "$FINDING_TEXT" >&2
    exit 0
fi

# Build email body — never include full details, only severity + titles
EMAIL_BODY="DR3 Audit Report — ${RUN_DATE}
Status: ${SEVERITY^^}

Findings:
${FINDING_TEXT}

To view the full report:
  ssh droplet 'cat ~/apps/ma-tracker-app/ops/audit/artifacts/\${RUN_DATE}*/report.md'

---
Automated audit by DR3 Dashboard ops/audit"

# Send via SendGrid API
send_email() {
    local to_email="$1"

    python3 -c "
import json, sys

payload = {
    'personalizations': [{'to': [{'email': sys.argv[1]}]}],
    'from': {'email': sys.argv[2]},
    'subject': sys.argv[3],
    'content': [{'type': 'text/plain', 'value': sys.argv[4]}]
}
print(json.dumps(payload))
" "$to_email" "$FROM_EMAIL" "$SUBJECT" "$EMAIL_BODY" | \
    curl -s -o /dev/null -w "%{http_code}" \
        --request POST \
        --url https://api.sendgrid.com/v3/mail/send \
        --header "Authorization: Bearer ${API_KEY}" \
        --header "Content-Type: application/json" \
        --data @-
}

# Parse recipients and send
python3 -c "
import json, sys
recipients = json.loads(sys.argv[1])
if isinstance(recipients, list):
    for r in recipients:
        print(r)
elif isinstance(recipients, str):
    print(recipients)
" "$RECIPIENTS_JSON" | while IFS= read -r recipient; do
    [[ -z "$recipient" ]] && continue
    log_info "Sending ${URGENCY} alert to ${recipient}..."
    http_code=$(send_email "$recipient")
    if [[ "$http_code" == "202" ]]; then
        log_info "  Sent successfully (HTTP 202)"
    else
        log_warn "  SendGrid returned HTTP ${http_code}"
    fi
done

log_info "Alert dispatch complete"

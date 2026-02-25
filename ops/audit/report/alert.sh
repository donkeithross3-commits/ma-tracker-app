#!/usr/bin/env bash
# Send audit alerts based on severity level
# Usage: ./alert.sh <artifacts_dir>
#
# Sends email via Python smtplib (Gmail SMTP or SendGrid).
# Configure in audit.yml under alert: section.
# Requires SMTP_PASSWORD in environment (Gmail App Password or SendGrid API key).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${AUDIT_ROOT}/bin/lib.sh"

ARTIFACTS_DIR="${1:?Usage: alert.sh <artifacts_dir>}"
SUMMARY_FILE="${ARTIFACTS_DIR}/summary.json"
REPORT_FILE="${ARTIFACTS_DIR}/report.md"

if [[ ! -f "$SUMMARY_FILE" ]]; then
    log_error "summary.json not found at ${SUMMARY_FILE}"
    exit 1
fi

# Read alert config
FROM_EMAIL=$(read_config "alert.from_email" 2>/dev/null || echo "audit@dr3-dashboard.com")
SMTP_HOST=$(read_config "alert.smtp_host" 2>/dev/null || echo "smtp.gmail.com")
SMTP_PORT=$(read_config "alert.smtp_port" 2>/dev/null || echo "587")
SMTP_USER=$(read_config "alert.smtp_user" 2>/dev/null || echo "$FROM_EMAIL")

# Password from environment
SMTP_PASSWORD="${SMTP_PASSWORD:-}"

# Parse summary
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

notable = [f for f in findings if f.get('severity', 0) >= 10]
notable.sort(key=lambda x: x.get('severity', 0), reverse=True)

finding_lines = []
for f in notable[:20]:
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
RECIPIENTS_JSON=$(read_config "alert.recipients.email" 2>/dev/null || echo "[]")
if [[ -z "$RECIPIENTS_JSON" || "$RECIPIENTS_JSON" == "[]" || "$RECIPIENTS_JSON" == "null" ]]; then
    log_warn "No email recipients configured in audit.yml — skipping email"
    log_info "Alert summary: ${SUBJECT}"
    log_info "Findings:"
    echo "$FINDING_TEXT" >&2
    exit 0
fi

if [[ -z "$SMTP_PASSWORD" ]]; then
    log_warn "SMTP_PASSWORD not set — skipping email"
    log_info "Would have sent: ${SUBJECT}"
    log_info "Findings:"
    echo "$FINDING_TEXT" >&2
    exit 0
fi

# Build email body
EMAIL_BODY="DR3 Audit Report — ${RUN_DATE}
Status: ${SEVERITY^^}

Findings:
${FINDING_TEXT}

To view the full report:
  ssh droplet 'cat ~/apps/ma-tracker-app/ops/audit/artifacts/${RUN_DATE}*/report.md'

---
Automated audit by DR3 Dashboard ops/audit"

# Send via Python smtplib (works with Gmail SMTP, no extra packages needed)
python3 -c "
import smtplib, json, sys
from email.mime.text import MIMEText

smtp_host = sys.argv[1]
smtp_port = int(sys.argv[2])
smtp_user = sys.argv[3]
smtp_pass = sys.argv[4]
from_email = sys.argv[5]
subject = sys.argv[6]
body = sys.argv[7]
recipients_json = sys.argv[8]

recipients = json.loads(recipients_json)
if isinstance(recipients, str):
    recipients = [recipients]

msg = MIMEText(body)
msg['Subject'] = subject
msg['From'] = from_email
msg['To'] = ', '.join(recipients)

with smtplib.SMTP(smtp_host, smtp_port) as server:
    server.starttls()
    server.login(smtp_user, smtp_pass)
    server.sendmail(from_email, recipients, msg.as_string())

print('OK')
" "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASSWORD" \
  "$FROM_EMAIL" "$SUBJECT" "$EMAIL_BODY" "$RECIPIENTS_JSON" \
  > "$_alert_tmp/send_result" 2>&1

SEND_RESULT="$(cat "$_alert_tmp/send_result")"

if [[ "$SEND_RESULT" == "OK" ]]; then
    log_info "Email sent successfully to $(echo "$RECIPIENTS_JSON" | tr -d '[]"')"
else
    log_warn "Email send failed: ${SEND_RESULT}"
fi

log_info "Alert dispatch complete"

#!/usr/bin/env bash
# Weekly IB Gateway 2FA reminder
# IB invalidates auth tokens every Sunday ~1 AM ET.
# This script runs Sunday evening to remind Don to approve 2FA on IBKR Mobile.
#
# Crontab entry (install on droplet):
#   0 23 * * 0 /home/don/apps/ma-tracker-app/ops/ib-gateway/weekly-2fa-reminder.sh >> /home/don/apps/logs/ib-gateway-2fa.log 2>&1
set -euo pipefail

TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')
LOG_PREFIX="[$TIMESTAMP] 2FA Reminder:"

# Check if Gateway is currently responding
GATEWAY_STATUS="NOT responding - needs attention"
if nc -z 127.0.0.1 4001 2>/dev/null || nc -z 127.0.0.1 4002 2>/dev/null; then
    GATEWAY_STATUS="currently responding"
fi

if [ "$GATEWAY_STATUS" = "currently responding" ]; then
    echo "$LOG_PREFIX Gateway is currently responding. 2FA may not be needed yet."
    echo "$LOG_PREFIX IB will invalidate tokens overnight. Check IBKR Mobile in the morning."
else
    echo "$LOG_PREFIX WARNING: Gateway is NOT responding. 2FA approval likely needed NOW."
    echo "$LOG_PREFIX Open IBKR Mobile and approve the login notification."
fi

# Try to send email notification via SendGrid if configured
PYTHON="/home/don/apps/ma-tracker-app/python-service/.venv/bin/python"
ENV_FILE="/home/don/apps/ma-tracker-app/python-service/.env"

if [ -f "$PYTHON" ] && [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a

    export GATEWAY_STATUS
    $PYTHON -c '
import os, sys
try:
    sg_key = os.environ.get("SENDGRID_API_KEY", "")
    if sg_key and not sg_key.startswith("SG..."):
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail
        recipients = os.environ.get("ALERT_EMAIL_RECIPIENTS", "").split(",")
        if recipients and recipients[0]:
            status = os.environ.get("GATEWAY_STATUS", "unknown")
            msg = Mail(
                from_email=os.environ.get("SENDGRID_FROM_EMAIL", "alerts@dr3-dashboard.com"),
                to_emails=recipients[0].strip(),
                subject="IB Gateway 2FA Reminder - Approve on IBKR Mobile",
                plain_text_content=f"IB Gateway needs weekly 2FA re-authentication.\n\nOpen IBKR Mobile and approve the login notification.\n\nGateway status: {status}"
            )
            sg = SendGridAPIClient(sg_key)
            sg.send(msg)
            print("Email notification sent")
            sys.exit(0)
except Exception as e:
    print(f"Email notification failed: {e}")

print("No notification channel available - check logs manually")
' 2>&1 | while read -r line; do echo "$LOG_PREFIX $line"; done
fi

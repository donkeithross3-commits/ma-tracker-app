#!/usr/bin/env bash
# Install (or update) the DR3 daily audit cron entry.
# Usage: bash ops/audit/cron/install.sh
#
# Safe to run multiple times -- it removes any previous DR3 audit entry
# before adding the current one.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_FILE="${SCRIPT_DIR}/audit-daily.cron"

if [[ ! -f "$CRON_FILE" ]]; then
    echo "ERROR: cron file not found: ${CRON_FILE}" >&2
    exit 1
fi

# Create logs directory if missing
LOGS_DIR="$(cd "${SCRIPT_DIR}/../logs" 2>/dev/null && pwd || echo "${SCRIPT_DIR}/../logs")"
mkdir -p "$LOGS_DIR"

# Remove any existing DR3 audit cron entries, then append the new one
MARKER="DR3 Daily Security Audit"
(crontab -l 2>/dev/null || true) | grep -v "$MARKER" | grep -v "run_daily.sh" > /tmp/dr3_crontab_clean.tmp || true

# Append only the actual cron line (skip comments/env from the .cron file)
grep -E '^[0-9*]' "$CRON_FILE" >> /tmp/dr3_crontab_clean.tmp

crontab /tmp/dr3_crontab_clean.tmp
rm -f /tmp/dr3_crontab_clean.tmp

echo "Installed DR3 audit cron entry. Current crontab:"
crontab -l

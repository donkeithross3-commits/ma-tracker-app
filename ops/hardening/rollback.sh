#!/usr/bin/env bash
set -euo pipefail

# rollback.sh — Revert hardening changes on ma-tracker-app droplet
# Usage: sudo bash rollback.sh [backup-dir]
#
# If no backup dir is specified, looks for the most recent one in /root/

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (use sudo)."
    exit 1
fi

BACKUP_DIR="${1:-}"

if [[ -z "$BACKUP_DIR" ]]; then
    # Find most recent backup
    BACKUP_DIR=$(ls -1d /root/hardening-backup-* 2>/dev/null | sort -r | head -1)
    if [[ -z "$BACKUP_DIR" ]]; then
        echo "ERROR: No backup directory found. Specify one: sudo bash rollback.sh /root/hardening-backup-YYYYMMDD-HHMMSS"
        exit 1
    fi
    echo "Using most recent backup: $BACKUP_DIR"
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "ERROR: Backup directory not found: $BACKUP_DIR"
    exit 1
fi

log() { echo "[$(date '+%H:%M:%S')] $*"; }

echo "============================================"
echo "  ROLLBACK HARDENING CHANGES"
echo "  Restoring from: $BACKUP_DIR"
echo "============================================"
echo ""

# -------------------------------------------------------------------
# 1. Restore SSH config
# -------------------------------------------------------------------
log "Restoring SSH config..."
rm -f /etc/ssh/sshd_config.d/90-hardening.conf

if [[ -d "$BACKUP_DIR/sshd_config.d" ]]; then
    cp -a "$BACKUP_DIR/sshd_config.d/"* /etc/ssh/sshd_config.d/ 2>/dev/null || true
fi

if sshd -t; then
    systemctl restart sshd
    log "SSH config restored and sshd restarted."
else
    log "WARNING: sshd config validation failed after restore. Check manually."
fi

# -------------------------------------------------------------------
# 2. Disable UFW
# -------------------------------------------------------------------
log "Disabling UFW..."
if command -v ufw &>/dev/null; then
    ufw --force disable
    ufw --force reset
    log "UFW disabled and reset."
else
    log "UFW not installed, skipping."
fi

# -------------------------------------------------------------------
# 3. Stop fail2ban
# -------------------------------------------------------------------
log "Stopping fail2ban..."
if command -v fail2ban-client &>/dev/null; then
    systemctl stop fail2ban 2>/dev/null || true
    systemctl disable fail2ban 2>/dev/null || true
    if [[ -f "$BACKUP_DIR/jail.local" ]]; then
        cp "$BACKUP_DIR/jail.local" /etc/fail2ban/jail.local
    else
        rm -f /etc/fail2ban/jail.local
    fi
    log "fail2ban stopped and config restored."
else
    log "fail2ban not installed, skipping."
fi

echo ""
log "=== Rollback complete ==="
echo ""
echo "Verify SSH access in a new terminal before closing this session."

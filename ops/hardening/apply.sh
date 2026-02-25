#!/usr/bin/env bash
set -euo pipefail

# apply.sh — Apply all hardening configs to ma-tracker-app droplet
# Usage: sudo bash apply.sh [--dry-run]
#
# IMPORTANT: Keep an existing SSH session open while running this.
# If SSH config is broken, the open session lets you fix it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="/root/hardening-backup-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE — no changes will be made ==="
    echo ""
fi

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (use sudo)."
    exit 1
fi

log() { echo "[$(date '+%H:%M:%S')] $*"; }

run() {
    if $DRY_RUN; then
        echo "  [dry-run] $*"
    else
        "$@"
    fi
}

# -------------------------------------------------------------------
# Pre-flight checks
# -------------------------------------------------------------------
log "Pre-flight: verifying SSH key authentication works for current user..."
if ! grep -q "PubkeyAuthentication" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then
    log "WARNING: Could not confirm PubkeyAuthentication is set anywhere."
    log "Make sure you have SSH keys configured before proceeding."
fi

echo ""
echo "============================================"
echo "  MA-TRACKER DROPLET HARDENING"
echo "  Backup dir: $BACKUP_DIR"
echo "============================================"
echo ""
echo "WARNING: Keep an SSH session open in another terminal!"
echo "         If something goes wrong, you can fix it from there."
echo ""

if ! $DRY_RUN; then
    read -r -p "Press Enter to continue, or Ctrl+C to abort... "
fi

# -------------------------------------------------------------------
# 1. Backup existing configs
# -------------------------------------------------------------------
log "Step 1: Backing up existing configs to $BACKUP_DIR"
run mkdir -p "$BACKUP_DIR"

if [[ -d /etc/ssh/sshd_config.d ]]; then
    run cp -a /etc/ssh/sshd_config.d "$BACKUP_DIR/sshd_config.d"
fi
run cp /etc/ssh/sshd_config "$BACKUP_DIR/sshd_config"

if command -v ufw &>/dev/null; then
    run mkdir -p "$BACKUP_DIR/ufw"
    run cp -a /etc/ufw "$BACKUP_DIR/ufw/" 2>/dev/null || true
fi

if [[ -f /etc/fail2ban/jail.local ]]; then
    run cp /etc/fail2ban/jail.local "$BACKUP_DIR/jail.local"
fi

log "Backup complete."

# -------------------------------------------------------------------
# 2. SSH hardening
# -------------------------------------------------------------------
log "Step 2: Applying SSH hardening config..."
run mkdir -p /etc/ssh/sshd_config.d
run cp "$SCRIPT_DIR/sshd_config.d/90-hardening.conf" /etc/ssh/sshd_config.d/90-hardening.conf
run chmod 644 /etc/ssh/sshd_config.d/90-hardening.conf

# Validate sshd config before restarting
if ! $DRY_RUN; then
    log "Validating sshd config..."
    if sshd -t; then
        log "sshd config OK. Restarting sshd..."
        systemctl restart sshd
        log "sshd restarted."
    else
        log "ERROR: sshd config validation failed! Restoring backup..."
        cp "$BACKUP_DIR/sshd_config.d/"* /etc/ssh/sshd_config.d/ 2>/dev/null || true
        rm -f /etc/ssh/sshd_config.d/90-hardening.conf
        log "Backup restored. SSH config unchanged."
        exit 1
    fi
else
    echo "  [dry-run] sshd -t (validate config)"
    echo "  [dry-run] systemctl restart sshd"
fi

# -------------------------------------------------------------------
# 3. UFW firewall
# -------------------------------------------------------------------
log "Step 3: Installing and configuring UFW..."

if ! $DRY_RUN; then
    if ! command -v ufw &>/dev/null; then
        log "Installing ufw..."
        apt-get update -qq && apt-get install -y -qq ufw
    fi
    bash "$SCRIPT_DIR/ufw/setup.sh"
else
    echo "  [dry-run] apt-get install -y ufw (if not installed)"
    echo "  [dry-run] bash $SCRIPT_DIR/ufw/setup.sh"
fi

# -------------------------------------------------------------------
# 4. fail2ban
# -------------------------------------------------------------------
log "Step 4: Installing and configuring fail2ban..."

if ! $DRY_RUN; then
    if ! command -v fail2ban-client &>/dev/null; then
        log "Installing fail2ban..."
        apt-get update -qq && apt-get install -y -qq fail2ban
    fi
    cp "$SCRIPT_DIR/fail2ban/jail.local" /etc/fail2ban/jail.local
    chmod 644 /etc/fail2ban/jail.local
    systemctl enable fail2ban
    systemctl restart fail2ban
    log "fail2ban configured and started."
else
    echo "  [dry-run] apt-get install -y fail2ban (if not installed)"
    echo "  [dry-run] cp jail.local -> /etc/fail2ban/jail.local"
    echo "  [dry-run] systemctl enable fail2ban && systemctl restart fail2ban"
fi

# -------------------------------------------------------------------
# 5. Verification
# -------------------------------------------------------------------
echo ""
log "=== Verification ==="

if ! $DRY_RUN; then
    echo ""
    echo "SSH config:"
    sshd -T 2>/dev/null | grep -E "permitrootlogin|passwordauthentication|pubkeyauthentication|x11forwarding|maxauthtries" || true

    echo ""
    echo "UFW status:"
    ufw status numbered 2>/dev/null || echo "  UFW not available"

    echo ""
    echo "fail2ban status:"
    fail2ban-client status sshd 2>/dev/null || echo "  fail2ban not running yet"
else
    echo "  [dry-run] sshd -T | grep key settings"
    echo "  [dry-run] ufw status numbered"
    echo "  [dry-run] fail2ban-client status sshd"
fi

echo ""
log "=== Hardening complete ==="
echo ""
echo "NEXT STEPS:"
echo "  1. In a NEW terminal, verify you can still SSH in: ssh don@134.199.204.12"
echo "  2. Only after confirming SSH works, close this session."
echo "  3. Backup dir: $BACKUP_DIR"
echo "  4. To rollback: sudo bash $SCRIPT_DIR/rollback.sh $BACKUP_DIR"

#!/usr/bin/env bash
set -euo pipefail

# UFW firewall setup for ma-tracker-app droplet
# Allows SSH from anywhere, HTTP/HTTPS only from Cloudflare IPs
#
# Cloudflare IPv4 ranges fetched 2026-02-24 from https://www.cloudflare.com/ips-v4
# Review and update periodically: ranges can change.

CLOUDFLARE_IPS=(
    173.245.48.0/20
    103.21.244.0/22
    103.22.200.0/22
    103.31.4.0/22
    141.101.64.0/18
    108.162.192.0/18
    190.93.240.0/20
    188.114.96.0/20
    197.234.240.0/22
    198.41.128.0/17
    162.158.0.0/15
    104.16.0.0/13
    104.24.0.0/14
    172.64.0.0/13
    131.0.72.0/22
)

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (use sudo)."
    exit 1
fi

echo "=== UFW Firewall Setup ==="

# Reset UFW to clean state (non-interactive)
echo "[1/5] Resetting UFW to defaults..."
ufw --force reset

# Set default policies
echo "[2/5] Setting default policies (deny incoming, allow outgoing)..."
ufw default deny incoming
ufw default allow outgoing

# Allow SSH from anywhere (critical for management)
echo "[3/5] Allowing SSH (port 22) from any source..."
ufw allow 22/tcp comment 'SSH'

# Allow HTTP/HTTPS only from Cloudflare IPs
echo "[4/5] Allowing HTTP/HTTPS only from Cloudflare IP ranges..."
for ip in "${CLOUDFLARE_IPS[@]}"; do
    ufw allow from "$ip" to any port 80 proto tcp comment "Cloudflare HTTP"
    ufw allow from "$ip" to any port 443 proto tcp comment "Cloudflare HTTPS"
done

# Allow localhost for Docker internal networking
echo "[5/5] Allowing localhost traffic..."
ufw allow from 127.0.0.0/8 comment 'Localhost'
ufw allow from 172.16.0.0/12 comment 'Docker networks'

# Enable UFW
echo ""
echo "Enabling UFW..."
ufw --force enable

echo ""
echo "=== UFW setup complete ==="
ufw status verbose

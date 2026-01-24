#!/bin/bash
#
# DR3 Dashboard HTTPS Setup Script
# Run this on the droplet: ssh droplet then bash setup-caddy-https.sh
#
# Prerequisites:
# 1. Cloudflare DNS configured (A record for @ pointing to 134.199.204.12)
# 2. Cloudflare SSL/TLS set to "Full (strict)"
# 3. Origin certificate files uploaded to /home/don/ (origin.pem and origin-key.pem)
#

set -e

echo "=========================================="
echo "DR3 Dashboard HTTPS Setup"
echo "=========================================="
echo

# Check if running as don user
if [ "$(whoami)" != "don" ]; then
    echo "ERROR: Run this script as user 'don'"
    exit 1
fi

# Check for certificate files
if [ ! -f /home/don/origin.pem ] || [ ! -f /home/don/origin-key.pem ]; then
    echo "ERROR: Certificate files not found!"
    echo "Please upload origin.pem and origin-key.pem to /home/don/"
    echo "From your local machine run:"
    echo "  scp origin.pem origin-key.pem droplet:/home/don/"
    exit 1
fi

echo "Step 1: Installing Caddy..."
echo "=========================================="
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null

sudo apt update
sudo apt install -y caddy

echo
echo "Step 2: Setting up certificates..."
echo "=========================================="
sudo mkdir -p /etc/caddy/certs
sudo mv /home/don/origin.pem /etc/caddy/certs/
sudo mv /home/don/origin-key.pem /etc/caddy/certs/
sudo chmod 600 /etc/caddy/certs/*
sudo chown caddy:caddy /etc/caddy/certs/*

echo
echo "Step 3: Creating Caddyfile..."
echo "=========================================="
sudo tee /etc/caddy/Caddyfile > /dev/null << 'CADDYFILE'
# DR3 Dashboard - Cloudflare Origin SSL
dr3-dashboard.com, www.dr3-dashboard.com {
    # Use Cloudflare Origin Certificate
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin-key.pem

    # Reverse proxy to Next.js app
    reverse_proxy localhost:3000 {
        # Pass original host header
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }

    # Logging
    log {
        output file /var/log/caddy/dr3-dashboard.log
        format json
    }
}
CADDYFILE

echo
echo "Step 4: Setting up log directory..."
echo "=========================================="
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy

echo
echo "Step 5: Validating Caddy config..."
echo "=========================================="
sudo caddy validate --config /etc/caddy/Caddyfile

echo
echo "Step 6: Starting Caddy..."
echo "=========================================="
sudo systemctl enable caddy
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager

echo
echo "Step 7: Updating Docker to bind locally only..."
echo "=========================================="
cd /home/don/apps

# Backup current config
cp docker-compose.yml docker-compose.yml.backup.$(date +%Y%m%d_%H%M%S)

# Update port binding to localhost only
sed -i 's/"3000:3000"/"127.0.0.1:3000:3000"/g' docker-compose.yml

echo "Updated docker-compose.yml:"
grep -A2 "ports:" docker-compose.yml | head -5

echo
echo "Step 8: Restarting Docker containers..."
echo "=========================================="
docker compose down
docker compose up -d
docker ps

echo
echo "Step 9: Configuring firewall..."
echo "=========================================="
# Allow SSH first (critical!)
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall (will prompt for confirmation)
echo "Enabling firewall..."
sudo ufw --force enable

echo
echo "Firewall status:"
sudo ufw status verbose

echo
echo "=========================================="
echo "SETUP COMPLETE!"
echo "=========================================="
echo
echo "Verification commands to run:"
echo "  curl -I https://dr3-dashboard.com"
echo "  curl -I https://dr3-dashboard.com/krj"
echo "  curl -I https://dr3-dashboard.com/ma-options"
echo
echo "Port 3000 should now be blocked externally:"
echo "  curl -I http://134.199.204.12:3000 --connect-timeout 5"
echo "  (should timeout or refuse connection)"
echo

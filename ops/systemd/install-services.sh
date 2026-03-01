#!/usr/bin/env bash
# Install DR3 systemd services on the droplet
# FastAPI  → user-level (matches existing setup, no sudo for deploy)
# Trading  → system-level (requires Nice=-10 scheduling priority)
#
# Run as: sudo bash install-services.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_SYSTEMD_DIR="/home/don/.config/systemd/user"

echo "=== DR3 Service Installer ==="

# --- FastAPI: user-level service ---
echo ""
echo "Installing dr3-fastapi.service (user-level)..."
mkdir -p "$USER_SYSTEMD_DIR"
cp "$SCRIPT_DIR/dr3-fastapi.service" "$USER_SYSTEMD_DIR/"
chown don:don "$USER_SYSTEMD_DIR/dr3-fastapi.service"

# Enable linger so user services survive logout
loginctl enable-linger don

# Reload user daemon (run as don)
su - don -c 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user daemon-reload'
su - don -c 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user enable dr3-fastapi.service'
echo "  dr3-fastapi.service installed (user-level)"

# --- Trading Agent: system-level service (needs Nice=-10) ---
echo ""
echo "Installing dr3-trading-agent.service (system-level)..."
cp "$SCRIPT_DIR/dr3-trading-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable dr3-trading-agent.service
echo "  dr3-trading-agent.service installed (system-level)"

# --- Sudoers: allow don to restart trading agent without password ---
echo ""
echo "Installing sudoers rule for deploy script..."
SUDOERS_FILE="/etc/sudoers.d/dr3-trading-agent"
cat > "$SUDOERS_FILE" << 'SUDOERS'
# Allow don to manage the trading agent service without a password
# Used by deploy.sh trading-agent target
don ALL=(root) NOPASSWD: /usr/bin/systemctl start dr3-trading-agent, \
                          /usr/bin/systemctl stop dr3-trading-agent, \
                          /usr/bin/systemctl restart dr3-trading-agent, \
                          /usr/bin/systemctl status dr3-trading-agent
SUDOERS
chmod 440 "$SUDOERS_FILE"
# Validate sudoers syntax
if visudo -c -f "$SUDOERS_FILE" > /dev/null 2>&1; then
    echo "  Sudoers rule installed and validated"
else
    echo "  WARNING: Sudoers syntax check failed — removing bad file"
    rm -f "$SUDOERS_FILE"
    exit 1
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "FastAPI (user-level):"
echo "  systemctl --user start dr3-fastapi"
echo "  systemctl --user status dr3-fastapi"
echo "  journalctl --user -u dr3-fastapi -f"
echo ""
echo "Trading Agent (system-level):"
echo "  sudo systemctl start dr3-trading-agent"
echo "  sudo systemctl status dr3-trading-agent"
echo "  sudo journalctl -u dr3-trading-agent -f"
echo ""
echo "Note: If FastAPI is running via nohup, kill it first:"
echo "  pkill -f 'uvicorn app.main:app' && systemctl --user start dr3-fastapi"

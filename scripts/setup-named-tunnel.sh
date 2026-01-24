#!/bin/bash
# Setup Named Cloudflare Tunnel for KRJ Dev
# Run this script once to create and configure the named tunnel

set -e

TUNNEL_NAME="krj-dev-tunnel"
DOMAIN="krj-dev.dr3-dashboard.com"
PROJECT_ROOT="/Users/donaldross/dev/ma-tracker-app"
CLOUDFLARED_DIR="$PROJECT_ROOT/.cloudflared"

echo "=========================================="
echo "🔧 Named Tunnel Setup for KRJ Dev"
echo "=========================================="
echo ""
echo "Domain: $DOMAIN"
echo "Tunnel: $TUNNEL_NAME"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared not found"
    echo ""
    echo "Install with: brew install cloudflared"
    exit 1
fi

# Check if cert exists
if [ ! -f ~/.cloudflared/cert.pem ]; then
    echo "❌ Cloudflare cert not found"
    echo ""
    echo "You need to authenticate first:"
    echo "  cloudflared tunnel login"
    echo ""
    echo "This will open your browser to authenticate with Cloudflare."
    echo "After authentication, run this script again."
    exit 1
fi

echo "✅ Cloudflare cert found"
echo ""

# Check if tunnel already exists
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
    echo "⚠️  Tunnel '$TUNNEL_NAME' already exists"
    echo ""
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
    echo "Tunnel ID: $TUNNEL_ID"
else
    # Create the tunnel
    echo "Creating tunnel '$TUNNEL_NAME'..."
    cloudflared tunnel create "$TUNNEL_NAME"
    echo ""
    
    TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
    echo "✅ Tunnel created with ID: $TUNNEL_ID"
    echo ""
fi

# Find credentials file
CREDS_FILE=$(find ~/.cloudflared -name "${TUNNEL_ID}.json" 2>/dev/null | head -1)

if [ -z "$CREDS_FILE" ]; then
    echo "❌ Could not find credentials file for tunnel"
    exit 1
fi

# Copy credentials to project
echo "Copying credentials to project..."
cp "$CREDS_FILE" "$CLOUDFLARED_DIR/${TUNNEL_ID}.json"
echo "✅ Credentials copied"
echo ""

# Create config.yml
echo "Creating config.yml..."
cat > "$CLOUDFLARED_DIR/config.yml" << EOF
# Cloudflare Named Tunnel Configuration for KRJ Dev
tunnel: $TUNNEL_ID
credentials-file: $CLOUDFLARED_DIR/${TUNNEL_ID}.json

ingress:
  # Route krj-dev.dr3-dashboard.com to local Next.js dev server
  - hostname: $DOMAIN
    service: http://localhost:3000
  
  # Catch-all rule (required)
  - service: http_status:404
EOF

echo "✅ Config file created"
echo ""

# Configure DNS routing
echo "Configuring DNS routing..."
if cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>&1 | grep -q "already exists"; then
    echo "⚠️  DNS route already exists"
else
    echo "✅ DNS route created"
fi
echo ""

echo "=========================================="
echo "✅ Named Tunnel Setup Complete!"
echo "=========================================="
echo ""
echo "Tunnel Name: $TUNNEL_NAME"
echo "Tunnel ID:   $TUNNEL_ID"
echo "Domain:      https://$DOMAIN"
echo ""
echo "Next steps:"
echo "  1. Start dev server:  npm run dev"
echo "  2. Start tunnel:      ./scripts/start-tunnel.sh"
echo "  3. Visit:             https://$DOMAIN/krj"
echo ""
echo "=========================================="


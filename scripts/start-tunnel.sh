#!/bin/bash
# Start Cloudflare Tunnel for KRJ UI external access
# Supports two modes:
#   - Named Tunnel (default): Stable URL at krj-dev.dr3-dashboard.com
#   - Quick Tunnel: Temporary URL (use --quick flag)

TUNNEL_MODE="named"
DOMAIN="krj-dev.dr3-dashboard.com"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLOUDFLARED_DIR="$PROJECT_ROOT/.cloudflared"

# Parse arguments
if [ "$1" == "--quick" ] || [ "$TUNNEL_MODE_ENV" == "quick" ]; then
    TUNNEL_MODE="quick"
fi

echo "=========================================="
echo "🌐 Starting Cloudflare Tunnel for KRJ"
echo "=========================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared not found"
    echo ""
    echo "Install with: brew install cloudflared"
    echo "Or visit: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
fi

# Check if Next.js dev server is running
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "⚠️  Warning: localhost:3000 not responding"
    echo "   Make sure to run 'npm run dev' first"
    echo ""
fi

# Create .cloudflared directory if it doesn't exist
mkdir -p "$CLOUDFLARED_DIR"

# ============================================================================
# NAMED TUNNEL MODE (Stable URL)
# ============================================================================
if [ "$TUNNEL_MODE" == "named" ]; then
    echo "Mode: Named Tunnel (Stable URL)"
    echo ""
    
    # Check if config exists
    if [ ! -f "$CLOUDFLARED_DIR/config.yml" ]; then
        echo "❌ Named tunnel not configured"
        echo ""
        echo "Run the setup script first:"
        echo "  ./scripts/setup-named-tunnel.sh"
        echo ""
        echo "Or use Quick Tunnel mode:"
        echo "  ./scripts/start-tunnel.sh --quick"
        exit 1
    fi
    
    echo "Starting Named Tunnel..."
    echo ""
    
    # Start the named tunnel
    cloudflared tunnel --config "$CLOUDFLARED_DIR/config.yml" run 2>&1 | tee "$CLOUDFLARED_DIR/tunnel.log" &
    TUNNEL_PID=$!
    
    # Wait for tunnel to establish
    echo "Waiting for tunnel to connect..."
    sleep 3
    
    echo ""
    echo "=========================================="
    echo "✅ Named Cloudflare Tunnel Active"
    echo "=========================================="
    echo ""
    echo "Stable URL: https://$DOMAIN"
    echo "KRJ Page:   https://$DOMAIN/krj"
    echo ""
    echo "This is a stable URL that won't change."
    echo ""
    echo "Tunnel PID: $TUNNEL_PID"
    echo "Log file:   $CLOUDFLARED_DIR/tunnel.log"
    echo ""
    echo "=========================================="
    echo "Press Ctrl+C to stop the tunnel"
    echo "=========================================="
    echo ""
    
    # Keep script running
    wait $TUNNEL_PID

# ============================================================================
# QUICK TUNNEL MODE (Temporary URL)
# ============================================================================
else
    echo "Mode: Quick Tunnel (Temporary URL)"
    echo ""
    echo "Starting Quick Tunnel..."
    echo "This will generate a temporary public URL"
    echo ""
    
    cloudflared tunnel --url http://localhost:3000 2>&1 | tee "$CLOUDFLARED_DIR/tunnel.log" &
    TUNNEL_PID=$!
    
    # Wait for tunnel to establish and extract URL
    echo "Waiting for tunnel to connect..."
    sleep 5
    
    # Extract URL from cloudflared output
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CLOUDFLARED_DIR/tunnel.log" | head -1)
    
    if [ -z "$TUNNEL_URL" ]; then
        echo "❌ Failed to get tunnel URL"
        echo "Check $CLOUDFLARED_DIR/tunnel.log for details"
        exit 1
    fi
    
    echo ""
    echo "=========================================="
    echo "✅ Cloudflare Tunnel Active (Quick)"
    echo "=========================================="
    echo ""
    echo "Public URL: $TUNNEL_URL"
    echo "KRJ Page:   $TUNNEL_URL/krj"
    echo ""
    echo "⚠️  This URL is temporary and will change"
    echo "    Use Named Tunnel for a stable URL"
    echo ""
    echo "Tunnel PID: $TUNNEL_PID"
    echo "Log file:   $CLOUDFLARED_DIR/tunnel.log"
    echo ""
    echo "=========================================="
    echo "Press Ctrl+C to stop the tunnel"
    echo "=========================================="
    echo ""
    
    # Keep script running
    wait $TUNNEL_PID
fi


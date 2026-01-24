#!/bin/bash
# Stop Cloudflare Tunnel

echo "Stopping Cloudflare Tunnel..."
pkill -f "cloudflared tunnel" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Tunnel stopped"
else
    echo "ℹ️  No tunnel process found"
fi


#!/bin/bash
# Start the M&A Tracker with ngrok for automated email forwarding

echo "=========================================="
echo "M&A Tracker - Starting with ngrok"
echo "=========================================="
echo ""

# Kill any existing processes
pkill -f "start_server.py" 2>/dev/null
pkill -f "ngrok" 2>/dev/null
sleep 2

# Start Python server
echo "Starting Python server on port 8000..."
cd /Users/donaldross/ma-tracker-app/python-service
/Users/donaldross/opt/anaconda3/bin/python3 start_server.py &
PYTHON_PID=$!
echo "Python server started (PID: $PYTHON_PID)"
sleep 5

# Start ngrok
echo ""
echo "Starting ngrok tunnel..."
/Users/donaldross/bin/ngrok http 8000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
echo "ngrok started (PID: $NGROK_PID)"
sleep 3

# Get ngrok URL
echo ""
echo "=========================================="
echo "Fetching ngrok public URL..."
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "import sys, json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
    echo "❌ Failed to get ngrok URL"
    echo "Check if ngrok is running: http://localhost:4040"
    exit 1
fi

echo "✅ ngrok tunnel established!"
echo ""
echo "Public URL: $NGROK_URL"
echo "Webhook URL: $NGROK_URL/webhooks/email/inbound"
echo ""
echo "=========================================="
echo "Setup Instructions:"
echo "=========================================="
echo ""
echo "1. Copy this webhook URL:"
echo "   $NGROK_URL/webhooks/email/inbound"
echo ""
echo "2. Use it in your Gmail Apps Script (see gmail_forwarder.gs)"
echo "   Or set up SendGrid Inbound Parse with this URL"
echo ""
echo "3. Monitor webhook at: http://localhost:4040"
echo ""
echo "4. Test the webhook:"
echo "   curl -X POST $NGROK_URL/webhooks/email/inbound \\"
echo "     -F 'from=test@example.com' \\"
echo "     -F 'subject=FRGE (\$FRGE) - Test' \\"
echo "     -F 'text=Test email body'"
echo ""
echo "=========================================="
echo "Press Ctrl+C to stop both services"
echo "=========================================="
echo ""

# Keep running
tail -f /dev/null

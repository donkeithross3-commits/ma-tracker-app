# Price Agent Setup Guide

**Version:** 1.0  
**Date:** December 26, 2025  
**Status:** Production Ready

---

## Overview

The Price Agent runs on your local machine with IB TWS/Gateway and sends option price data to the server. This keeps your IB credentials secure on your machine while enabling the MA Options Scanner to display live prices.

---

## Prerequisites

1. **Interactive Brokers Account**
   - Active IB account with market data subscriptions
   - TWS or IB Gateway installed on your machine

2. **Python 3.8+**
   - Check: `python3 --version`
   - Install from: https://www.python.org/downloads/

3. **Server Access**
   - Server URL (e.g., `https://134.199.204.12:3000`)
   - API key (provided by administrator)

---

## Installation

### Step 1: Clone Repository (if not already done)

```bash
cd ~/dev
git clone <repository-url> ma-tracker-app
cd ma-tracker-app/python-service
```

### Step 2: Create Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### Step 3: Install Dependencies

```bash
pip install -r requirements.txt
```

### Step 4: Configure Agent

```bash
# Copy example configuration
cp .env.local.example .env.local

# Edit configuration
nano .env.local  # or use your preferred editor
```

**Edit `.env.local`:**
```bash
# Choose a unique agent ID (e.g., "don-macbook-pro")
AGENT_ID=your-name-machine

# Server URL (provided by administrator)
SERVER_URL=https://134.199.204.12:3000

# API key (provided by administrator)
AGENT_API_KEY=your-api-key-here

# IB TWS settings (usually these defaults are correct)
IB_HOST=127.0.0.1
IB_PORT=7497
IB_CLIENT_ID=100
```

---

## Configure IB TWS/Gateway

### Step 1: Enable API Connections

1. Open IB TWS or Gateway
2. Go to **File > Global Configuration > API > Settings**
3. Check **"Enable ActiveX and Socket Clients"**
4. Set **Socket port** to `7497` (or match your `.env.local`)
5. Check **"Read-Only API"** (recommended for safety)
6. Add `127.0.0.1` to **Trusted IP Addresses**
7. Click **OK** and restart TWS/Gateway

### Step 2: Verify Connection

```bash
# Test IB connection
python3 -c "from app.options.ib_client import IBClient; c = IBClient(); print('Connected:', c.connect())"
```

**Expected output:**
```
Connecting to IB at 127.0.0.1:7497 with client_id=XXX
Successfully connected to IB TWS
Connected: True
```

---

## Usage

### Fetch Option Chain for a Deal

```bash
python3 price_agent.py \
  --ticker CSGS \
  --deal-price 81.34 \
  --close-date 2026-06-30
```

**Expected output:**
```
Loading configuration from .env.local
Price Agent initialized: your-agent-id
Connecting to IB TWS at 127.0.0.1:7497
✓ Connected to IB TWS
Fetching option chain for CSGS
Spot price for CSGS: $78.25
✓ Fetched 47 option contracts for CSGS
Posting to https://134.199.204.12:3000/api/price-agent/ingest-chain
✓ Server accepted data: {'success': True, 'dealId': '...', 'contractsReceived': 47}
✓ Success!
Disconnected from IB TWS
```

### Dry Run (Test Without Sending)

```bash
python3 price_agent.py \
  --ticker CSGS \
  --deal-price 81.34 \
  --close-date 2026-06-30 \
  --dry-run
```

This fetches prices from IB but doesn't send to the server (useful for testing).

### Advanced Options

```bash
# Scan further before close date
python3 price_agent.py \
  --ticker CSGS \
  --deal-price 81.34 \
  --close-date 2026-06-30 \
  --days-before-close 7
```

---

## Troubleshooting

### Error: "AGENT_ID must be set in .env.local"

**Solution:** Create `.env.local` file with required configuration (see Step 4 above)

### Error: "Failed to connect to IB TWS"

**Possible causes:**
1. TWS/Gateway not running → Start TWS/Gateway
2. API not enabled → Enable in Global Configuration (see above)
3. Wrong port → Check port in TWS matches `.env.local`
4. Firewall blocking → Allow Python through firewall

### Error: "Invalid API key"

**Solution:** 
1. Verify API key in `.env.local` matches server
2. Contact administrator for correct API key
3. Check for extra spaces or quotes in `.env.local`

### Error: "Deal not found for ticker: XXX"

**Solution:** 
1. Verify ticker exists in MA Options Scanner
2. Check ticker spelling (case-insensitive)
3. Add deal to scanner first

### Error: "Agent timestamp is in the future"

**Solution:**
1. Sync your system clock: `sudo ntpdate -s time.apple.com` (Mac)
2. Check timezone settings
3. Restart agent

---

## Monitoring

### Check Agent Activity

Visit the MA Options Scanner UI and look for:
- Green "live" indicator on prices (< 5 minutes old)
- Your agent ID in price metadata
- Recent timestamp on option chains

### View Logs

```bash
# Agent logs (terminal output)
python3 price_agent.py --ticker CSGS ... 2>&1 | tee agent.log

# Server logs (on droplet)
ssh don@134.199.204.12
docker logs ma-tracker-app-web --tail 100 | grep "Price data ingested"
```

---

## Security Notes

### What Stays Local (Never Transmitted)

- ✅ IB username and password
- ✅ IB account number
- ✅ TWS/Gateway session
- ✅ Your `.env.local` file

### What Is Transmitted

- ✅ Agent ID (your chosen identifier)
- ✅ Option prices (public market data)
- ✅ Timestamps
- ✅ API key (encrypted via HTTPS)

### Best Practices

1. **Never share your API key** with others
2. **Use HTTPS** for server connection (not HTTP)
3. **Keep `.env.local` private** (don't commit to git)
4. **Use unique agent IDs** for each machine
5. **Rotate API keys** periodically

---

## Advanced: Running as a Service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.ma-tracker.price-agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ma-tracker.price-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/path/to/ma-tracker-app/python-service/price_agent.py</string>
        <string>--ticker</string>
        <string>CSGS</string>
        <string>--deal-price</string>
        <string>81.34</string>
        <string>--close-date</string>
        <string>2026-06-30</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/price-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/price-agent-error.log</string>
</dict>
</plist>
```

Load service:
```bash
launchctl load ~/Library/LaunchAgents/com.ma-tracker.price-agent.plist
```

---

## FAQ

**Q: How often should I run the agent?**  
A: Run on-demand when you need fresh prices. The UI will show age of last update.

**Q: Can multiple people run agents?**  
A: Yes! Each person should have their own agent ID and API key.

**Q: What if two agents send data at the same time?**  
A: The server keeps the newest data (by server receipt time). Both agents work fine.

**Q: Do I need to keep the agent running constantly?**  
A: No. Run it when you need fresh prices. The UI always shows the last known price.

**Q: Can I run multiple agents on one machine?**  
A: Yes, but use different agent IDs and IB client IDs.

**Q: What happens if my machine goes offline?**  
A: Nothing breaks. The server keeps showing the last known prices. Run the agent again when back online.

---

## Support

For issues or questions:
1. Check this documentation
2. Review troubleshooting section
3. Check application logs
4. Contact your administrator

---

**Last Updated:** December 26, 2025  
**Version:** 1.0


# Local Testing Guide - MA Options Scanner Distributed Architecture

**Date:** December 26, 2025  
**Purpose:** Test the new price agent architecture locally before deploying to production

---

## Overview

This guide walks you through testing the distributed architecture on your Mac:
1. Price Agent connects to local IB TWS
2. Fetches option prices
3. Sends to local Next.js server
4. Verifies data appears in UI

**Total Time:** ~15-20 minutes (assuming IB TWS is already configured)

---

## Prerequisites

### Required

- [x] IB TWS or Gateway installed
- [x] Active IB account with market data subscriptions
- [x] Python 3.8+ installed
- [x] Node.js 18+ installed
- [x] PostgreSQL running (Postgres.app)
- [x] Repository cloned to `/Users/donaldross/dev/ma-tracker-app`

### Optional (for full testing)

- [ ] Active deal in database (e.g., CSGS)
- [ ] IB TWS logged in and connected

---

## Step-by-Step Testing

### Step 1: Start PostgreSQL

```bash
# If using Postgres.app, just open it from Applications
# Verify it's running:
psql -U donaldross -d ma_tracker -c "SELECT 1;"

# Expected output: Should return "1" without errors
```

**If database doesn't exist:**
```bash
createdb -U donaldross ma_tracker
cd /Users/donaldross/dev/ma-tracker-app
npx prisma db push
```

### Step 2: Ensure Database Has Test Data

```bash
cd /Users/donaldross/dev/ma-tracker-app

# Check if deals exist
psql -U donaldross -d ma_tracker -c "SELECT ticker, id FROM deals LIMIT 5;"

# If no deals, run seed:
npm run db:seed
```

**Expected output:** Should show at least one deal (e.g., CSGS)

### Step 3: Set Up Python Environment

```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service

# Create virtual environment if it doesn't exist
python3 -m venv .venv

# Activate it
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Verify installation
python3 -c "from app.options.ib_client import IBClient; print('✅ Dependencies OK')"
```

**Expected output:** `✅ Dependencies OK`

### Step 4: Configure IB TWS

**CRITICAL:** IB TWS must be configured to accept API connections.

1. **Open IB TWS or Gateway**
   - Log in with your IB credentials
   - Wait for connection to establish

2. **Enable API Access**
   - Go to: **File > Global Configuration > API > Settings**
   - Check: **"Enable ActiveX and Socket Clients"**
   - Set **Socket port** to: `7497` (TWS) or `4002` (Gateway)
   - Check: **"Read-Only API"** (recommended for safety)
   - Add `127.0.0.1` to **Trusted IP Addresses**
   - Click **OK**

3. **Restart TWS/Gateway** (if you changed settings)

**Note:** If using Gateway instead of TWS, update `.env.local`:
```bash
IB_PORT=4002  # Gateway port instead of 7497
```

### Step 5: Test IB TWS Connection

```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service
source .venv/bin/activate

# Test connection
python3 -c "
from app.options.ib_client import IBClient
client = IBClient()
connected = client.connect(host='127.0.0.1', port=7497, client_id=100)
print(f'✅ Connected: {connected}')
client.disconnect()
"
```

**Expected output:**
```
Connecting to IB at 127.0.0.1:7497 with client_id=100
Successfully connected to IB TWS
✅ Connected: True
```

**If connection fails:**
- Verify TWS/Gateway is running and logged in
- Check API is enabled (Step 4)
- Try different client_id: `client_id=101`
- Check firewall isn't blocking connection

### Step 6: Test Price Agent (Dry Run)

This tests the agent without sending data to the server.

```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service
source .venv/bin/activate

# Run dry-run test
python3 price_agent.py \
  --ticker CSGS \
  --deal-price 81.34 \
  --close-date 2026-06-30 \
  --dry-run
```

**Expected output:**
```
Loading configuration from .env.local
Price Agent initialized: don-macbook-local-test
Connecting to IB TWS at 127.0.0.1:7497
✓ Connected to IB TWS
Fetching option chain for CSGS
Spot price for CSGS: $XX.XX
✓ Fetched XX option contracts for CSGS
DRY RUN - Would send payload:
  Agent ID: don-macbook-local-test
  Ticker: CSGS
  Contracts: XX
  Timestamp: 2025-12-26T...
Disconnected from IB TWS
```

**If this works, you're 80% done!** The agent can connect to IB and fetch prices.

**Common issues:**
- **"AGENT_ID must be set"** → Check `.env.local` exists in `python-service/`
- **"Failed to connect to IB TWS"** → Go back to Step 5
- **"No data for ticker"** → Try a different ticker (e.g., AAPL, SPY)

### Step 7: Start Next.js Development Server

Open a **new terminal window** (keep the Python terminal open):

```bash
cd /Users/donaldross/dev/ma-tracker-app

# Start dev server
npm run dev
```

**Expected output:**
```
▲ Next.js 14.x.x
- Local:        http://localhost:3000
- Ready in XXXms
```

**Keep this terminal open.** The server needs to be running for the next steps.

### Step 8: Verify Server API Endpoint

In a **third terminal window**:

```bash
# Test authentication (should fail with wrong key)
curl -X POST http://localhost:3000/api/price-agent/ingest-chain \
  -H "Authorization: Bearer wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"test","ticker":"CSGS","agentTimestamp":"2025-12-26T20:00:00Z","contracts":[]}'

# Expected: {"error":"Invalid API key"}
```

**If you see `{"error":"Invalid API key"}`**, the endpoint is working! ✅

**If you see 404 or other errors:**
- Check server is running (Step 7)
- Check URL is correct
- Look at server logs in the dev server terminal

### Step 9: Test End-to-End (Agent → Server)

Now we'll send real data from the agent to the local server.

**Terminal 1:** Keep Next.js dev server running  
**Terminal 2:** Run the price agent (without `--dry-run`)

```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service
source .venv/bin/activate

# Run live test (sends to local server)
python3 price_agent.py \
  --ticker CSGS \
  --deal-price 81.34 \
  --close-date 2026-06-30
```

**Expected output:**
```
Loading configuration from .env.local
Price Agent initialized: don-macbook-local-test
Connecting to IB TWS at 127.0.0.1:7497
✓ Connected to IB TWS
Fetching option chain for CSGS
Spot price for CSGS: $XX.XX
✓ Fetched XX option contracts for CSGS
Posting to http://localhost:3000/api/price-agent/ingest-chain
✓ Server accepted data: {'success': True, 'dealId': '...', 'contractsReceived': XX}
✓ Success!
Disconnected from IB TWS
```

**In the Next.js terminal**, you should see:
```
Price data ingested successfully {
  agentId: 'don-macbook-local-test',
  ticker: 'CSGS',
  contractCount: XX,
  ...
}
```

**If you see this, the full pipeline is working!** 🎉

**Common issues:**
- **"Deal not found for ticker: CSGS"** → Run `npm run db:seed` to add deals
- **"Invalid API key"** → Check `AGENT_API_KEY` matches in both `.env.local` and `.env.development`
- **Network error** → Check dev server is running on port 3000

### Step 10: Verify in UI

Open your browser and navigate to:

```
http://localhost:3000/ma-options
```

**What to look for:**
1. Page loads without errors
2. Deals are listed
3. Click on CSGS (or whichever ticker you tested)
4. Click "Fetch Option Chain"
5. Should show option contracts with:
   - Source: "agent"
   - Agent ID: "don-macbook-local-test"
   - Timestamp: recent (< 5 minutes)
   - Green "live" indicator

**Success criteria:**
- ✅ Option chain displays
- ✅ Shows agent metadata
- ✅ Timestamp is recent
- ✅ No errors in browser console

---

## Troubleshooting

### Issue: Python dependencies missing

**Symptoms:**
```
ModuleNotFoundError: No module named 'requests'
```

**Solution:**
```bash
cd /Users/donaldross/dev/ma-tracker-app/python-service
source .venv/bin/activate
pip install -r requirements.txt
```

### Issue: IB TWS connection refused

**Symptoms:**
```
Error connecting to IB TWS: Connection refused
```

**Solutions:**
1. Ensure TWS/Gateway is running and logged in
2. Check API is enabled: File > Global Configuration > API > Settings
3. Verify port: 7497 (TWS) or 4002 (Gateway)
4. Try different client_id in `.env.local`: `IB_CLIENT_ID=101`
5. Restart TWS/Gateway

### Issue: Database connection error

**Symptoms:**
```
PrismaClientInitializationError: Can't reach database
```

**Solutions:**
1. Start Postgres.app
2. Verify database exists: `psql -U donaldross -l | grep ma_tracker`
3. Create if missing: `createdb -U donaldross ma_tracker`
4. Apply schema: `npx prisma db push`

### Issue: Deal not found

**Symptoms:**
```
Server returned 404: Deal not found for ticker: CSGS
```

**Solutions:**
1. Run seed script: `npm run db:seed`
2. Or manually add deal via UI
3. Use a different ticker that exists in your database

### Issue: API key mismatch

**Symptoms:**
```
Server returned 403: Invalid API key
```

**Solutions:**
1. Check `python-service/.env.local` has `AGENT_API_KEY=dev-test-key-replace-in-production`
2. Check `.env.development` has same key
3. Restart Next.js dev server after changing `.env.development`

### Issue: Port 3000 already in use

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solutions:**
1. Kill existing process: `lsof -ti:3000 | xargs kill -9`
2. Or use different port: `npm run dev -- -p 3001`
3. Update `.env.local` SERVER_URL if using different port

---

## Quick Test Script

For future testing, you can use this one-liner (after initial setup):

```bash
# Terminal 1: Start server
cd /Users/donaldross/dev/ma-tracker-app && npm run dev

# Terminal 2: Run agent
cd /Users/donaldross/dev/ma-tracker-app/python-service && \
  source .venv/bin/activate && \
  python3 price_agent.py --ticker CSGS --deal-price 81.34 --close-date 2026-06-30
```

---

## Success Checklist

- [ ] PostgreSQL running
- [ ] Database has test deals
- [ ] Python venv created and activated
- [ ] Python dependencies installed
- [ ] IB TWS running and logged in
- [ ] IB API enabled and configured
- [ ] IB connection test passes
- [ ] Dry-run test passes
- [ ] Next.js dev server running
- [ ] API endpoint responds (even with wrong key)
- [ ] End-to-end test passes (agent → server)
- [ ] UI displays option chain with agent metadata

**If all checked, you're ready for production deployment!** 🚀

---

## Next Steps After Local Testing

Once local testing is complete:

1. **Review logs** - Check for any warnings or errors
2. **Test with multiple tickers** - Verify it works for different stocks
3. **Test conflict handling** - Run agent twice quickly, verify last-write-wins
4. **Review documentation** - Read `docs/PRICE_AGENT_SETUP.md` for production setup
5. **Plan production deployment** - Follow `MA_OPTIONS_DISTRIBUTED_ARCHITECTURE_IMPLEMENTATION.md`

---

## Support

If you encounter issues not covered here:
1. Check server logs (Next.js terminal)
2. Check agent logs (Python terminal)
3. Check browser console (F12)
4. Review `MA_OPTIONS_DISTRIBUTED_ARCHITECTURE_IMPLEMENTATION.md`
5. Review `docs/PRICE_AGENT_SETUP.md`

---

**Last Updated:** December 26, 2025  
**Version:** 1.0


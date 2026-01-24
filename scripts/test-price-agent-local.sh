#!/bin/bash
#
# Quick Local Testing Script for Price Agent
# Tests the distributed architecture on your Mac
#

set -e  # Exit on error

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get ticker from argument or use default
TEST_TICKER=${1:-CSGS}

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  🧪 MA OPTIONS SCANNER - LOCAL TESTING (TICKER: $TEST_TICKER)"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check PostgreSQL
echo "Step 1: Checking PostgreSQL..."

# Try to find psql in common locations
PSQL_CMD=""
if command -v psql > /dev/null 2>&1; then
    PSQL_CMD="psql"
elif [ -f "/Applications/Postgres.app/Contents/Versions/latest/bin/psql" ]; then
    PSQL_CMD="/Applications/Postgres.app/Contents/Versions/latest/bin/psql"
fi

if [ -z "$PSQL_CMD" ]; then
    echo -e "${RED}❌ psql command not found${NC}"
    echo "   Please ensure Postgres.app is installed or psql is in your PATH"
    exit 1
fi

if $PSQL_CMD -U donaldross -d ma_tracker -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${RED}❌ PostgreSQL is not running or database doesn't exist${NC}"
    echo "   Please start Postgres.app and run: createdb -U donaldross ma_tracker"
    exit 1
fi

# Step 2: Check for test deals and get details for the target ticker
echo ""
echo "Step 2: Checking for ticker details..."

# Fetch deal details (ticker, price, close date)
# Using -A -t -F ' ' to get unaligned, space-separated values without headers
DEAL_DETAILS=$($PSQL_CMD -U donaldross -d ma_tracker -A -t -F ' ' -c "
    SELECT ticker, cash_per_share, expected_close_date 
    FROM deals d 
    JOIN deal_versions v ON d.deal_id = v.deal_id 
    WHERE d.ticker = '$TEST_TICKER' 
    AND v.is_current_version = true 
    LIMIT 1;
" 2>/dev/null)

if [ -n "$DEAL_DETAILS" ]; then
    # Parse the details (Ticker Price Date)
    # Note: xargs already trimmed whitespace and joined with spaces
    read -r TICKER DEAL_PRICE CLOSE_DATE <<< "$DEAL_DETAILS"
    echo -e "${GREEN}✅ Found details for $TICKER: Price=\$$DEAL_PRICE, Close=$CLOSE_DATE${NC}"
else
    # Fallback to defaults if ticker not found
    echo -e "${YELLOW}⚠️  Ticker $TEST_TICKER not found in database. Using defaults.${NC}"
    DEAL_PRICE="100.00"
    CLOSE_DATE="2026-06-30"
fi

# Step 3: Check Python environment
echo ""
echo "Step 3: Checking Python environment..."
cd "$PROJECT_ROOT/python-service"
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}⚠️  Python venv not found. Creating...${NC}"
    python3 -m venv .venv
fi

source .venv/bin/activate

# Check if dependencies are installed
if ! python3 -c "import requests" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Installing Python dependencies...${NC}"
    pip install -r requirements.txt > /dev/null
fi

echo -e "${GREEN}✅ Python environment ready${NC}"

# Step 4: Check configuration
echo ""
echo "Step 4: Checking configuration..."
if [ ! -f ".env.local" ]; then
    echo -e "${RED}❌ .env.local not found${NC}"
    echo "   Creating from example..."
    cp .env.local.example .env.local
    echo "   Please edit .env.local with your settings"
    exit 1
fi

AGENT_ID=$(grep "^AGENT_ID=" .env.local | cut -d'=' -f2)
if [ -z "$AGENT_ID" ]; then
    echo -e "${RED}❌ AGENT_ID not set in .env.local${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration OK (Agent: $AGENT_ID)${NC}"

# Step 5: Check IB TWS connection
echo ""
echo "Step 5: Testing IB TWS connection..."
echo "   (This will take a few seconds...)"

IB_TEST=$(python3 -c "
from app.options.ib_client import IBClient
import sys
try:
    client = IBClient()
    connected = client.connect(host='127.0.0.1', port=7497, client_id=100)
    client.disconnect()
    if connected:
        print('CONNECTED')
        sys.exit(0)
    else:
        print('FAILED')
        sys.exit(1)
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
" 2>&1)

if echo "$IB_TEST" | grep -q "CONNECTED"; then
    echo -e "${GREEN}✅ IB TWS connection successful${NC}"
else
    echo -e "${RED}❌ IB TWS connection failed${NC}"
    echo "   Error: $IB_TEST"
    echo ""
    echo "   Troubleshooting:"
    echo "   1. Ensure IB TWS or Gateway is running and logged in"
    echo "   2. Enable API: File > Global Configuration > API > Settings"
    echo "   3. Check port: 7497 (TWS) or 4002 (Gateway)"
    echo "   4. Add 127.0.0.1 to Trusted IP Addresses"
    echo ""
    exit 1
fi

# Step 6: Run dry-run test
echo ""
echo "Step 6: Running dry-run test..."
echo "   (Fetching option chain for $TEST_TICKER...)"

if python3 price_agent.py \
    --ticker "$TEST_TICKER" \
    --deal-price "$DEAL_PRICE" \
    --close-date "$CLOSE_DATE" \
    --dry-run > /tmp/agent_test.log 2>&1; then
    
    CONTRACTS=$(grep "Fetched" /tmp/agent_test.log | grep -oE "[0-9]+ option contracts" | grep -oE "[0-9]+")
    echo -e "${GREEN}✅ Dry-run successful (fetched $CONTRACTS contracts)${NC}"
else
    echo -e "${RED}❌ Dry-run failed${NC}"
    cat /tmp/agent_test.log
    exit 1
fi

# Step 7: Check if Next.js server is running
echo ""
echo "Step 7: Checking Next.js server..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Next.js server is running${NC}"
    
    # Step 8: Run live test
    echo ""
    echo "Step 8: Running live test (agent → server)..."
    echo "   (This will send data to http://localhost:3000)..."
    
    # Run in background with a spinner or just show progress
    python3 price_agent.py \
        --ticker "$TEST_TICKER" \
        --deal-price "$DEAL_PRICE" \
        --close-date "$CLOSE_DATE" > /tmp/agent_live.log 2>&1 &
    
    AGENT_PID=$!
    
    # Wait for completion or timeout (increased to 180s for larger option chains)
    COUNT=0
    while kill -0 $AGENT_PID 2>/dev/null; do
        sleep 1
        COUNT=$((COUNT + 1))
        if [ $COUNT -gt 180 ]; then
            echo -e "${RED}❌ Test timed out after 180s${NC}"
            kill -9 $AGENT_PID 2>/dev/null
            cat /tmp/agent_live.log
            exit 1
        fi
        if [ $((COUNT % 10)) -eq 0 ]; then
            echo "   ... still working ($COUNT s)"
        fi
    done
    
    # Wait for the exit status
    wait $AGENT_PID
    EXIT_STATUS=$?
    
    if [ $EXIT_STATUS -eq 0 ] && grep -q "Server accepted data" /tmp/agent_live.log; then
        echo -e "${GREEN}✅ Live test successful!${NC}"
        echo ""
        echo "   Data sent to server and accepted."
        echo "   Check UI at: http://localhost:3000/ma-options"
        echo ""
    else
        echo -e "${RED}❌ Live test failed (Exit code: $EXIT_STATUS)${NC}"
        echo "   Last 10 lines of log:"
        tail -n 10 /tmp/agent_live.log
        echo ""
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Next.js server is not running${NC}"
    echo ""
    echo "   To complete testing:"
    echo "   1. Open a new terminal"
    echo "   2. cd $PROJECT_ROOT"
    echo "   3. npm run dev"
    echo "   4. Re-run this script"
    echo ""
    exit 0
fi

# Success!
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo -e "${GREEN}  ✅ ALL TESTS PASSED!${NC}"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Open browser: http://localhost:3000/ma-options"
echo "  2. Select $TEST_TICKER deal"
echo "  3. Click 'Fetch Option Chain'"
echo "  4. Verify data shows 'source: agent' with your agent ID"
echo ""
echo "To test with different ticker:"
echo "  ./scripts/test-price-agent-local.sh EA"
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo ""


#!/bin/bash
# Local Testing Script for KRJ Date Fix
# This script tests the fix locally before deploying to the server

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}KRJ Date Fix - Local Testing${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cd /Users/donaldross/dev/ma-tracker-app

# Step 1: Verify metadata.json exists
echo -e "${YELLOW}Step 1: Checking metadata.json...${NC}"
if [ -f "data/krj/metadata.json" ]; then
    echo -e "${GREEN}✓ metadata.json exists${NC}"
    echo "Content:"
    cat data/krj/metadata.json
    echo ""
else
    echo -e "${RED}✗ metadata.json not found${NC}"
    echo "Creating sample metadata.json..."
    cat > data/krj/metadata.json << 'EOF'
{
  "signal_date": "2025-12-19",
  "generated_at": "2025-12-24T14:30:00Z",
  "categories": {
    "equities": "2025-12-19",
    "etfs_fx": "2025-12-19",
    "sp500": "2025-12-19",
    "sp100": "2025-12-19"
  },
  "version": "1.0"
}
EOF
    echo -e "${GREEN}✓ Created metadata.json${NC}"
fi

# Step 2: Build the app
echo ""
echo -e "${YELLOW}Step 2: Building Next.js app...${NC}"
npm run build > /tmp/krj-build.log 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    echo "Check /tmp/krj-build.log for details"
    exit 1
fi

# Step 3: Start the production server
echo ""
echo -e "${YELLOW}Step 3: Starting production server...${NC}"
echo "Server will start on http://localhost:3000"
echo ""
echo -e "${GREEN}To test:${NC}"
echo "1. Open http://localhost:3000/krj in your browser"
echo "2. Check the date in the header"
echo "3. It should show 'Dec 19, 2025'"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Kill any existing process on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start the server
npm start


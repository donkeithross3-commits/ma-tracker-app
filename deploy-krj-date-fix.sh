#!/bin/bash
# KRJ Date Fix Deployment Script
# This script deploys the metadata-based date fix to the server

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DROPLET_IP="${DROPLET_IP:-}"  # Set via environment variable or prompt
DROPLET_USER="don"
LOCAL_APP_DIR="/Users/donaldross/dev/ma-tracker-app"
REMOTE_APP_DIR="/home/don/apps"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}KRJ Date Fix Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if DROPLET_IP is set
if [ -z "$DROPLET_IP" ]; then
    echo -e "${YELLOW}Enter your DigitalOcean droplet IP address:${NC}"
    read -r DROPLET_IP
fi

echo -e "${GREEN}Deploying to: ${DROPLET_USER}@${DROPLET_IP}${NC}"
echo ""

# Step 1: Deploy UI changes
echo -e "${YELLOW}Step 1: Deploying UI changes...${NC}"
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'data' \
    --exclude '.git' \
    "${LOCAL_APP_DIR}/" \
    "${DROPLET_USER}@${DROPLET_IP}:${REMOTE_APP_DIR}/ma-tracker-app/"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ UI files synced successfully${NC}"
else
    echo -e "${RED}✗ Failed to sync UI files${NC}"
    exit 1
fi

# Step 2: Deploy batch script
echo ""
echo -e "${YELLOW}Step 2: Deploying batch script...${NC}"
rsync -avz --progress \
    "${LOCAL_APP_DIR}/scripts/run_krj_batch.py" \
    "${DROPLET_USER}@${DROPLET_IP}:${REMOTE_APP_DIR}/py_proj/run_krj_batch.py"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Batch script synced successfully${NC}"
else
    echo -e "${RED}✗ Failed to sync batch script${NC}"
    exit 1
fi

# Step 3: Rebuild and restart services on server
echo ""
echo -e "${YELLOW}Step 3: Rebuilding Docker containers...${NC}"
ssh "${DROPLET_USER}@${DROPLET_IP}" << 'ENDSSH'
    cd /home/don/apps
    
    echo "Building web container..."
    docker compose build web
    
    echo "Building krj-batch container..."
    docker compose build krj-batch
    
    echo "Restarting web service..."
    docker compose up -d web
    
    echo "Running batch script to generate metadata.json..."
    docker compose run --rm krj-batch
    
    echo ""
    echo "Verifying metadata.json..."
    if [ -f /home/don/apps/data/krj/metadata.json ]; then
        echo "✓ metadata.json exists"
        cat /home/don/apps/data/krj/metadata.json
    else
        echo "✗ metadata.json not found!"
        exit 1
    fi
ENDSSH

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Deployment completed successfully${NC}"
else
    echo -e "${RED}✗ Deployment failed${NC}"
    exit 1
fi

# Step 4: Display success message
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Open your browser and navigate to: http://${DROPLET_IP}:3000/krj"
echo "2. Enter your basic auth credentials"
echo "3. Verify the date in the header shows the correct signal date (e.g., Dec 19, 2025)"
echo ""
echo -e "${YELLOW}To check logs:${NC}"
echo "  ssh ${DROPLET_USER}@${DROPLET_IP}"
echo "  cd /home/don/apps"
echo "  docker compose logs web"
echo "  docker compose logs krj-batch"
echo ""


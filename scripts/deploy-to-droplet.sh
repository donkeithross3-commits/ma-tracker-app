#!/bin/bash
# KRJ Dashboard - Production Deployment Script
# 
# Usage:
#   ./scripts/deploy-to-droplet.sh [quick|full|batch]
#
# Modes:
#   quick - Deploy specific files (default: components/*)
#   full  - Deploy entire app directory
#   batch - Deploy batch script only

set -e # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DROPLET_USER="don"
DROPLET_IP="134.199.204.12"
LOCAL_APP_DIR="/Users/donaldross/dev/ma-tracker-app"
REMOTE_APP_DIR="/home/don/apps/ma-tracker-app"
REMOTE_BASE_DIR="/home/don/apps"

# Parse arguments
MODE="${1:-quick}"
SPECIFIC_FILES="${2:-}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}KRJ Dashboard - Production Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Mode: ${MODE}${NC}"
echo -e "${YELLOW}Droplet: ${DROPLET_IP}${NC}"
echo ""

# Function to check if droplet is reachable
check_connection() {
    echo -e "${YELLOW}Checking connection to droplet...${NC}"
    if ! ssh -o ConnectTimeout=5 "${DROPLET_USER}@${DROPLET_IP}" "echo 'Connected'" > /dev/null 2>&1; then
        echo -e "${RED}✗ Cannot connect to droplet${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Connection successful${NC}"
    echo ""
}

# Function to sync files
sync_files() {
    local source=$1
    local dest=$2
    local description=$3
    
    echo -e "${YELLOW}Syncing ${description}...${NC}"
    rsync -avz "${source}" "${DROPLET_USER}@${DROPLET_IP}:${dest}"
    echo -e "${GREEN}✓ ${description} synced${NC}"
    echo ""
}

# Function to rebuild Docker image
rebuild_image() {
    local service=$1
    
    echo -e "${YELLOW}Rebuilding Docker image for ${service}...${NC}"
    ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_APP_DIR} && docker build --no-cache -t ma-tracker-app-dev -f Dockerfile . 2>&1 | tail -20"
    echo -e "${GREEN}✓ Docker image rebuilt${NC}"
    echo ""
}

# Function to recreate container
recreate_container() {
    local service=$1
    
    echo -e "${YELLOW}Recreating ${service} container...${NC}"
    ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_BASE_DIR} && docker compose down ${service} && docker compose up -d ${service}"
    echo -e "${GREEN}✓ Container recreated${NC}"
    echo ""
}

# Function to verify deployment
verify_deployment() {
    echo -e "${YELLOW}Verifying deployment...${NC}"
    
    # Check container status
    echo -e "${BLUE}Container status:${NC}"
    ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_BASE_DIR} && docker compose ps"
    echo ""
    
    # Check recent logs
    echo -e "${BLUE}Recent logs:${NC}"
    ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_BASE_DIR} && docker compose logs web --tail 10"
    echo ""
    
    echo -e "${GREEN}✓ Deployment verified${NC}"
    echo ""
}

# Main deployment logic
check_connection

case "${MODE}" in
    quick)
        echo -e "${BLUE}Quick Deployment Mode${NC}"
        echo -e "${YELLOW}Deploying specific files to droplet${NC}"
        echo ""
        
        if [ -n "${SPECIFIC_FILES}" ]; then
            # Deploy specific files provided as argument
            sync_files "${LOCAL_APP_DIR}/${SPECIFIC_FILES}" "${REMOTE_APP_DIR}/${SPECIFIC_FILES%/*}/" "specified files"
        else
            # Default: deploy components
            sync_files "${LOCAL_APP_DIR}/components/" "${REMOTE_APP_DIR}/components/" "components"
        fi
        
        rebuild_image "web"
        recreate_container "web"
        verify_deployment
        ;;
        
    full)
        echo -e "${BLUE}Full Deployment Mode${NC}"
        echo -e "${YELLOW}Deploying entire app directory${NC}"
        echo ""
        
        rsync -avz \
            --exclude 'node_modules' \
            --exclude '.next' \
            --exclude '.git' \
            --exclude 'data/krj/*.csv' \
            "${LOCAL_APP_DIR}/" \
            "${DROPLET_USER}@${DROPLET_IP}:${REMOTE_APP_DIR}/"
        
        echo -e "${GREEN}✓ Full app synced${NC}"
        echo ""
        
        rebuild_image "web"
        recreate_container "web"
        verify_deployment
        ;;
        
    batch)
        echo -e "${BLUE}Batch Script Deployment Mode${NC}"
        echo -e "${YELLOW}Deploying batch processing script${NC}"
        echo ""
        
        sync_files "${LOCAL_APP_DIR}/scripts/run_krj_batch.py" "${REMOTE_BASE_DIR}/py_proj/" "batch script"
        
        echo -e "${YELLOW}Rebuilding krj-batch image...${NC}"
        ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_BASE_DIR} && docker compose build krj-batch"
        echo -e "${GREEN}✓ krj-batch image rebuilt${NC}"
        echo ""
        
        echo -e "${YELLOW}Testing batch script...${NC}"
        ssh "${DROPLET_USER}@${DROPLET_IP}" "cd ${REMOTE_BASE_DIR} && docker compose run --rm krj-batch"
        echo -e "${GREEN}✓ Batch script executed${NC}"
        echo ""
        
        echo -e "${YELLOW}Verifying metadata.json...${NC}"
        ssh "${DROPLET_USER}@${DROPLET_IP}" "cat ${REMOTE_BASE_DIR}/data/krj/metadata.json"
        echo -e "${GREEN}✓ Batch deployment complete${NC}"
        echo ""
        ;;
        
    *)
        echo -e "${RED}Invalid mode: ${MODE}${NC}"
        echo ""
        echo "Usage: $0 [quick|full|batch] [specific-file-path]"
        echo ""
        echo "Examples:"
        echo "  $0 quick                              # Deploy components (default)"
        echo "  $0 quick app/krj/page.tsx             # Deploy specific file"
        echo "  $0 full                               # Deploy entire app"
        echo "  $0 batch                              # Deploy batch script"
        exit 1
        ;;
esac

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Use hard refresh in browser${NC}"
echo -e "${YELLOW}   Mac: Cmd + Shift + R${NC}"
echo -e "${YELLOW}   Windows/Linux: Ctrl + Shift + R${NC}"
echo ""
echo -e "${BLUE}Test URL: http://${DROPLET_IP}:3000/krj${NC}"
echo ""


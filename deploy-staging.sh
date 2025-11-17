#!/bin/bash
# Staging deployment script for Mac/Linux
# Ensures clean deployment with no cache issues

echo "========================================"
echo "MA Tracker - Staging Deployment"
echo "========================================"
echo

# Step 1: Stop all services
echo "[1/7] Stopping services..."
./dev-stop.sh
sleep 2

# Step 2: Pull latest code
echo "[2/7] Pulling latest code from main..."
git fetch origin
git reset --hard origin/main
echo "Code updated to latest main"

# Step 3: Clean Python cache AFTER pulling code
echo "[3/7] Cleaning Python bytecode cache..."
find python-service -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find python-service -name "*.pyc" -delete 2>/dev/null
echo "Python cache cleaned"

# Step 4: Clean Next.js build cache
echo "[4/7] Cleaning Next.js build cache..."
rm -rf .next
echo "Next.js cache cleaned"

# Step 5: Clean logs
echo "[5/7] Cleaning old logs..."
rm -f logs/python-backend.log
rm -f logs/nextjs-frontend.log
echo "Logs cleaned"

# Step 6: Install/update dependencies (optional, uncomment if needed)
# echo "[6/7] Updating Python dependencies..."
# cd python-service
# /Users/donaldross/opt/anaconda3/bin/python3 -m pip install -r requirements.txt --upgrade
# cd ..

echo "[6/7] Skipping dependency installation (not needed)"

# Step 7: Start services
echo "[7/7] Starting services..."
./dev-start.sh

echo
echo "Waiting for backend to fully initialize..."
sleep 10

echo "Starting intelligence monitoring..."
curl -X POST http://localhost:8000/intelligence/monitoring/start

echo
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo
echo "Services running:"
echo "  Backend: http://localhost:8000"
echo "  Frontend: http://localhost:3000"
echo "  Intelligence monitoring: STARTED"
echo
echo "Check logs for any errors:"
echo "  tail -f logs/python-backend.log"
echo "  tail -f logs/nextjs-frontend.log"
echo

#!/usr/bin/env bash
#
# Weekly KRJ update: copy CSVs + metadata, then refresh market caps.
# Run from the droplet's apps directory (where docker-compose lives), e.g.:
#   cd /home/don/apps && ./ma-tracker-app/scripts/run_weekly_krj.sh
#
# Cron (Saturday 8 AM): 
#   0 8 * * 6 cd /home/don/apps && ./ma-tracker-app/scripts/run_weekly_krj.sh >> /home/don/apps/logs/krj_weekly.log 2>&1
#
set -e

# Resolve paths: script lives at ma-tracker-app/scripts/run_weekly_krj.sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APPS_DIR="${APPS_DIR:-$(cd "$REPO_DIR/.." && pwd)}"
KRJ_DATA="${APPS_DIR}/data/krj"

echo "[$(date -Iseconds)] Weekly KRJ: APPS_DIR=$APPS_DIR"

# 1. Run Python batch (copy CSVs + generate metadata)
echo "[$(date -Iseconds)] Running krj-batch..."
cd "$APPS_DIR"
docker compose run --rm krj-batch
echo "[$(date -Iseconds)] krj-batch done."

# 2. Refresh market caps (Node script writes into same volume)
echo "[$(date -Iseconds)] Fetching market caps..."
mkdir -p "$KRJ_DATA"
docker run --rm \
  -v "$REPO_DIR:/app" \
  -v "$KRJ_DATA:/app/data/krj" \
  -w /app \
  --env-file "$REPO_DIR/python-service/.env" \
  node:22-slim \
  npx tsx scripts/fetch-krj-market-caps.ts
echo "[$(date -Iseconds)] Market caps done."

echo "[$(date -Iseconds)] Weekly KRJ complete."

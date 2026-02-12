# Scripts Directory

This directory contains utility scripts for the KRJ dashboard deployment.

## check-relay-status.sh

**Purpose:** Debug WebSocket relay and IB status when the local agent is connected but the dashboard shows "Disconnected".

**Usage (on the droplet, with the user's agent running):**
```bash
ssh droplet
cd ~/apps/ma-tracker-app
PYTHON_URL=http://localhost:8000 ./scripts/check-relay-status.sh
```

**Output:** Registry (who is connected), IB status (does any provider report IB connected). See `docs/RELAY_STATUS_DEBUG.md` for how to interpret results.

**See Also:** `docs/RELAY_STATUS_DEBUG.md`

---

## run_krj_batch.py

**Purpose:** Copy latest KRJ signal files from input directory to output directory and generate metadata.

**Usage:**
```bash
# On the server (inside Docker container)
python run_krj_batch.py

# Via Docker Compose
docker compose run --rm krj-batch
```

**Environment Variables:**
- `KRJ_DATA_DIR`: Input directory (default: `/root/Documents/daily_data`)
- `KRJ_OUTPUT_DIR`: Output directory (default: `/data/krj`)

**Input Files:**
```
KRJ_signals_latest_week_Equities_YYYY-MM-DD.csv
KRJ_signals_latest_week_ETFs_and_FX_YYYY-MM-DD.csv
KRJ_signals_latest_week_SP500_YYYY-MM-DD.csv
KRJ_signals_latest_week_SP100_YYYY-MM-DD.csv
```

**Output Files:**
```
latest_equities.csv
latest_etfs_fx.csv
latest_sp500.csv
latest_sp100.csv
metadata.json (NEW)
```

**Metadata Format:**
```json
{
  "signal_date": "2025-12-19",
  "generated_at": "2025-12-24T10:30:00Z",
  "categories": {
    "equities": "2025-12-19",
    "etfs_fx": "2025-12-19",
    "sp500": "2025-12-19",
    "sp100": "2025-12-19"
  },
  "version": "1.0"
}
```

**How It Works:**
1. Scans input directory for files matching pattern `KRJ_signals_latest_week_{CATEGORY}_{YYYY-MM-DD}.csv`
2. Extracts the date from the filename using regex
3. Selects the lexicographically latest file for each category
4. Copies to output directory with simplified name (`latest_*.csv`)
5. Generates `metadata.json` with the signal date

**Deployment:**

This script is deployed to the server at `/home/don/apps/py_proj/run_krj_batch.py` and runs inside the `krj-batch` Docker container.

To update on the server:
```bash
rsync -avz scripts/run_krj_batch.py don@<DROPLET_IP>:/home/don/apps/py_proj/run_krj_batch.py
docker compose build krj-batch
```

**See Also:**
- `KRJ_DATE_FIX_DEPLOYMENT.md` - Deployment guide
- `KRJ_DATE_FIX_SUMMARY.md` - Implementation summary

---

## fetch-krj-market-caps.ts

**Purpose:** Populate `data/krj/ticker_market_caps.json` with market cap (in billions) for every ticker that appears in the KRJ CSVs. Uses Polygon’s ticker details API so the Mkt Cap column on the KRJ signals dashboard is filled for all tickers.

**Usage:**
```bash
# From project root (requires POLYGON_API_KEY in .env.local, .env, or env)
npm run krj:fetch-market-caps
# Or: npx tsx scripts/fetch-krj-market-caps.ts
```

**Behavior:** Reads all `data/krj/latest_*.csv` files, collects unique tickers, fetches market cap from Polygon for any ticker not already in `ticker_market_caps.json`, then writes the merged result. Rate-limited to ~4.5 requests/sec.

**Run from the droplet:** Polygon key is in `python-service/.env`. The web container mounts `~/apps/data/krj`, not the repo’s `data/krj`, so you must copy the generated file into that volume after the script runs:

```bash
cd ~/apps/ma-tracker-app
docker run --rm -v "$(pwd):/app" -w /app --env-file python-service/.env node:22-slim npx tsx scripts/fetch-krj-market-caps.ts
mkdir -p ~/apps/data/krj && cp data/krj/ticker_market_caps.json ~/apps/data/krj/
```

No rebuild needed—the container reads the mount live. To persist the file in the repo for future deploys: commit and push `data/krj/ticker_market_caps.json`, then run your normal deploy (which does `cp ~/apps/ma-tracker-app/data/krj/* ~/apps/data/krj/`).

**Run locally:** After running, commit the updated `data/krj/ticker_market_caps.json` and deploy so production shows market caps for all tickers.

---

## run_weekly_krj.sh

**Purpose:** Single entry point for the weekly KRJ update: (1) run the Python batch (copy CSVs + metadata), (2) run the market cap fetch so `ticker_market_caps.json` is refreshed in the same volume the web container uses.

**Usage on droplet:** From the apps directory (where `docker-compose` lives):

```bash
cd /home/don/apps
./ma-tracker-app/scripts/run_weekly_krj.sh
```

**Cron (Saturday 8 AM):** Add to crontab (`crontab -e`):

```
0 8 * * 6 cd /home/don/apps && ./ma-tracker-app/scripts/run_weekly_krj.sh >> /home/don/apps/logs/krj_weekly.log 2>&1
```

Ensure `/home/don/apps/logs` exists (`mkdir -p /home/don/apps/logs`). After `git pull`, the script is at `~/apps/ma-tracker-app/scripts/run_weekly_krj.sh`; cron runs from a minimal env so paths are absolute.

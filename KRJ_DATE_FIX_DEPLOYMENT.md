# KRJ Date Fix Deployment Guide

**Date:** 2025-12-25  
**Issue:** UI displays file modification date (12/24) instead of actual signal date (12/19)  
**Solution:** Metadata file approach - batch script extracts date from source filename and writes to `metadata.json`

---

## Overview

This fix ensures the KRJ dashboard displays the correct **Friday signal date** (e.g., Dec 19, 2025) instead of the file modification timestamp (e.g., Dec 24, 2025).

### What Changed

1. **Batch Script (`run_krj_batch.py`)**: Now extracts the date from source CSV filenames and writes `metadata.json`
2. **UI (`app/krj/page.tsx`)**: Now reads from `metadata.json` with fallback to file timestamp for backwards compatibility
3. **New File**: `data/krj/metadata.json` contains the authoritative signal date

---

## Deployment Steps

### Part 1: Deploy UI Changes (Zero Downtime)

The UI changes are backwards compatible - they will fall back to file timestamps if `metadata.json` doesn't exist.

#### On Your Local Machine

```bash
# 1. Ensure you have the latest code
cd /Users/donaldross/dev/ma-tracker-app

# 2. Verify the build succeeds
npm run build

# 3. Sync to server (replace <DROPLET_IP> with actual IP)
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'data' \
  ./ \
  don@<DROPLET_IP>:/home/don/apps/ma-tracker-app/
```

#### On the Server

```bash
# SSH to server
ssh don@<DROPLET_IP>

# Navigate to app directory
cd /home/don/apps

# Rebuild the web container
docker compose build web

# Restart the web service
docker compose up -d web

# Verify the service is running
docker compose ps
docker compose logs -f web
```

**At this point**, the UI is deployed but still showing file timestamps (because `metadata.json` doesn't exist yet). This is expected and safe.

---

### Part 2: Deploy Batch Script Changes

Now update the batch script to generate `metadata.json`.

#### On Your Local Machine

```bash
# Sync the updated batch script to server
rsync -avz --progress \
  /Users/donaldross/dev/ma-tracker-app/scripts/run_krj_batch.py \
  don@<DROPLET_IP>:/home/don/apps/py_proj/run_krj_batch.py
```

#### On the Server

```bash
# SSH to server (if not already connected)
ssh don@<DROPLET_IP>

# Navigate to app directory
cd /home/don/apps

# Rebuild the krj-batch container
docker compose build krj-batch

# Run the batch script to generate metadata.json
docker compose run --rm krj-batch

# Expected output:
# ============================================================
# KRJ Batch Copy Script
# ============================================================
# Input directory:  /root/Documents/daily_data
# Output directory: /data/krj
#
# Found latest Equities file: KRJ_signals_latest_week_Equities_2025-12-19.csv
#   Signal date: 2025-12-19
#   Copying to: /data/krj/latest_equities.csv
# Found latest ETFs_and_FX file: KRJ_signals_latest_week_ETFs_and_FX_2025-12-19.csv
#   Signal date: 2025-12-19
#   Copying to: /data/krj/latest_etfs_fx.csv
# ... (etc)
#
# Generating metadata file: /data/krj/metadata.json
#   Signal date: 2025-12-19
# ✓ Metadata file created successfully
#
# ============================================================
# Batch copy complete!
# ============================================================

# Verify metadata.json was created
cat /home/don/apps/data/krj/metadata.json

# Expected output:
# {
#   "signal_date": "2025-12-19",
#   "generated_at": "2025-12-24T10:30:00Z",
#   "categories": {
#     "equities": "2025-12-19",
#     "etfs_fx": "2025-12-19",
#     "sp500": "2025-12-19",
#     "sp100": "2025-12-19"
#   },
#   "version": "1.0"
# }
```

---

### Part 3: Verify the Fix

#### Check the UI

1. Open your browser and navigate to `http://<DROPLET_IP>:3000/krj`
2. Enter basic auth credentials
3. **Verify the date** in the header next to "KRJ Weekly Signals"
4. It should now display **"Dec 19, 2025"** (or whatever the actual signal date is)

#### Check the Logs

```bash
# On the server
docker compose logs web | grep "signal"
```

---

## Rollback Procedure

If something goes wrong, you can roll back to the previous version:

### Rollback UI Only

```bash
# On the server
cd /home/don/apps

# Revert to previous image (if you have it)
docker compose down web
docker compose up -d web
```

### Rollback Batch Script Only

```bash
# On the server
cd /home/don/apps/py_proj

# Restore the old batch script from backup (if you made one)
cp run_krj_batch.py.bak run_krj_batch.py

# Rebuild the container
cd /home/don/apps
docker compose build krj-batch
```

### Complete Rollback

If you need to completely roll back:

1. Delete `metadata.json`: `rm /home/don/apps/data/krj/metadata.json`
2. The UI will automatically fall back to file timestamps
3. Redeploy the old code from git

---

## Testing Checklist

- [ ] UI deployed successfully
- [ ] Batch script deployed successfully
- [ ] `metadata.json` created with correct signal date
- [ ] UI displays correct date (Dec 19, 2025)
- [ ] No errors in `docker compose logs web`
- [ ] No errors in `docker compose logs krj-batch`
- [ ] Date updates when new signals are generated

---

## Future Improvements

### Option 1: Add Date Column to CSV (Recommended)

Instead of relying on `metadata.json`, add a `signal_date` column directly to the CSV files:

```python
# In the backtester (local machine)
df['signal_date'] = last_date  # e.g., "2025-12-19"
df.to_csv('KRJ_signals_latest_week_Equities_2025-12-19.csv', index=False)
```

Then update the UI to read from the CSV column instead of `metadata.json`.

**Benefits:**
- Date is embedded in the data itself
- No separate metadata file needed
- More robust and self-documenting

### Option 2: Automated Weekly Updates

Set up a cron job on the server to:
1. Rsync data from local machine (or pull from S3/cloud storage)
2. Run `docker compose run --rm krj-batch` automatically
3. Send notification on success/failure

---

## Troubleshooting

### UI Still Shows Old Date

**Symptom:** UI displays Dec 24 instead of Dec 19

**Possible Causes:**
1. `metadata.json` doesn't exist
2. `metadata.json` has incorrect format
3. Browser cache (hard refresh with Cmd+Shift+R or Ctrl+Shift+R)

**Solution:**
```bash
# On the server
cat /home/don/apps/data/krj/metadata.json

# If file doesn't exist or is malformed, regenerate it:
docker compose run --rm krj-batch
```

### Batch Script Fails

**Symptom:** `docker compose run --rm krj-batch` exits with error

**Possible Causes:**
1. Source CSV files don't exist in `py_proj/daily_data/`
2. Filename pattern doesn't match (e.g., wrong date format)
3. Permissions issue writing to `data/krj/`

**Solution:**
```bash
# Check if source files exist
ls -lh /home/don/apps/py_proj/daily_data/KRJ_signals_latest_week_*.csv

# Check permissions
ls -ld /home/don/apps/data/krj/

# View batch logs
docker compose logs krj-batch
```

### Metadata File Has Wrong Date

**Symptom:** `metadata.json` exists but shows wrong date

**Possible Causes:**
1. Batch script is reading from old CSV files
2. Rsync didn't update the source files

**Solution:**
```bash
# Check source file dates
ls -lh /home/don/apps/py_proj/daily_data/KRJ_signals_latest_week_*.csv

# Re-rsync from local machine
rsync -avz --progress \
  ~/Documents/daily_data/KRJ_signals_latest_week_*.csv \
  don@<DROPLET_IP>:/home/don/apps/py_proj/daily_data/

# Re-run batch script
docker compose run --rm krj-batch
```

---

## Technical Details

### Metadata File Format

```json
{
  "signal_date": "YYYY-MM-DD",
  "generated_at": "ISO 8601 timestamp",
  "categories": {
    "equities": "YYYY-MM-DD",
    "etfs_fx": "YYYY-MM-DD",
    "sp500": "YYYY-MM-DD",
    "sp100": "YYYY-MM-DD"
  },
  "version": "1.0"
}
```

### Data Flow

```
Local Machine
  └─ KRJ_backtester.py generates:
     KRJ_signals_latest_week_Equities_2025-12-19.csv
     
     ↓ rsync
     
Server: py_proj/daily_data/
  └─ KRJ_signals_latest_week_Equities_2025-12-19.csv
  
     ↓ run_krj_batch.py
     
Server: data/krj/
  ├─ latest_equities.csv (data)
  └─ metadata.json (date: 2025-12-19)
  
     ↓ Next.js reads
     
UI Header
  └─ "KRJ Weekly Signals Dec 19, 2025"
```

---

## Contact

If you encounter issues during deployment, check:
1. Docker logs: `docker compose logs web` and `docker compose logs krj-batch`
2. File permissions: `ls -lh /home/don/apps/data/krj/`
3. Metadata file: `cat /home/don/apps/data/krj/metadata.json`

---

*Last updated: 2025-12-25*


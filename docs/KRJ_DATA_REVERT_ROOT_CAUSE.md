# KRJ Data Revert — Root Cause and Fix

**Date:** 2026-02-15  
**Issue:** After many weeks of correct behavior, the KRJ dashboard reverted to January data (e.g. Jan 9) instead of showing the most recent Friday (e.g. Feb 6 or Feb 13). The Saturday 8 AM job had run successfully (e.g. 2/7 publishing 2/6 data).

---

## Root Cause

**Deploy was overwriting production KRJ data with the repo’s `data/krj/`.**

1. **Saturday cron** on the droplet runs **`/home/don/apps/scripts/run_krj_weekly.sh`** (the full pipeline). That script: syncs index constituents, runs **KRJ_backtester_updated.py** (generates signals for the most recent Friday into `~/apps/py_proj/.krj_data/daily_data/`), then copies the latest-week CSVs into **`~/apps/data/krj/`** and writes `metadata.json`. The web container mounts `~/apps/data/krj/`. So after the job runs, production has fresh data (e.g. 2/6).  
   **Note:** The repo also has `ma-tracker-app/scripts/run_weekly_krj.sh`, which is **copy-only** (Docker krj-batch + market caps) and reads from `py_proj/daily_data`; it does **not** generate data. Cron uses the droplet’s full-pipeline script, not this one.

2. **Deploy** (from push-and-deploy or manual) was doing:
   ```bash
   cp -r ~/apps/ma-tracker-app/data/krj/* ~/apps/data/krj/
   ```
   That copies from the **git repo’s** `data/krj/` into the **volume** `~/apps/data/krj/`. The repo’s `data/krj/` is only updated when someone commits those files (e.g. from a local run). It was never updated by the droplet’s Saturday job. So the repo still had old data (January).

3. **Any deploy after a successful Saturday run** therefore overwrote the good volume data with the repo’s stale January data. The dashboard then showed January again.

---

## Fix

1. **Stop overwriting KRJ data on deploy.**  
   The deploy command must **not** run `mkdir -p ~/apps/data/krj && cp -r ~/apps/ma-tracker-app/data/krj/* ~/apps/data/krj/`.  
   Production KRJ data is owned by the weekly job; the volume must be left unchanged on deploy.

2. **Deploy command** (use this):
   ```bash
   ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && cd ~/apps && docker compose build --no-cache web && docker compose up -d --force-recreate web'
   ```

3. **Restore current data on production** (one-time after this fix):  
   Either run the weekly job manually to repopulate from the latest source files, or restore from backup if you have a copy of `~/apps/data/krj/` from after the last successful Saturday run.

---

## References

- **Full pipeline (cron):** `/home/don/apps/scripts/run_krj_weekly.sh` (Saturday; generates via KRJ_backtester_updated.py then copies to data/krj).
- **Copy-only (repo):** `ma-tracker-app/scripts/run_weekly_krj.sh` (Docker krj-batch + market caps; does not generate).
- **Volume:** `~/apps/data/krj` (host) → `/app/data/krj` (web).
- **Deploy rules:** `.cursor/rules/push-and-deploy.mdc`, `CLAUDE.md` (Push and Deploy section).

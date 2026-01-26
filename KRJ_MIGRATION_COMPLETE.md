# KRJ Weekly Update - Migration to Droplet Complete ✅

**Date:** December 26, 2025  
**Status:** Ready for Production (after dependency install)

---

## Summary

The KRJ weekly update process has been successfully migrated from local Mac execution to automated droplet execution. All code, scripts, and documentation have been deployed to the droplet at `134.199.204.12`.

---

## What Changed

### Before (Local Mac)
- Manual execution of `/Users/donaldross/update_krj_weekly.sh`
- Hardcoded API key in Python script
- Data in `~/Documents/daily_data/`
- Manual sync to droplet

### After (Droplet)
- Automated execution via cron (Saturday 6:00 AM)
- API key in `.env` file (secure)
- Data in `/home/don/apps/py_proj/.krj_data/daily_data/`
- Automatic update of web dashboard

---

## Next Steps (Manual Actions Required)

### 1. Install Python Dependencies (REQUIRED)

```bash
ssh don@134.199.204.12
bash /home/don/apps/py_proj/setup_droplet_dependencies.sh
```

This requires sudo access to install system packages.

### 2. Validate Installation

```bash
ssh don@134.199.204.12
bash /home/don/apps/py_proj/test_krj_migration.sh
```

### 3. Test Manual Execution

```bash
ssh don@134.199.204.12
/home/don/apps/scripts/run_krj_weekly.sh
```

Expected runtime: 30-60 minutes (first run with downloads)

### 4. Verify Web Dashboard

Visit: http://134.199.204.12:3000/krj

Check that the date shows the most recent Friday.

### 5. Install Cron Job

```bash
ssh don@134.199.204.12
crontab -e

# Add this line:
0 6 * * 6 /home/don/apps/scripts/run_krj_weekly.sh >> /home/don/apps/py_proj/.krj_data/logs/cron.log 2>&1
```

---

## Documentation

All documentation is available on the droplet:

- **Migration Guide:** `/home/don/apps/py_proj/KRJ_DROPLET_MIGRATION_GUIDE.md`
- **Operations Manual:** `/home/don/apps/py_proj/KRJ_OPERATIONS_MANUAL.md`
- **System Documentation:** `/home/don/apps/py_proj/KRJ_WEEKLY_UPDATE_SYSTEM_DOCUMENTATION.md`
- **Migration Summary:** `/home/don/apps/py_proj/MIGRATION_COMPLETE_SUMMARY.md`

---

## Quick Reference

### Check System Health
```bash
ssh don@134.199.204.12 "/home/don/apps/scripts/check_krj_health.sh"
```

### Run Manual Update
```bash
ssh don@134.199.204.12 "/home/don/apps/scripts/run_krj_weekly.sh"
```

### View Latest Log
```bash
ssh don@134.199.204.12 "ls -t /home/don/apps/py_proj/.krj_data/logs/krj_weekly_*.log | head -1 | xargs tail -50"
```

### Check Signal Date
```bash
ssh don@134.199.204.12 "cat /home/don/apps/data/krj/metadata.json | grep signal_date"
```

---

## Files Deployed

### Scripts
- `/home/don/apps/scripts/run_krj_weekly.sh` - Main weekly update script
- `/home/don/apps/scripts/check_krj_health.sh` - Health check script

### Python Code
- `/home/don/apps/py_proj/KRJ_backtester_updated.py` - Updated to use env vars
- `/home/don/apps/py_proj/dr3_data_libs.py` - Data download library
- `/home/don/apps/py_proj/sync_indexes.py` - Index sync script
- `/home/don/apps/py_proj/.env` - Environment variables (API key)

### Setup & Testing
- `/home/don/apps/py_proj/setup_droplet_dependencies.sh` - Dependency installer
- `/home/don/apps/py_proj/test_krj_migration.sh` - Validation tests

### Configuration
- `/home/don/apps/py_proj/krj_crontab.txt` - Cron job template
- `/home/don/apps/py_proj/krj_logrotate.conf` - Log rotation config

### Documentation
- `/home/don/apps/py_proj/KRJ_DROPLET_MIGRATION_GUIDE.md`
- `/home/don/apps/py_proj/KRJ_OPERATIONS_MANUAL.md`
- `/home/don/apps/py_proj/MIGRATION_COMPLETE_SUMMARY.md`

---

## Rollback Plan

If needed, you can quickly rollback to local Mac execution:

```bash
# Disable cron on droplet
ssh don@134.199.204.12
crontab -e
# Comment out the krj line

# Run local script on Mac
/Users/donaldross/update_krj_weekly.sh

# Manually sync to droplet if needed
rsync -avz ~/Documents/daily_data/KRJ_signals_latest_week_*.csv \
  don@134.199.204.12:/home/don/apps/data/krj/
```

---

## Support

For issues:
1. Check logs: `/home/don/apps/py_proj/.krj_data/logs/`
2. Run health check: `/home/don/apps/scripts/check_krj_health.sh`
3. Run validation: `/home/don/apps/py_proj/test_krj_migration.sh`
4. Review documentation (see above)

---

**Migration Completed:** December 26, 2025  
**Status:** Ready for production after dependency install  
**Next Action:** Run `setup_droplet_dependencies.sh` on droplet


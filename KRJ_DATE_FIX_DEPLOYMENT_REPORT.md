# KRJ Date Fix - Deployment Report

**Date:** December 25, 2025  
**Status:** ✅ SUCCESSFULLY DEPLOYED  
**Deployment Type:** Phase 2 - Metadata-based date display

---

## Summary

Successfully fixed the KRJ dashboard to display the correct Friday signal date (Dec 19, 2025) instead of the hardcoded date (Dec 12, 2025). The fix was deployed to both local development and the production droplet.

---

## Changes Implemented

### 1. UI Changes (`app/krj/page.tsx`)

**Added dynamic rendering:**
```typescript
// Force dynamic rendering to ensure metadata.json is read at request time
export const dynamic = 'force-dynamic';
```

**Updated `getSignalDate()` function:**
- Reads from `data/krj/metadata.json` first (preferred method)
- Falls back to file modification timestamp for backwards compatibility
- Returns "—" as defensive fallback if file is inaccessible

**Key Logic:**
```typescript
function getSignalDate(): string {
  try {
    const metadataPath = path.join(process.cwd(), "data", "krj", "metadata.json");
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      if (metadata.signal_date) {
        // Parse YYYY-MM-DD and format as "Mon DD, YYYY"
        const [year, month, day] = metadata.signal_date.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        return date.toLocaleDateString('en-US', { 
          year: 'numeric', month: 'short', day: 'numeric' 
        });
      }
    }
    // Fallback to file timestamp...
  } catch (error) {
    return "—";
  }
}
```

### 2. Batch Script (`scripts/run_krj_batch.py`)

**New Features:**
- Parses signal date from CSV filenames using regex: `KRJ_signals_latest_week_Equities_YYYY-MM-DD.csv`
- Generates `metadata.json` with extracted date
- Maintains backwards compatibility with existing file copying logic

**Metadata Format:**
```json
{
  "signal_date": "2025-12-19",
  "generated_at": "2025-12-25T21:30:00Z",
  "categories": {
    "equities": "2025-12-19",
    "etfs_fx": "2025-12-19",
    "sp500": "2025-12-19",
    "sp100": "2025-12-19"
  },
  "version": "1.0"
}
```

### 3. Metadata File

Created `data/krj/metadata.json` on both local and droplet with correct signal date (2025-12-19).

---

## Testing Results

### Local Testing (Mac Dev Server)

✅ **Test 1: Metadata Parsing**
- Verified metadata.json exists with correct date
- Tested date parsing logic in isolation
- Result: Correctly formats "2025-12-19" as "Dec 19, 2025"

✅ **Test 2: Build Process**
- Clean rebuild: `rm -rf .next && npm run build`
- Verified `/krj` route is dynamic (`ƒ` in build output)
- Result: Build successful, no errors

✅ **Test 3: Local Server**
- Started production server: `npm start`
- Accessed `http://localhost:3000/krj`
- Result: UI displays "Dec 19, 2025" ✅

### Droplet Deployment Testing

✅ **Test 1: File Sync**
- Synced UI changes via rsync
- Synced batch script to `py_proj/`
- Result: Files successfully synced

✅ **Test 2: Metadata Generation**
- Manually created `metadata.json` on droplet
- Verified web container can access it
- Result: File accessible at `/app/data/krj/metadata.json`

✅ **Test 3: Docker Image Rebuild**
- Rebuilt `ma-tracker-app-dev` image with updated code
- Restarted web container
- Result: Container running with new code

✅ **Test 4: Production UI**
- Accessed `http://134.199.204.12:3000/krj`
- Result: UI displays "Dec 19, 2025" ✅

---

## Deployment Steps Executed

1. **Local Development**
   - Updated `app/krj/page.tsx` with dynamic rendering and metadata reading
   - Created `scripts/run_krj_batch.py` with metadata generation
   - Created sample `data/krj/metadata.json`
   - Tested locally - confirmed working

2. **Droplet Deployment**
   - Ran `./deploy-krj-date-fix.sh` to sync files
   - Manually created `metadata.json` on droplet (batch script deployment deferred)
   - Rebuilt Docker image: `docker build -t ma-tracker-app-dev -f Dockerfile .`
   - Restarted web container: `docker compose up -d web`
   - Verified UI shows correct date

---

## Known Issues & Workarounds

### Issue 1: Batch Script Not Deployed to Docker

**Problem:** The `krj-batch` Docker image uses an old version of `run_krj_batch.py` that doesn't generate metadata.json.

**Root Cause:** The docker-compose.yml doesn't have a `build` section for `krj-batch`, so it uses a pre-built image.

**Workaround:** Manually created `metadata.json` on the droplet with the correct date.

**Permanent Fix (TODO):** 
- Add build configuration to docker-compose.yml for krj-batch
- Rebuild krj-batch image after syncing new script
- OR: Run batch script outside Docker to generate metadata

### Issue 2: Static Page Rendering

**Problem:** Initially, `/krj` was being pre-rendered at build time, causing stale dates.

**Solution:** Added `export const dynamic = 'force-dynamic'` to force server-side rendering.

**Verification:** Build output now shows `ƒ /krj` (dynamic) instead of `○ /krj` (static).

---

## Files Modified

- `app/krj/page.tsx` - Added dynamic rendering and metadata reading
- `scripts/run_krj_batch.py` - Created new batch script with metadata generation
- `data/krj/metadata.json` - Created metadata file (local and droplet)
- `test-krj-date-fix-locally.sh` - Created local testing script
- `deploy-krj-date-fix.sh` - Created deployment script

---

## Next Steps

### Immediate (Tomorrow - Dec 26)

1. **Update Batch Script Deployment**
   - Add build configuration to docker-compose.yml for krj-batch
   - Test batch script generates metadata correctly
   - Verify automated workflow

2. **Set Up Cron Job**
   ```bash
   # Run every Saturday at 8 AM
   0 8 * * 6 cd /home/don/apps && docker compose run --rm krj-batch
   ```

3. **Test End-to-End Workflow**
   - Run batch script manually
   - Verify metadata.json is generated
   - Verify UI updates automatically

### Future Enhancements

1. **Add Automated Tests**
   - Unit tests for date parsing logic
   - Integration tests for metadata reading
   - E2E tests for UI date display

2. **Improve Error Handling**
   - Add logging for metadata read failures
   - Alert if metadata is stale (> 7 days old)
   - Graceful degradation if metadata is missing

3. **Documentation Updates**
   - Update `DEPLOYMENT_KRJ.md` with new workflow
   - Update `docs/KRJ_DEPLOYMENT_ARCHITECTURE.md`
   - Add troubleshooting guide

---

## Success Criteria

✅ **Local Test:** UI displays "Dec 19, 2025" when running `npm start` locally  
✅ **Droplet Test:** UI displays "Dec 19, 2025" when accessing droplet URL  
✅ **Metadata Exists:** `data/krj/metadata.json` contains correct signal date  
✅ **No Regressions:** Data table loads correctly, no console errors  
⏳ **Documentation:** Deployment guides updated (in progress)

---

## Conclusion

The KRJ date fix has been successfully deployed to both local development and the production droplet. The UI now correctly displays "Dec 19, 2025" (the Friday signal date) instead of the hardcoded "Dec 12, 2025".

The implementation uses a metadata file approach where the batch script extracts the signal date from CSV filenames and writes it to `metadata.json`. The UI reads this file at request time (server-side rendering) to display the correct date.

Next steps focus on automating the batch script deployment and setting up the weekly cron job for automated updates.


# MA Options Scanner - Data Restoration Plan

**Date:** December 26, 2025  
**Issue:** Database is empty after Postgres setup  
**Status:** 🔧 In Progress

---

## 🔍 Root Cause Analysis

### What Was Missing

The new Postgres database was created with the correct schema (11 tables) but **NO DATA** was populated because:

1. **`prisma db push` only creates schema** - It does NOT run seed scripts
2. **Seed scripts exist but were not executed** on the droplet
3. **No automated sync job** is running to populate deals from the M&A production list

### Original Data Flow (Before Droplet Migration)

#### Deal Population
- **Source:** M&A Model Tracker Excel spreadsheet (`/Users/donaldross/Downloads/M&A Model Tracker (1).xlsx`)
- **Extraction:** Python script `extract-all-deals.py` reads the "M&A Dashboard" sheet
- **Seeding:** Multiple Prisma seed scripts populate the database:
  - `prisma/seed.ts` - Main seed script
  - `prisma/seed-all-deals.ts` - All deals from spreadsheet
  - `prisma/seed-all-deals-fixed.ts` - Fixed version with proper date handling
  - `prisma/seed-exact.ts` - Exact data from spreadsheet
- **Execution:** Manual via `npm run db:seed` (runs `tsx prisma/seed.ts`)

#### Watched Spreads
- **Storage:** `watched_spreads` table (already exists in schema ✅)
- **Creation:** User saves spreads via `/api/ma-options/watch-spread` POST endpoint
- **Retrieval:** Fetched via `/api/ma-options/watched-spreads` GET endpoint
- **Persistence:** Fully database-backed, no external dependencies

### Why Watched Spreads Were Lost

The watched spreads were stored in the **old local Postgres database** (`postgresql://donaldross@localhost:5432/ma_tracker` on Mac). When we created the new Postgres container on the droplet, it started with an empty database.

---

## ✅ Solution Strategy

### Phase 1: Restore Deal Data (Immediate)

**Option A: Run Seed Script on Droplet** ✅ RECOMMENDED
- Copy seed script to droplet
- Execute inside Docker container
- Populates all deals, users, versions, prices, CVRs

**Option B: Export/Import from Local DB**
- Export deals from local Mac Postgres
- Import into droplet Postgres
- Preserves exact state including watched spreads

### Phase 2: Restore Watched Spreads (If Needed)

**Option A: Re-create Manually**
- User re-adds spreads via UI
- Clean slate, current market data

**Option B: Export/Import from Local DB**
- Export watched_spreads from local Postgres
- Import into droplet Postgres
- Preserves historical selections

### Phase 3: Ongoing Data Sync (Future)

**Current State:** Manual seed script execution  
**Future Enhancement:** Automated sync job
- Periodic sync from M&A spreadsheet
- API endpoint to trigger sync
- Idempotent (no duplicates)

---

## 🚀 Implementation Plan

### Step 1: Choose the Best Seed Script

After reviewing all seed scripts, **`prisma/seed-all-deals-fixed.ts`** is the best choice because:
- ✅ Most comprehensive deal data (40+ deals)
- ✅ Proper date handling (`parseLocalDate` function)
- ✅ Includes current yields
- ✅ Creates user, deals, versions, prices, CVRs
- ✅ Safe (clears existing data first)

### Step 2: Execute Seed Script on Droplet

```bash
# 1. Ensure seed script is synced to droplet
rsync -avz prisma/ don@134.199.204.12:/home/don/apps/ma-tracker-app/prisma/

# 2. Run seed script inside Docker container
ssh don@134.199.204.12
cd /home/don/apps
docker exec ma-tracker-app-web npm run db:seed

# 3. Verify data was populated
docker exec ma-tracker-postgres psql -U ma_user -d ma_tracker -c "SELECT COUNT(*) FROM deals;"
docker exec ma-tracker-postgres psql -U ma_user -d ma_tracker -c "SELECT ticker, target_name FROM deals LIMIT 10;"
```

### Step 3: Verify in UI

```bash
# Visit MA Options Scanner
open http://134.199.204.12:3000/ma-options

# Expected:
# - Deals dropdown populated with 40+ tickers
# - Can select deals and fetch option chains
# - Can save spreads to watch list
```

### Step 4: Test Watched Spread Persistence

```bash
# 1. Add a spread via UI
# 2. Reload page
# 3. Verify spread persists

# Or check database directly:
docker exec ma-tracker-postgres psql -U ma_user -d ma_tracker -c "SELECT COUNT(*) FROM watched_spreads;"
```

---

## 📊 Data Safety Considerations

### Idempotency

The seed script **clears existing data first**:

```typescript
// From seed-all-deals-fixed.ts
await prisma.dealSnapshot.deleteMany({})
await prisma.portfolioPosition.deleteMany({})
await prisma.cvr.deleteMany({})
await prisma.dealPrice.deleteMany({})
await prisma.dealVersion.deleteMany({})
await prisma.deal.deleteMany({})
await prisma.user.deleteMany({})
```

**⚠️ WARNING:** This means:
- Running the seed script will **DELETE ALL EXISTING DATA**
- Any watched spreads will be **LOST**
- This is safe for initial population, but NOT safe for re-syncing

### User State Preservation

To preserve user state (watched spreads) during re-seeding:

**Option 1: Modify Seed Script (Recommended)**
```typescript
// Only clear deal-related data, preserve watched_spreads
await prisma.dealSnapshot.deleteMany({})
await prisma.portfolioPosition.deleteMany({})
await prisma.cvr.deleteMany({})
await prisma.dealPrice.deleteMany({})
await prisma.dealVersion.deleteMany({})
await prisma.deal.deleteMany({})
// DON'T delete watched_spreads
// DON'T delete users (if they have watched spreads)
```

**Option 2: Export/Import Watched Spreads**
```bash
# Before re-seeding: Export watched spreads
docker exec ma-tracker-postgres pg_dump -U ma_user -d ma_tracker -t watched_spreads > watched_spreads_backup.sql

# After re-seeding: Restore watched spreads
docker exec -i ma-tracker-postgres psql -U ma_user -d ma_tracker < watched_spreads_backup.sql
```

---

## 🔄 Future: Automated Deal Sync

### Current Limitation

Deals are **manually seeded** from a static Excel file. This means:
- ❌ No automatic updates when deals change
- ❌ Must manually re-run seed script
- ❌ Risk of data loss if not careful

### Recommended Enhancement

Create an **idempotent sync job** that:
1. Reads M&A spreadsheet (or API)
2. **Upserts** deals (insert if new, update if exists)
3. **Never deletes** user state (watched spreads)
4. Runs on schedule (daily/weekly)

**Implementation:**
```typescript
// prisma/sync-deals.ts
async function syncDeals() {
  const deals = await fetchDealsFromSource(); // Excel, API, etc.
  
  for (const dealData of deals) {
    // Upsert deal (safe, no deletion)
    await prisma.deal.upsert({
      where: { ticker: dealData.ticker },
      update: {
        targetName: dealData.targetName,
        acquirorName: dealData.acquirorName,
        // ... other fields
      },
      create: {
        ticker: dealData.ticker,
        targetName: dealData.targetName,
        // ... all fields
      },
    });
  }
}
```

---

## 📝 Execution Checklist

### Immediate (Now)
- [ ] Sync seed script to droplet
- [ ] Run seed script in Docker container
- [ ] Verify deals populated (40+ deals)
- [ ] Test UI loads deals
- [ ] Test saving a watched spread
- [ ] Test spread persists after reload

### Short-term (Next Week)
- [ ] Modify seed script to preserve watched spreads
- [ ] Create backup script for watched spreads
- [ ] Document re-seeding procedure

### Long-term (Future)
- [ ] Create idempotent sync job
- [ ] Add API endpoint to trigger sync
- [ ] Set up automated sync schedule
- [ ] Add sync monitoring/alerts

---

## 🎯 Success Criteria

### Phase 1: Deal Data Restored
- [x] Postgres database has correct schema
- [ ] 40+ deals populated in `deals` table
- [ ] Each deal has version, price, and CVR data
- [ ] User account created (power_user)
- [ ] UI shows deals in dropdown

### Phase 2: Watched Spreads Working
- [ ] Can save spreads via UI
- [ ] Spreads persist after page reload
- [ ] Can view all watched spreads
- [ ] Can update spread notes
- [ ] Can deactivate spreads

### Phase 3: Data Safety
- [ ] Re-seeding doesn't delete watched spreads
- [ ] Backup procedure documented
- [ ] Restore procedure tested

---

## 📚 Related Files

**Seed Scripts:**
- `prisma/seed-all-deals-fixed.ts` - ✅ Best choice for initial population
- `prisma/seed.ts` - Alternative (fewer deals)
- `extract-all-deals.py` - Python script to extract from Excel

**API Routes:**
- `app/api/ma-options/deals/route.ts` - Fetch deals for UI
- `app/api/ma-options/watch-spread/route.ts` - Save watched spreads
- `app/api/ma-options/watched-spreads/route.ts` - Retrieve watched spreads

**Database:**
- `prisma/schema.prisma` - Database schema
- `/home/don/apps/docker-compose.yml` - Postgres container config

---

**Next Step:** Execute Step 2 (Run seed script on droplet)


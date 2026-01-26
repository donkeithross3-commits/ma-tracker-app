# KRJ Summary Box Resize Plan

**Date:** December 26, 2025  
**Objective:** Increase the size of the yellow summary box on the KRJ page (approximately double)  
**Approach:** Test locally first, review with user, then deploy to droplet

---

## Current State

### Location
**File:** `components/KrjTabsClient.tsx`  
**Lines:** 252-265

### Current Styling
```tsx
<div className="bg-yellow-300 text-black rounded px-2 py-1 inline-block text-[10px] font-semibold">
```

**Current dimensions:**
- `text-[10px]` - Font size: 10px
- `px-2` - Horizontal padding: 0.5rem (8px)
- `py-1` - Vertical padding: 0.25rem (4px)
- `inline-block` - Shrinks to content width
- `mb-1.5` - Margin bottom: 0.375rem (6px) on parent div

### Current Content
Displays: `L:76 (+23) | N:348 (-32) | S:77 (+9) | Tot:501`
- L = Long signals
- N = Neutral signals  
- S = Short signals
- Tot = Total count
- Numbers in parentheses show delta from previous week

---

## Proposed Changes

### Approach: Approximately Double the Size

**Font Size:** `text-[10px]` → `text-[18px]` (1.8x increase)  
**Padding:** `px-2 py-1` → `px-4 py-2` (2x increase)  
**Display:** Keep `inline-block` (maintains compact width)  
**Spacing:** `mb-1.5` → `mb-3` (2x increase for better separation)

### New Styling
```tsx
<div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
```

### Visual Impact
- **Before:** Small, compact box (10px text, minimal padding)
- **After:** Larger, more prominent box (18px text, generous padding)
- **Readability:** Significantly improved for quick scanning
- **Visual hierarchy:** More prominent summary information

---

## Implementation Steps

### Step 1: Make Code Changes

**File to edit:** `components/KrjTabsClient.tsx`

**Change 1 - Parent div (line 252):**
```tsx
// BEFORE:
<div className="mb-1.5">

// AFTER:
<div className="mb-3">
```

**Change 2 - Summary box (line 253):**
```tsx
// BEFORE:
<div className="bg-yellow-300 text-black rounded px-2 py-1 inline-block text-[10px] font-semibold">

// AFTER:
<div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
```

### Step 2: Test Locally

```bash
# Clean build
cd /Users/donaldross/dev/ma-tracker-app
rm -rf .next && npm run build

# Start dev server
npm run dev

# Open in browser
open http://localhost:3000/krj

# Verify:
# 1. Yellow box is approximately double the size
# 2. Text is clearly readable (18px vs 10px)
# 3. Box doesn't overflow or break layout
# 4. Spacing above table looks good (mb-3)
# 5. All tabs (Equities, ETFs/FX, SP500, SP100) look consistent
```

### Step 3: Visual Review

**Check these aspects:**
1. **Size:** Is it approximately double? Does it feel right?
2. **Readability:** Is the text easier to read?
3. **Layout:** Does it fit well above the table?
4. **Consistency:** Does it look good across all tabs?
5. **Mobile:** Check responsive behavior (if applicable)

**If adjustments needed:**
- Too large: Reduce to `text-[16px]` or `text-[14px]`
- Too small: Increase to `text-[20px]`
- Padding issues: Adjust `px-` and `py-` values
- Spacing issues: Adjust `mb-` value

### Step 4: User Review

**Present to user:**
1. Show before/after screenshots (if possible)
2. Let user interact with live local version
3. Get feedback on size, readability, visual balance
4. Make any requested adjustments

### Step 5: Deploy to Droplet (After Approval)

```bash
# 1. Sync files
cd /Users/donaldross/dev/ma-tracker-app
rsync -avz --exclude 'node_modules' --exclude '.next' \
  components/KrjTabsClient.tsx \
  don@134.199.204.12:/home/don/apps/ma-tracker-app/components/

# 2. SSH to droplet
ssh don@134.199.204.12

# 3. Rebuild Docker image
cd /home/don/apps/ma-tracker-app
docker build -t ma-tracker-app-dev -f Dockerfile .

# 4. Restart web container
cd /home/don/apps
docker compose restart web

# 5. Verify deployment
curl -s http://134.199.204.12:3000/krj | grep -A 5 "bg-yellow-300"
# Or open in browser: http://134.199.204.12:3000/krj
```

---

## Rollback Plan

If the changes don't look good or cause issues:

```bash
# Revert the file
cd /Users/donaldross/dev/ma-tracker-app
git checkout HEAD -- components/KrjTabsClient.tsx

# Rebuild locally
rm -rf .next && npm run build
npm run dev

# If already deployed to droplet:
ssh don@134.199.204.12
cd /home/don/apps/ma-tracker-app
git checkout HEAD -- components/KrjTabsClient.tsx
docker build -t ma-tracker-app-dev -f Dockerfile .
cd /home/don/apps
docker compose restart web
```

---

## Alternative Size Options

If doubling is too much or too little, here are alternatives:

### Option A: 1.5x increase (more conservative)
```tsx
<div className="bg-yellow-300 text-black rounded px-3 py-1.5 inline-block text-[14px] font-semibold">
```

### Option B: 2x increase (proposed)
```tsx
<div className="bg-yellow-300 text-black rounded px-4 py-2 inline-block text-[18px] font-semibold">
```

### Option C: 2.5x increase (more aggressive)
```tsx
<div className="bg-yellow-300 text-black rounded px-5 py-2.5 inline-block text-[22px] font-semibold">
```

### Option D: Full-width block (maximum prominence)
```tsx
<div className="bg-yellow-300 text-black rounded px-4 py-2 block text-[18px] font-semibold">
```

---

## Success Criteria

- ✅ Yellow box is visibly larger (approximately double)
- ✅ Text is more readable at a glance
- ✅ Layout remains clean and professional
- ✅ No overflow or layout breaking
- ✅ Consistent across all tabs
- ✅ User approves the visual change
- ✅ Successfully deployed to droplet

---

## Testing Checklist

### Local Testing
- [ ] Clean build completed without errors
- [ ] Dev server starts successfully
- [ ] Yellow box appears larger on all tabs
- [ ] Text is clearly readable (18px)
- [ ] No layout issues or overflow
- [ ] Spacing above table looks good
- [ ] Print layout still works (if applicable)

### User Review
- [ ] User sees local version
- [ ] User approves size increase
- [ ] Any requested adjustments made
- [ ] Final approval received

### Droplet Deployment
- [ ] Files synced to droplet
- [ ] Docker image rebuilt
- [ ] Web container restarted
- [ ] Yellow box appears correctly on production
- [ ] No errors in Docker logs
- [ ] All tabs work correctly

---

## Notes

- This is a **visual-only change** - no functionality changes
- Only affects the summary box styling
- Does not impact data loading or calculations
- Safe to test and iterate locally before deploying
- Easy to rollback if needed

---

*Plan created: 2025-12-26*
*Ready for implementation and testing*


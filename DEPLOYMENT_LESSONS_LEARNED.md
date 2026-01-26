# Deployment Lessons Learned - December 26, 2025

## Summary

Successfully deployed KRJ UI improvements (50% larger fonts, removed subtitle, tightened spacing) after discovering critical architecture details about how the droplet deployment works.

---

## What We Deployed

### UI Changes
1. **Font sizes increased 50%:**
   - Title: 20px → 30px (`text-xl` → `text-3xl`)
   - Date: 14px → 21px (`text-sm` → `text-xl`)
   - Tabs: 12px → 18px (`text-xs` → `text-lg`)
   - Table body: 11px → 16px (`text-[11px]` → `text-[16px]`)
   - Table headers: 9px → 14px (`text-[9px]` → `text-[14px]`)

2. **Layout improvements:**
   - Removed subtitle text ("Latest snapshot for each group...")
   - Tightened spacing (all `mb-3` → `mb-1`)
   - Moved Print button inline with tabs (eliminated blank space)

3. **Kept unchanged (as requested):**
   - Summary box: `text-[18px]` (fixed size)
   - M&A button: `text-sm` (fixed size)

---

## Critical Discovery: Docker Architecture

### The Problem

Initially thought deployment was:
```bash
rsync files → restart container → done
```

**This was wrong!** Changes weren't appearing despite multiple deployments.

### The Root Cause

The droplet runs Docker with **code baked into the image at build time:**

1. **Code is NOT mounted as a volume**
   - Only `/app/data/krj` is mounted (for CSV data)
   - Application code is copied into image with `COPY . .` in Dockerfile

2. **docker-compose.yml has no build section**
   - Only references pre-built image: `image: ma-tracker-app-dev`
   - Doesn't build the image itself

3. **Container uses code from image, not host**
   - Syncing files to host doesn't affect running container
   - Container has its own copy of code from when image was built

### The Solution

**Must rebuild Docker image to deploy code changes:**

```bash
# 1. Sync files to build directory
rsync -avz app/ components/ don@droplet:/home/don/apps/ma-tracker-app/

# 2. Build Docker image (code is baked in here)
ssh don@droplet "cd /home/don/apps/ma-tracker-app && \
  docker build --no-cache -t ma-tracker-app-dev ."

# 3. Restart container to use new image
ssh don@droplet "cd /home/don/apps && \
  docker compose down && docker compose up -d web"
```

---

## Debugging Process

### What We Tried (That Didn't Work)

1. ❌ Syncing files and restarting container
2. ❌ Using `docker compose build` (no build config)
3. ❌ Using `docker compose restart` (doesn't load new image)
4. ❌ Rebuilding with cache (used old cached layers)

### The Breakthrough

**Canary test with red title:**
- Changed title color to red
- Synced, rebuilt, restarted
- Red title appeared! (confirmed deployment pipeline)
- Changed back to gray
- Deployed final version successfully

### Key Verification Commands

```bash
# Check what's actually in the running container
ssh don@droplet "docker exec ma-tracker-app-web cat /app/app/krj/page.tsx | grep 'text-gray-100'"

# Compare host vs container (timestamps will differ)
ssh don@droplet "ls -la /home/don/apps/ma-tracker-app/app/krj/page.tsx"
ssh don@droplet "docker exec ma-tracker-app-web ls -la /app/app/krj/page.tsx"
```

---

## Documentation Created

### 1. `docs/DROPLET_DEPLOYMENT_ARCHITECTURE.md`
Comprehensive guide covering:
- How Docker images work on the droplet
- Why code must be baked into images
- Step-by-step deployment process
- Common mistakes and how to avoid them
- Verification commands
- Debugging techniques

### 2. Updated `.claude-rules`
Added new section: "CRITICAL: Droplet Deployment Architecture"
- Quick reference for deployment process
- Common mistakes table
- Verification commands
- Links to detailed docs

### 3. Updated `scripts/deploy-to-droplet.sh`
- Added comments explaining the architecture
- Fixed build process to use correct directory
- Ensured `--no-cache` is used for code changes
- Proper restart sequence (`down` then `up`)

### 4. Updated `docs/KRJ_UI_STYLE_GUIDE.md`
- Documented new font sizes
- Documented spacing changes
- Added change history
- Guidelines for future changes

---

## Key Takeaways

### For Future Deployments

1. ✅ **Always rebuild the Docker image** after syncing code
2. ✅ **Use `--no-cache`** to ensure fresh build
3. ✅ **Restart with `down` then `up`** (not just `restart`)
4. ✅ **Verify code in container** (not just on host)
5. ✅ **Hard refresh browser** (`Cmd+Shift+R`)

### Architecture Understanding

- **Code:** Baked into Docker image at build time
- **Data:** Mounted as volume, changes immediately visible
- **Dev Mode:** Runs `npm run dev` (not production build)
- **No Hot Reload:** Container doesn't watch host files
- **Image Name:** `ma-tracker-app-dev` (referenced by docker-compose)

### Deployment Checklist

- [ ] Sync files to `/home/don/apps/ma-tracker-app/`
- [ ] Build image: `cd /home/don/apps/ma-tracker-app && docker build --no-cache -t ma-tracker-app-dev .`
- [ ] Restart: `cd /home/don/apps && docker compose down && docker compose up -d web`
- [ ] Verify: `docker exec ma-tracker-app-web cat /app/app/krj/page.tsx | head -20`
- [ ] Hard refresh browser

---

## Browser Caching

Even with correct deployment, browsers cache aggressively.

### Always Use Hard Refresh

- **Mac:** `Cmd + Shift + R`
- **Windows/Linux:** `Ctrl + Shift + R`
- **Alternative:** Open in incognito/private window

### Why It Matters

Next.js serves static assets with cache headers. Without hard refresh:
- Browser uses cached HTML
- Cached JavaScript bundles
- Cached CSS styles
- Changes appear not deployed (but they are!)

---

## Files Modified

### Application Code
- `app/krj/page.tsx` - Font sizes, removed subtitle, spacing
- `components/KrjTabsClient.tsx` - Font sizes, Print button inline, spacing

### Documentation
- `docs/DROPLET_DEPLOYMENT_ARCHITECTURE.md` - NEW: Complete architecture guide
- `docs/KRJ_UI_STYLE_GUIDE.md` - NEW: Comprehensive style guide
- `.claude-rules` - Added deployment architecture section
- `DEPLOYMENT_LESSONS_LEARNED.md` - This file

### Scripts
- `scripts/deploy-to-droplet.sh` - Updated with correct build process

---

## Success Metrics

### Before
- ❌ Deployments took multiple attempts
- ❌ Changes didn't appear despite "successful" deployment
- ❌ No clear understanding of why
- ❌ Manual trial-and-error debugging

### After
- ✅ Deployment process documented and understood
- ✅ Automated script that works correctly
- ✅ Clear verification steps
- ✅ Reproducible process for future deployments

---

## Future Improvements

### Short Term
1. Update `scripts/deploy-to-droplet.sh` to use new architecture
2. Add verification step to deployment script
3. Create rollback procedure

### Long Term
1. Consider production build (`npm run build` + `npm start`)
2. Add build section to docker-compose.yml
3. Implement CI/CD pipeline
4. Add health check endpoint
5. Set up proper logging and monitoring

---

## Timeline

**Start:** December 26, 2025 - 2:00 PM  
**Issue Discovered:** Multiple deployments not showing changes  
**Root Cause Found:** Code baked into Docker image, not mounted  
**Solution Implemented:** Rebuild image as part of deployment  
**Success:** December 26, 2025 - 3:00 PM  
**Duration:** ~1 hour of debugging and documentation

---

## Conclusion

This deployment taught us a critical lesson about our Docker architecture. The time spent debugging and documenting will save hours in future deployments.

**Key insight:** When in doubt, rebuild the image. It's the only way to guarantee code changes are deployed.

---

*Documented by: AI Assistant*  
*Verified by: Don Ross*  
*Date: December 26, 2025*


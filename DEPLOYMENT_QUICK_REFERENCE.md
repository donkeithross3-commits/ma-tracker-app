# KRJ Deployment - Quick Reference

**Last Updated:** December 26, 2025  
**For detailed docs, see:** `DEPLOYMENT_KRJ.md`

---

## One-Line Deployments

### Quick Deploy (Components/UI Changes)
```bash
./scripts/deploy-to-droplet.sh quick
```

### Full Deploy (Multiple Files)
```bash
./scripts/deploy-to-droplet.sh full
```

### Batch Script Deploy
```bash
./scripts/deploy-to-droplet.sh batch
```

---

## Manual Deployment (4 Steps)

```bash
# 1. Sync files
rsync -avz components/KrjTabsClient.tsx \
  don@134.199.204.12:/home/don/apps/ma-tracker-app/components/

# 2. Rebuild (with --no-cache!)
ssh don@134.199.204.12 \
  "cd /home/don/apps/ma-tracker-app && docker build --no-cache -t ma-tracker-app-dev -f Dockerfile ."

# 3. Recreate container (down + up, not restart!)
ssh don@134.199.204.12 \
  "cd /home/don/apps && docker compose down web && docker compose up -d web"

# 4. Verify
ssh don@134.199.204.12 "cd /home/don/apps && docker compose logs web --tail 20"
```

---

## Critical Rules

### ✅ DO
- ✅ Use `--no-cache` when building
- ✅ Use `down` then `up` (not `restart`)
- ✅ Hard refresh browser (Cmd+Shift+R)
- ✅ Test locally first (`npm run dev`)
- ✅ Check logs after deploy

### ❌ DON'T
- ❌ Use `docker compose restart` for code changes
- ❌ Skip `--no-cache` flag
- ❌ Trust browser without hard refresh
- ❌ Deploy without local testing

---

## Troubleshooting

### Changes Not Visible in Browser
**Symptom:** Deployed but UI looks the same  
**Cause:** Browser cache  
**Fix:** Hard refresh (Cmd+Shift+R) or incognito window  
**Verify:** `curl -s http://134.199.204.12:3000/krj | grep "your-class"`

### Container Shows Old Code
**Symptom:** Logs show old behavior  
**Cause:** Docker build cache  
**Fix:** Use `--no-cache` flag  
**Verify:** Check file timestamp on server

### Container Not Updated
**Symptom:** Rebuild worked but container unchanged  
**Cause:** Container using old image  
**Fix:** Use `down` then `up` (not `restart`)  
**Verify:** Check image hash in `docker compose ps`

---

## Pre-Deployment Checklist

- [ ] Tested locally (`npm run dev`)
- [ ] No TypeScript errors (`npm run build`)
- [ ] Reviewed changed files
- [ ] Committed changes to git

## Post-Deployment Checklist

- [ ] Container running (`docker compose ps`)
- [ ] No errors in logs (`docker compose logs web --tail 20`)
- [ ] Hard refresh browser (Cmd+Shift+R)
- [ ] Verified changes visible
- [ ] Tested all affected tabs/pages

---

## Quick Verification

```bash
# Check container status
ssh don@134.199.204.12 "cd /home/don/apps && docker compose ps"

# Check recent logs
ssh don@134.199.204.12 "cd /home/don/apps && docker compose logs web --tail 20"

# Verify HTML contains new code
curl -s http://134.199.204.12:3000/krj | grep "your-new-class"

# Check file timestamp on server
ssh don@134.199.204.12 "ls -la /home/don/apps/ma-tracker-app/components/KrjTabsClient.tsx"
```

---

## Browser Hard Refresh

**Mac:**
- Chrome/Edge: `Cmd + Shift + R`
- Safari: `Cmd + Option + R`
- Firefox: `Cmd + Shift + R`

**Windows/Linux:**
- All browsers: `Ctrl + Shift + R`

**Alternative:**
- Use incognito/private window
- Open DevTools → Network tab → Check "Disable cache" → Reload

---

## Common Scenarios

### Scenario 1: Single Component Change
```bash
./scripts/deploy-to-droplet.sh quick
# Hard refresh browser
```

### Scenario 2: Multiple File Changes
```bash
./scripts/deploy-to-droplet.sh full
# Hard refresh browser
```

### Scenario 3: Batch Script Update
```bash
./scripts/deploy-to-droplet.sh batch
# No browser refresh needed (backend only)
```

### Scenario 4: Dependency Update
```bash
# Edit package.json locally
npm install
# Test locally
./scripts/deploy-to-droplet.sh full
# Hard refresh browser
```

---

## Deployment Script Options

```bash
# Default: Deploy components
./scripts/deploy-to-droplet.sh

# Deploy specific file
./scripts/deploy-to-droplet.sh quick app/krj/page.tsx

# Deploy everything
./scripts/deploy-to-droplet.sh full

# Deploy batch script
./scripts/deploy-to-droplet.sh batch
```

---

## Emergency Rollback

```bash
# 1. Revert local changes
git checkout HEAD -- components/KrjTabsClient.tsx

# 2. Deploy reverted version
./scripts/deploy-to-droplet.sh quick

# 3. Verify
curl -s http://134.199.204.12:3000/krj | grep "expected-class"
```

---

## Key Learnings (Dec 26, 2025)

### Issue: Browser Cache
- **Problem:** Deployed changes not visible in browser
- **Root Cause:** Browser serving cached HTML/CSS
- **Solution:** Always hard refresh (Cmd+Shift+R) after deploy
- **Lesson:** Add reminder to deployment script and docs

### Issue: Docker Build Cache
- **Problem:** Container not picking up code changes
- **Root Cause:** Docker reusing cached layers
- **Solution:** Always use `--no-cache` flag
- **Lesson:** Make `--no-cache` the default in scripts

### Issue: Container Image Not Updated
- **Problem:** Rebuilt image but container shows old code
- **Root Cause:** `docker compose restart` doesn't pull new image
- **Solution:** Use `down` then `up` to recreate container
- **Lesson:** Never use `restart` for code changes

---

## URLs

- **Production:** http://134.199.204.12:3000/krj
- **Local Dev:** http://localhost:3000/krj

---

## Related Documentation

- `DEPLOYMENT_KRJ.md` - Comprehensive deployment guide
- `docs/KRJ_DEV_WORKFLOW.md` - Development workflow
- `docs/KRJ_STYLE_GUIDE.md` - UI style guidelines
- `.claude-rules` - Project rules and context

---

*Keep this file updated with new learnings and deployment patterns*


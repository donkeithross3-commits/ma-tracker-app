# KRJ Production Deployment Guide

**Migrating from development mode to production mode**

---

## Executive Summary

This guide walks through migrating the KRJ deployment from development mode (`npm run dev`) to production mode (`npm run build` + `node server.js`) with optimized Docker configuration.

**CRITICAL: This deployment ONLY changes how the web app runs (dev → prod). It does NOT change:**
- ❌ How KRJ data is produced (still local Mac backtester)
- ❌ How KRJ CSVs are copied (still rsync + krj-batch)
- ❌ How the UI reads CSVs (still /app/data/krj/*.csv)
- ✅ ONLY changes: Web container runs production build instead of dev mode

---

## What's Changing

### Before (Development Mode)
- Web container runs `npm run dev`
- React dev mode with hot reload
- High CPU/RAM usage
- Unoptimized bundles
- Verbose logging

### After (Production Mode)
- Web container runs `node server.js`
- Optimized Next.js standalone server
- Lower CPU/RAM usage (~50% reduction expected)
- Optimized bundles
- Production logging

### What's NOT Changing
- ✅ KRJ data flow (Local Mac → rsync → krj-batch → data/krj/ → web UI)
- ✅ Volume mount paths (`./data/krj:/app/data/krj`)
- ✅ Port 3000
- ✅ Basic auth on `/krj`
- ✅ krj-batch workflow
- ✅ docker-compose as control plane

---

## New Files Created

1. **`Dockerfile.prod`** - Production-optimized 2-stage Dockerfile
2. **`docker-compose.prod.yml`** - Production docker-compose configuration
3. **`next.config.ts`** - Updated with `output: 'standalone'`

---

## Simplified 2-Stage Dockerfile

### Stage 1: Builder
- Install all dependencies (including dev for build)
- Copy Prisma schema BEFORE npm ci (fixes postinstall)
- Generate Prisma client
- Build Next.js app (creates `.next/standalone`)

### Stage 2: Runner
- Slim Node image (~200MB vs ~1GB)
- Copy standalone server + static files
- Run as non-root user (nextjs:1001)
- Healthcheck on `/` (currently public)
- Start with `node server.js`

**Key improvements:**
- Clean 2-stage build (no unused stages)
- Prisma handled correctly
- Non-root execution for security
- Built-in healthcheck

---

## Docker Compose Changes

### Volume Mounts (PRESERVED EXACTLY)
```yaml
# Web service
- ./data/krj:/app/data/krj:ro  # Read-only, unchanged path

# Batch service  
- ./data/krj:/data/krj  # Write access, unchanged path
- ./py_proj/daily_data:/root/Documents/daily_data:ro  # Read-only, unchanged path
```

### New Features
- `env_file` for cleaner environment variable management
- `restart: unless-stopped` for auto-restart on failure
- Healthcheck for container monitoring
- Log rotation (10MB max, 3 files)

### Removed
- Unused build args (NODE_ENV not needed in build context)
- Inline comments (moved above for clean indentation)

---

## Migration Steps

### Phase 1: Local Testing (Your Mac)

**Goal:** Validate production build locally before touching server

```bash
# 1. Navigate to project
cd /Users/donaldross/dev/ma-tracker-app

# 2. Verify next.config.ts has standalone output
cat next.config.ts | grep standalone
# Should see: output: 'standalone',

# 3. Test production build locally
npm run build
npm start

# 4. Verify app works
open http://localhost:3000
# Check /krj dashboard loads

# 5. Stop local server
# Ctrl+C

# 6. Build production Docker image locally
docker build -f Dockerfile.prod -t ma-tracker-app-prod:test .

# 7. Test Docker image locally
docker run -d \
  --name krj-test \
  -p 3000:3000 \
  -v $(pwd)/data/krj:/app/data/krj:ro \
  --env-file .env.local \
  ma-tracker-app-prod:test

# 8. Verify container works
docker logs krj-test
open http://localhost:3000/krj

# 9. Check CSV data loads correctly
# Verify all 4 tabs (SP500, SP100, ETFs/FX, Equities)

# 10. Clean up test container
docker stop krj-test
docker rm krj-test
```

**Validation checklist:**
- ✅ Build completes without errors
- ✅ Prisma client generates correctly
- ✅ App starts and responds on port 3000
- ✅ KRJ dashboard loads
- ✅ CSV data displays correctly
- ✅ Basic auth works

---

### Phase 2: Server Deployment (Droplet)

**Estimated downtime: 30-60 seconds**

#### Step 1: Backup Current Setup

```bash
# SSH to droplet
ssh don@<DROPLET_IP>

# Navigate to apps directory
cd /home/don/apps

# Create backup
tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  docker-compose.yml \
  ma-tracker-app/Dockerfile \
  ma-tracker-app/.env.local

# Verify backup
ls -lh backup-*.tar.gz
```

#### Step 2: Sync New Files

**Option A: Using git (if repo is set up)**
```bash
cd /home/don/apps/ma-tracker-app
git pull origin main
```

**Option B: Using rsync (from your Mac)**
```bash
# From your Mac
rsync -avz --exclude node_modules --exclude .next \
  /Users/donaldross/dev/ma-tracker-app/ \
  don@<DROPLET_IP>:/home/don/apps/ma-tracker-app/

# Verify files arrived
ssh don@<DROPLET_IP> "ls -l /home/don/apps/ma-tracker-app/Dockerfile.prod"
ssh don@<DROPLET_IP> "ls -l /home/don/apps/ma-tracker-app/docker-compose.prod.yml"
```

#### Step 3: Replace docker-compose.yml

```bash
# On droplet
cd /home/don/apps

# Backup old compose file (already in tar.gz, but extra safety)
cp docker-compose.yml docker-compose.yml.old

# Copy new production compose file
cp ma-tracker-app/docker-compose.prod.yml docker-compose.yml

# Verify
cat docker-compose.yml | grep "Dockerfile.prod"
# Should see: dockerfile: Dockerfile.prod
```

#### Step 4: Build Production Image

```bash
cd /home/don/apps

# Build new production image (old container still running)
docker compose build web

# Verify image built successfully
docker images | grep ma-tracker-app-prod

# Expected output:
# ma-tracker-app-prod   latest   <IMAGE_ID>   X minutes ago   ~200-300MB
```

**If build fails:**
- Check logs: `docker compose build web 2>&1 | tee build.log`
- Check disk space: `df -h`
- Clear cache if needed: `docker builder prune`

#### Step 5: Cutover (DOWNTIME STARTS)

```bash
cd /home/don/apps

# Stop current web service
docker compose stop web

# Remove old container (keeps image for rollback)
docker compose rm -f web

# Start new production service
docker compose up -d web

# Watch logs for startup
docker compose logs -f web

# Expected output:
# ✓ Ready in X ms
# ○ Listening on http://0.0.0.0:3000
```

**Estimated downtime: 30-60 seconds**

#### Step 6: Validation

```bash
# 1. Check container is running
docker compose ps

# Expected:
# NAME                    STATUS
# ma-tracker-app-web      Up X seconds (healthy)

# 2. Check logs for errors
docker compose logs web | grep -i error
# Should be empty or only harmless warnings

# 3. Test health endpoint
curl -I http://localhost:3000

# Expected: HTTP/1.1 200 OK

# 4. Check resource usage
docker stats ma-tracker-app-web --no-stream

# Expected: Lower CPU/RAM than before

# 5. Test krj-batch still works
docker compose run --rm krj-batch

# Expected: Copies files successfully
```

#### Step 7: End-to-End Validation (From Your Mac)

```bash
# Open browser
open http://<DROPLET_IP>:3000/krj

# Verify:
# ✅ Basic auth prompts for credentials
# ✅ Basic auth accepts correct credentials
# ✅ Dashboard loads
# ✅ All 4 tabs present (SP500, SP100, ETFs/FX, Equities)
# ✅ CSV data displays correctly
# ✅ No console errors in browser
# ✅ Page loads faster than before
```

---

### Phase 3: Rollback (If Needed)

**If something goes wrong, rollback immediately:**

```bash
cd /home/don/apps

# 1. Stop broken production container
docker compose stop web
docker compose rm -f web

# 2. Restore old docker-compose.yml
cp docker-compose.yml.old docker-compose.yml

# OR restore from backup
tar -xzf backup-<TIMESTAMP>.tar.gz

# 3. Rebuild old dev image (if needed)
docker compose build web

# 4. Start old service
docker compose up -d web

# 5. Verify old service works
curl http://localhost:3000/krj
```

---

## Validation Checklist

### Pre-Deployment (Local)
- [ ] `next.config.ts` updated with `output: 'standalone'`
- [ ] `Dockerfile.prod` created
- [ ] `docker-compose.prod.yml` created
- [ ] Local production build succeeds: `npm run build`
- [ ] Local production server works: `npm start`
- [ ] Local Docker image builds successfully
- [ ] Local Docker container runs and serves app
- [ ] KRJ dashboard loads with local CSV data

### Deployment (Server)
- [ ] Backup created: `backup-YYYYMMDD-HHMMSS.tar.gz`
- [ ] New files synced to server
- [ ] `docker-compose.yml` replaced with production version
- [ ] Production image builds on server
- [ ] Old container stopped gracefully
- [ ] New container starts successfully
- [ ] Container status shows "Up" and "healthy"
- [ ] No errors in logs

### Functional (End-to-End)
- [ ] KRJ dashboard accessible at `http://<DROPLET_IP>:3000/krj`
- [ ] Basic auth prompts for credentials
- [ ] Basic auth accepts correct credentials
- [ ] Dashboard displays all 4 CSV tabs
- [ ] CSV data loads and displays correctly
- [ ] No console errors in browser
- [ ] Page loads faster than before (production mode)
- [ ] krj-batch runs successfully: `docker compose run --rm krj-batch`
- [ ] krj-batch copies files to `data/krj/`
- [ ] Web service picks up updated CSV files

### Performance
- [ ] CPU usage lower than before: `docker stats --no-stream`
- [ ] Memory usage lower than before
- [ ] Page load time <2 seconds
- [ ] Container restarts automatically if crashed

---

## Troubleshooting

### Issue: Build fails with Prisma error

**Symptoms:**
```
Error: @prisma/client did not initialize yet
```

**Solution:**
- Verify `COPY prisma ./prisma` comes BEFORE `RUN npm ci` in Dockerfile.prod
- Check that `prisma/schema.prisma` exists in local repo
- Try: `docker builder prune` and rebuild

### Issue: Container starts but crashes immediately

**Symptoms:**
```
docker compose ps
# Shows: ma-tracker-app-web   Restarting
```

**Diagnosis:**
```bash
docker compose logs web
```

**Common causes:**
- Missing `.env.local` file
- Missing required environment variables
- Port 3000 already in use
- Volume mount path incorrect

**Solution:**
- Verify `.env.local` exists and contains required variables
- Check port: `netstat -tuln | grep 3000`
- Verify volume paths match exactly

### Issue: KRJ dashboard shows no data

**Symptoms:**
- Dashboard loads but tables are empty
- Console error: "Failed to load CSV"

**Diagnosis:**
```bash
# Check if CSVs exist
ls -lh /home/don/apps/data/krj/

# Check volume mount inside container
docker compose exec web ls -lh /app/data/krj/
```

**Solution:**
- Verify volume mount path: `./data/krj:/app/data/krj:ro`
- Run krj-batch to regenerate CSVs: `docker compose run --rm krj-batch`
- Check file permissions: `ls -l /home/don/apps/data/krj/`

### Issue: Healthcheck failing

**Symptoms:**
```
docker compose ps
# Shows: ma-tracker-app-web   Up (unhealthy)
```

**Diagnosis:**
```bash
docker compose logs web | grep health
```

**Solution:**
- Verify app is actually responding: `curl http://localhost:3000`
- If `/` requires auth, update healthcheck to use `/healthz` endpoint
- Increase healthcheck timeout if app is slow to start

---

## Performance Expectations

### Before (Development Mode)
- **Memory:** ~400-600 MB
- **CPU (idle):** 5-10%
- **CPU (under load):** 20-40%
- **Startup time:** 10-15 seconds
- **Image size:** ~1 GB

### After (Production Mode)
- **Memory:** ~150-250 MB (60% reduction)
- **CPU (idle):** <2%
- **CPU (under load):** 5-15%
- **Startup time:** 3-5 seconds
- **Image size:** ~200-300 MB (70% reduction)

---

## Next Steps After Successful Deployment

1. **Monitor for 24 hours**
   - Watch logs: `docker compose logs -f web`
   - Check resource usage: `docker stats`
   - Verify no errors or crashes

2. **Document performance gains**
   - Record CPU/RAM before vs after
   - Measure page load times
   - Update documentation

3. **Plan future enhancements**
   - Nginx reverse proxy for SSL
   - Monitoring (Prometheus/Grafana)
   - Automated KRJ updates (cron)
   - Domain + Cloudflare

4. **Update `.claude-rules`**
   - Mark deployment as "production mode"
   - Update commands to reflect new setup

---

## Success Criteria

**Deployment is successful when:**
1. ✅ Web service running in production mode
2. ✅ KRJ dashboard fully functional
3. ✅ CSV data flow unchanged
4. ✅ Basic auth working
5. ✅ krj-batch still works on-demand
6. ✅ CPU/RAM usage reduced by >50%
7. ✅ No errors in logs for 1 hour
8. ✅ Container auto-restarts if crashed

**Deployment should be rolled back if:**
1. ❌ Build fails on server
2. ❌ Container won't start
3. ❌ KRJ dashboard doesn't load
4. ❌ CSV data not displaying
5. ❌ krj-batch broken
6. ❌ Critical errors in logs

---

*Last updated: 2025-12-25*
*Deployment version: Production v1.0*

